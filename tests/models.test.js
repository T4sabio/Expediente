import test from 'node:test';
import assert from 'node:assert/strict';
import { VitalSigns } from '../src/models/VitalSigns.js';
import { Medication } from '../src/models/Medication.js';
import { Patient } from '../src/models/Patient.js';
import { LabResult, PendingTask } from '../src/models/ClinicalRecords.js';
import { PatientRecord } from '../src/models/PatientRecord.js';
import { ValidationError } from '../src/utils/errors.js';

const vitalForm = (over = {}) => ({
  Fecha_Hora: '2026-09-24T14:30', PA_Sistolica: '120', PA_Diastolica: '80',
  Frecuencia_Cardiaca: '72', SpO2: '98', Temperatura: '36.8', Frecuencia_Respiratoria: '16', ...over
});

test('VitalSigns: detecta valores anormales', () => {
  const v = VitalSigns.fromForm(vitalForm({ SpO2: '90', Temperatura: '38.5' }), '2026-1');
  assert.equal(v.isAbnormal('SpO2'), true);
  assert.equal(v.isAbnormal('Temperatura'), true);
  assert.equal(v.isAbnormal('Frecuencia_Cardiaca'), false);
});

test('VitalSigns: ajusta FC infantil, SpO2 en EPOC y umbral de PAM', () => {
  const infant = new Patient({ Edad: '6 meses' });
  const context = { age: infant.age(), diagnoses: '' };
  assert.equal(VitalSigns.isValueAbnormal('Frecuencia_Cardiaca', 130, context), false);
  const newborn = new Patient({ Edad: '4 semanas' });
  assert.equal(VitalSigns.isValueAbnormal('Frecuencia_Cardiaca', 150, { age: newborn.age() }), false);
  assert.equal(VitalSigns.isValueAbnormal('Frecuencia_Cardiaca', 130), true);
  assert.equal(VitalSigns.isValueAbnormal('SpO2', 90, { diagnoses: 'EPOC' }), false);
  assert.equal(VitalSigns.isValueAbnormal('SpO2', 90), true);
  assert.equal(VitalSigns.isValueAbnormal('PAM', 67), false);
  assert.equal(VitalSigns.isValueAbnormal('PAM', 64), true);
});

test('VitalSigns: convierte la fecha a offset explícito y números', () => {
  const row = VitalSigns.fromForm(vitalForm(), '2026-1').toRow();
  assert.equal(row.Fecha_Hora, '2026-09-24T14:30:00-06:00');
  assert.equal(row.PA_Sistolica, 120);
});

test('VitalSigns: rechaza valores imposibles', () => {
  assert.throws(() => VitalSigns.fromForm(vitalForm({ SpO2: '980' }), 'x'), ValidationError);
  assert.throws(() => VitalSigns.fromForm(vitalForm({ PA_Sistolica: '70', PA_Diastolica: '80' }), 'x'), ValidationError);
});

test('Medication: días de tratamiento', () => {
  const activa = new Medication({ Activo: 'Sí', Requiere_Seguimiento_Dias: true, Fecha_Inicio: '2026-09-01' });
  assert.equal(activa.treatmentDays('2026-09-24'), 24);
  assert.equal(activa.isProlonged('2026-09-24'), true);
  const suspendida = new Medication({ Activo: 'No', Fecha_Inicio: '2026-09-01', Fecha_Omision: '2026-09-05' });
  assert.equal(suspendida.treatmentDays('2026-09-24'), 5);
  assert.equal(suspendida.isProlonged('2026-09-24'), false);
  assert.equal(new Medication({ Dias_Tratamiento: '7' }).treatmentDays(), 7);
});

test('Medication: cuenta el día de inicio como día 1 y limita alerta prolongada a seguimiento', () => {
  const antibiotic = new Medication({ Activo: 'Sí', Requiere_Seguimiento_Dias: true, Fecha_Inicio: '2026-09-01' });
  assert.equal(antibiotic.treatmentDays('2026-09-01'), 1);
  assert.match(antibiotic.coverageText('2026-09-01'), /primer día/);
  assert.match(antibiotic.coverageText('2026-09-02'), /día 2/);
  assert.equal(antibiotic.isProlonged('2026-09-14'), true);
  const future = new Medication({ Activo: 'Sí', Fecha_Inicio: '2026-09-03' });
  assert.equal(future.treatmentDays('2026-09-02'), 0);
  assert.match(future.coverageText('2026-09-02'), /sin días/);
  const chronic = new Medication({ Activo: 'Sí', Fecha_Inicio: '2026-09-01' });
  assert.equal(chronic.isProlonged('2026-09-30'), false);
});

