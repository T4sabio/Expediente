begin;
select plan(19);

select has_schema('clinical', 'schema clínico canónico existe');
select has_table('clinical', 'patient', 'paciente canónico existe');
select has_table('clinical', 'patient_identifier', 'identificadores del paciente separados existen');
select has_table('clinical', 'encounter', 'encuentro clínico existe');
select has_table('clinical', 'condition', 'condiciones clínicas existen');
select has_table('clinical', 'observation', 'observaciones clínicas existen');
select has_table('clinical', 'medication_order', 'órdenes de medicamentos existen');
select has_table('clinical', 'consultation', 'interconsultas canónicas existen');
select has_table('clinical', 'specimen', 'muestras clínicas existen');
select has_table('clinical', 'microbiology_result', 'resultados microbiológicos existen');

select ok(
  not has_schema_privilege('anon', 'clinical', 'USAGE'),
  'anon no tiene acceso al schema clinical'
);
select ok(
  not has_schema_privilege('authenticated', 'clinical', 'USAGE'),
  'authenticated no tiene acceso directo al schema clinical'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'clinical.patient'::regclass),
  'RLS habilitado en patient canónico'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'clinical.observation'::regclass),
  'RLS habilitado en observation canónico'
);

-- Los datos synthetic del seed deben haber sido migrados sin inventar una FDN.
select is(
  (select count(*)::integer from clinical.patient where legacy_hc in ('DEV-001', 'DEV-002')),
  2,
  'los pacientes synthetic del seed fueron migrados'
);
select is(
  (select legacy_age_text from clinical.patient where legacy_hc = 'DEV-001'),
  '40 años',
  'se conserva la edad legacy para trazabilidad'
);
select is(
  (select age_at_encounter_value from clinical.encounter e join clinical.patient p on p.patient_id = e.patient_id where p.legacy_hc = 'DEV-001'),
  40::numeric,
  'la edad del encuentro se estructura sin inferir fecha de nacimiento'
);
select is(
  (select count(*)::integer from clinical.observation o join clinical.patient p on p.patient_id = o.patient_id where p.legacy_hc = 'DEV-001' and o.category = 'vital-sign'),
  14,
  'dos tomas de signos producen siete observaciones por toma'
);

select * from finish();
rollback;
