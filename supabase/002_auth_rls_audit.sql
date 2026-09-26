-- ============================================================================
-- 002_auth_rls_audit.sql
-- Ejecutar UNA VEZ en Supabase → SQL Editor, DESPUÉS de 001_search_and_indexes.sql.
--
-- Qué hace:
--   1. Tabla public.personal: vincula cada usuario de Supabase Auth con un rol
--      (medico / enfermeria / lectura). Sin fila en esta tabla, el usuario
--      autenticado no puede leer ni escribir nada (deny-by-default).
--   2. Row Level Security en las 7 tablas DB_*: solo personal activo puede
--      leer; solo medico/enfermeria puede insertar/actualizar; nadie puede
--      hacer DELETE físico (no se crea política de DELETE → PostgREST lo
--      rechaza). El "borrado" de pacientes es lógico (ver Eliminado_En).
--   3. Columnas Creado_Por / Modificado_Por en cada tabla, llenadas solas
--      por trigger con el usuario autenticado (auth.uid()).
--   4. public.audit_log: registro inmutable de cada INSERT/UPDATE en las 7
--      tablas (quién, cuándo, qué cambió). Solo lectura desde el cliente.
--   5. Borrado lógico de pacientes: columna Eliminado_En / Eliminado_Por en
--      DB_Pacientes. Solo rol "medico" puede setearla (trigger lo valida).
--      El resto de la app (búsqueda, expediente) ignora los pacientes
--      eliminados vía la función get_paciente_activo / vista activa.
--
-- IMPORTANTE — orden de despliegue:
--   a) Corre este script.
--   b) Crea el primer usuario en Supabase → Authentication → Users
--      (o que se registre con signUp desde la pantalla de login).
--   c) Ve a Table Editor → personal y cambia su "rol" a 'medico' a mano
--      (el trigger de abajo crea la fila automáticamente con rol 'lectura'
--      la primera vez que inicia sesión: hay que "ascenderlo" manualmente).
--   d) Repite (c) para cada persona del equipo. Así nadie queda con acceso
--      de escritura sin que un médico/admin lo apruebe explícitamente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PERSONAL Y ROLES
-- ----------------------------------------------------------------------------
create table if not exists public.personal (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text,
  rol         text not null default 'lectura' check (rol in ('medico', 'enfermeria', 'lectura')),
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

alter table public.personal enable row level security;

-- Cada quien puede ver su propia fila (para que la UI sepa su rol/nombre).
drop policy if exists "ver mi propio registro" on public.personal;
create policy "ver mi propio registro" on public.personal
  for select to authenticated using (id = auth.uid());

-- Nadie escribe esta tabla desde el cliente (anon key). Los roles se asignan
-- a mano desde el Table Editor de Supabase (con la service_role, fuera del navegador).

-- Al confirmarse un nuevo usuario, se le crea automáticamente una fila con
-- rol 'lectura' (el mínimo privilegio). Un médico debe subirle el rol luego.
create or replace function public.f_nuevo_usuario_personal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.personal (id, nombre, rol)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email), 'lectura')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.f_nuevo_usuario_personal();

-- Helper: rol del usuario actual (null si no está autenticado o no tiene fila).
create or replace function public.f_mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from public.personal where id = auth.uid() and activo;
$$;

grant execute on function public.f_mi_rol() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. COLUMNAS DE AUDITORÍA (Creado_Por / Modificado_Por) EN LAS 7 TABLAS
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['DB_Pacientes','DB_SignosVitales','DB_Medicamentos',
                            'DB_Laboratorios','DB_Consultas','DB_Cultivos','DB_Pendientes']
  loop
    execute format('alter table public.%I add column if not exists "Creado_Por" uuid references auth.users(id)', t);
    execute format('alter table public.%I add column if not exists "Modificado_Por" uuid references auth.users(id)', t);
    execute format('alter table public.%I add column if not exists "Modificado_En" timestamptz', t);
  end loop;
end $$;

-- Borrado lógico: solo aplica a pacientes (las tablas hijas no se borran solas).
alter table public."DB_Pacientes" add column if not exists "Eliminado_En" timestamptz;
alter table public."DB_Pacientes" add column if not exists "Eliminado_Por" uuid references auth.users(id);

create index if not exists idx_pacientes_no_eliminados
  on public."DB_Pacientes" (("Eliminado_En" is null));

create or replace function public.f_set_auditoria()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new."Creado_Por" := auth.uid();
    new."Modificado_Por" := auth.uid();
    new."Modificado_En" := now();
  elsif tg_op = 'UPDATE' then
    -- La HC/id y quién creó el registro no se pueden falsear desde el cliente.
    new."Creado_Por" := old."Creado_Por";
    new."Modificado_Por" := auth.uid();
    new."Modificado_En" := now();
    -- Solo un médico puede eliminar (o restaurar) un paciente lógicamente.
    if tg_table_name = 'DB_Pacientes' and new."Eliminado_En" is distinct from old."Eliminado_En" then
      if public.f_mi_rol() <> 'medico' then
        raise exception 'Solo el rol médico puede eliminar o restaurar pacientes.';
      end if;
      new."Eliminado_Por" := case when new."Eliminado_En" is null then null else auth.uid() end;
    end if;
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
    execute format('drop trigger if exists trg_auditoria on public.%I', t);
    execute format('create trigger trg_auditoria before insert or update on public.%I
                     for each row execute function public.f_set_auditoria()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. BITÁCORA DE AUDITORÍA (audit_log) — quién hizo qué y cuándo
-- ----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id                bigserial primary key,
  tabla             text not null,
  registro_id       text not null,
  accion            text not null check (accion in ('INSERT', 'UPDATE')),
  usuario_id        uuid references auth.users(id),
  datos_anteriores  jsonb,
  datos_nuevos      jsonb,
  creado_en         timestamptz not null default now()
);

