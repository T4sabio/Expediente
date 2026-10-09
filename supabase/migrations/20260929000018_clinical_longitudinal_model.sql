-- ============================================================================
-- 018_clinical_longitudinal_model.sql
-- Fase 2: modelo clínico longitudinal y estructurado.
--
-- PRINCIPIOS:
--   * No elimina ni renombra las tablas legacy usadas por la UI actual.
--   * Introduce una identidad interna UUID para pacientes: HC deja de ser la PK
--     canónica y pasa a ser un identificador legacy único.
--   * Introduce Encounter y entidades clínicas separadas.
--   * Conserva trazabilidad con source_key/source_system.
--   * Migra los datos existentes de forma conservadora, sin inventar códigos
--     clínicos que no existen en el origen.
--   * Mantiene la capa clinical fuera de la API pública de PostgREST por ahora.
--   * Agrega triggers de compatibilidad que mantienen el modelo canónico
--     sincronizado mientras la UI siga escribiendo en las tablas legacy.
--
-- NO implementa todavía:
--   * terminologías externas (LOINC/SNOMED/ICD/ATC/UCUM),
--   * OMOP,
--   * FHIR,
--   * analytics/pseudonimización,
--   * multi-hospital completo,
--   * cambio de la UI a la capa canonical.
-- ============================================================================

create schema if not exists clinical;

revoke all on schema clinical from public, anon, authenticated;
alter default privileges in schema clinical
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema clinical
  revoke all on sequences from public, anon, authenticated;

-- Por defecto PostgreSQL concede EXECUTE sobre funciones nuevas a PUBLIC.
-- El schema clinical no debe acumular funciones accesibles por el cliente.
alter default privileges in schema private
  revoke execute on functions from public, anon, authenticated;
alter default privileges in schema clinical
  revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) Catálogo interno mínimo de conceptos.
-- ---------------------------------------------------------------------------
-- Este catálogo NO pretende sustituir LOINC/SNOMED/ICD. Solo da identidad
-- estable a conceptos que el propio sistema ya conoce y permite añadir
-- mappings externos en una fase posterior.
create table if not exists clinical.concept (
  concept_id uuid primary key default gen_random_uuid(),
  code text not null,
  system text not null default 'ronda-clinica',
  display text not null,
  category text not null,
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  unique (system, code),
  check (btrim(code) <> ''),
  check (btrim(display) <> '')
);

insert into clinical.concept (code, system, display, category)
values
  ('vital.pa_sistolica', 'ronda-clinica', 'Presión arterial sistólica', 'vital-sign'),
  ('vital.pa_diastolica', 'ronda-clinica', 'Presión arterial diastólica', 'vital-sign'),
  ('vital.frecuencia_cardiaca', 'ronda-clinica', 'Frecuencia cardíaca', 'vital-sign'),
  ('vital.spo2', 'ronda-clinica', 'Saturación periférica de oxígeno', 'vital-sign'),
  ('vital.temperatura', 'ronda-clinica', 'Temperatura corporal', 'vital-sign'),
  ('vital.frecuencia_respiratoria', 'ronda-clinica', 'Frecuencia respiratoria', 'vital-sign'),
  ('vital.oxigeno_suplementario', 'ronda-clinica', 'Oxígeno suplementario', 'vital-sign'),
  ('vital.pam', 'ronda-clinica', 'Presión arterial media', 'vital-sign')
on conflict (system, code) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Identidad canónica del paciente.
-- ---------------------------------------------------------------------------
create table if not exists clinical.patient (
  patient_id uuid primary key default gen_random_uuid(),
  legacy_hc text not null,
  full_name text not null,
  date_of_birth date,
  sex_code text,
  sex_display text,
  residence_country_code text,
  residence_department_code text,
  residence_municipality_code text,
  residence_locality_code text,
  urban_rural text,
  legacy_age_text text,
  deleted_at timestamptz,
  source_system text not null default 'ronda-clinica',
  source_key text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (legacy_hc),
  unique (source_key),
  check (btrim(legacy_hc) <> ''),
  check (btrim(full_name) <> ''),
  check (urban_rural is null or urban_rural in ('urban', 'rural', 'unknown'))
);

create index if not exists idx_clinical_patient_active
  on clinical.patient (legacy_hc)
  where deleted_at is null;

-- Los identificadores se separan de la identidad técnica para permitir en el
-- futuro múltiples identificadores por paciente (HC, identificador externo, etc.).
create table if not exists clinical.patient_identifier (
  patient_identifier_id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references clinical.patient(patient_id) on delete restrict,
  identifier_system text not null,
  identifier_type text not null,
  identifier_value text not null,
  identifier_use text not null default 'usual',
  source_system text not null default 'ronda-clinica',
  source_key text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (source_key),
  check (btrim(identifier_system) <> ''),
  check (btrim(identifier_type) <> ''),
  check (btrim(identifier_value) <> ''),
  check (identifier_use in ('usual', 'official', 'secondary', 'old'))
);

create unique index if not exists uq_clinical_patient_identifier_system_value
  on clinical.patient_identifier (identifier_system, identifier_value);

-- ---------------------------------------------------------------------------
-- 3) Episodios/encuentros.
-- ---------------------------------------------------------------------------
create table if not exists clinical.encounter (
  encounter_id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references clinical.patient(patient_id) on delete restrict,
  encounter_type text not null default 'inpatient',
  status text not null default 'active',
  admitted_at timestamptz,
  discharged_at timestamptz,
  admission_precision text not null default 'unknown',
  discharge_precision text not null default 'unknown',
  age_at_encounter_value numeric(8,2),
  age_at_encounter_unit text,
  reason_text text,
  service_text text,
  bed_text text,
  disposition_text text,
  source_system text not null default 'ronda-clinica',
  source_key text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (source_key),
  check (status in ('planned', 'active', 'finished', 'cancelled', 'unknown')),
  check (admission_precision in ('date', 'datetime', 'unknown')),
  check (discharge_precision in ('date', 'datetime', 'unknown')),
  check (age_at_encounter_unit is null or age_at_encounter_unit in ('years', 'months', 'weeks', 'days')),
  check (admitted_at is null or discharged_at is null or discharged_at >= admitted_at)
);

create index if not exists idx_clinical_encounter_patient_time
  on clinical.encounter (patient_id, admitted_at desc nulls last);

create index if not exists idx_clinical_encounter_active
  on clinical.encounter (patient_id, status)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 4) Diagnósticos/condiciones.
