import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { countTimelineUnread, readUiPreferences, writeUiPreferences, timelineReadKey } from '../src/utils/preferences.js';
import { renderRoundOverview } from '../src/views/roundView.js';
import { PatientRecord } from '../src/models/PatientRecord.js';
import { Patient } from '../src/models/Patient.js';

const root = path.resolve(process.cwd());
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('fase 3: preferencias de UI solo persisten configuración, no PHI', () => {
  const original = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v))
  };
  try {
    assert.deepEqual(readUiPreferences(), { density: 'normal', highContrast: false });
    writeUiPreferences({ density: 'compact', highContrast: true });
    assert.deepEqual(readUiPreferences(), { density: 'compact', highContrast: true });
    const key = timelineReadKey('user-1', 'HC-1');
    assert.match(key, /^ronda\.timeline\.read\.v1:[a-z0-9]+:[a-z0-9]+$/);
    assert.equal(key.includes('HC-1'), false);
  } finally {
    if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original;
  }
});

test('fase 3: novedades cuenta eventos posteriores a la última revisión', () => {
  const events = [
    { event_at: '2026-09-27T14:00:00-06:00' },
    { event_at: '2026-09-27T13:00:00-06:00' },
    { event_at: '2026-09-27T11:00:00-06:00' }
  ];
  assert.equal(countTimelineUnread(events, new Date('2026-09-27T12:30:00-06:00').getTime()), 2);
});

test('fase 3: ronda ordena por servicio/cama y expone indicadores de revisión', () => {
  const recentVital = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const html = renderRoundOverview([
    { hc: '2', nombre_completo: 'Beta', servicio: 'UCI', cama: '10', latest_vital_at: recentVital, active_medications: 1, open_tasks: 2, due_tasks: 2, pending_cultures: 0, unanswered_consultations: 0 },
    { hc: '1', nombre_completo: 'Alfa', servicio: 'UCI', cama: '2', latest_vital_at: recentVital, active_medications: 2, open_tasks: 0, due_tasks: 0, pending_cultures: 1, unanswered_consultations: 1 }
  ]);
  assert.ok(html.indexOf('Alfa') < html.indexOf('Beta'));
  assert.match(html, /Ronda de hoy/);
  assert.match(html, /4 puntos a revisar/);
});

test('fase 3: ronda alerta por signos atrasados, no por tareas futuras, e indica truncamiento', () => {
  const html = renderRoundOverview([
    { hc: '3', nombre_completo: 'Celia', servicio: 'UCI', cama: '1', open_tasks: 1, due_tasks: 0, total_active: 101 }
  ]);
  assert.match(html, /muestra 1 de 101 pacientes activos/);
  assert.match(html, /1 punto a revisar/);
  assert.match(html, /Signos &gt;24 h/);
  assert.doesNotMatch(html, /1 pendientes para hoy/);
  assert.doesNotMatch(html, /Al día/);
});

test('fase 3: PatientRecord conserva timeline sin alterar el historial paginado', () => {
  const record = new PatientRecord({ patient: new Patient({ HC: '1', Nombre_Completo: 'Ana' }), tasks: [] });
  const next = record.withTimeline([{ event_at: '2026-09-27T12:00:00-06:00', title: 'Pendiente' }]);
  assert.equal(record.timeline.length, 0);
  assert.equal(next.timeline.length, 1);
});

test('fase 3: timeline y producto están registrados en la UI/SQL/CI', () => {
  assert.match(read('src/utils/constants.js'), /timeline/);
  assert.match(read('src/views/sections/index.js'), /timelineSection/);
  assert.match(read('src/services/ApiService.js'), /getRoundOverview/);
  assert.match(read('src/services/ApiService.js'), /getPatientTimeline/);
  assert.match(read('src/controllers/DashboardController.js'), /open-command-palette/);
  assert.match(read('src/controllers/DashboardController.js'), /cycle-density/);
  assert.match(read('src/controllers/DashboardController.js'), /toggle-contrast/);
  assert.match(read('supabase/008_phase3_product.sql'), /ronda_hoy/);
  assert.match(read('supabase/008_phase3_product.sql'), /revoke all on function public\.ronda_hoy\(text, int\) from public, anon/i);
  assert.match(read('supabase/008_phase3_product.sql'), /America\/Guatemala/);
  assert.match(read('supabase/008_phase3_product.sql'), /timeline_paciente/);
  assert.match(read('.github/workflows/ci.yml'), /test:browser/);
});

test('fase 3: pgTAP cubre las nuevas RPC y los índices de actividad', () => {
  const sql = read('supabase/tests/database/phase3_test.sql');
  assert.match(sql, /select has_function\('public', 'ronda_hoy'/);
  assert.match(sql, /select has_function\('public', 'timeline_paciente'/);
  assert.match(sql, /idx_pacientes_ronda_servicio_cama/);
});

test('fase 3: la migración corrige ronda y registra impresiones', () => {
  const migration = read('supabase/012_round_print_audit.sql');
  assert.match(migration, /row_number\(\) over[\s\S]*count\(\*\) over/);
  assert.match(migration, /latest_activity_at/);
  assert.match(migration, /vitals_overdue/);
  assert.match(migration, /registrar_impresion_expediente/);
  assert.match(migration, /'PRINT'/);
});

test('build: usa codeSplitting de Rolldown y no la forma objeto obsoleta de manualChunks', () => {
  const config = read('vite.config.js');
  assert.match(config, /rolldownOptions/);
  assert.match(config, /codeSplitting/);
  assert.match(config, /name: 'supabase'/);
  assert.doesNotMatch(config, /manualChunks\s*:/);
  assert.doesNotMatch(config, /rollupOptions\s*:/);
});
