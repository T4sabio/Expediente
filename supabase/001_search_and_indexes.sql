-- Ejecutar una vez en Supabase → SQL Editor.
-- Mueve la búsqueda al servidor (sin acentos + tolerante a errores de tipeo) para que
-- la app NO tenga que descargar todos los pacientes al iniciar.

create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- unaccent() no es IMMUTABLE; este envoltorio permite usarlo en índices.
create or replace function public.f_unaccent(text)
returns text language sql immutable parallel safe strict as
$$ select public.unaccent('public.unaccent', $1) $$;

create index if not exists idx_pacientes_nombre_trgm
  on public."DB_Pacientes" using gin (public.f_unaccent(lower("Nombre_Completo")) gin_trgm_ops);
create index if not exists idx_pacientes_servicio on public."DB_Pacientes" ("Servicio");

-- Índices por HC en las tablas hijas (consultas del expediente).
create index if not exists idx_signos_hc on public."DB_SignosVitales" ("HC", "Fecha_Hora");
create index if not exists idx_meds_hc   on public."DB_Medicamentos" ("HC");
create index if not exists idx_labs_hc   on public."DB_Laboratorios" ("HC", "Fecha");
create index if not exists idx_cons_hc   on public."DB_Consultas"    ("HC");
create index if not exists idx_cult_hc   on public."DB_Cultivos"     ("HC");
create index if not exists idx_pend_hc   on public."DB_Pendientes"   ("HC");

-- Búsqueda: cada palabra debe coincidir (contiene o similar); también HC por prefijo y cama exacta.
create or replace function public.buscar_pacientes(
  p_query text default '', p_servicio text default null, p_limit int default 30
) returns setof public."DB_Pacientes"
language sql stable as
$$
  with q as (select public.f_unaccent(lower(trim(coalesce(p_query, '')))) as t)
  select p.*
  from public."DB_Pacientes" p, q
  where (p_servicio is null or p_servicio = '' or p."Servicio" = p_servicio)
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

create or replace function public.listar_servicios()
returns setof text language sql stable as
$$ select distinct "Servicio" from public."DB_Pacientes" where "Servicio" is not null order by 1; $$;

grant execute on function public.buscar_pacientes(text, text, int) to anon, authenticated;
grant execute on function public.listar_servicios() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- SEGURIDAD (recomendado antes de producción): la anon key es pública, así que
-- SIN Row Level Security cualquiera con la URL puede leer/borrar pacientes.
-- Con Supabase Auth (login del personal) el patrón sería, por cada tabla DB_*:
--
--   alter table public."DB_Pacientes" enable row level security;
--   create policy "personal autenticado" on public."DB_Pacientes"
--     for all to authenticated using (true) with check (true);
--
-- OJO: al activar RLS la app dejará de funcionar hasta que agregues inicio de sesión.
-- ---------------------------------------------------------------------------
