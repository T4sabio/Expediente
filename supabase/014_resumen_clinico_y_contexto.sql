alter table public."DB_Pacientes"
  add column if not exists "Tiene_EPOC" boolean not null default false;

alter table public."DB_SignosVitales"
  add column if not exists "Oxigeno_Suplementario" boolean;

alter table public."DB_Cultivos"
  add column if not exists "Fecha_Envio_Hora" timestamptz;

alter table public."DB_Cultivos"
  alter column "Fecha_Envio_Hora" set default now();

create or replace function public.resumen_paciente(p_hc text)
returns jsonb
language sql
stable
as $$
  with p as (
    select 1 from public."DB_Pacientes"
    where "HC" = p_hc and "Eliminado_En" is null
  ),
  latest_vital as (
    select jsonb_build_object(
      'id', v.id, 'HC', v."HC", 'Fecha_Hora', v."Fecha_Hora",
      'PA_Sistolica', v."PA_Sistolica", 'PA_Diastolica', v."PA_Diastolica",
      'Frecuencia_Cardiaca', v."Frecuencia_Cardiaca", 'SpO2', v."SpO2",
      'Oxigeno_Suplementario', v."Oxigeno_Suplementario",
      'Temperatura', v."Temperatura", 'Frecuencia_Respiratoria', v."Frecuencia_Respiratoria",
      'PAM', v."PAM", 'Modificado_En', v."Modificado_En"
    ) as row
    from public."DB_SignosVitales" v
    where v."HC" = p_hc
    order by v."Fecha_Hora" desc
    limit 1
  ),
  labs as (
    select coalesce(jsonb_agg(t."Tipo_Lab" order by t."Tipo_Lab"), '[]'::jsonb) as values
    from (
      select distinct "Tipo_Lab" from public."DB_Laboratorios"
      where "HC" = p_hc and "Tipo_Lab" is not null limit 100
    ) t
  ),
  meds as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'HC', m."HC", 'Nombre_Medicamento', m."Nombre_Medicamento",
      'Dosis_Frecuencia', m."Dosis_Frecuencia", 'Fecha_Inicio', m."Fecha_Inicio",
      'Fecha_Omision', m."Fecha_Omision", 'Activo', m."Activo",
      'Dias_Tratamiento', m."Dias_Tratamiento",
      'Requiere_Seguimiento_Dias', m."Requiere_Seguimiento_Dias",
      'Frecuencia_Horas', m."Frecuencia_Horas", 'Modificado_En', m."Modificado_En"
    ) order by m."Fecha_Inicio" desc, m.id desc), '[]'::jsonb) as values
    from (
      select id, "HC", "Nombre_Medicamento", "Dosis_Frecuencia", "Fecha_Inicio",
        "Fecha_Omision", "Activo", "Dias_Tratamiento", "Requiere_Seguimiento_Dias",
        "Frecuencia_Horas", "Modificado_En"
      from public."DB_Medicamentos"
      where "HC" = p_hc and "Activo" = 'Sí'
      order by "Fecha_Inicio" desc, id desc limit 5
    ) m
  ),
  tracked_meds as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'HC', m."HC", 'Nombre_Medicamento', m."Nombre_Medicamento",
      'Dosis_Frecuencia', m."Dosis_Frecuencia", 'Fecha_Inicio', m."Fecha_Inicio",
      'Fecha_Omision', m."Fecha_Omision", 'Activo', m."Activo",
      'Dias_Tratamiento', m."Dias_Tratamiento",
      'Requiere_Seguimiento_Dias', m."Requiere_Seguimiento_Dias",
      'Frecuencia_Horas', m."Frecuencia_Horas", 'Modificado_En', m."Modificado_En"
    ) order by m."Fecha_Inicio", m.id), '[]'::jsonb) as values
    from public."DB_Medicamentos" m
    where m."HC" = p_hc and m."Activo" = 'Sí' and m."Requiere_Seguimiento_Dias"
  ),
  tasks as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'HC', t."HC", 'Descripcion_Tarea', t."Descripcion_Tarea",
      'Fecha_Solicitud', t."Fecha_Solicitud", 'Fecha_Programada', t."Fecha_Programada",
      'Justificacion_Observaciones', t."Justificacion_Observaciones", 'Estado', t."Estado",
      'Fecha_Completado', t."Fecha_Completado", 'Modificado_En', t."Modificado_En"
    ) order by t.is_overdue desc, t.due_date, t.id desc), '[]'::jsonb) as values
    from (
      select id, "HC", "Descripcion_Tarea", "Fecha_Solicitud", "Fecha_Programada",
        "Justificacion_Observaciones", "Estado", "Fecha_Completado", "Modificado_En",
        coalesce("Fecha_Programada", "Fecha_Solicitud") as due_date,
        coalesce("Fecha_Programada", "Fecha_Solicitud") <
          (now() at time zone 'America/Guatemala')::date as is_overdue
      from public."DB_Pendientes"
      where "HC" = p_hc and "Estado" = 'Pendiente'
      order by is_overdue desc, due_date, id desc limit 25
    ) t
  ),
  overdue_tasks as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'HC', t."HC", 'Descripcion_Tarea', t."Descripcion_Tarea",
      'Fecha_Solicitud', t."Fecha_Solicitud", 'Fecha_Programada', t."Fecha_Programada",
      'Justificacion_Observaciones', t."Justificacion_Observaciones", 'Estado', t."Estado",
      'Fecha_Completado', t."Fecha_Completado", 'Modificado_En', t."Modificado_En"
    ) order by t.due_date, t.id desc), '[]'::jsonb) as values
    from (
      select id, "HC", "Descripcion_Tarea", "Fecha_Solicitud", "Fecha_Programada",
        "Justificacion_Observaciones", "Estado", "Fecha_Completado", "Modificado_En",
        coalesce("Fecha_Programada", "Fecha_Solicitud") as due_date
      from public."DB_Pendientes"
      where "HC" = p_hc and "Estado" = 'Pendiente'
        and coalesce("Fecha_Programada", "Fecha_Solicitud") <
          (now() at time zone 'America/Guatemala')::date
      order by due_date, id desc limit 25
    ) t
  ),
  cultures as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'HC', c."HC", 'Tipo_Cultivo', c."Tipo_Cultivo",
      'Fecha_Envio', c."Fecha_Envio", 'Fecha_Envio_Hora', c."Fecha_Envio_Hora",
      'Fecha_Resultado', c."Fecha_Resultado", 'Resultado', c."Resultado",
      'Es_Periodico', c."Es_Periodico", 'Intervalo_Horas', c."Intervalo_Horas",
      'Observaciones_Microbiologia', c."Observaciones_Microbiologia", 'Modificado_En', c."Modificado_En"
    ) order by c."Fecha_Envio" desc, c.id desc), '[]'::jsonb) as values
    from (
      select id, "HC", "Tipo_Cultivo", "Fecha_Envio", "Fecha_Envio_Hora",
        "Fecha_Resultado", "Resultado", "Es_Periodico", "Intervalo_Horas",
        "Observaciones_Microbiologia", "Modificado_En"
      from public."DB_Cultivos"
      where "HC" = p_hc and ("Resultado" is null or "Resultado" = 'Pendiente')
      order by "Fecha_Envio" desc, id desc limit 5
    ) c
  ),
  periodic_cultures as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'Tipo_Cultivo', c."Tipo_Cultivo", 'Fecha_Envio', c."Fecha_Envio",
      'Fecha_Envio_Hora', c."Fecha_Envio_Hora", 'Es_Periodico', c."Es_Periodico",
      'Intervalo_Horas', c."Intervalo_Horas", 'Resultado', c."Resultado"
    ) order by c."Tipo_Cultivo"), '[]'::jsonb) as values
    from (
      select distinct on ("Tipo_Cultivo") id, "Tipo_Cultivo", "Fecha_Envio",
        "Fecha_Envio_Hora", "Es_Periodico", "Intervalo_Horas", "Resultado"
      from public."DB_Cultivos"
      where "HC" = p_hc and "Es_Periodico" and coalesce("Intervalo_Horas", 0) > 0
      order by "Tipo_Cultivo", coalesce("Fecha_Envio_Hora", "Fecha_Envio"::timestamp at time zone 'America/Guatemala') desc, id desc
    ) c
  ),
  consults as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'HC', c."HC", 'Departamento_Consultado', c."Departamento_Consultado",
      'Fecha_Envio', c."Fecha_Envio", 'Modificado_En', c."Modificado_En"
    ) order by c."Fecha_Envio" desc, c.id desc), '[]'::jsonb) as values
    from (
      select id, "HC", "Departamento_Consultado", "Fecha_Envio", "Modificado_En"
      from public."DB_Consultas"
      where "HC" = p_hc and "Fecha_Respuesta" is null
      order by "Fecha_Envio" desc, id desc limit 5
    ) c
  )
  select case when exists (select 1 from p) then jsonb_build_object(
    'counts', jsonb_build_object(
      'vitals', (select count(*) from public."DB_SignosVitales" where "HC" = p_hc),
      'medications', (select count(*) from public."DB_Medicamentos" where "HC" = p_hc),
      'activeMedications', (select count(*) from public."DB_Medicamentos" where "HC" = p_hc and "Activo" = 'Sí'),
      'labs', (select count(*) from public."DB_Laboratorios" where "HC" = p_hc),
      'consultations', (select count(*) from public."DB_Consultas" where "HC" = p_hc),
      'unansweredConsultations', (select count(*) from public."DB_Consultas" where "HC" = p_hc and "Fecha_Respuesta" is null),
      'cultures', (select count(*) from public."DB_Cultivos" where "HC" = p_hc),
      'pendingCultures', (select count(*) from public."DB_Cultivos" where "HC" = p_hc and ("Resultado" is null or "Resultado" = 'Pendiente')),
      'tasks', (select count(*) from public."DB_Pendientes" where "HC" = p_hc),
      'openTasks', (select count(*) from public."DB_Pendientes" where "HC" = p_hc and "Estado" = 'Pendiente'),
      'overdueTasks', (select count(*) from public."DB_Pendientes" where "HC" = p_hc and "Estado" = 'Pendiente' and coalesce("Fecha_Programada", "Fecha_Solicitud") < (now() at time zone 'America/Guatemala')::date)
    ),
    'labTypes', (select values from labs),
    'latestVital', (select row from latest_vital),
    'activeMedications', (select values from meds),
    'trackedMedications', (select values from tracked_meds),
    'openTasks', (select values from tasks),
    'overdueTasks', (select values from overdue_tasks),
    'pendingCultures', (select values from cultures),
    'periodicCultures', (select values from periodic_cultures),
    'unansweredConsultations', (select values from consults)
  ) else null end;
$$;

grant execute on function public.resumen_paciente(text) to authenticated;
revoke execute on function public.resumen_paciente(text) from anon;