-- ---------------------------------------------------------------------------
create table if not exists clinical.condition (
  condition_id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references clinical.patient(patient_id) on delete restrict,
  encounter_id uuid references clinical.encounter(encounter_id) on delete restrict,
  code text,
  code_system text,
  display_text text not null,
  clinical_status text not null default 'active',
  verification_status text not null default 'unknown',
  onset_at timestamptz,
  recorded_at timestamptz not null default pg_catalog.now(),
  source_system text not null default 'ronda-clinica',
  source_key text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (source_key),
  check (btrim(display_text) <> ''),
  check (clinical_status in ('active', 'resolved', 'inactive', 'unknown')),
  check (verification_status in ('provisional', 'confirmed', 'refuted', 'entered-in-error', 'unknown'))
);

create index if not exists idx_clinical_condition_patient
  on clinical.condition (patient_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- 5) Observaciones: vitales y laboratorio.
-- ---------------------------------------------------------------------------
create table if not exists clinical.observation (
  observation_id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references clinical.patient(patient_id) on delete restrict,
  encounter_id uuid references clinical.encounter(encounter_id) on delete restrict,
  observed_at timestamptz not null,
  category text not null,
  code text,
  code_system text,
  display_text text not null,
  value_numeric numeric,
  value_text text,
  value_boolean boolean,
  unit_code text,
  reference_low numeric,
  reference_high numeric,
  abnormal_flag text,
  source_system text not null default 'ronda-clinica',
  source_key text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (source_key),
  check (category in ('vital-sign', 'laboratory', 'other')),
  check (btrim(display_text) <> ''),
  check (value_numeric is not null or value_text is not null or value_boolean is not null),
  check (abnormal_flag is null or abnormal_flag in ('low', 'high', 'normal', 'critical', 'unknown'))
);

create index if not exists idx_clinical_observation_patient_time
  on clinical.observation (patient_id, observed_at desc);

create index if not exists idx_clinical_observation_category_code
  on clinical.observation (category, code, observed_at desc);

-- ---------------------------------------------------------------------------
-- 6) Medicamentos: orden terapéutica, no solo texto de la pantalla.
-- ---------------------------------------------------------------------------
create table if not exists clinical.medication_order (
  medication_order_id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references clinical.patient(patient_id) on delete restrict,
  encounter_id uuid references clinical.encounter(encounter_id) on delete restrict,
  medication_display text not null,
  medication_code text,
  medication_code_system text,
  dose_frequency_text text not null,
  dose_value numeric,
  dose_unit text,
  route_text text,
  frequency_hours smallint,
  start_on date not null,
  stop_on date,
  status text not null default 'active',
  planned_duration_days integer,
  requires_followup_days boolean not null default false,
  suspension_reason text,
  source_system text not null default 'ronda-clinica',
  source_key text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (source_key),
  check (btrim(medication_display) <> ''),
  check (btrim(dose_frequency_text) <> ''),
  check (status in ('active', 'stopped', 'completed', 'cancelled', 'unknown')),
  check (stop_on is null or stop_on >= start_on),
  check (planned_duration_days is null or planned_duration_days > 0),
  check (frequency_hours is null or frequency_hours > 0)
);

create index if not exists idx_clinical_medication_patient_start
  on clinical.medication_order (patient_id, start_on desc);

create index if not exists idx_clinical_medication_active
  on clinical.medication_order (patient_id, status)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 7) Interconsultas.
-- ---------------------------------------------------------------------------
create table if not exists clinical.consultation (
  consultation_id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references clinical.patient(patient_id) on delete restrict,
  encounter_id uuid references clinical.encounter(encounter_id) on delete restrict,
  department_text text not null,
  sent_at timestamptz not null,
  response_at timestamptz,
  response_text text,
  status text not null default 'open',
  source_system text not null default 'ronda-clinica',
  source_key text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (source_key),
  check (btrim(department_text) <> ''),
  check (status in ('open', 'answered', 'cancelled', 'unknown')),
  check (response_at is null or response_at >= sent_at)
);

create index if not exists idx_clinical_consultation_patient_sent
  on clinical.consultation (patient_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- 8) Pendientes/tareas clínicas.
-- ---------------------------------------------------------------------------
create table if not exists clinical.task (
  task_id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references clinical.patient(patient_id) on delete restrict,
  encounter_id uuid references clinical.encounter(encounter_id) on delete restrict,
  description text not null,
  requested_on date not null,
  scheduled_on date,
  completed_at timestamptz,
  status text not null default 'pending',
  notes text,
  source_system text not null default 'ronda-clinica',
  source_key text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (source_key),
  check (btrim(description) <> ''),
  check (status in ('pending', 'completed', 'cancelled', 'unknown')),
  check (scheduled_on is null or scheduled_on >= requested_on)
);

create index if not exists idx_clinical_task_patient_schedule
  on clinical.task (patient_id, scheduled_on nulls last, requested_on desc);

create index if not exists idx_clinical_task_open
  on clinical.task (patient_id, status)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 9) Microbiología: separar specimen de resultado.
-- ---------------------------------------------------------------------------
create table if not exists clinical.specimen (
  specimen_id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references clinical.patient(patient_id) on delete restrict,
  encounter_id uuid references clinical.encounter(encounter_id) on delete restrict,
  type_display text not null,
  collected_at timestamptz,
  source_system text not null default 'ronda-clinica',
  source_key text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (source_key),
  check (btrim(type_display) <> '')
);

create table if not exists clinical.microbiology_result (
  microbiology_result_id uuid primary key default gen_random_uuid(),
  specimen_id uuid not null references clinical.specimen(specimen_id) on delete restrict,
  sent_at timestamptz not null,
  resulted_at timestamptz,
  result_text text,
  comments text,
  status text not null default 'pending',
  recurring boolean not null default false,
  interval_hours smallint,
  source_system text not null default 'ronda-clinica',
  source_key text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (source_key),
  check (status in ('pending', 'resulted', 'cancelled', 'unknown')),
  check (interval_hours is null or interval_hours > 0),
  check (resulted_at is null or resulted_at >= sent_at)
);

create index if not exists idx_clinical_microbiology_specimen_sent
  on clinical.microbiology_result (specimen_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- 10) RLS y privilegios: la nueva capa no queda disponible al cliente todavía.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'concept', 'patient', 'encounter', 'condition', 'observation',
    'medication_order', 'consultation', 'task', 'specimen', 'microbiology_result'
  ] loop
    execute format('alter table clinical.%I enable row level security', t);
    execute format('revoke all on clinical.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 11) Helpers de sincronización de compatibilidad legacy -> canonical.
-- ---------------------------------------------------------------------------
create or replace function private.f_parse_age_snapshot(p_age text)
returns table(age_value numeric, age_unit text)
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_age, '')));
  n numeric;
