-- ============================================================================
-- 006_hardening_produccion.sql
-- Fase 1: endurecimiento de seguridad, integridad y despliegue.
-- Ejecutar DESPUÉS de 005. Diseñado para ser re-ejecutable.
--
-- Objetivos:
--   1. HC inmutable en pacientes y tablas hijas.
--   2. Filtrado RLS de tablas hijas por paciente NO eliminado.
--   3. Paciente eliminado queda fuera de lecturas rutinarias; enfermería no
--      puede operar sobre expedientes eliminados y solo el médico puede restaurarlos.
--   4. Audit log restringido al rol médico y sin snapshots completos para nuevos
--      eventos: se registran únicamente campos modificados.
--   5. Restricciones de dominio en servidor para signos, fechas y periodicidad.
--   6. Realtime idempotente tabla por tabla.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Helpers de seguridad
-- ----------------------------------------------------------------------------
create schema if not exists private;

-- Los helpers privilegiados que solo sirven a RLS/triggers viven fuera del
-- esquema expuesto por PostgREST.
create or replace function private.f_paciente_activo(p_hc text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public."DB_Pacientes" p
    where p."HC" = p_hc
      and p."Eliminado_En" is null
  )
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.f_paciente_activo(text) from public, anon;
grant execute on function private.f_paciente_activo(text) to authenticated;


-- SECURITY DEFINER con privilegios mínimos: las funciones no deben quedar
-- ejecutables públicamente por accidente.
revoke execute on function public.f_set_auditoria() from public, anon, authenticated;
revoke execute on function public.f_registrar_auditoria() from public, anon, authenticated;
revoke execute on function public.f_nuevo_usuario_personal() from public, anon, authenticated;

