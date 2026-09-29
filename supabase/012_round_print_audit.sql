-- Corrige la actividad y el límite de la ronda, y registra la impresión clínica.

drop function if exists public.ronda_hoy(text, int);
create function public.ronda_hoy(p_servicio text default null, p_limit int default 100)
returns table (
  hc text,
  nombre_completo text,
  servicio text,
  cama text,
  edad text,
  latest_vital_at timestamptz,
  latest_activity_at timestamptz,
  active_medications bigint,
  open_tasks bigint,
  due_tasks bigint,
  pending_cultures bigint,
  unanswered_consultations bigint,
  vitals_overdue boolean,
  modificado_en timestamptz,
  total_active bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.f_mi_rol() is null then
    raise exception 'No autorizado';
  end if;

  return query
  with filtered_patients as (
    select p.*
    from public."DB_Pacientes" p
    where p."Eliminado_En" is null
      and (p_servicio is null or p_servicio = '' or p."Servicio" = p_servicio)
  ), ranked_patients as (
    select p.*,
      row_number() over (order by p."Servicio", p."Cama", p."Nombre_Completo", p."HC") as round_order,
      count(*) over () as total_count
    from filtered_patients p
  ), active_patients as (
    select * from ranked_patients
    where round_order <= least(greatest(coalesce(p_limit, 100), 1), 100)
  ), vitals as (
    select v."HC", max(v."Fecha_Hora") as latest_vital_at
    from public."DB_SignosVitales" v
    join active_patients p on p."HC" = v."HC"
    group by v."HC"
  ), activity as (
    select v."HC", v."Fecha_Hora" as event_at
    from public."DB_SignosVitales" v join active_patients p on p."HC" = v."HC"
    union all
    select m."HC", coalesce(m."Modificado_En", m."Fecha_Inicio"::timestamp at time zone 'America/Guatemala')
    from public."DB_Medicamentos" m join active_patients p on p."HC" = m."HC"
    union all
    select l."HC", coalesce(l."Modificado_En", l."Fecha"::timestamp at time zone 'America/Guatemala')
    from public."DB_Laboratorios" l join active_patients p on p."HC" = l."HC"
    union all
    select c."HC", coalesce(c."Modificado_En", c."Fecha_Envio"::timestamp at time zone 'America/Guatemala')
    from public."DB_Consultas" c join active_patients p on p."HC" = c."HC"
    union all
    select c."HC", coalesce(c."Modificado_En", c."Fecha_Envio"::timestamp at time zone 'America/Guatemala')
    from public."DB_Cultivos" c join active_patients p on p."HC" = c."HC"
    union all
    select t."HC", coalesce(t."Modificado_En", t."Fecha_Solicitud"::timestamp at time zone 'America/Guatemala')
    from public."DB_Pendientes" t join active_patients p on p."HC" = t."HC"
    union all
    select p."HC", p."Modificado_En" from active_patients p
  ), latest_activity as (
    select a."HC", max(a.event_at) as latest_activity_at
    from activity a
    where a.event_at is not null
    group by a."HC"
  ), meds as (
    select m."HC", count(*)::bigint as active_medications
    from public."DB_Medicamentos" m join active_patients p on p."HC" = m."HC"
    where m."Activo" = 'Sí'
    group by m."HC"
  ), tasks as (
    select t."HC", count(*)::bigint as open_tasks,
      count(*) filter (
        where t."Fecha_Programada" is null
          or t."Fecha_Programada" <= (now() at time zone 'America/Guatemala')::date
      )::bigint as due_tasks
    from public."DB_Pendientes" t join active_patients p on p."HC" = t."HC"
    where t."Estado" = 'Pendiente'
    group by t."HC"
  ), cultures as (
    select c."HC", count(*)::bigint as pending_cultures
    from public."DB_Cultivos" c join active_patients p on p."HC" = c."HC"
    where c."Resultado" is null or c."Resultado" = 'Pendiente'
    group by c."HC"
  ), consults as (
    select c."HC", count(*)::bigint as unanswered_consultations
    from public."DB_Consultas" c join active_patients p on p."HC" = c."HC"
    where c."Fecha_Respuesta" is null
    group by c."HC"
  )
  select p."HC", p."Nombre_Completo", p."Servicio", p."Cama", p."Edad",
    v.latest_vital_at, la.latest_activity_at,
    coalesce(m.active_medications, 0), coalesce(t.open_tasks, 0), coalesce(t.due_tasks, 0),
    coalesce(cu.pending_cultures, 0), coalesce(co.unanswered_consultations, 0),
    v.latest_vital_at is null or v.latest_vital_at <= now() - interval '24 hours',
    p."Modificado_En", p.total_count
  from active_patients p
  left join vitals v on v."HC" = p."HC"
  left join latest_activity la on la."HC" = p."HC"
  left join meds m on m."HC" = p."HC"
  left join tasks t on t."HC" = p."HC"
  left join cultures cu on cu."HC" = p."HC"
  left join consults co on co."HC" = p."HC"
  order by p."round_order";
end;
$$;

revoke all on function public.ronda_hoy(text, int) from public, anon;
grant execute on function public.ronda_hoy(text, int) to authenticated;

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
security definer
set search_path = public, pg_temp
as $$
begin
  if public.f_mi_rol() is null then
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
    coalesce(nullif(trim(per.nombre), ''), 'Personal clínico') as actor_name
  from events e
  left join public.personal per on per.id = e.actor_id
  where e.event_at is not null
  order by e.event_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 80);
end;
$$;

revoke all on function public.timeline_paciente(text, int) from public, anon;
grant execute on function public.timeline_paciente(text, int) to authenticated;

alter table public.audit_log drop constraint if exists audit_log_accion_check;
alter table public.audit_log add constraint audit_log_accion_check
  check (accion in ('INSERT', 'UPDATE', 'PRINT'));

create or replace function public.registrar_impresion_expediente(p_hc text, p_registros jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.f_mi_rol() is null then
    raise exception 'No autorizado';
  end if;
  if not exists (
    select 1 from public."DB_Pacientes"
    where "HC" = p_hc and "Eliminado_En" is null
  ) then
    raise exception 'El expediente ya no está disponible';
  end if;

  insert into public.audit_log (tabla, registro_id, accion, usuario_id, datos_nuevos)
  values (
    'DB_Pacientes', p_hc, 'PRINT', auth.uid(),
    jsonb_build_object('impreso_en', clock_timestamp(), 'registros_incluidos', coalesce(p_registros, '{}'::jsonb))
  );
end;
$$;

revoke all on function public.registrar_impresion_expediente(text, jsonb) from public, anon;
grant execute on function public.registrar_impresion_expediente(text, jsonb) to authenticated;