import test from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../src/state/AppState.js';
import { ApiService } from '../src/services/ApiService.js';
import { sectionViewFor } from '../src/views/sections/index.js';
import { PatientRecord } from '../src/models/PatientRecord.js';
import { Patient } from '../src/models/Patient.js';
import { Medication } from '../src/models/Medication.js';
import { Culture, LabResult, PendingTask } from '../src/models/ClinicalRecords.js';
import { VitalSigns } from '../src/models/VitalSigns.js';
import { laboratoriosSection } from '../src/views/sections/laboratorios.js';
import { DashboardView } from '../src/views/DashboardView.js';

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

test('DashboardView alterna entre ronda general y expediente seleccionado', () => {
  const createElement = initialHidden => {
    const classes = new Set(initialHidden ? ['hidden'] : []);
    return { classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      contains: value => classes.has(value)
    } };
  };
  const elements = {
    roundContainer: createElement(false),
    emptyState: createElement(false),
    patientView: createElement(true)
  };
  const view = new DashboardView({ getElementById: id => elements[id] ?? null });
  view.showPatientView();
  assert.equal(elements.roundContainer.classList.contains('hidden'), true);
  assert.equal(elements.emptyState.classList.contains('hidden'), true);
  assert.equal(elements.patientView.classList.contains('hidden'), false);
  view.showEmptyState();
  assert.equal(elements.roundContainer.classList.contains('hidden'), false);
  assert.equal(elements.emptyState.classList.contains('hidden'), false);
  assert.equal(elements.patientView.classList.contains('hidden'), true);
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

test('resumen: incluye antibióticos antiguos y periodicidad aunque el cultivo tenga resultado', () => {
  const trackedMedications = Array.from({ length: 7 }, (_, index) => new Medication({
    id: index + 1, Activo: 'Sí', Requiere_Seguimiento_Dias: true,
    Fecha_Inicio: `2026-09-${String(1 + index).padStart(2, '0')}`,
    Nombre_Medicamento: `Antibiótico ${index + 1}`, Dosis_Frecuencia: 'cada 8 horas'
  }));
  const record = new PatientRecord({
    patient: new Patient({ HC: '1', Nombre_Completo: 'Ana' }),
    summary: {
      counts: { activeMedications: 7, pendingCultures: 0 },
      activeMedications: trackedMedications.slice(-5), trackedMedications,
      periodicCultures: [new Culture({
        id: 30, Tipo_Cultivo: 'Hemocultivo', Fecha_Envio: '2026-09-23',
        Fecha_Envio_Hora: '2026-09-23T08:00:00-06:00', Es_Periodico: true,
        Intervalo_Horas: 24, Resultado: 'Negativo'
      })]
    }
  });
  const html = sectionViewFor('resumen').render(record, ctx);
  assert.match(html, /Antibiótico 1/);
  assert.match(html, /Hemocultivo/);
});

test('pendientes: conserva atrasos de la RPC aunque no estén en la página visible', () => {
  const hiddenOverdue = new PendingTask({
    id: 99, HC: '1', Estado: 'Pendiente', Fecha_Programada: '2026-09-01',
    Descripcion_Tarea: 'Pendiente antiguo fuera de página'
  });
  const record = new PatientRecord({
    patient: new Patient({ HC: '1', Nombre_Completo: 'Ana' }),
    tasks: [new PendingTask({ id: 1, HC: '1', Estado: 'Pendiente', Fecha_Programada: '2026-09-24', Descripcion_Tarea: 'Para hoy' })],
    summary: { counts: { overdueTasks: 1 }, overdueTasks: [hiddenOverdue] }
  });
  const html = sectionViewFor('pendientes').render(record, ctx);
  assert.match(html, /Pendiente antiguo fuera de página/);
  assert.match(html, /Atrasados \(1\)/);
});

test('cultivos: muestra la hora local registrada para el envío periódico', () => {
  const record = new PatientRecord({
    patient: new Patient({ HC: '1', Nombre_Completo: 'Ana' }),
    cultures: [new Culture({
      id: 4, HC: '1', Tipo_Cultivo: 'Hemocultivo', Fecha_Envio: '2026-09-24',
      Fecha_Envio_Hora: '2026-09-24T14:30:00-06:00', Resultado: 'Pendiente'
    })]
  });
  assert.match(sectionViewFor('cultivos').render(record, ctx), /2:30/);
});

test('ApiService cae a búsqueda ILIKE si falta la función SQL', async () => {
  const builder = { select() { return this; }, order() { return this; }, limit() { return this; }, eq() { return this; }, is() { return this; },
    or(expr) { this.expr = expr; return this; }, then(res) { res({ data: [{ HC: '1', Nombre_Completo: 'Ana' }], error: null }); } };
  const client = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'nf' } }), from: () => builder };
  const res = await new ApiService(client).searchPatients({ query: 'ana perez' });
  assert.equal(res[0].Nombre_Completo, 'Ana');
  assert.match(builder.expr, /Nombre_Completo\.ilike\.%ana%perez%/);
});
