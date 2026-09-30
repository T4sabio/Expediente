alter table public."DB_Pacientes"
  add column if not exists "Estado_Episodio" text not null default 'Hospitalizado',
  add column if not exists "Fecha_Egreso" date,
  add column if not exists "Umbral_Signos_Horas" smallint not null default 24;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public."DB_Pacientes"'::regclass
      and conname = 'db_pacientes_estado_episodio_check'
  ) then
    alter table public."DB_Pacientes"
      add constraint db_pacientes_estado_episodio_check
      check (
        "Estado_Episodio" in ('Hospitalizado', 'Trasladado', 'Alta', 'Defunción')
        and (("Estado_Episodio" = 'Hospitalizado' and "Fecha_Egreso" is null)
          or ("Estado_Episodio" <> 'Hospitalizado' and "Fecha_Egreso" is not null))
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public."DB_Pacientes"'::regclass
      and conname = 'db_pacientes_umbral_signos_check'
  ) then
    alter table public."DB_Pacientes"
      add constraint db_pacientes_umbral_signos_check
      check ("Umbral_Signos_Horas" between 1 and 720);
  end if;
end;
$$;

create or replace function public.ronda_hoy(p_servicio text default null, p_limit int default 100)
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
      and p."Estado_Episodio" = 'Hospitalizado'
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
    v.latest_vital_at is null or v.latest_vital_at <= now() - make_interval(hours => p."Umbral_Signos_Horas"),
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