begin
  v := pg_catalog.replace(v, ',', '.');

  if v ~ '^[0-9]+(\.[0-9]+)?\s*años?$' then
    n := pg_catalog.regexp_replace(v, '[^0-9.]', '', 'g')::numeric;
    return query select n, 'years';
    return;
  elsif v ~ '^[0-9]+(\.[0-9]+)?\s*mes(es)?$' then
    n := pg_catalog.regexp_replace(v, '[^0-9.]', '', 'g')::numeric;
    return query select n, 'months';
    return;
  elsif v ~ '^[0-9]+(\.[0-9]+)?\s*semanas?$' then
    n := pg_catalog.regexp_replace(v, '[^0-9.]', '', 'g')::numeric;
    return query select n, 'weeks';
    return;
  elsif v ~ '^[0-9]+(\.[0-9]+)?\s*d[ií]as?$' then
    n := pg_catalog.regexp_replace(v, '[^0-9.]', '', 'g')::numeric;
    return query select n, 'days';
    return;
  end if;

  return query select null::numeric, null::text;
end;
$$;

revoke all on function private.f_parse_age_snapshot(text) from public, anon, authenticated;

create or replace function private.f_sync_clinical_patient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient_id uuid;
  v_encounter_id uuid;
  v_age numeric;
  v_age_unit text;
  v_status text;
  v_disposition text;
begin
  select age_value, age_unit
    into v_age, v_age_unit
  from private.f_parse_age_snapshot(new."Edad");

  insert into clinical.patient (
    legacy_hc,
    full_name,
    legacy_age_text,
    deleted_at,
    source_key,
    updated_at
  )
  values (
    pg_catalog.btrim(new."HC"),
    new."Nombre_Completo",
    new."Edad",
    new."Eliminado_En",
    'DB_Pacientes:' || pg_catalog.btrim(new."HC"),
    coalesce(new."Modificado_En", pg_catalog.now())
  )
  on conflict (legacy_hc) do update
  set full_name = excluded.full_name,
      legacy_age_text = excluded.legacy_age_text,
      deleted_at = excluded.deleted_at,
      updated_at = excluded.updated_at
  returning patient_id into v_patient_id;

  insert into clinical.patient_identifier (
    patient_id, identifier_system, identifier_type, identifier_value,
    identifier_use, source_key, updated_at
  )
  values (
    v_patient_id, 'legacy:ronda-clinica', 'medical-record-number',
    pg_catalog.btrim(new."HC"), 'usual',
    'DB_Pacientes:' || pg_catalog.btrim(new."HC") || ':identifier',
    coalesce(new."Modificado_En", pg_catalog.now())
  )
  on conflict (source_key) do update
  set patient_id = excluded.patient_id,
      identifier_value = excluded.identifier_value,
      updated_at = excluded.updated_at;

  v_status := case new."Estado_Episodio"
    when 'Hospitalizado' then 'active'
    when 'Alta' then 'finished'
    when 'Trasladado' then 'finished'
    when 'Defunción' then 'finished'
    else 'unknown'
  end;

  v_disposition := case new."Estado_Episodio"
    when 'Alta' then 'discharge'
    when 'Trasladado' then 'transfer'
    when 'Defunción' then 'death'
    else null
  end;

  insert into clinical.encounter (
    patient_id,
    encounter_type,
    status,
    admitted_at,
    discharged_at,
    admission_precision,
    discharge_precision,
    age_at_encounter_value,
    age_at_encounter_unit,
    reason_text,
    service_text,
    bed_text,
    disposition_text,
    source_key,
    updated_at
  )
  values (
    v_patient_id,
    'inpatient',
    v_status,
    case when new."Fecha_Ingreso" is null then null
         else (new."Fecha_Ingreso"::timestamp at time zone 'America/Guatemala') end,
    case when new."Fecha_Egreso" is null then null
         else (new."Fecha_Egreso"::timestamp at time zone 'America/Guatemala') end,
    case when new."Fecha_Ingreso" is null then 'unknown' else 'date' end,
    case when new."Fecha_Egreso" is null then 'unknown' else 'date' end,
    v_age,
    v_age_unit,
    new."Motivo_Consulta",
    new."Servicio",
    new."Cama",
    v_disposition,
    'DB_Pacientes:' || pg_catalog.btrim(new."HC"),
    coalesce(new."Modificado_En", pg_catalog.now())
  )
  on conflict (source_key) do update
  set status = excluded.status,
      admitted_at = excluded.admitted_at,
      discharged_at = excluded.discharged_at,
      admission_precision = excluded.admission_precision,
      discharge_precision = excluded.discharge_precision,
      age_at_encounter_value = excluded.age_at_encounter_value,
      age_at_encounter_unit = excluded.age_at_encounter_unit,
      reason_text = excluded.reason_text,
      service_text = excluded.service_text,
      bed_text = excluded.bed_text,
      disposition_text = excluded.disposition_text,
      patient_id = excluded.patient_id,
      updated_at = excluded.updated_at
  returning encounter_id into v_encounter_id;

  -- Diagnósticos legacy: se conservan como narrativa no codificada. No se
  -- inventa ICD/SNOMED a partir de texto libre.
  if nullif(pg_catalog.btrim(coalesce(new."Diagnosticos", '')), '') is null then
    delete from clinical.condition
    where source_key = 'DB_Pacientes:' || pg_catalog.btrim(new."HC") || ':diagnosticos';
  else
    insert into clinical.condition (
      patient_id,
      encounter_id,
      display_text,
      code_system,
      clinical_status,
      verification_status,
      recorded_at,
      source_key,
      updated_at
    )
    values (
      v_patient_id,
      v_encounter_id,
      pg_catalog.btrim(new."Diagnosticos"),
      'legacy-free-text',
      'active',
      'unknown',
      coalesce(new."Modificado_En", pg_catalog.now()),
      'DB_Pacientes:' || pg_catalog.btrim(new."HC") || ':diagnosticos',
      coalesce(new."Modificado_En", pg_catalog.now())
    )
    on conflict (source_key) do update
    set patient_id = excluded.patient_id,
        encounter_id = excluded.encounter_id,
        display_text = excluded.display_text,
        recorded_at = excluded.recorded_at,
        updated_at = excluded.updated_at;
  end if;

  return new;
