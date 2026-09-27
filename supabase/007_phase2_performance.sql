-- ============================================================================
-- 007_phase2_performance.sql
-- Fase 2: consultas mínimas, paginación, resumen server-side y accesos eficientes.
-- Ejecutar DESPUÉS de 006. Re-ejecutable.
-- ============================================================================

-- Índices alineados con los ORDER BY + HC que usa la aplicación.
create index if not exists idx_signos_hc_fecha_desc
  on public."DB_SignosVitales" ("HC", "Fecha_Hora" desc);
create index if not exists idx_meds_hc_fecha_desc
  on public."DB_Medicamentos" ("HC", "Fecha_Inicio" desc, id desc);
create index if not exists idx_meds_hc_activos
  on public."DB_Medicamentos" ("HC", "Fecha_Inicio" desc, id desc)
  where "Activo" = 'Sí';
create index if not exists idx_labs_hc_fecha_desc
  on public."DB_Laboratorios" ("HC", "Fecha" desc, id desc);
create index if not exists idx_cons_hc_fecha_desc
  on public."DB_Consultas" ("HC", "Fecha_Envio" desc, id desc);
create index if not exists idx_cons_hc_sin_respuesta
  on public."DB_Consultas" ("HC", "Fecha_Envio" desc, id desc)
  where "Fecha_Respuesta" is null;
create index if not exists idx_cult_hc_fecha_desc
  on public."DB_Cultivos" ("HC", "Fecha_Envio" desc, id desc);
create index if not exists idx_pend_hc_fecha_desc
  on public."DB_Pendientes" ("HC", "Fecha_Solicitud" desc, id desc);
create index if not exists idx_pend_hc_abiertos
  on public."DB_Pendientes" ("HC", "Fecha_Solicitud" desc, id desc)
  where "Estado" = 'Pendiente';

-- Resumen compacto server-side. La UI necesita conteos y una pequeña ventana de
-- contexto, pero nunca debe descargar el historial completo para pintar el resumen.
-- SECURITY INVOKER (por defecto): las mismas RLS del usuario autenticado se aplican.
create or replace function public.resumen_paciente(p_hc text)
returns jsonb
language sql
stable
as $$
  with p as (
    select 1
    from public."DB_Pacientes"
    where "HC" = p_hc and "Eliminado_En" is null
  ),
  latest_vital as (
    select jsonb_build_object(
      'id', v.id,
      'HC', v."HC",
      'Fecha_Hora', v."Fecha_Hora",
      'PA_Sistolica', v."PA_Sistolica",
      'PA_Diastolica', v."PA_Diastolica",
      'Frecuencia_Cardiaca', v."Frecuencia_Cardiaca",
      'SpO2', v."SpO2",
      'Temperatura', v."Temperatura",
      'Frecuencia_Respiratoria', v."Frecuencia_Respiratoria",
      'PAM', v."PAM",
      'Modificado_En', v."Modificado_En"
    ) as row
    from public."DB_SignosVitales" v
    where v."HC" = p_hc
    order by v."Fecha_Hora" desc
    limit 1
  ),
  labs as (
    select coalesce(jsonb_agg(t."Tipo_Lab" order by t."Tipo_Lab"), '[]'::jsonb) as values
    from (select distinct "Tipo_Lab" from public."DB_Laboratorios" where "HC" = p_hc and "Tipo_Lab" is not null limit 100) t
  ),
  meds as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id,
      'HC', m."HC",
      'Nombre_Medicamento', m."Nombre_Medicamento",
      'Dosis_Frecuencia', m."Dosis_Frecuencia",
      'Fecha_Inicio', m."Fecha_Inicio",
      'Activo', m."Activo",
      'Requiere_Seguimiento_Dias', m."Requiere_Seguimiento_Dias",
      'Frecuencia_Horas', m."Frecuencia_Horas",
      'Modificado_En', m."Modificado_En"
    ) order by m."Fecha_Inicio" desc, m.id desc), '[]'::jsonb) as values
    from (select id, "HC", "Nombre_Medicamento", "Dosis_Frecuencia", "Fecha_Inicio", "Activo", "Requiere_Seguimiento_Dias", "Frecuencia_Horas", "Modificado_En" from public."DB_Medicamentos" where "HC" = p_hc and "Activo" = 'Sí' order by "Fecha_Inicio" desc, id desc limit 5) m
  ),
  tasks as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'HC', t."HC",
      'Descripcion_Tarea', t."Descripcion_Tarea",
      'Fecha_Solicitud', t."Fecha_Solicitud",
      'Fecha_Programada', t."Fecha_Programada",
      'Justificacion_Observaciones', t."Justificacion_Observaciones",
      'Estado', t."Estado",
      'Fecha_Completado', t."Fecha_Completado",
      'Modificado_En', t."Modificado_En"
    ) order by t."Fecha_Solicitud" desc, t.id desc), '[]'::jsonb) as values
    from (select id, "HC", "Descripcion_Tarea", "Fecha_Solicitud", "Fecha_Programada", "Justificacion_Observaciones", "Estado", "Fecha_Completado", "Modificado_En" from public."DB_Pendientes" where "HC" = p_hc and "Estado" = 'Pendiente' order by "Fecha_Solicitud" desc, id desc limit 5) t
  ),
  cultures as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'HC', c."HC",
      'Tipo_Cultivo', c."Tipo_Cultivo",
      'Fecha_Envio', c."Fecha_Envio",
      'Fecha_Resultado', c."Fecha_Resultado",
      'Resultado', c."Resultado",
      'Es_Periodico', c."Es_Periodico",
      'Intervalo_Horas', c."Intervalo_Horas",
      'Observaciones_Microbiologia', c."Observaciones_Microbiologia",
      'Modificado_En', c."Modificado_En"
    ) order by c."Fecha_Envio" desc, c.id desc), '[]'::jsonb) as values
    from (select id, "HC", "Tipo_Cultivo", "Fecha_Envio", "Fecha_Resultado", "Resultado", "Observaciones_Microbiologia", "Es_Periodico", "Intervalo_Horas", "Modificado_En" from public."DB_Cultivos" where "HC" = p_hc and ("Resultado" is null or "Resultado" = 'Pendiente') order by "Fecha_Envio" desc, id desc limit 5) c
  ),
  consults as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'HC', c."HC",
      'Departamento_Consultado', c."Departamento_Consultado",
      'Fecha_Envio', c."Fecha_Envio",
      'Modificado_En', c."Modificado_En"
    ) order by c."Fecha_Envio" desc, c.id desc), '[]'::jsonb) as values
    from (select id, "HC", "Departamento_Consultado", "Fecha_Envio", "Modificado_En" from public."DB_Consultas" where "HC" = p_hc and "Fecha_Respuesta" is null order by "Fecha_Envio" desc, id desc limit 5) c
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
      'openTasks', (select count(*) from public."DB_Pendientes" where "HC" = p_hc and "Estado" = 'Pendiente')
    ),
    'labTypes', (select values from labs),
    'latestVital', (select row from latest_vital),
    'activeMedications', (select values from meds),
    'openTasks', (select values from tasks),
    'pendingCultures', (select values from cultures),
    'unansweredConsultations', (select values from consults)
  ) else null end;
