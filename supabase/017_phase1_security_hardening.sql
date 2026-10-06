-- ============================================================================
-- 017_phase1_security_hardening.sql
-- Fase 1 de transformación: endurecimiento de seguridad y mínimo privilegio.
--
-- Objetivos principales:
--   * Ninguna función SECURITY DEFINER permanece expuesta desde public.
--   * Helpers privilegiados viven en private y tienen search_path = ''.
--   * El cálculo de rol para RLS usa un helper privado seguro.
--   * Audit trail no almacena valores clínicos ni payload JSON arbitrario.
--   * Impresión/exportación aceptan solo la HC; el cliente no controla metadata.
--   * buscar_pacientes deja de retornar filas completas de DB_Pacientes.
--   * RPC de lectura son SECURITY INVOKER cuando RLS es suficiente.
--   * GraphQL deja de estar expuesto por la API local del proyecto si no se usa.
--   * Se refuerzan grants/revokes y funciones de trigger.
--
-- Esta migración NO implementa todavía OMOP, FHIR, R ni la nueva capa analítica.
-- ============================================================================

create schema if not exists private;

-- private no está incluido en [api].schemas, por lo que no es accesible por
-- PostgREST con la configuración actual. Los helpers que participan en RLS/RPC
-- reciben solamente el EXECUTE mínimo necesario.
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter default privileges in schema private
  revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) Helper de autorización: rol del usuario actual.
-- ---------------------------------------------------------------------------
create or replace function private.f_mi_rol()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.rol
  from public.personal p
  where p.id = (select auth.uid())
    and p.activo
  limit 1;
$$;

revoke all on function private.f_mi_rol() from public, anon;
grant execute on function private.f_mi_rol() to authenticated;

-- Wrapper público no privilegiado para que la UI pueda leer su propio rol.
-- Las políticas RLS usan directamente private.f_mi_rol().
create or replace function public.f_mi_rol()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select p.rol
  from public.personal p
  where p.id = (select auth.uid())
    and p.activo
  limit 1;
$$;