end;
$$;

revoke all on function private.f_sync_clinical_patient() from public, anon, authenticated;

create or replace function private.f_clinical_patient_id(p_hc text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select patient_id
  from clinical.patient
  where legacy_hc = pg_catalog.btrim(p_hc)
  limit 1;
$$;

revoke all on function private.f_clinical_patient_id(text) from public, anon, authenticated;

create or replace function private.f_clinical_encounter_id(p_hc text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.encounter_id
  from clinical.encounter e
  join clinical.patient p on p.patient_id = e.patient_id
  where p.legacy_hc = pg_catalog.btrim(p_hc)
  order by (e.status = 'active') desc, e.admitted_at desc nulls last
  limit 1;
$$;

revoke all on function private.f_clinical_encounter_id(text) from public, anon, authenticated;

create or replace function private.f_upsert_clinical_observation(
  p_source_key text,
  p_patient_id uuid,
  p_encounter_id uuid,
  p_observed_at timestamptz,
  p_category text,
  p_code text,
  p_code_system text,
  p_display text,
  p_numeric numeric default null,
  p_text text default null,
  p_boolean boolean default null,
  p_unit text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_numeric is null and p_text is null and p_boolean is null then
    delete from clinical.observation where source_key = p_source_key;
    return;
  end if;

  insert into clinical.observation (
    patient_id, encounter_id, observed_at, category, code, code_system,
    display_text, value_numeric, value_text, value_boolean, unit_code,
    source_key, updated_at
  )
  values (
    p_patient_id, p_encounter_id, p_observed_at, p_category, p_code,
    p_code_system, p_display, p_numeric, p_text, p_boolean, p_unit,
    p_source_key, pg_catalog.now()
  )
  on conflict (source_key) do update
  set patient_id = excluded.patient_id,
      encounter_id = excluded.encounter_id,
      observed_at = excluded.observed_at,
      category = excluded.category,
      code = excluded.code,
      code_system = excluded.code_system,
      display_text = excluded.display_text,
      value_numeric = excluded.value_numeric,
      value_text = excluded.value_text,
      value_boolean = excluded.value_boolean,
      unit_code = excluded.unit_code,
      updated_at = excluded.updated_at;
end;
$$;

revoke all on function private.f_upsert_clinical_observation(text, uuid, uuid, timestamptz, text, text, text, text, numeric, text, boolean, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12) Sync de signos vitales.
-- ---------------------------------------------------------------------------
create or replace function private.f_sync_clinical_vitals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_id uuid;
  e_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from clinical.observation
    where source_key like 'DB_SignosVitales:' || old.id::text || ':%';
    return old;
  end if;

  p_id := private.f_clinical_patient_id(new."HC");
  e_id := private.f_clinical_encounter_id(new."HC");
  perform private.f_upsert_clinical_observation('DB_SignosVitales:' || new.id::text || ':PA_Sistolica', p_id, e_id, new."Fecha_Hora", 'vital-sign', 'vital.pa_sistolica', 'ronda-clinica', 'Presión arterial sistólica', new."PA_Sistolica"::numeric, null, null, 'mm[Hg]');
  perform private.f_upsert_clinical_observation('DB_SignosVitales:' || new.id::text || ':PA_Diastolica', p_id, e_id, new."Fecha_Hora", 'vital-sign', 'vital.pa_diastolica', 'ronda-clinica', 'Presión arterial diastólica', new."PA_Diastolica"::numeric, null, null, 'mm[Hg]');
  perform private.f_upsert_clinical_observation('DB_SignosVitales:' || new.id::text || ':Frecuencia_Cardiaca', p_id, e_id, new."Fecha_Hora", 'vital-sign', 'vital.frecuencia_cardiaca', 'ronda-clinica', 'Frecuencia cardíaca', new."Frecuencia_Cardiaca"::numeric, null, null, '/min');
  perform private.f_upsert_clinical_observation('DB_SignosVitales:' || new.id::text || ':SpO2', p_id, e_id, new."Fecha_Hora", 'vital-sign', 'vital.spo2', 'ronda-clinica', 'Saturación periférica de oxígeno', new."SpO2"::numeric, null, null, '%');
  perform private.f_upsert_clinical_observation('DB_SignosVitales:' || new.id::text || ':Temperatura', p_id, e_id, new."Fecha_Hora", 'vital-sign', 'vital.temperatura', 'ronda-clinica', 'Temperatura corporal', new."Temperatura"::numeric, null, null, 'Cel');
  perform private.f_upsert_clinical_observation('DB_SignosVitales:' || new.id::text || ':Frecuencia_Respiratoria', p_id, e_id, new."Fecha_Hora", 'vital-sign', 'vital.frecuencia_respiratoria', 'ronda-clinica', 'Frecuencia respiratoria', new."Frecuencia_Respiratoria"::numeric, null, null, '/min');
  perform private.f_upsert_clinical_observation('DB_SignosVitales:' || new.id::text || ':Oxigeno_Suplementario', p_id, e_id, new."Fecha_Hora", 'vital-sign', 'vital.oxigeno_suplementario', 'ronda-clinica', 'Oxígeno suplementario', null, null, new."Oxigeno_Suplementario", null);
  perform private.f_upsert_clinical_observation('DB_SignosVitales:' || new.id::text || ':PAM', p_id, e_id, new."Fecha_Hora", 'vital-sign', 'vital.pam', 'ronda-clinica', 'Presión arterial media', new."PAM"::numeric, null, null, 'mm[Hg]');

  return new;
end;
$$;

revoke all on function private.f_sync_clinical_vitals() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13) Sync de laboratorios.
-- ---------------------------------------------------------------------------
create or replace function private.f_sync_clinical_lab()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_id uuid;
  e_id uuid;
  observed_at timestamptz;
begin
  if tg_op = 'DELETE' then
    delete from clinical.observation where source_key = 'DB_Laboratorios:' || old.id::text || ':result';
    return old;
  end if;

  p_id := private.f_clinical_patient_id(new."HC");
  e_id := private.f_clinical_encounter_id(new."HC");
  observed_at := (new."Fecha"::timestamp at time zone 'America/Guatemala');

  perform private.f_upsert_clinical_observation(
    'DB_Laboratorios:' || new.id::text || ':result',
    p_id,
    e_id,
    observed_at,
    'laboratory',
    null,
    null,
    pg_catalog.btrim(new."Tipo_Lab"),
    new."Valor_Numerico",
    new."Resultado_Texto",
    null,
    null
  );

  return new;
end;
$$;

revoke all on function private.f_sync_clinical_lab() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14) Sync de medicamentos.
-- ---------------------------------------------------------------------------
create or replace function private.f_sync_clinical_medication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_id uuid;
  e_id uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    delete from clinical.medication_order where source_key = 'DB_Medicamentos:' || old.id::text;
    return old;
  end if;

  p_id := private.f_clinical_patient_id(new."HC");
  e_id := private.f_clinical_encounter_id(new."HC");
  v_status := case new."Activo"
    when 'Sí' then 'active'
    when 'No' then case when new."Fecha_Omision" is not null then 'stopped' else 'unknown' end
    else 'unknown'
  end;

  insert into clinical.medication_order (
    patient_id, encounter_id, medication_display, dose_frequency_text,
    frequency_hours, start_on, stop_on, status, planned_duration_days,
    requires_followup_days, suspension_reason, source_key, updated_at
  )
  values (
    p_id, e_id, pg_catalog.btrim(new."Nombre_Medicamento"), new."Dosis_Frecuencia",
    new."Frecuencia_Horas", new."Fecha_Inicio", new."Fecha_Omision", v_status,
    case when new."Dias_Tratamiento" is null then null else trunc(new."Dias_Tratamiento")::integer end,
    coalesce(new."Requiere_Seguimiento_Dias", false), new."Motivo_Suspension",
    'DB_Medicamentos:' || new.id::text, pg_catalog.now()
  )
  on conflict (source_key) do update
  set patient_id = excluded.patient_id,
      encounter_id = excluded.encounter_id,
      medication_display = excluded.medication_display,
      dose_frequency_text = excluded.dose_frequency_text,
      frequency_hours = excluded.frequency_hours,
      start_on = excluded.start_on,
      stop_on = excluded.stop_on,
      status = excluded.status,
      planned_duration_days = excluded.planned_duration_days,
      requires_followup_days = excluded.requires_followup_days,
      suspension_reason = excluded.suspension_reason,
      updated_at = excluded.updated_at;

  return new;
end;
$$;

revoke all on function private.f_sync_clinical_medication() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 15) Sync de interconsultas.
-- ---------------------------------------------------------------------------
create or replace function private.f_sync_clinical_consultation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_id uuid;
  e_id uuid;
  sent_at timestamptz;
  response_at timestamptz;