test('Patient: arma la edad y valida obligatorios', () => {
  const p = Patient.fromForm({ HC: ' 2026-1 ', Nombre_Completo: 'Ana', Servicio: 'Pediatría', Edad: '1', Edad_Unidad: 'meses' });
  assert.equal(p.HC, '2026-1');
  assert.equal(p.Edad, '1 mes');
  assert.throws(() => Patient.fromForm({ HC: '1' }).validate(), ValidationError);
  assert.equal('HC' in p.toUpdateRow(), false);
});

test('LabResult: valor vacío -> null y enlaces solo http(s)', () => {
  const l = LabResult.fromForm({ Fecha: '2026-09-24', Tipo_Lab: 'PCR', Valor_Numerico: '' }, 'x');
  assert.equal(l.Valor_Numerico, null);
  assert.equal(l.hasNumericValue, false);
  assert.throws(() => LabResult.fromForm({ Fecha: '2026-09-24', Tipo_Lab: 'PCR', Enlace_PDF_Hospital: 'javascript:alert(1)' }, 'x'), ValidationError);
});


test('PatientRecord: insertar en página 2 actualiza el total sin desplazar filas visibles', () => {
  const record = new PatientRecord({
    patient: new Patient({ HC: 'x', Nombre_Completo: 'Paciente' }),
    tasks: Array.from({ length: 25 }, (_, i) => new PendingTask({ id: i + 1, HC: 'x', Fecha_Solicitud: `2026-09-${String(27 - Math.floor(i / 3)).padStart(2, '0')}`, Descripcion_Tarea: `Tarea ${i + 1}` })),
    pagination: { tasks: { page: 2, pageSize: 25, total: 50, totalPages: 2, listKey: 'tasks' } }
  });
  const next = record.withUpsertedItem('tasks', new PendingTask({ id: 99, HC: 'x', Fecha_Solicitud: '2026-09-27', Descripcion_Tarea: 'Nueva' }));
  assert.equal(next.tasks.length, 25);
  assert.equal(next.tasks[0].id, record.tasks[0].id);
  assert.equal(next.pagination.tasks.total, 51);
  assert.equal(next.pagination.tasks.totalPages, 3);
});

test('PatientRecord: mantiene labHistory al día con eventos Realtime', () => {
  const first = new LabResult({ id: 1, HC: 'x', Fecha: '2026-09-01', Tipo_Lab: 'PCR' });
  const record = new PatientRecord({
    patient: new Patient({ HC: 'x', Nombre_Completo: 'Paciente' }),
    labs: [first], labHistory: [first],
    pagination: { labs: { page: 1, pageSize: 25, total: 1, totalPages: 1, listKey: 'labs' } }
  });
  const inserted = record.withRealtimeEvent('DB_Laboratorios', {
    eventType: 'INSERT', new: { id: 2, HC: 'x', Fecha: '2026-09-02', Tipo_Lab: 'PCR' }
  });
  assert.deepEqual(inserted.labHistory.map(lab => lab.id), [2, 1]);
  const deleted = inserted.withRealtimeEvent('DB_Laboratorios', { eventType: 'DELETE', old: { id: 1, HC: 'x' } });
  assert.deepEqual(deleted.labHistory.map(lab => lab.id), [2]);
});

test('PatientRecord: DELETE Realtime en fila visible no contamina una página distinta y corrige el total', () => {
  const tasks = Array.from({ length: 25 }, (_, i) => new PendingTask({ id: i + 1, HC: 'x', Fecha_Solicitud: '2026-09-27', Descripcion_Tarea: `Tarea ${i + 1}` }));
  const record = new PatientRecord({
    patient: new Patient({ HC: 'x', Nombre_Completo: 'Paciente' }),
    tasks,
    pagination: { tasks: { page: 2, pageSize: 25, total: 50, totalPages: 2, listKey: 'tasks' } }
  });
  const next = record.withRealtimeEvent('DB_Pendientes', { eventType: 'DELETE', old: { id: 99, HC: 'x' } });
  assert.equal(next.tasks.length, 25);
  assert.equal(next.tasks.some(row => row.id === 13), true);
  assert.equal(next.pagination.tasks.total, 49);
});