create index if not exists idx_audit_tabla_registro on public.audit_log (tabla, registro_id, creado_en desc);

alter table public.audit_log enable row level security;

-- Cualquier personal autenticado puede CONSULTAR la bitácora (transparencia),
-- pero nadie puede insertar/editar/borrar desde el cliente: solo el trigger
-- (que corre con privilegios del dueño de la función) escribe aquí.
drop policy if exists "personal autenticado puede leer bitacora" on public.audit_log;
create policy "personal autenticado puede leer bitacora" on public.audit_log
  for select to authenticated using (public.f_mi_rol() is not null);

create or replace function public.f_registrar_auditoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  id_col text := case when tg_table_name = 'DB_Pacientes' then 'HC' else 'id' end;
  reg_id text;
begin
  if tg_op = 'INSERT' then
    reg_id := (to_jsonb(new) ->> id_col);
    insert into public.audit_log (tabla, registro_id, accion, usuario_id, datos_nuevos)
    values (tg_table_name, reg_id, 'INSERT', auth.uid(), to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    reg_id := (to_jsonb(new) ->> id_col);
    insert into public.audit_log (tabla, registro_id, accion, usuario_id, datos_anteriores, datos_nuevos)
    values (tg_table_name, reg_id, 'UPDATE', auth.uid(), to_jsonb(old), to_jsonb(new));
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
    execute format('drop trigger if exists trg_bitacora on public.%I', t);
    -- corre DESPUÉS de f_set_auditoria para que Creado_Por/Modificado_Por ya estén resueltos.
    execute format('create trigger trg_bitacora after insert or update on public.%I
                     for each row execute function public.f_registrar_auditoria()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY EN LAS 7 TABLAS CLÍNICAS
--    Lectura: cualquier personal activo. Escritura: medico o enfermeria.
--    DELETE físico: sin política → PostgREST lo rechaza para todos (incluido
--    "lectura"); el borrado de pacientes es lógico vía UPDATE (ver arriba).
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['DB_Pacientes','DB_SignosVitales','DB_Medicamentos',
                            'DB_Laboratorios','DB_Consultas','DB_Cultivos','DB_Pendientes']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "personal activo puede leer" on public.%I', t);
    execute format($p$create policy "personal activo puede leer" on public.%I
                     for select to authenticated using (public.f_mi_rol() is not null)$p$, t);

    execute format('drop policy if exists "medico o enfermeria puede insertar" on public.%I', t);
    execute format($p$create policy "medico o enfermeria puede insertar" on public.%I
                     for insert to authenticated with check (public.f_mi_rol() in ('medico','enfermeria'))$p$, t);

    execute format('drop policy if exists "medico o enfermeria puede actualizar" on public.%I', t);
    execute format($p$create policy "medico o enfermeria puede actualizar" on public.%I
                     for update to authenticated
                     using (public.f_mi_rol() in ('medico','enfermeria'))
                     with check (public.f_mi_rol() in ('medico','enfermeria'))$p$, t);
  end loop;
end $$;

-- Sin política de "anon": al quitar el acceso anónimo, un visitante sin sesión
-- iniciada ya no puede leer ni escribir nada, aunque tenga la URL y la anon key.
revoke all on public."DB_Pacientes", public."DB_SignosVitales", public."DB_Medicamentos",
              public."DB_Laboratorios", public."DB_Consultas", public."DB_Cultivos",
              public."DB_Pendientes", public.personal, public.audit_log from anon;

-- ----------------------------------------------------------------------------
-- 5. BÚSQUEDA / EXPEDIENTE: ignorar pacientes eliminados lógicamente
--    (reemplaza las funciones de 001 para que filtren Eliminado_En is null)
-- ----------------------------------------------------------------------------
create or replace function public.buscar_pacientes(
  p_query text default '', p_servicio text default null, p_limit int default 30
) returns setof public."DB_Pacientes"
language sql stable as
$$
  with q as (select public.f_unaccent(lower(trim(coalesce(p_query, '')))) as t)
  select p.*
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

create or replace function public.listar_servicios()
returns setof text language sql stable as
$$ select distinct "Servicio" from public."DB_Pacientes" where "Servicio" is not null and "Eliminado_En" is null order by 1; $$;

grant execute on function public.buscar_pacientes(text, text, int) to authenticated;
grant execute on function public.listar_servicios() to authenticated;
revoke execute on function public.buscar_pacientes(text, text, int) from anon;
revoke execute on function public.listar_servicios() from anon;

-- ============================================================================
-- Fin. Después de correr esto, la app dejará de funcionar hasta que:
--   1. Agregues el login (ya viene implementado en src/services/AuthService.js).
--   2. Cada usuario inicie sesión al menos una vez (se le crea su fila en
--      "personal" automáticamente, con rol 'lectura').
--   3. Un administrador le suba el rol a 'medico' o 'enfermeria' desde el
--      Table Editor de Supabase, según corresponda.
-- ============================================================================
