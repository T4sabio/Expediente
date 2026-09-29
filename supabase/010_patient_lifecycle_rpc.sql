-- Borrado/restauración lógica de pacientes con autorización y motivo auditado.
-- Ejecutar después de 009_auth_approval_required.sql.

alter table public.audit_log add column if not exists motivo text;

create or replace function public.f_registrar_auditoria()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  id_col text := case when tg_table_name = 'DB_Pacientes' then 'HC' else 'id' end;
  reg_id text;
  old_json jsonb;
  new_json jsonb;
  changed jsonb;
  audit_reason text := nullif(current_setting('app.patient_lifecycle_reason', true), '');
begin
  old_json := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  new_json := to_jsonb(new);
  reg_id := new_json ->> id_col;
  changed := private.f_diff_fields(old_json, new_json);

  if tg_op = 'INSERT' then
    insert into public.audit_log (tabla, registro_id, accion, usuario_id, datos_nuevos)
    values (tg_table_name, reg_id, 'INSERT', auth.uid(), changed);
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (tabla, registro_id, accion, usuario_id, datos_anteriores, datos_nuevos, motivo)
    values (
      tg_table_name, reg_id, 'UPDATE', auth.uid(),
      (select coalesce(jsonb_object_agg(k, true), '{}'::jsonb)
       from jsonb_object_keys(changed) k),
      changed,
      case when tg_table_name = 'DB_Pacientes' then audit_reason else null end
    );
  end if;
  return new;
end;
$$;

create or replace function public.eliminar_paciente(p_hc text, p_motivo text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_hc text;
  v_motivo text := nullif(pg_catalog.btrim(p_motivo), '');
begin
  if auth.uid() is null or public.f_mi_rol() is distinct from 'medico' then
    raise exception 'Solo un médico activo puede eliminar pacientes.' using errcode = '42501';
  end if;
  if p_hc is null or pg_catalog.btrim(p_hc) = '' then
    raise exception 'La historia clínica es obligatoria.' using errcode = '22023';
  end if;
  if v_motivo is null or pg_catalog.char_length(v_motivo) not between 3 and 500 then
    raise exception 'El motivo debe tener entre 3 y 500 caracteres.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('app.patient_lifecycle_reason', v_motivo, true);
  update public."DB_Pacientes" p
  set "Eliminado_En" = pg_catalog.now()
  where p."HC" = pg_catalog.btrim(p_hc) and p."Eliminado_En" is null
  returning p."HC" into v_hc;

  if not found then
    raise exception 'Paciente no encontrado o ya eliminado.' using errcode = 'P0002';
  end if;
  return v_hc;
end;
$$;

create or replace function public.restaurar_paciente(p_hc text, p_motivo text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_hc text;
  v_motivo text := nullif(pg_catalog.btrim(p_motivo), '');
begin
  if auth.uid() is null or public.f_mi_rol() is distinct from 'medico' then
    raise exception 'Solo un médico activo puede restaurar pacientes.' using errcode = '42501';
  end if;
  if p_hc is null or pg_catalog.btrim(p_hc) = '' then
    raise exception 'La historia clínica es obligatoria.' using errcode = '22023';
  end if;
  if v_motivo is null or pg_catalog.char_length(v_motivo) not between 3 and 500 then
    raise exception 'El motivo debe tener entre 3 y 500 caracteres.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('app.patient_lifecycle_reason', v_motivo, true);
  update public."DB_Pacientes" p
  set "Eliminado_En" = null
  where p."HC" = pg_catalog.btrim(p_hc) and p."Eliminado_En" is not null
  returning p."HC" into v_hc;

  if not found then
    raise exception 'Paciente no encontrado o no eliminado.' using errcode = 'P0002';
  end if;
  return v_hc;
end;
$$;

revoke all on function public.eliminar_paciente(text, text) from public, anon, authenticated;
revoke all on function public.restaurar_paciente(text, text) from public, anon, authenticated;
grant execute on function public.eliminar_paciente(text, text) to authenticated;
grant execute on function public.restaurar_paciente(text, text) to authenticated;