$$;

grant execute on function public.resumen_paciente(text) to authenticated;
revoke execute on function public.resumen_paciente(text) from anon;

-- La búsqueda tampoco necesita devolver la fila completa de DB_Pacientes. Se crea
-- una RPC específica para el cliente; mantiene la búsqueda existente intacta para
-- compatibilidad con instalaciones previas.
create or replace function public.buscar_pacientes_min(
  p_query text default '', p_servicio text default null, p_limit int default 30
) returns table (
  "HC" text,
  "Nombre_Completo" text,
  "Servicio" text,
  "Cama" text,
  "Edad" text
)
language sql
stable
as $$
  with q as (select public.f_unaccent(lower(trim(coalesce(p_query, '')))) as t)
  select p."HC", p."Nombre_Completo", p."Servicio", p."Cama", p."Edad"
  from public."DB_Pacientes" p, q
  where p."Eliminado_En" is null
    and (p_servicio is null or p_servicio = '' or p."Servicio" = p_servicio)
    and (
      q.t = ''
      or not exists (
        select 1 from unnest(string_to_array(q.t, ' ')) w
        where w <> ''
          and not (public.f_unaccent(lower(p."Nombre_Completo")) like '%' || w || '%'
                   or w <% public.f_unaccent(lower(p."Nombre_Completo")))
      )
      or lower(p."HC") like replace(q.t, ' ', '') || '%'
      or lower(coalesce(p."Cama", '')) = regexp_replace(q.t, '^cama\s*', '')
    )
  order by similarity(public.f_unaccent(lower(p."Nombre_Completo")), q.t) desc, p."Nombre_Completo"
  limit least(coalesce(p_limit, 30), 50);
$$;

grant execute on function public.buscar_pacientes_min(text, text, int) to authenticated;
revoke execute on function public.buscar_pacientes_min(text, text, int) from anon;
