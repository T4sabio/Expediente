import test from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../src/state/AppState.js';
import { ApiService } from '../src/services/ApiService.js';
import { sectionViewFor } from '../src/views/sections/index.js';
import { PatientRecord } from '../src/models/PatientRecord.js';
import { Patient } from '../src/models/Patient.js';
import { Medication } from '../src/models/Medication.js';
import { LabResult, PendingTask } from '../src/models/ClinicalRecords.js';
import { VitalSigns } from '../src/models/VitalSigns.js';
import { laboratoriosSection } from '../src/views/sections/laboratorios.js';

const ctx = { today: '2026-09-24', charts: { render() {} } };

test('las secciones escapan HTML proveniente de la BD (XSS)', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const record = new PatientRecord({
    patient: new Patient({ HC: '1', Nombre_Completo: 'Ana' }),
    medications: [new Medication({ id: 1, Nombre_Medicamento: evil, Dosis_Frecuencia: evil, Fecha_Inicio: '2026-09-01', Activo: 'Sí' })],
    tasks: [new PendingTask({ id: 2, Descripcion_Tarea: evil, Estado: 'Pendiente' })],
    labs: [new LabResult({ Fecha: '2026-09-01', Tipo_Lab: evil, Enlace_PDF_Hospital: 'javascript:alert(1)' })],
    vitals: [new VitalSigns({ Fecha_Hora: '2026-09-24T20:00:00Z', PA_Sistolica: 120, PA_Diastolica: 80, Frecuencia_Cardiaca: 70, SpO2: 98, Temperatura: 36.5, Frecuencia_Respiratoria: 16 })]
  });
  for (const id of ['resumen', 'vitales', 'medicamentos', 'laboratorios', 'pendientes', 'cultivos', 'consultas']) {
    const html = sectionViewFor(id).render(record, ctx);
    assert.ok(!html.includes('<img'), `sección ${id} sin escapar`);
    assert.ok(!html.includes('javascript:'), `sección ${id} permite javascript:`);
  }
});

test('AppState notifica solo cuando algo cambia', () => {
  const s = new AppState({ a: 1 });
  let calls = 0;
  s.subscribe(() => calls++);
  s.set({ a: 1 });
  s.set({ a: 2 });
  assert.equal(calls, 1);
  assert.equal(s.get().a, 2);
});

test('laboratorios: tabla reciente primero y gráfico usa historial completo cronológico', () => {
  const rendered = [];
  const charts = { render: (...args) => rendered.push(args) };
  const recent = new LabResult({ Fecha: '2026-09-24', Tipo_Lab: 'Creatinina', Valor_Numerico: 2 });
  const older = new LabResult({ Fecha: '2026-09-01', Tipo_Lab: 'Creatinina', Valor_Numerico: 1 });
  const record = new PatientRecord({
    patient: new Patient({ HC: '1', Nombre_Completo: 'Ana' }),
    labs: [recent], labHistory: [recent, older]
  });
  const html = laboratoriosSection.render(record, {});
  laboratoriosSection.mount({ querySelector: () => ({ addEventListener() {} }) }, record, { charts });
  assert.ok(html.indexOf('24/09/2026') < html.indexOf('01/09/2026') || !html.includes('01/09/2026'));
  assert.deepEqual(rendered[0][1], ['01/09/2026', '24/09/2026']);
  assert.deepEqual(rendered[0][2][0].data, [1, 2]);
});

test('ApiService cae a búsqueda ILIKE si falta la función SQL', async () => {
  const builder = { select() { return this; }, order() { return this; }, limit() { return this; }, eq() { return this; }, is() { return this; },
    or(expr) { this.expr = expr; return this; }, then(res) { res({ data: [{ HC: '1', Nombre_Completo: 'Ana' }], error: null }); } };
  const client = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'nf' } }), from: () => builder };
  const res = await new ApiService(client).searchPatients({ query: 'ana perez' });
  assert.equal(res[0].Nombre_Completo, 'Ana');
  assert.match(builder.expr, /Nombre_Completo\.ilike\.%ana%perez%/);
});