begin
  if tg_op = 'DELETE' then
    delete from clinical.consultation where source_key = 'DB_Consultas:' || old.id::text;
    return old;
  end if;

  p_id := private.f_clinical_patient_id(new."HC");
  e_id := private.f_clinical_encounter_id(new."HC");
  sent_at := (new."Fecha_Envio"::timestamp at time zone 'America/Guatemala');
  response_at := case when new."Fecha_Respuesta" is null then null else (new."Fecha_Respuesta"::timestamp at time zone 'America/Guatemala') end;

  insert into clinical.consultation (
    patient_id, encounter_id, department_text, sent_at, response_at,
    response_text, status, source_key, updated_at
  )
  values (
    p_id, e_id, pg_catalog.btrim(new."Departamento_Consultado"), sent_at,
    response_at, new."Respuesta_Departamento",
    case when response_at is null then 'open' else 'answered' end,
    'DB_Consultas:' || new.id::text, pg_catalog.now()
  )
  on conflict (source_key) do update
  set patient_id = excluded.patient_id,
      encounter_id = excluded.encounter_id,
      department_text = excluded.department_text,
      sent_at = excluded.sent_at,
      response_at = excluded.response_at,
      response_text = excluded.response_text,
      status = excluded.status,
      updated_at = excluded.updated_at;

  return new;
end;
$$;

revoke all on function private.f_sync_clinical_consultation() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 16) Sync de cultivos/specimen.
-- ---------------------------------------------------------------------------
create or replace function private.f_sync_clinical_culture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_id uuid;
  e_id uuid;
  v_specimen_id uuid;
  sent_at timestamptz;
  result_at timestamptz;
  source_key text;
begin
  if tg_op = 'DELETE' then
    delete from clinical.microbiology_result where source_key = 'DB_Cultivos:' || old.id::text;
    delete from clinical.specimen where source_key = 'DB_Cultivos:' || old.id::text;
    return old;
  end if;

  p_id := private.f_clinical_patient_id(new."HC");
  e_id := private.f_clinical_encounter_id(new."HC");
  sent_at := coalesce(new."Fecha_Envio_Hora", (new."Fecha_Envio"::timestamp at time zone 'America/Guatemala'));
  result_at := case when new."Fecha_Resultado" is null then null else (new."Fecha_Resultado"::timestamp at time zone 'America/Guatemala') end;
  source_key := 'DB_Cultivos:' || new.id::text;

  insert into clinical.specimen as s (
    patient_id, encounter_id, type_display, collected_at, source_key, updated_at
  )
  values (
    p_id, e_id, pg_catalog.btrim(new."Tipo_Cultivo"), sent_at, source_key, pg_catalog.now()
  )
  on conflict (source_key) do update
  set patient_id = excluded.patient_id,
      encounter_id = excluded.encounter_id,
      type_display = excluded.type_display,
      collected_at = excluded.collected_at,
      updated_at = excluded.updated_at
  returning s.specimen_id into v_specimen_id;

  insert into clinical.microbiology_result (
    specimen_id, sent_at, resulted_at, result_text, comments, status,
    recurring, interval_hours, source_key, updated_at
  )
  values (
    v_specimen_id, sent_at, result_at, new."Resultado", new."Observaciones_Microbiologia",
    case when new."Resultado" is null or new."Resultado" = 'Pendiente' then 'pending' else 'resulted' end,
    coalesce(new."Es_Periodico", false), new."Intervalo_Horas", source_key, pg_catalog.now()
  )
  on conflict (source_key) do update
  set specimen_id = excluded.specimen_id,
      sent_at = excluded.sent_at,
      resulted_at = excluded.resulted_at,
      result_text = excluded.result_text,
      comments = excluded.comments,
      status = excluded.status,
      recurring = excluded.recurring,
      interval_hours = excluded.interval_hours,
      updated_at = excluded.updated_at;

  return new;
end;
$$;

