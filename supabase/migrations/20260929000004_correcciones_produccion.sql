-- ============================================================================
-- 004_correcciones_produccion.sql
-- Ejecutar UNA VEZ en Supabase → SQL Editor, después de 001/002/003.
-- Seguro de correr en una base ya en uso: todo es idempotente (if not exists,
-- create or replace) y los checks de longitud se agregan como "not valid" para
-- no fallar si ya existe una fila más larga que el límite (ver nota al final).
--
-- Qué corrige (ver informe de auditoría, hallazgos 2.1 y 2.7):
--   1. DB_Pendientes no tenía columna "Fecha_Solicitud", aunque la app la
--      consulta y la muestra (src/services/ApiService.js, src/views/sections/
--      pendientes.js). Sin esta columna, esa fecha siempre se veía como "—" y,
--      según la versión de PostgREST, ordenar por una columna inexistente
--      puede romper la carga completa del expediente.
--   2. Los campos de texto libre más largos (nombre, servicio, motivo de
--      consulta, diagnósticos, etc.) no tenían ningún límite en el servidor;
--      el límite solo vivía en la app (src/utils/constants.js FIELD_LIMITS).
--      Alguien escribiendo directo contra la API (o un bug futuro en el
--      cliente) podía guardar un texto de cualquier tamaño.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Fecha_Solicitud en DB_Pendientes
-- ----------------------------------------------------------------------------
alter table public."DB_Pendientes"
  add column if not exists "Fecha_Solicitud" date not null default ((now() at time zone 'America/Guatemala')::date);

alter table public."DB_Pendientes"
  alter column "Fecha_Solicitud" set default ((now() at time zone 'America/Guatemala')::date);

-- Para pendientes ya existentes sin este dato, se usa la fecha programada (si
-- la tenían) como mejor aproximación disponible; el default de arriba ya cubre
-- las filas nuevas, esto solo repara el historial previo a esta migración.
update public."DB_Pendientes"
set "Fecha_Solicitud" = coalesce("Fecha_Programada", "Fecha_Solicitud")
where "Fecha_Solicitud" = (now() at time zone 'America/Guatemala')::date
  and "Fecha_Programada" is not null
  and "Fecha_Programada" < (now() at time zone 'America/Guatemala')::date;

create index if not exists idx_pend_fecha_solicitud on public."DB_Pendientes" ("Fecha_Solicitud" desc);

-- ----------------------------------------------------------------------------
-- 2. Límites de longitud (deben coincidir con FIELD_LIMITS en
--    src/utils/constants.js — si cambias uno, cambia el otro).
-- ----------------------------------------------------------------------------
-- Postgres no soporta "ADD CONSTRAINT IF NOT EXISTS", así que cada una se
-- agrega solo si todavía no existe (mismo patrón defensivo que el resto del
-- proyecto usa para políticas/triggers con "drop ... if exists" antes de crear).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_nombre_completo_len') then
    alter table public."DB_Pacientes" add constraint chk_nombre_completo_len
      check (char_length("Nombre_Completo") <= 200) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_servicio_len') then
    alter table public."DB_Pacientes" add constraint chk_servicio_len
      check (char_length("Servicio") <= 100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_cama_len') then
    alter table public."DB_Pacientes" add constraint chk_cama_len
      check ("Cama" is null or char_length("Cama") <= 20) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_rayosx_len') then
    alter table public."DB_Pacientes" add constraint chk_rayosx_len
      check ("Num_RayosX" is null or char_length("Num_RayosX") <= 50) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_motivo_len') then
    alter table public."DB_Pacientes" add constraint chk_motivo_len
      check ("Motivo_Consulta" is null or char_length("Motivo_Consulta") <= 1000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_diagnosticos_len') then
    alter table public."DB_Pacientes" add constraint chk_diagnosticos_len
      check ("Diagnosticos" is null or char_length("Diagnosticos") <= 4000) not valid;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- NOTA sobre "not valid": esto hace que el check se aplique de inmediato a
-- todo INSERT/UPDATE nuevo, pero NO revisa retroactivamente las filas ya
-- existentes (así esta migración nunca falla por datos históricos más largos
-- que el nuevo límite). Cuando quieras confirmar que TODO el historial ya
-- cumple el límite, corre aparte (una sola vez, cuando tengas tiempo de
-- revisar si algo falla):
--   alter table public."DB_Pacientes" validate constraint chk_diagnosticos_len;
-- (y lo mismo para las otras 5 constraints de este archivo).
-- ============================================================================