-- Evita que nuevas funciones creadas accidentalmente en public queden
-- ejecutables por clientes; las funciones de API deberán otorgar EXECUTE
-- explícitamente.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) HC inmutable + expediente eliminado protegido
-- ----------------------------------------------------------------------------
create or replace function public.f_bloquear_identidad_expediente()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and tg_table_name = 'DB_Pacientes'
     and old."Eliminado_En" is not null
     and new."Eliminado_En" is not null then
    raise exception 'El expediente está eliminado; solo puede restaurarse.' using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' and new."HC" is distinct from old."HC" then
    raise exception 'La historia clínica (HC) es inmutable.' using errcode = '22023';
  end if;

  if tg_table_name <> 'DB_Pacientes'
     and public.f_mi_rol() is not null
     and not exists (
       select 1 from public."DB_Pacientes" p
       where p."HC" = new."HC" and p."Eliminado_En" is null
     ) then
    raise exception 'No se puede operar sobre un expediente inactivo.' using errcode = '42501';
  end if;

  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['DB_Pacientes','DB_SignosVitales','DB_Medicamentos',
                            'DB_Laboratorios','DB_Consultas','DB_Cultivos','DB_Pendientes']
  loop
    execute format('drop trigger if exists trg_integridad_expediente on public.%I', t);
    execute format('create trigger trg_integridad_expediente before update on public.%I
                    for each row execute function public.f_bloquear_identidad_expediente()', t);
  end loop;
end $$;

-- Lectura: pacientes activos para cualquier personal; filas hijas solo si su
-- paciente sigue activo. Esto impide consultar PHI de expedientes retirados.
drop policy if exists "personal activo puede leer" on public."DB_Pacientes";
create policy "personal activo puede leer" on public."DB_Pacientes"
  for select to authenticated
  using (public.f_mi_rol() is not null and "Eliminado_En" is null);

do $$
declare t text;
begin
  foreach t in array array['DB_SignosVitales','DB_Medicamentos','DB_Laboratorios',
                            'DB_Consultas','DB_Cultivos','DB_Pendientes']
  loop
    execute format('drop policy if exists "personal activo puede leer" on public.%I', t);
    execute format('create policy "personal activo puede leer" on public.%I
      for select to authenticated
      using (public.f_mi_rol() is not null and private.f_paciente_activo("HC"))', t);
  end loop;
end $$;

-- Insert/update en tablas hijas: además del rol, el HC debe apuntar a un
-- paciente activo. El trigger de identidad impide cambiar HC durante UPDATE.
do $$
declare t text;
begin
  foreach t in array array['DB_SignosVitales','DB_Medicamentos','DB_Laboratorios',
                            'DB_Consultas','DB_Cultivos','DB_Pendientes']
  loop
    execute format('drop policy if exists "medico o enfermeria puede insertar" on public.%I', t);
    execute format('drop policy if exists "medico o enfermeria puede actualizar" on public.%I', t);
    execute format('create policy "medico o enfermeria puede insertar" on public.%I
      for insert to authenticated
      with check (public.f_mi_rol() in (''medico'',''enfermeria'') and private.f_paciente_activo(%I."HC"))', t, t);
    execute format('create policy "medico o enfermeria puede actualizar" on public.%I
      for update to authenticated
      using (public.f_mi_rol() in (''medico'',''enfermeria'') and private.f_paciente_activo(%I."HC"))
      with check (public.f_mi_rol() in (''medico'',''enfermeria'') and private.f_paciente_activo(%I."HC"))', t, t, t);
  end loop;
end $$;

-- Para pacientes: escritura solo sobre activos para ambos roles; las
-- operaciones de eliminar/restaurar quedan exclusivas del médico.
drop policy if exists "medico o enfermeria puede insertar" on public."DB_Pacientes";
create policy "medico o enfermeria puede insertar" on public."DB_Pacientes"
  for insert to authenticated
  with check (public.f_mi_rol() in ('medico','enfermeria') and "Eliminado_En" is null);

drop policy if exists "medico o enfermeria puede actualizar" on public."DB_Pacientes";
create policy "medico o enfermeria puede actualizar" on public."DB_Pacientes"
  for update to authenticated
  using (public.f_mi_rol() in ('medico','enfermeria') and "Eliminado_En" is null)
  with check (public.f_mi_rol() in ('medico','enfermeria') and "Eliminado_En" is null);

drop policy if exists "solo medico puede eliminar o restaurar" on public."DB_Pacientes";
create policy "solo medico puede eliminar o restaurar" on public."DB_Pacientes"
  for update to authenticated
  using (public.f_mi_rol() = 'medico')
  with check (public.f_mi_rol() = 'medico');

-- El trigger actualiza Eliminado_Por y exige rol médico al cambiar Eliminado_En.

-- ----------------------------------------------------------------------------
-- 3) Audit log: privilegio mínimo + diff, no snapshot completo en eventos nuevos
-- ----------------------------------------------------------------------------
create or replace function private.f_diff_fields(before jsonb, after jsonb)
returns jsonb
language sql immutable security definer set search_path = ''
as $$
  with keys as (
    select key from jsonb_object_keys(coalesce(before, '{}'::jsonb)) key
    union
    select key from jsonb_object_keys(coalesce(after, '{}'::jsonb)) key
  ),
  changed as (
    select key from keys
    where key not in ('Creado_Por','Modificado_Por','Modificado_En')
      and (before -> key) is distinct from (after -> key)
  )
  select coalesce(jsonb_object_agg(key, true), '{}'::jsonb) from changed;
$$;

revoke all on function private.f_diff_fields(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.f_registrar_auditoria()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  id_col text := case when tg_table_name = 'DB_Pacientes' then 'HC' else 'id' end;
  reg_id text;
  old_json jsonb;
  new_json jsonb;
  changed jsonb;
begin
  old_json := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  new_json := to_jsonb(new);
  reg_id := (new_json ->> id_col);
  changed := private.f_diff_fields(old_json, new_json);

  if tg_op = 'INSERT' then
    insert into public.audit_log (tabla, registro_id, accion, usuario_id, datos_nuevos)
    values (tg_table_name, reg_id, 'INSERT', auth.uid(), changed);
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (tabla, registro_id, accion, usuario_id, datos_anteriores, datos_nuevos)
    values (
      tg_table_name, reg_id, 'UPDATE', auth.uid(),
      (select coalesce(jsonb_object_agg(k, true), '{}'::jsonb)
       from jsonb_object_keys(changed) k),
      changed
    );
  end if;
  return new;
end;
$$;

drop policy if exists "personal autenticado puede leer bitacora" on public.audit_log;
drop policy if exists "solo medico puede leer bitacora" on public.audit_log;
create policy "solo medico puede leer bitacora" on public.audit_log
  for select to authenticated using (public.f_mi_rol() = 'medico');

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- ----------------------------------------------------------------------------
-- 4) Constraints de dominio (NOT VALID para no romper historial existente)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_paciente_hc_len') then
    alter table public."DB_Pacientes" add constraint chk_paciente_hc_len
      check (char_length("HC") between 1 and 50) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_signos_rangos') then
    alter table public."DB_SignosVitales" add constraint chk_signos_rangos
      check (
        "PA_Sistolica" between 30 and 300 and
        "PA_Diastolica" between 10 and 200 and
        "PA_Sistolica" > "PA_Diastolica" and
        "Frecuencia_Cardiaca" between 10 and 300 and
        "SpO2" between 0 and 100 and
        "Temperatura" between 25 and 45 and
        "Frecuencia_Respiratoria" between 1 and 80
      ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_medicacion_frecuencia_horas') then
    alter table public."DB_Medicamentos" add constraint chk_medicacion_frecuencia_horas
      check ("Frecuencia_Horas" is null or "Frecuencia_Horas" between 1 and 168) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_medicacion_fechas') then
    alter table public."DB_Medicamentos" add constraint chk_medicacion_fechas
      check ("Fecha_Omision" is null or "Fecha_Omision" >= "Fecha_Inicio") not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_cultivo_periodico') then
    alter table public."DB_Cultivos" add constraint chk_cultivo_periodico
      check (("Es_Periodico" = false and "Intervalo_Horas" is null) or
             ("Es_Periodico" = true and "Intervalo_Horas" between 1 and 720)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_cultivo_fechas') then
    alter table public."DB_Cultivos" add constraint chk_cultivo_fechas
      check ("Fecha_Resultado" is null or "Fecha_Resultado" >= "Fecha_Envio") not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_consulta_fechas') then
    alter table public."DB_Consultas" add constraint chk_consulta_fechas
      check ("Fecha_Respuesta" is null or "Fecha_Respuesta" >= "Fecha_Envio") not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_pendiente_fecha') then
    alter table public."DB_Pendientes" add constraint chk_pendiente_fecha
      check ("Fecha_Programada" is null or "Fecha_Programada" >= "Fecha_Solicitud") not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_medicacion_textos_len') then
    alter table public."DB_Medicamentos" add constraint chk_medicacion_textos_len
      check (char_length("Nombre_Medicamento") <= 200 and char_length("Dosis_Frecuencia") <= 200) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_laboratorio_textos_len') then
    alter table public."DB_Laboratorios" add constraint chk_laboratorio_textos_len
      check (char_length("Tipo_Lab") <= 100 and char_length(coalesce("Resultado_Texto", '')) <= 4000
             and char_length(coalesce("Enlace_PDF_Hospital", '')) <= 2048) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_consulta_textos_len') then
    alter table public."DB_Consultas" add constraint chk_consulta_textos_len
      check (char_length("Departamento_Consultado") <= 100
             and char_length(coalesce("Respuesta_Departamento", '')) <= 4000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_cultivo_textos_len') then
    alter table public."DB_Cultivos" add constraint chk_cultivo_textos_len
      check (char_length("Tipo_Cultivo") <= 100 and char_length(coalesce("Resultado", '')) <= 4000
             and char_length(coalesce("Observaciones_Microbiologia", '')) <= 4000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_pendiente_texto_len') then
    alter table public."DB_Pendientes" add constraint chk_pendiente_texto_len
      check (char_length("Descripcion_Tarea") <= 4000
             and char_length(coalesce("Justificacion_Observaciones", '')) <= 4000) not valid;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5) Realtime idempotente, tabla por tabla.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  in_publication boolean;
begin
  foreach t in array array['DB_Pacientes','DB_SignosVitales','DB_Medicamentos',
                            'DB_Laboratorios','DB_Consultas','DB_Cultivos','DB_Pendientes']
  loop
    select exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) into in_publication;

    if not in_publication then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Después de corregir datos históricos, valida permanentemente las constraints:
-- alter table ... validate constraint ...;
-- ============================================================================
