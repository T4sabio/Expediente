-- Harden role boundaries, retry-safe inserts and audit data after phase 3.

-- A retry with the same per-form key returns the committed row instead of
-- creating a second medication, vital sign, or other clinical entry.
do $$
declare t text;
begin
  foreach t in array array['DB_SignosVitales','DB_Medicamentos','DB_Laboratorios',
                            'DB_Consultas','DB_Cultivos','DB_Pendientes']
  loop
    execute format('alter table public.%I add column if not exists "Idempotency_Key" text', t);
    execute format('create unique index if not exists %I on public.%I ("HC", "Idempotency_Key") where "Idempotency_Key" is not null',
                   'uq_' || lower(t) || '_idempotency', t);
  end loop;
end $$;

alter table public."DB_Medicamentos"
  add column if not exists "Motivo_Suspension" text;

-- Demographic writes and medication state changes are physician-only;
-- nurses retain insert and update permissions for the other clinical tables.
drop policy if exists "medico o enfermeria puede insertar" on public."DB_Pacientes";
drop policy if exists "medico o enfermeria puede actualizar" on public."DB_Pacientes";
create policy "solo medico puede registrar pacientes" on public."DB_Pacientes"
  for insert to authenticated
  with check (public.f_mi_rol() = 'medico' and "Eliminado_En" is null);
create policy "solo medico puede editar pacientes" on public."DB_Pacientes"
  for update to authenticated
  using (public.f_mi_rol() = 'medico' and "Eliminado_En" is null)
  with check (public.f_mi_rol() = 'medico' and "Eliminado_En" is null);

drop policy if exists "medico o enfermeria puede actualizar" on public."DB_Medicamentos";
create policy "solo medico puede actualizar medicamentos" on public."DB_Medicamentos"
  for update to authenticated
  using (public.f_mi_rol() = 'medico' and private.f_paciente_activo("HC"))
  with check (public.f_mi_rol() = 'medico' and private.f_paciente_activo("HC"));

create or replace function private.f_proteger_estado_medicamento()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.f_mi_rol() = 'enfermeria' and (
    (tg_op = 'INSERT' and (new."Activo" = 'No' or new."Motivo_Suspension" is not null))
    or (tg_op = 'UPDATE' and (
      new."Activo" is distinct from old."Activo"
      or new."Motivo_Suspension" is distinct from old."Motivo_Suspension"
    ))
  ) then
    raise exception 'Solo el rol médico puede suspender o reactivar medicamentos.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_estado_medicamento on public."DB_Medicamentos";
create trigger trg_proteger_estado_medicamento
  before insert or update on public."DB_Medicamentos"
  for each row execute function private.f_proteger_estado_medicamento();

-- New audit rows contain only changed values, not full row snapshots.
-- Direct patient identifiers and narrative PHI are intentionally omitted.
create or replace function private.f_diff_fields(before jsonb, after jsonb)
returns jsonb
language sql immutable security definer set search_path = ''
as $$
  with keys as (
    select key from jsonb_object_keys(coalesce(before, '{}'::jsonb)) key
    union
    select key from jsonb_object_keys(coalesce(after, '{}'::jsonb)) key
  ), changed as (
    select key, before -> key as old_value, after -> key as new_value
    from keys
    where key not in (
      'Creado_Por', 'Modificado_Por', 'Modificado_En', 'HC', 'Nombre_Completo',
      'Edad', 'Num_RayosX', 'Motivo_Consulta', 'Diagnosticos'
    )
      and (before -> key) is distinct from (after -> key)
  )
  select jsonb_build_object(
    'old', coalesce((select jsonb_object_agg(key, old_value) from changed), '{}'::jsonb),
    'new', coalesce((select jsonb_object_agg(key, new_value) from changed), '{}'::jsonb)
  );
$$;

create or replace function public.f_registrar_auditoria()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  id_col text := case when tg_table_name = 'DB_Pacientes' then 'HC' else 'id' end;
  old_json jsonb;
  new_json jsonb;
  changed jsonb;
begin
  old_json := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  new_json := to_jsonb(new);
  changed := private.f_diff_fields(old_json, new_json);

  insert into public.audit_log (tabla, registro_id, accion, usuario_id, datos_anteriores, datos_nuevos)
  values (
    tg_table_name,
    new_json ->> id_col,
    tg_op,
    auth.uid(),
    case when tg_op = 'UPDATE' then changed -> 'old' else null end,
    changed -> 'new'
  );
  return new;
end;
$$;

-- Remove historical full snapshots left by migration 002. Historical field
-- names remain useful, while old clinical values are deliberately discarded.
update public.audit_log a
set datos_anteriores = case when a.datos_anteriores is null then null else (
      select coalesce(jsonb_object_agg(k, true), '{}'::jsonb)
      from jsonb_object_keys(a.datos_anteriores) k
    ) end,
    datos_nuevos = case when a.datos_nuevos is null then null else (
      select coalesce(jsonb_object_agg(k, true), '{}'::jsonb)
      from jsonb_object_keys(a.datos_nuevos) k
    ) end
where a.accion in ('INSERT', 'UPDATE');

alter table public.audit_log drop constraint if exists audit_log_accion_check;
alter table public.audit_log add constraint audit_log_accion_check
  check (accion in ('INSERT', 'UPDATE', 'PRINT', 'READ', 'EXPORT'));

create or replace function public.registrar_lectura_expediente(p_hc text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if public.f_mi_rol() is null or not exists (
    select 1 from public."DB_Pacientes" where "HC" = p_hc and "Eliminado_En" is null
  ) then
    raise exception 'El expediente ya no está disponible';
  end if;
  insert into public.audit_log (tabla, registro_id, accion, usuario_id, datos_nuevos)
  values ('DB_Pacientes', p_hc, 'READ', auth.uid(), '{"evento":"lectura"}'::jsonb);
end;
$$;

create or replace function public.registrar_exporte_expediente(p_hc text, p_registros jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if public.f_mi_rol() is null or not exists (
    select 1 from public."DB_Pacientes" where "HC" = p_hc and "Eliminado_En" is null
  ) then
    raise exception 'El expediente ya no está disponible';
  end if;
  insert into public.audit_log (tabla, registro_id, accion, usuario_id, datos_nuevos)
  values (
    'DB_Pacientes', p_hc, 'EXPORT', auth.uid(),
    jsonb_build_object('exportado_en', clock_timestamp(), 'registros_incluidos', coalesce(p_registros, '{}'::jsonb))
  );
end;
$$;

revoke all on function public.registrar_lectura_expediente(text) from public, anon;
revoke all on function public.registrar_exporte_expediente(text, jsonb) from public, anon;
grant execute on function public.registrar_lectura_expediente(text) to authenticated;
grant execute on function public.registrar_exporte_expediente(text, jsonb) to authenticated;