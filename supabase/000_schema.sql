-- ============================================================================
-- 000_schema.sql
-- Ejecutar PRIMERO, antes de 001/002/003, en un proyecto Supabase nuevo.
-- Crea las 7 tablas clínicas con exactamente las columnas que espera la app
-- (ver src/models/*.js y src/utils/constants.js). Si tus tablas YA existen
-- (por ejemplo, migraste datos de otro lado), omite este script.
-- ============================================================================

create table if not exists public."DB_Pacientes" (
  "HC"               text primary key,
  "Nombre_Completo"  text not null,
  "Servicio"         text not null,
  "Cama"             text,
  "Edad"             text,
  "Fecha_Ingreso"    date,
  "Num_RayosX"       text,
  "Motivo_Consulta"  text,
  "Diagnosticos"     text
);

create table if not exists public."DB_SignosVitales" (
  "id"                        bigserial primary key,
  "HC"                        text not null references public."DB_Pacientes"("HC") on delete cascade,
  "Fecha_Hora"                timestamptz not null,
  "PA_Sistolica"              smallint,
  "PA_Diastolica"             smallint,
  "Frecuencia_Cardiaca"       smallint,
  "SpO2"                      smallint,
  "Temperatura"               numeric(4,1),
  "Frecuencia_Respiratoria"   smallint
);

create table if not exists public."DB_Medicamentos" (
  "id"                    bigserial primary key,
  "HC"                    text not null references public."DB_Pacientes"("HC") on delete cascade,
  "Nombre_Medicamento"    text not null,
  "Dosis_Frecuencia"      text not null,
  "Fecha_Inicio"          date not null,
  "Fecha_Omision"         date,
  "Activo"                text not null default 'Sí' check ("Activo" in ('Sí', 'No')),
  "Dias_Tratamiento"      numeric
);

create table if not exists public."DB_Laboratorios" (
  "id"                    bigserial primary key,
  "HC"                    text not null references public."DB_Pacientes"("HC") on delete cascade,
  "Fecha"                 date not null,
  "Tipo_Lab"              text not null,
  "Valor_Numerico"        numeric,
  "Resultado_Texto"       text,
  "Enlace_PDF_Hospital"   text
);

create table if not exists public."DB_Consultas" (
  "id"                        bigserial primary key,
  "HC"                        text not null references public."DB_Pacientes"("HC") on delete cascade,
  "Departamento_Consultado"   text not null,
  "Fecha_Envio"               date not null,
  "Fecha_Respuesta"           date,
  "Respuesta_Departamento"    text
);

create table if not exists public."DB_Cultivos" (
  "id"                            bigserial primary key,
  "HC"                            text not null references public."DB_Pacientes"("HC") on delete cascade,
  "Tipo_Cultivo"                  text not null,
  "Fecha_Envio"                   date not null,
  "Fecha_Resultado"               date,
  "Resultado"                     text default 'Pendiente',
  "Observaciones_Microbiologia"   text
);

create table if not exists public."DB_Pendientes" (
  "id"                            bigserial primary key,
  "HC"                            text not null references public."DB_Pacientes"("HC") on delete cascade,
  "Descripcion_Tarea"             text not null,
  "Fecha_Programada"              date,
  "Justificacion_Observaciones"   text,
  "Estado"                        text not null default 'Pendiente' check ("Estado" in ('Pendiente', 'Realizado')),
  "Fecha_Completado"              timestamptz
);

-- Nota: en este punto las tablas NO tienen Row Level Security todavía — eso lo
-- activa 002_auth_rls_audit.sql (que también agrega Creado_Por/Modificado_Por/
-- Modificado_En y, en DB_Pacientes, Eliminado_En/Eliminado_Por). Sigue con
-- 001_search_and_indexes.sql y luego 002 y 003, en ese orden.
