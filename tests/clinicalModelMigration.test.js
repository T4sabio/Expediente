import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260929000018_clinical_longitudinal_model.sql'),
  'utf8'
);
const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');

test('fase 2: el modelo canónico tiene identidad UUID y HC legacy separado', () => {
  assert.match(migration, /create table if not exists clinical\.patient \(\s*patient_id uuid primary key/s);
  assert.match(migration, /legacy_hc text not null/);
  assert.match(migration, /create table if not exists clinical\.patient_identifier/);
  assert.match(migration, /medical-record-number/);
});

test('fase 2: clinical no queda expuesto por PostgREST', () => {
  assert.doesNotMatch(config, /schemas\s*=.*clinical/);
  assert.match(migration, /revoke all on schema clinical from public, anon, authenticated/);
});

test('fase 2: datos clínicos se separan por entidad longitudinal', () => {
  for (const table of [
    'patient', 'encounter', 'condition', 'observation', 'medication_order',
    'consultation', 'task', 'specimen', 'microbiology_result'
  ]) {
    assert.match(migration, new RegExp(`create table if not exists clinical\\.${table}\\b`, 'i'), table);
  }
  assert.match(migration, /references clinical\.patient\(patient_id\)/i);
  assert.match(migration, /references clinical\.encounter\(encounter_id\)/i);
});

test('fase 2: no se inventan códigos terminológicos al migrar diagnósticos legacy', () => {
  assert.match(migration, /legacy-free-text/);
  assert.match(migration, /sin inventar códigos[\s\S]*clínicos que no existen en el origen/i);
  assert.match(migration, /display_text,\s*code_system,[\s\S]{0,300}'legacy-free-text'/i);
});

test('fase 2: la compatibilidad legacy mantiene el modelo canónico sincronizado', () => {
  for (const trigger of [
    'trg_sync_clinical_patient',
    'trg_sync_clinical_vitals',
    'trg_sync_clinical_lab',
    'trg_sync_clinical_medication',
    'trg_sync_clinical_consultation',
    'trg_sync_clinical_culture',
    'trg_sync_clinical_task'
  ]) {
    assert.match(migration, new RegExp(`create trigger ${trigger}`, 'i'), trigger);
  }
  assert.match(migration, /after insert or update or delete on public\."DB_SignosVitales"/i);
});
