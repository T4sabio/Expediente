-- ============================================================================
-- 005_pam_antibioticos_cultivos_periodicos.sql
-- Ejecutar después de 000-004. Agrega:
--   1) PAM (presión arterial media) como columna generada en DB_SignosVitales.
--   2) Seguimiento de días de cobertura para antibióticos en DB_Medicamentos.
--   3) Cultivos periódicos (ej. hemocultivo cada 48h) en DB_Cultivos.
-- ============================================================================

-- 1) PAM: PA_Diastolica + (PA_Sistolica - PA_Diastolica) / 3, redondeada a 1 decimal.
-- Columna generada: una sola fuente de verdad, visible para cualquier cliente que
-- consulte la tabla directamente (auditorías, exportes), no solo esta app.
alter table public."DB_SignosVitales"
  add column if not exists "PAM" numeric(5,1)
  generated always as (
    round(("PA_Diastolica") + (("PA_Sistolica") - ("PA_Diastolica")) / 3.0, 1)
  ) stored;

-- 2) Antibióticos / medicamentos con seguimiento de días de cobertura.
alter table public."DB_Medicamentos"
  add column if not exists "Requiere_Seguimiento_Dias" boolean not null default false,
  add column if not exists "Frecuencia_Horas" smallint;

-- 3) Cultivos periódicos (ej. hemocultivo cada 48h). Cada toma sigue siendo una fila
-- independiente en DB_Cultivos; estas columnas son metadato de cómo se agendó, no
-- un cultivo "recurrente virtual".
alter table public."DB_Cultivos"
  add column if not exists "Es_Periodico" boolean not null default false,
  add column if not exists "Intervalo_Horas" smallint;

comment on column public."DB_SignosVitales"."PAM" is 'Presión arterial media, calculada automáticamente. No se captura en el formulario.';
comment on column public."DB_Medicamentos"."Requiere_Seguimiento_Dias" is 'Marca medicamentos (típicamente antibióticos) donde importa contar días de cobertura desde Fecha_Inicio.';
comment on column public."DB_Medicamentos"."Frecuencia_Horas" is 'Frecuencia en horas (ej. 8, 12, 24), opcional: solo para frasear el resumen ("cada 8 horas"). Si es null, el resumen usa Dosis_Frecuencia tal cual.';
comment on column public."DB_Cultivos"."Es_Periodico" is 'Marca cultivos agendados con repetición fija (ej. hemocultivo cada 48h).';
comment on column public."DB_Cultivos"."Intervalo_Horas" is 'Horas entre tomas cuando Es_Periodico = true (ej. 48). Null si Es_Periodico = false.';
