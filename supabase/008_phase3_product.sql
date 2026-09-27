-- ============================================================================
-- 008_phase3_product.sql
-- Producto premium: ronda diaria, timeline clínico y última actividad.
-- Estas funciones devuelven solo datos mínimos para la experiencia de trabajo.
-- Son SECURITY DEFINER porque necesitan resolver el nombre del actor desde
-- public.personal sin abrir esa tabla completa al cliente. Cada función valida
-- que exista personal activo mediante f_mi_rol() y solo considera pacientes activos.
-- ============================================================================

create or replace function public.ronda_hoy(p_servicio text default null, p_limit int default 100)
returns table (
  hc text,
  nombre_completo text,
  servicio text,
  cama text,
  edad text,
  latest_vital_at timestamptz,
  active_medications bigint,
  open_tasks bigint,
  pending_cultures bigint,
  unanswered_consultations bigint,
  modificado_en timestamptz
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
  with active_patients as (
    select p.*
    from public."DB_Pacientes" p
    where p."Eliminado_En" is null
      and (p_servicio is null or p_servicio = '' or p."Servicio" = p_servicio)
    order by p."Servicio", p."Cama", p."Nombre_Completo"
    limit least(greatest(coalesce(p_limit, 100), 1), 100)
  ),
  vitals as (
    select v."HC", max(v."Fecha_Hora") as latest_vital_at
    from public."DB_SignosVitales" v
    join active_patients p on p."HC" = v."HC"
    group by v."HC"
  ),
  meds as (
    select m."HC", count(*)::bigint as active_medications
    from public."DB_Medicamentos" m
    join active_patients p on p."HC" = m."HC"
    where m."Activo" = 'Sí'
    group by m."HC"
  ),
  tasks as (
    select t."HC", count(*)::bigint as open_tasks
    from public."DB_Pendientes" t
    join active_patients p on p."HC" = t."HC"
    where t."Estado" = 'Pendiente'
    group by t."HC"
  ),
  cultures as (
    select c."HC", count(*)::bigint as pending_cultures
    from public."DB_Cultivos" c
    join active_patients p on p."HC" = c."HC"
    where c."Resultado" is null or c."Resultado" = 'Pendiente'
    group by c."HC"
  ),
  consults as (
    select c."HC", count(*)::bigint as unanswered_consultations
    from public."DB_Consultas" c
    join active_patients p on p."HC" = c."HC"
    where c."Fecha_Respuesta" is null
    group by c."HC"
  )
  select p."HC", p."Nombre_Completo", p."Servicio", p."Cama", p."Edad",
         v.latest_vital_at,
         coalesce(m.active_medications, 0), coalesce(t.open_tasks, 0),
         coalesce(cu.pending_cultures, 0), coalesce(co.unanswered_consultations, 0),
         p."Modificado_En"
  from active_patients p
  left join vitals v on v."HC" = p."HC"
  left join meds m on m."HC" = p."HC"
  left join tasks t on t."HC" = p."HC"
  left join cultures cu on cu."HC" = p."HC"
  left join consults co on co."HC" = p."HC"
  order by p."Servicio", p."Cama", p."Nombre_Completo";
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
    select v."Modificado_En" as event_at, 'vitales'::text as kind,
      'Signos vitales'::text as title,
      concat('PA ', coalesce(v."PA_Sistolica"::text, '—'), '/', coalesce(v."PA_Diastolica"::text, '—'),
             ' · FC ', coalesce(v."Frecuencia_Cardiaca"::text, '—'),
             ' · SpO2 ', coalesce(v."SpO2"::text, '—'), '%') as detail,
      'Registro'::text as action_label, v."Modificado_Por" as actor_id
    from public."DB_SignosVitales" v where v."HC" = p_hc

    union all
    select coalesce(m."Modificado_En", (m."Fecha_Inicio"::timestamp at time zone 'America/Guatemala')), 'medicamentos',
      'Medicamento', concat(m."Nombre_Medicamento", ' · ', m."Dosis_Frecuencia"),
      case when m."Activo" = 'Sí' then 'Activo' else 'Suspendido' end, m."Modificado_Por"
    from public."DB_Medicamentos" m where m."HC" = p_hc

    union all
    select coalesce(l."Modificado_En", (l."Fecha"::timestamp at time zone 'America/Guatemala')), 'laboratorios',
      'Laboratorio', concat(l."Tipo_Lab", ' · ', coalesce(l."Resultado_Texto", l."Valor_Numerico"::text, 'Sin resultado')),
      'Resultado', l."Modificado_Por"
    from public."DB_Laboratorios" l where l."HC" = p_hc

    union all
    select coalesce(c."Modificado_En", (c."Fecha_Envio"::timestamp at time zone 'America/Guatemala')), 'consultas',
      'Interconsulta', c."Departamento_Consultado",
      case when c."Fecha_Respuesta" is null then 'Sin respuesta' else 'Respondida' end, c."Modificado_Por"
    from public."DB_Consultas" c where c."HC" = p_hc

    union all
    select coalesce(c."Modificado_En", (c."Fecha_Envio"::timestamp at time zone 'America/Guatemala')), 'cultivos',
      'Cultivo', concat(c."Tipo_Cultivo", ' · ', coalesce(c."Resultado", 'Pendiente')),
      case when c."Resultado" is null or c."Resultado" = 'Pendiente' then 'En curso' else 'Resultado' end, c."Modificado_Por"
    from public."DB_Cultivos" c where c."HC" = p_hc

    union all
    select coalesce(t."Modificado_En", (t."Fecha_Solicitud"::timestamp at time zone 'America/Guatemala')), 'pendientes',
      'Pendiente', t."Descripcion_Tarea",
      t."Estado", t."Modificado_Por"
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

create or replace function public.ultima_actividad_paciente(p_hc text)
returns table (
  event_at timestamptz,
  title text,
  actor_name text,
  action_label text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.event_at, t.title, t.actor_name, t.action_label
  from public.timeline_paciente(p_hc, 1) t;
$$;

revoke all on function public.ultima_actividad_paciente(text) from public, anon;
grant execute on function public.ultima_actividad_paciente(text) to authenticated;

-- Índices auxiliares para las vistas de producto.
create index if not exists idx_pacientes_ronda_servicio_cama
  on public."DB_Pacientes" ("Servicio", "Cama", "Nombre_Completo")
  where "Eliminado_En" is null;
create index if not exists idx_vitals_hc_modificado_desc
  on public."DB_SignosVitales" ("HC", "Modificado_En" desc);
create index if not exists idx_meds_hc_activo_modificado
  on public."DB_Medicamentos" ("HC", "Activo", "Modificado_En" desc);
create index if not exists idx_labs_hc_modificado_desc
  on public."DB_Laboratorios" ("HC", "Modificado_En" desc);
create index if not exists idx_cons_hc_modificado_desc
  on public."DB_Consultas" ("HC", "Modificado_En" desc);
create index if not exists idx_cult_hc_modificado_desc
  on public."DB_Cultivos" ("HC", "Modificado_En" desc);
create index if not exists idx_tasks_hc_modificado_desc
  on public."DB_Pendientes" ("HC", "Modificado_En" desc);