revoke all on function private.f_sync_clinical_culture() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 17) Sync de pendientes.
-- ---------------------------------------------------------------------------
create or replace function private.f_sync_clinical_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_id uuid;
  e_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from clinical.task where source_key = 'DB_Pendientes:' || old.id::text;
    return old;
  end if;

  p_id := private.f_clinical_patient_id(new."HC");
  e_id := private.f_clinical_encounter_id(new."HC");

  insert into clinical.task (
    patient_id, encounter_id, description, requested_on, scheduled_on,
    completed_at, status, notes, source_key, updated_at
  )
  values (
    p_id, e_id, pg_catalog.btrim(new."Descripcion_Tarea"), new."Fecha_Solicitud",
    new."Fecha_Programada", new."Fecha_Completado",
    case new."Estado" when 'Realizado' then 'completed' when 'Pendiente' then 'pending' else 'unknown' end,
    new."Justificacion_Observaciones",
    'DB_Pendientes:' || new.id::text,
    pg_catalog.now()
  )
  on conflict (source_key) do update
  set patient_id = excluded.patient_id,
      encounter_id = excluded.encounter_id,
      description = excluded.description,
      requested_on = excluded.requested_on,
      scheduled_on = excluded.scheduled_on,
      completed_at = excluded.completed_at,
      status = excluded.status,
      notes = excluded.notes,
      updated_at = excluded.updated_at;

  return new;
end;
$$;

revoke all on function private.f_sync_clinical_task() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 18) Backfill inicial.
-- ---------------------------------------------------------------------------
-- Se ejecuta explícitamente con SQL set-based/loops antes de instalar los
-- triggers de compatibilidad.
-- Backfill de pacientes/encuentros usando las mismas reglas de normalización.
do $$
declare
  r record;
begin
  for r in select * from public."DB_Pacientes" loop
    insert into clinical.patient (
      legacy_hc, full_name, legacy_age_text, deleted_at, source_key, updated_at
    )
    values (
      pg_catalog.btrim(r."HC"), r."Nombre_Completo", r."Edad", r."Eliminado_En",
      'DB_Pacientes:' || pg_catalog.btrim(r."HC"), coalesce(r."Modificado_En", pg_catalog.now())
    )
    on conflict (legacy_hc) do update
    set full_name = excluded.full_name,
        legacy_age_text = excluded.legacy_age_text,
        deleted_at = excluded.deleted_at,
        updated_at = excluded.updated_at;
  end loop;

  for r in select * from public."DB_Pacientes" loop
    insert into clinical.patient_identifier (
      patient_id, identifier_system, identifier_type, identifier_value,
      identifier_use, source_key
    )
    select p.patient_id, 'legacy:ronda-clinica', 'medical-record-number',
           pg_catalog.btrim(r."HC"), 'usual',
           'DB_Pacientes:' || pg_catalog.btrim(r."HC") || ':identifier'
    from clinical.patient p
    where p.legacy_hc = pg_catalog.btrim(r."HC")
    on conflict (source_key) do update
    set patient_id = excluded.patient_id,
        identifier_value = excluded.identifier_value,
        updated_at = pg_catalog.now();
  end loop;

  for r in select p.*, x."Edad", x."Servicio", x."Cama", x."Fecha_Ingreso", x."Fecha_Egreso",
                   x."Motivo_Consulta", x."Estado_Episodio", x."Diagnosticos", x."Modificado_En"
            from clinical.patient p
            join public."DB_Pacientes" x on x."HC" = p.legacy_hc
  loop
    insert into clinical.encounter (
      patient_id, encounter_type, status, admitted_at, discharged_at,
      admission_precision, discharge_precision, age_at_encounter_value,
      age_at_encounter_unit, reason_text, service_text, bed_text,
      disposition_text, source_key, updated_at
    )
    select p.patient_id, 'inpatient',
      case r."Estado_Episodio"
        when 'Hospitalizado' then 'active'
        when 'Alta' then 'finished'
        when 'Trasladado' then 'finished'
        when 'Defunción' then 'finished'
        else 'unknown'
      end,
      case when r."Fecha_Ingreso" is null then null else (r."Fecha_Ingreso"::timestamp at time zone 'America/Guatemala') end,
      case when r."Fecha_Egreso" is null then null else (r."Fecha_Egreso"::timestamp at time zone 'America/Guatemala') end,
      case when r."Fecha_Ingreso" is null then 'unknown' else 'date' end,
      case when r."Fecha_Egreso" is null then 'unknown' else 'date' end,
      a.age_value, a.age_unit,
      r."Motivo_Consulta", r."Servicio", r."Cama",
      case r."Estado_Episodio" when 'Alta' then 'discharge' when 'Trasladado' then 'transfer' when 'Defunción' then 'death' else null end,
      'DB_Pacientes:' || r.legacy_hc,
      coalesce(r."Modificado_En", pg_catalog.now())
    from clinical.patient p,
         private.f_parse_age_snapshot(r."Edad") a
    where p.patient_id = r.patient_id
    on conflict (source_key) do update
    set status = excluded.status,
        admitted_at = excluded.admitted_at,
        discharged_at = excluded.discharged_at,
        admission_precision = excluded.admission_precision,
        discharge_precision = excluded.discharge_precision,
        age_at_encounter_value = excluded.age_at_encounter_value,
        age_at_encounter_unit = excluded.age_at_encounter_unit,
        reason_text = excluded.reason_text,
        service_text = excluded.service_text,
        bed_text = excluded.bed_text,
        disposition_text = excluded.disposition_text,
        patient_id = excluded.patient_id,
        updated_at = excluded.updated_at;

    if nullif(pg_catalog.btrim(coalesce(r."Diagnosticos", '')), '') is not null then
      insert into clinical.condition (
        patient_id, encounter_id, display_text, code_system,
        clinical_status, verification_status, recorded_at, source_key, updated_at
      )
      select p.patient_id, e.encounter_id, pg_catalog.btrim(r."Diagnosticos"),
             'legacy-free-text', 'active', 'unknown',
             coalesce(r."Modificado_En", pg_catalog.now()),
             'DB_Pacientes:' || r.legacy_hc || ':diagnosticos',
             coalesce(r."Modificado_En", pg_catalog.now())
      from clinical.patient p
      join clinical.encounter e on e.source_key = 'DB_Pacientes:' || r.legacy_hc
      where p.patient_id = r.patient_id
      on conflict (source_key) do update
      set display_text = excluded.display_text,
          encounter_id = excluded.encounter_id,
          recorded_at = excluded.recorded_at,
          updated_at = excluded.updated_at;
    end if;
  end loop;
end $$;