revoke all on function public.f_mi_rol() from public, anon;
grant execute on function public.f_mi_rol() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Helper de nombres de actores para timeline.
-- ---------------------------------------------------------------------------
create or replace function private.f_personal_nombre(p_usuario_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.nombre
  from public.personal p
  where p.id = p_usuario_id
  limit 1;
$$;

revoke all on function private.f_personal_nombre(uuid) from public, anon;
grant execute on function private.f_personal_nombre(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Helpers privilegiados de trigger: moverlos fuera de public.
-- ---------------------------------------------------------------------------
create or replace function private.f_nuevo_usuario_personal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.personal (id, nombre, rol, activo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', new.email),
    'lectura',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.f_nuevo_usuario_personal() from public, anon, authenticated;

-- El trigger de Auth debe usar ahora el helper privado.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.f_nuevo_usuario_personal();

create or replace function private.f_set_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new."Creado_Por" := auth.uid();
    new."Modificado_Por" := auth.uid();
    new."Modificado_En" := now();
  elsif tg_op = 'UPDATE' then
    new."Creado_Por" := old."Creado_Por";
    new."Modificado_Por" := auth.uid();

    -- La marca temporal la controla el servidor.
    new."Modificado_En" := now();

    if tg_table_name = 'DB_Pacientes' then
      if new."Eliminado_En" is distinct from old."Eliminado_En" then
        if private.f_mi_rol() is distinct from 'medico' then
          raise exception 'Solo el rol médico puede eliminar o restaurar pacientes.'
            using errcode = '42501';
        end if;
        new."Eliminado_Por" := case
          when new."Eliminado_En" is null then null
          else auth.uid()
        end;
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.f_set_auditoria() from public, anon, authenticated;

create or replace function private.f_bloquear_identidad_expediente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and tg_table_name = 'DB_Pacientes' then
    if old."Eliminado_En" is not null and new."Eliminado_En" is not null then
      raise exception 'El expediente está eliminado; solo puede restaurarse.'
        using errcode = '55000';
    end if;
  end if;

  if tg_op = 'UPDATE' and new."HC" is distinct from old."HC" then
    raise exception 'La historia clínica (HC) es inmutable.'
      using errcode = '22023';
  end if;

  if tg_table_name <> 'DB_Pacientes' then
    if not exists (
      select 1
      from public."DB_Pacientes" p
      where p."HC" = new."HC"
        and p."Eliminado_En" is null
    ) then
      raise exception 'No se puede operar sobre un expediente inactivo.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.f_bloquear_identidad_expediente() from public, anon, authenticated;

-- Reasignar triggers a private.
do $$
declare
  t text;
begin
  foreach t in array array[
    'DB_Pacientes','DB_SignosVitales','DB_Medicamentos',
    'DB_Laboratorios','DB_Consultas','DB_Cultivos','DB_Pendientes'
  ]
  loop
    execute format('drop trigger if exists trg_auditoria on public.%I', t);
    execute format(
      'create trigger trg_auditoria before insert or update on public.%I
       for each row execute function private.f_set_auditoria()', t
    );

    execute format('drop trigger if exists trg_integridad_expediente on public.%I', t);
    execute format(
      'create trigger trg_integridad_expediente before update on public.%I
       for each row execute function private.f_bloquear_identidad_expediente()', t
    );
  end loop;
end $$;

-- El helper de fechas solo es utilizado como trigger; tampoco necesita estar
-- expuesto a clientes.
create or replace function private.f_set_fechas_clinicas_guatemala()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  fecha_guatemala date := (pg_catalog.now() at time zone 'America/Guatemala')::date;
begin
  if tg_table_name = 'DB_Medicamentos' then
    if tg_op = 'UPDATE'
      and old."Activo" is distinct from new."Activo"
      and new."Activo" = 'No' then
      new."Fecha_Omision" := fecha_guatemala;
    end if;
  elsif tg_table_name = 'DB_Consultas' then
    if tg_op = 'UPDATE'
      and old."Respuesta_Departamento" is null
      and nullif(pg_catalog.btrim(new."Respuesta_Departamento"), '') is not null then
      new."Fecha_Respuesta" := fecha_guatemala;
    end if;
  elsif tg_table_name = 'DB_Cultivos' then
    if tg_op = 'UPDATE'
      and (old."Resultado" is null or old."Resultado" = 'Pendiente')
      and new."Resultado" is not null
      and new."Resultado" <> 'Pendiente' then
      new."Fecha_Resultado" := fecha_guatemala;
    end if;
  elsif tg_table_name = 'DB_Pendientes' then
    if tg_op = 'UPDATE' and old."Estado" is distinct from new."Estado" then
      if new."Estado" = 'Realizado' then
        new."Fecha_Completado" := pg_catalog.now();
      elsif new."Estado" = 'Pendiente' then
        new."Fecha_Completado" := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.f_set_fechas_clinicas_guatemala() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['DB_Medicamentos','DB_Consultas','DB_Cultivos','DB_Pendientes']
  loop
    execute format('drop trigger if exists trg_fechas_guatemala on public.%I', t);
    execute format(
      'create trigger trg_fechas_guatemala before update on public.%I
       for each row execute function private.f_set_fechas_clinicas_guatemala()', t
    );
  end loop;
end $$;

-- Los anteriores helpers públicos eran necesarios para los triggers históricos.
-- Ya no deben ser accesibles ni quedar como SECURITY DEFINER en public.
drop function if exists public.f_nuevo_usuario_personal();
drop function if exists public.f_set_auditoria();
drop function if exists public.f_bloquear_identidad_expediente();
drop function if exists public.f_registrar_auditoria();
drop function if exists public.f_set_fechas_clinicas_guatemala();

-- ---------------------------------------------------------------------------
-- 4) RLS: las políticas consultan directamente el helper privado.
-- ---------------------------------------------------------------------------
-- Personal: cada usuario solo ve su propio perfil desde la aplicación.
drop policy if exists "ver mi propio registro" on public.personal;
create policy "ver mi propio registro" on public.personal
  for select to authenticated
  using (id = (select auth.uid()));

-- Pacientes activos: lectura para personal activo; escritura clínica de
-- pacientes solo para médicos. Eliminación/restauración lógica exclusivamente
-- médica mediante las dos políticas UPDATE.
drop policy if exists "personal activo puede leer" on public."DB_Pacientes";
create policy "personal activo puede leer" on public."DB_Pacientes"
  for select to authenticated
  using (private.f_mi_rol() is not null and "Eliminado_En" is null);

drop policy if exists "medico o enfermeria puede insertar" on public."DB_Pacientes";
drop policy if exists "medico o enfermeria puede actualizar" on public."DB_Pacientes";
drop policy if exists "solo medico puede registrar pacientes" on public."DB_Pacientes";
drop policy if exists "solo medico puede editar pacientes" on public."DB_Pacientes";
drop policy if exists "solo medico puede eliminar o restaurar" on public."DB_Pacientes";

create policy "solo medico puede registrar pacientes" on public."DB_Pacientes"
  for insert to authenticated
  with check (private.f_mi_rol() = 'medico' and "Eliminado_En" is null);

create policy "solo medico puede editar pacientes" on public."DB_Pacientes"
  for update to authenticated
  using (private.f_mi_rol() = 'medico' and "Eliminado_En" is null)
  with check (private.f_mi_rol() = 'medico' and "Eliminado_En" is null);

create policy "solo medico puede eliminar o restaurar" on public."DB_Pacientes"
  for update to authenticated
  using (private.f_mi_rol() = 'medico')
  with check (private.f_mi_rol() = 'medico');

-- Tablas clínicas hijas: solo médicos/enfermería pueden registrar/modificar;
-- siempre se verifica que el paciente esté activo.
do $$
declare
  t text;
begin
  foreach t in array array[
    'DB_SignosVitales','DB_Medicamentos','DB_Laboratorios',
    'DB_Consultas','DB_Cultivos','DB_Pendientes'
  ]
  loop
    execute format('drop policy if exists "personal activo puede leer" on public.%I', t);
    execute format('create policy "personal activo puede leer" on public.%I
      for select to authenticated
      using (private.f_mi_rol() is not null and private.f_paciente_activo("HC"))', t);

    execute format('drop policy if exists "medico o enfermeria puede insertar" on public.%I', t);
    execute format('create policy "medico o enfermeria puede insertar" on public.%I
      for insert to authenticated
      with check (private.f_mi_rol() in (''medico'',''enfermeria'')
                 and private.f_paciente_activo("HC"))', t);

    execute format('drop policy if exists "medico o enfermeria puede actualizar" on public.%I', t);
    execute format('drop policy if exists "solo medico puede actualizar medicamentos" on public.%I', t);

    if t = 'DB_Medicamentos' then
      execute format('create policy "solo medico puede actualizar medicamentos" on public.%I
        for update to authenticated
        using (private.f_mi_rol() = ''medico'' and private.f_paciente_activo("HC"))
        with check (private.f_mi_rol() = ''medico'' and private.f_paciente_activo("HC"))', t);
    else
      execute format('create policy "medico o enfermeria puede actualizar" on public.%I
        for update to authenticated
        using (private.f_mi_rol() in (''medico'',''enfermeria'')
               and private.f_paciente_activo("HC"))
        with check (private.f_mi_rol() in (''medico'',''enfermeria'')
                    and private.f_paciente_activo("HC"))', t);
    end if;
  end loop;
end $$;

-- Sin DELETE físico desde las credenciales de la aplicación. El borrado de
-- paciente es lógico y se controla mediante UPDATE + trigger.
revoke delete on public."DB_Pacientes", public."DB_SignosVitales",
  public."DB_Medicamentos", public."DB_Laboratorios", public."DB_Consultas",
  public."DB_Cultivos", public."DB_Pendientes" from authenticated;

-- ---------------------------------------------------------------------------
-- 5) Audit trail: solo nombres de campos, nunca valores clínicos.
-- ---------------------------------------------------------------------------
create or replace function private.f_diff_fields(before jsonb, after jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  with keys as (
    select key
    from jsonb_object_keys(coalesce(before, '{}'::jsonb)) key
    union
    select key
    from jsonb_object_keys(coalesce(after, '{}'::jsonb)) key
  ), changed as (
    select key
    from keys
    where key not in (
      'Creado_Por', 'Modificado_Por', 'Modificado_En',
      'HC', 'Nombre_Completo', 'Edad', 'Num_RayosX',
      'Motivo_Consulta', 'Diagnosticos'
    )
      and (before -> key) is distinct from (after -> key)
  )
  select coalesce(jsonb_object_agg(key, true), '{}'::jsonb)
  from changed;
$$;

revoke all on function private.f_diff_fields(jsonb, jsonb) from public, anon, authenticated;

create or replace function private.f_registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  id_col text := case
    when tg_table_name = 'DB_Pacientes' then 'HC'
    else 'id'
  end;
  reg_id text;
  old_json jsonb;
  new_json jsonb;
  changed jsonb;
  audit_reason text := nullif(
    current_setting('app.patient_lifecycle_reason', true), ''
  );
begin
  old_json := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  new_json := to_jsonb(new);
  reg_id := new_json ->> id_col;
  changed := private.f_diff_fields(old_json, new_json);

  insert into public.audit_log (
    tabla, registro_id, accion, usuario_id,
    datos_anteriores, datos_nuevos, motivo
  )
  values (
    tg_table_name,
    reg_id,
    tg_op,
    auth.uid(),
    case when tg_op = 'UPDATE' then changed else null end,
    changed,
    case when tg_table_name = 'DB_Pacientes' then audit_reason else null end
  );

  return new;
end;
$$;

revoke all on function private.f_registrar_auditoria() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'DB_Pacientes','DB_SignosVitales','DB_Medicamentos',
    'DB_Laboratorios','DB_Consultas','DB_Cultivos','DB_Pendientes'
  ]
  loop
    execute format('drop trigger if exists trg_bitacora on public.%I', t);
    execute format(
      'create trigger trg_bitacora after insert or update on public.%I
       for each row execute function private.f_registrar_auditoria()', t
    );
  end loop;
end $$;

-- Reforzar que el cliente nunca escribe la bitácora directamente.
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- Solo médicos pueden leer la bitácora. No hay políticas de INSERT/UPDATE/DELETE.
drop policy if exists "personal autenticado puede leer bitacora" on public.audit_log;
drop policy if exists "solo medico puede leer bitacora" on public.audit_log;
create policy "solo medico puede leer bitacora"
  on public.audit_log
  for select to authenticated
  using (private.f_mi_rol() = 'medico');

-- ---------------------------------------------------------------------------
-- 5) RPCs de lectura: SECURITY INVOKER + RLS.
-- ---------------------------------------------------------------------------
alter function public.ronda_hoy(text, int)
  security invoker
  set search_path = '';

alter function public.ultima_actividad_paciente(text)
  security invoker
  set search_path = '';

-- timeline se redefine debajo porque debe dejar de depender del RLS de
-- public.personal para resolver el nombre del actor.

create or replace function public.timeline_paciente(p_hc text, p_limit int default 40)
returns table (
  event_at timestamptz,
  kind text,
  title text,
  detail text,
  action_label text,
  actor_name text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if private.f_mi_rol() is null then
    raise exception 'No autorizado';
  end if;

  if not exists (
    select 1 from public."DB_Pacientes"
    where "HC" = p_hc and "Eliminado_En" is null
  ) then
    return;
  end if;

  return query
  with events as (
    select coalesce(v."Fecha_Hora", v."Modificado_En") as event_at, 'vitales'::text as kind,
      'Signos vitales'::text as title,
      concat('PA ', coalesce(v."PA_Sistolica"::text, '—'), '/', coalesce(v."PA_Diastolica"::text, '—'),
             ' · FC ', coalesce(v."Frecuencia_Cardiaca"::text, '—'),
             ' · SpO2 ', coalesce(v."SpO2"::text, '—'), '%') as detail,
      'Registro'::text as action_label, v."Modificado_Por" as actor_id
    from public."DB_SignosVitales" v where v."HC" = p_hc
    union all
    select coalesce(m."Modificado_En", m."Fecha_Inicio"::timestamp at time zone 'America/Guatemala'), 'medicamentos',
      'Medicamento', concat(m."Nombre_Medicamento", ' · ', m."Dosis_Frecuencia"),
      case when m."Activo" = 'Sí' then 'Activo' else 'Suspendido' end, m."Modificado_Por"
    from public."DB_Medicamentos" m where m."HC" = p_hc
    union all
    select coalesce(l."Modificado_En", l."Fecha"::timestamp at time zone 'America/Guatemala'), 'laboratorios',
      'Laboratorio', concat(l."Tipo_Lab", ' · ', coalesce(l."Resultado_Texto", l."Valor_Numerico"::text, 'Sin resultado')),
      'Resultado', l."Modificado_Por"
    from public."DB_Laboratorios" l where l."HC" = p_hc
    union all
    select coalesce(c."Modificado_En", c."Fecha_Envio"::timestamp at time zone 'America/Guatemala'), 'consultas',
      'Interconsulta', c."Departamento_Consultado",
      case when c."Fecha_Respuesta" is null then 'Sin respuesta' else 'Respondida' end, c."Modificado_Por"
    from public."DB_Consultas" c where c."HC" = p_hc
    union all
    select coalesce(c."Modificado_En", c."Fecha_Envio"::timestamp at time zone 'America/Guatemala'), 'cultivos',
      'Cultivo', concat(c."Tipo_Cultivo", ' · ', coalesce(c."Resultado", 'Pendiente')),
      case when c."Resultado" is null or c."Resultado" = 'Pendiente' then 'En curso' else 'Resultado' end, c."Modificado_Por"
    from public."DB_Cultivos" c where c."HC" = p_hc
    union all
    select coalesce(t."Modificado_En", t."Fecha_Solicitud"), 'pendientes',
      'Pendiente', t."Descripcion_Tarea", t."Estado", t."Modificado_Por"
    from public."DB_Pendientes" t where t."HC" = p_hc
    union all
    select p."Modificado_En", 'paciente', 'Datos del paciente',
      concat(p."Servicio", ' · Cama ', coalesce(p."Cama", '—')),
      'Expediente actualizado', p."Modificado_Por"
    from public."DB_Pacientes" p where p."HC" = p_hc and p."Modificado_En" is not null
  )
  select e.event_at, e.kind, e.title, e.detail, e.action_label,
    coalesce(nullif(trim(private.f_personal_nombre(e.actor_id)), ''), 'Personal clínico') as actor_name
  from events e
  where e.event_at is not null
  order by e.event_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 80);
end;
$$;


revoke all on function public.ronda_hoy(text, int) from public, anon;
revoke all on function public.timeline_paciente(text, int) from public, anon;
revoke all on function public.ultima_actividad_paciente(text) from public, anon;
grant execute on function public.ronda_hoy(text, int) to authenticated;
grant execute on function public.timeline_paciente(text, int) to authenticated;
grant execute on function public.ultima_actividad_paciente(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Búsqueda: no exponer nunca la fila completa del paciente.
-- ---------------------------------------------------------------------------
drop function if exists public.buscar_pacientes(text, text, int);
create function public.buscar_pacientes(
  p_query text default '',
  p_servicio text default null,
  p_limit int default 30
) returns table (
  "HC" text,
  "Nombre_Completo" text,
  "Servicio" text,
  "Cama" text,
  "Edad" text
)
language sql
stable
set search_path = public, pg_catalog
as $$
  with q as (
    select public.f_unaccent(lower(trim(coalesce(p_query, '')))) as t
  )
  select p."HC", p."Nombre_Completo", p."Servicio", p."Cama", p."Edad"
  from public."DB_Pacientes" p, q
  where p."Eliminado_En" is null
    and (p_servicio is null or p_servicio = '' or p."Servicio" = p_servicio)
    and (
      q.t = ''
      or not exists (
        select 1
        from unnest(string_to_array(q.t, ' ')) w
        where w <> ''
          and not (
            public.f_unaccent(lower(p."Nombre_Completo")) like '%' || w || '%'
            or w <% public.f_unaccent(lower(p."Nombre_Completo"))
          )
      )
      or lower(p."HC") like replace(q.t, ' ', '') || '%'
      or lower(coalesce(p."Cama", '')) = regexp_replace(q.t, '^cama\s*', '')
    )
  order by similarity(public.f_unaccent(lower(p."Nombre_Completo")), q.t) desc,
           p."Nombre_Completo"
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
$$;

revoke all on function public.buscar_pacientes(text, text, int) from public, anon;
grant execute on function public.buscar_pacientes(text, text, int) to authenticated;

-- f_unaccent no accede a datos clínicos; la RPC de búsqueda necesita EXECUTE
-- porque permanece SECURITY INVOKER. Se cierra el acceso anónimo y público.
revoke all on function public.f_unaccent(text) from public, anon;
grant execute on function public.f_unaccent(text) to authenticated;

-- listar_servicios es una RPC pública de la app, pero no anónima.
revoke all on function public.listar_servicios() from public, anon;
grant execute on function public.listar_servicios() to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Auditoría de lectura/impresión/exportación sin payload controlado por
--    el cliente. Se conserva solo la firma HC + el evento.
-- ---------------------------------------------------------------------------
create or replace function private.f_registrar_evento_auditoria(
  p_hc text,
  p_accion text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if p_accion not in ('READ', 'PRINT', 'EXPORT') then
    raise exception 'Acción de auditoría no permitida.' using errcode = '22023';
  end if;

  insert into public.audit_log (
    tabla, registro_id, accion, usuario_id, datos_nuevos
  )
  values (
    'DB_Pacientes',
    p_hc,
    p_accion,
    auth.uid(),
    jsonb_build_object('evento', lower(p_accion))
  );
end;
$$;

revoke all on function private.f_registrar_evento_auditoria(text, text) from public, anon;
grant execute on function private.f_registrar_evento_auditoria(text, text) to authenticated;

-- Retiramos las versiones anteriores que aceptaban un jsonb arbitrario.
drop function if exists public.registrar_impresion_expediente(text, jsonb);
drop function if exists public.registrar_exporte_expediente(text, jsonb);

create function public.registrar_impresion_expediente(p_hc text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if private.f_mi_rol() is null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public."DB_Pacientes"
    where "HC" = p_hc
      and "Eliminado_En" is null
  ) then
    raise exception 'El expediente ya no está disponible' using errcode = 'P0002';
  end if;

  perform private.f_registrar_evento_auditoria(p_hc, 'PRINT');
end;
$$;

create function public.registrar_exporte_expediente(p_hc text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if private.f_mi_rol() is null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public."DB_Pacientes"
    where "HC" = p_hc
      and "Eliminado_En" is null
  ) then
    raise exception 'El expediente ya no está disponible' using errcode = 'P0002';
  end if;

  perform private.f_registrar_evento_auditoria(p_hc, 'EXPORT');
end;
$$;

create or replace function public.registrar_lectura_expediente(p_hc text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if private.f_mi_rol() is null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public."DB_Pacientes"
    where "HC" = p_hc
      and "Eliminado_En" is null
  ) then
    raise exception 'El expediente ya no está disponible' using errcode = 'P0002';
  end if;

  perform private.f_registrar_evento_auditoria(p_hc, 'READ');
end;
$$;

revoke all on function public.registrar_impresion_expediente(text) from public, anon;
revoke all on function public.registrar_exporte_expediente(text) from public, anon;
revoke all on function public.registrar_lectura_expediente(text) from public, anon;
grant execute on function public.registrar_impresion_expediente(text) to authenticated;
grant execute on function public.registrar_exporte_expediente(text) to authenticated;
grant execute on function public.registrar_lectura_expediente(text) to authenticated;

-- Compatibilidad temporal con consumidores históricos. El segundo parámetro
-- ya no se persiste ni participa en la autorización; se ignora deliberadamente.
create function public.registrar_impresion_expediente(p_hc text, _client_metadata jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  select public.registrar_impresion_expediente(p_hc);
$$;

create function public.registrar_exporte_expediente(p_hc text, _client_metadata jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  select public.registrar_exporte_expediente(p_hc);
$$;

revoke all on function public.registrar_impresion_expediente(text, jsonb) from public, anon;
revoke all on function public.registrar_exporte_expediente(text, jsonb) from public, anon;
grant execute on function public.registrar_impresion_expediente(text, jsonb) to authenticated;
grant execute on function public.registrar_exporte_expediente(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) Ciclo de vida: RLS sigue siendo la autoridad; las RPC ya no necesitan
--    SECURITY DEFINER porque las políticas de DB_Pacientes restringen UPDATE.
-- ---------------------------------------------------------------------------
alter function public.eliminar_paciente(text, text)
  security invoker
  set search_path = '';
alter function public.restaurar_paciente(text, text)
  security invoker
  set search_path = '';
revoke all on function public.eliminar_paciente(text, text) from public, anon;
revoke all on function public.restaurar_paciente(text, text) from public, anon;
grant execute on function public.eliminar_paciente(text, text) to authenticated;
grant execute on function public.restaurar_paciente(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9) Limpieza de execute en funciones internas públicas históricas.
-- ---------------------------------------------------------------------------
drop function if exists public.f_nuevo_usuario_personal();
drop function if exists public.f_set_auditoria();
drop function if exists public.f_registrar_auditoria();
drop function if exists public.f_bloquear_identidad_expediente();
drop function if exists public.f_set_fechas_clinicas_guatemala();

-- ---------------------------------------------------------------------------
-- 10) Seguridad de configuración local: graphql_public no forma parte de la
--     superficie API porque la aplicación no lo utiliza.
-- ---------------------------------------------------------------------------