-- Backfill de las entidades secundarias mediante funciones auxiliares que no
-- requieren simular un trigger.
do $$
declare
  r record;
  p_id uuid;
  e_id uuid;
  v_specimen_id uuid;
begin
  for r in select * from public."DB_SignosVitales" loop
    p_id := private.f_clinical_patient_id(r."HC");
    e_id := private.f_clinical_encounter_id(r."HC");
    perform private.f_upsert_clinical_observation('DB_SignosVitales:' || r.id::text || ':PA_Sistolica', p_id, e_id, r."Fecha_Hora", 'vital-sign', 'vital.pa_sistolica', 'ronda-clinica', 'Presión arterial sistólica', r."PA_Sistolica"::numeric, null, null, 'mm[Hg]');
    perform private.f_upsert_clinical_observation('DB_SignosVitales:' || r.id::text || ':PA_Diastolica', p_id, e_id, r."Fecha_Hora", 'vital-sign', 'vital.pa_diastolica', 'ronda-clinica', 'Presión arterial diastólica', r."PA_Diastolica"::numeric, null, null, 'mm[Hg]');
    perform private.f_upsert_clinical_observation('DB_SignosVitales:' || r.id::text || ':Frecuencia_Cardiaca', p_id, e_id, r."Fecha_Hora", 'vital-sign', 'vital.frecuencia_cardiaca', 'ronda-clinica', 'Frecuencia cardíaca', r."Frecuencia_Cardiaca"::numeric, null, null, '/min');
    perform private.f_upsert_clinical_observation('DB_SignosVitales:' || r.id::text || ':SpO2', p_id, e_id, r."Fecha_Hora", 'vital-sign', 'vital.spo2', 'ronda-clinica', 'Saturación periférica de oxígeno', r."SpO2"::numeric, null, null, '%');
    perform private.f_upsert_clinical_observation('DB_SignosVitales:' || r.id::text || ':Temperatura', p_id, e_id, r."Fecha_Hora", 'vital-sign', 'vital.temperatura', 'ronda-clinica', 'Temperatura corporal', r."Temperatura"::numeric, null, null, 'Cel');
    perform private.f_upsert_clinical_observation('DB_SignosVitales:' || r.id::text || ':Frecuencia_Respiratoria', p_id, e_id, r."Fecha_Hora", 'vital-sign', 'vital.frecuencia_respiratoria', 'ronda-clinica', 'Frecuencia respiratoria', r."Frecuencia_Respiratoria"::numeric, null, null, '/min');
    perform private.f_upsert_clinical_observation('DB_SignosVitales:' || r.id::text || ':Oxigeno_Suplementario', p_id, e_id, r."Fecha_Hora", 'vital-sign', 'vital.oxigeno_suplementario', 'ronda-clinica', 'Oxígeno suplementario', null, null, r."Oxigeno_Suplementario", null);
    perform private.f_upsert_clinical_observation('DB_SignosVitales:' || r.id::text || ':PAM', p_id, e_id, r."Fecha_Hora", 'vital-sign', 'vital.pam', 'ronda-clinica', 'Presión arterial media', r."PAM"::numeric, null, null, 'mm[Hg]');
  end loop;

  for r in select * from public."DB_Laboratorios" loop
    p_id := private.f_clinical_patient_id(r."HC");
    e_id := private.f_clinical_encounter_id(r."HC");
    perform private.f_upsert_clinical_observation(
      'DB_Laboratorios:' || r.id::text || ':result', p_id, e_id,
      (r."Fecha"::timestamp at time zone 'America/Guatemala'),
      'laboratory', null, null, pg_catalog.btrim(r."Tipo_Lab"),
      r."Valor_Numerico", r."Resultado_Texto", null, null
    );
  end loop;

  for r in select * from public."DB_Medicamentos" loop
    p_id := private.f_clinical_patient_id(r."HC");
    e_id := private.f_clinical_encounter_id(r."HC");
    insert into clinical.medication_order (
      patient_id, encounter_id, medication_display, dose_frequency_text,
      frequency_hours, start_on, stop_on, status, planned_duration_days,
      requires_followup_days, suspension_reason, source_key, updated_at
    )
    values (
      p_id, e_id, pg_catalog.btrim(r."Nombre_Medicamento"), r."Dosis_Frecuencia",
      r."Frecuencia_Horas", r."Fecha_Inicio", r."Fecha_Omision",
      case r."Activo" when 'Sí' then 'active' when 'No' then 'stopped' else 'unknown' end,
      case when r."Dias_Tratamiento" is null then null else trunc(r."Dias_Tratamiento")::integer end,
      coalesce(r."Requiere_Seguimiento_Dias", false), r."Motivo_Suspension",
      'DB_Medicamentos:' || r.id::text, pg_catalog.now()
    )
    on conflict (source_key) do update
    set patient_id = excluded.patient_id,
        encounter_id = excluded.encounter_id,
        medication_display = excluded.medication_display,
        dose_frequency_text = excluded.dose_frequency_text,
        frequency_hours = excluded.frequency_hours,
        start_on = excluded.start_on,
        stop_on = excluded.stop_on,
        status = excluded.status,
        planned_duration_days = excluded.planned_duration_days,
        requires_followup_days = excluded.requires_followup_days,
        suspension_reason = excluded.suspension_reason,
        updated_at = excluded.updated_at;
  end loop;

  for r in select * from public."DB_Consultas" loop
    p_id := private.f_clinical_patient_id(r."HC");
    e_id := private.f_clinical_encounter_id(r."HC");
    insert into clinical.consultation (
      patient_id, encounter_id, department_text, sent_at, response_at,
      response_text, status, source_key, updated_at
    )
    values (
      p_id, e_id, pg_catalog.btrim(r."Departamento_Consultado"),
      (r."Fecha_Envio"::timestamp at time zone 'America/Guatemala'),
      case when r."Fecha_Respuesta" is null then null else (r."Fecha_Respuesta"::timestamp at time zone 'America/Guatemala') end,
      r."Respuesta_Departamento",
      case when r."Fecha_Respuesta" is null then 'open' else 'answered' end,
      'DB_Consultas:' || r.id::text, pg_catalog.now()
    )
    on conflict (source_key) do update
    set patient_id = excluded.patient_id,
        encounter_id = excluded.encounter_id,
        department_text = excluded.department_text,
        sent_at = excluded.sent_at,
        response_at = excluded.response_at,
        response_text = excluded.response_text,
        status = excluded.status,
        updated_at = excluded.updated_at;
  end loop;

  for r in select * from public."DB_Cultivos" loop
    p_id := private.f_clinical_patient_id(r."HC");
    e_id := private.f_clinical_encounter_id(r."HC");
    insert into clinical.specimen (
      patient_id, encounter_id, type_display, collected_at, source_key, updated_at
    )
    values (
      p_id, e_id, pg_catalog.btrim(r."Tipo_Cultivo"),
      coalesce(r."Fecha_Envio_Hora", (r."Fecha_Envio"::timestamp at time zone 'America/Guatemala')),
      'DB_Cultivos:' || r.id::text, pg_catalog.now()
    )
    on conflict (source_key) do update
    set patient_id = excluded.patient_id,
        encounter_id = excluded.encounter_id,
        type_display = excluded.type_display,
        collected_at = excluded.collected_at,
        updated_at = excluded.updated_at;

    select s.specimen_id into v_specimen_id from clinical.specimen s where s.source_key = 'DB_Cultivos:' || r.id::text;
    insert into clinical.microbiology_result (
      specimen_id, sent_at, resulted_at, result_text, comments, status,
      recurring, interval_hours, source_key, updated_at
    )
    values (
      v_specimen_id,
      coalesce(r."Fecha_Envio_Hora", (r."Fecha_Envio"::timestamp at time zone 'America/Guatemala')),
      case when r."Fecha_Resultado" is null then null else (r."Fecha_Resultado"::timestamp at time zone 'America/Guatemala') end,
      r."Resultado", r."Observaciones_Microbiologia",
      case when r."Resultado" is null or r."Resultado" = 'Pendiente' then 'pending' else 'resulted' end,
      coalesce(r."Es_Periodico", false), r."Intervalo_Horas",
      'DB_Cultivos:' || r.id::text, pg_catalog.now()
    )
    on conflict (source_key) do update
    set specimen_id = excluded.specimen_id,
        sent_at = excluded.sent_at,
        resulted_at = excluded.resulted_at,
        result_text = excluded.result_text,
        comments = excluded.comments,
        status = excluded.status,
        recurring = excluded.recurring,
        interval_hours = excluded.interval_hours,
        updated_at = excluded.updated_at;
  end loop;

  for r in select * from public."DB_Pendientes" loop
    p_id := private.f_clinical_patient_id(r."HC");
    e_id := private.f_clinical_encounter_id(r."HC");
    insert into clinical.task (
      patient_id, encounter_id, description, requested_on, scheduled_on,
      completed_at, status, notes, source_key, updated_at
    )
    values (
      p_id, e_id, pg_catalog.btrim(r."Descripcion_Tarea"), r."Fecha_Solicitud",
      r."Fecha_Programada", r."Fecha_Completado",
      case r."Estado" when 'Realizado' then 'completed' when 'Pendiente' then 'pending' else 'unknown' end,
      r."Justificacion_Observaciones", 'DB_Pendientes:' || r.id::text, pg_catalog.now()
    )
    on conflict (source_key) do update
    set patient_id = excluded.patient_id,
        encounter_id = excluded.encounter_id,
        description = excluded.description,
        requested_on = excluded.requested_on,
        scheduled_on = excluded.scheduled_on,
        completed_at = excluded.completed_at,
        status = excluded.status,
        notes = excluded.notes,
        updated_at = excluded.updated_at;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 19) Triggers de sincronización futura.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_sync_clinical_patient on public."DB_Pacientes";
create trigger trg_sync_clinical_patient
  after insert or update on public."DB_Pacientes"
  for each row execute function private.f_sync_clinical_patient();

drop trigger if exists trg_sync_clinical_vitals on public."DB_SignosVitales";
create trigger trg_sync_clinical_vitals
  after insert or update or delete on public."DB_SignosVitales"
  for each row execute function private.f_sync_clinical_vitals();

drop trigger if exists trg_sync_clinical_lab on public."DB_Laboratorios";
create trigger trg_sync_clinical_lab
  after insert or update or delete on public."DB_Laboratorios"
  for each row execute function private.f_sync_clinical_lab();

drop trigger if exists trg_sync_clinical_medication on public."DB_Medicamentos";
create trigger trg_sync_clinical_medication
  after insert or update or delete on public."DB_Medicamentos"
  for each row execute function private.f_sync_clinical_medication();

drop trigger if exists trg_sync_clinical_consultation on public."DB_Consultas";
create trigger trg_sync_clinical_consultation
  after insert or update or delete on public."DB_Consultas"
  for each row execute function private.f_sync_clinical_consultation();

drop trigger if exists trg_sync_clinical_culture on public."DB_Cultivos";
create trigger trg_sync_clinical_culture
  after insert or update or delete on public."DB_Cultivos"
  for each row execute function private.f_sync_clinical_culture();

drop trigger if exists trg_sync_clinical_task on public."DB_Pendientes";
create trigger trg_sync_clinical_task
  after insert or update or delete on public."DB_Pendientes"
  for each row execute function private.f_sync_clinical_task();

-- Los nuevos helpers son únicamente para triggers/backfill.
revoke all on function private.f_sync_clinical_patient() from public, anon, authenticated;
revoke all on function private.f_sync_clinical_vitals() from public, anon, authenticated;
revoke all on function private.f_sync_clinical_lab() from public, anon, authenticated;
revoke all on function private.f_sync_clinical_medication() from public, anon, authenticated;
revoke all on function private.f_sync_clinical_consultation() from public, anon, authenticated;
revoke all on function private.f_sync_clinical_culture() from public, anon, authenticated;
revoke all on function private.f_sync_clinical_task() from public, anon, authenticated;

comment on schema clinical is 'Modelo clínico canónico longitudinal. No expuesto a PostgREST en la fase 2.';
comment on table clinical.patient is 'Identidad canónica del paciente. legacy_hc es identificador histórico, no PK.';
comment on table clinical.patient_identifier is 'Identificadores del paciente separados de la identidad técnica; HC se conserva como identificador legacy.';
comment on table clinical.encounter is 'Episodio/encuentro clínico longitudinal. La migración legacy crea un encounter inicial por HC.';
comment on table clinical.condition is 'Condiciones/diagnósticos. El texto legacy se conserva sin inventar terminología externa.';
comment on table clinical.observation is 'Observaciones clínicas y resultados de laboratorio normalizados estructuralmente.';
comment on table clinical.medication_order is 'Orden/estado terapéutico de medicamentos. No representa administración real.';
comment on table clinical.specimen is 'Muestra biológica; la identificación de microorganismos y susceptibilidades vendrá en una fase posterior.';
