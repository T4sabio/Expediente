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
  assert.equal(VitalSigns.isValueAbnormal('SpO2', 90, { diagnoses: 'Sin antecedente de EPOC' }), true);
  assert.equal(VitalSigns.isValueAbnormal('SpO2', 90, { hasCOPD: true }), false);
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

test('VitalSigns: acepta tomas parciales y rechaza fechas futuras', () => {
  const partial = VitalSigns.fromForm(vitalForm({
    PA_Sistolica: '', PA_Diastolica: '', Frecuencia_Cardiaca: '72', SpO2: '',
    Temperatura: '', Frecuencia_Respiratoria: ''
  }), '2026-1');
  assert.equal(partial.Frecuencia_Cardiaca, 72);
  assert.equal(partial.SpO2, null);
  assert.throws(() => VitalSigns.fromForm(vitalForm({ Fecha_Hora: '2030-01-01T12:00' }), '2026-1'), ValidationError);
  assert.throws(() => VitalSigns.fromForm(vitalForm({ Frecuencia_Cardiaca: '72.5' }), '2026-1'), ValidationError);
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
  const planned = new Medication({ Activo: 'Sí', Requiere_Seguimiento_Dias: true, Fecha_Inicio: '2026-09-01', Dias_Tratamiento: 7 });
  assert.equal(planned.isProlonged('2026-09-07'), true);
  const future = new Medication({ Activo: 'Sí', Fecha_Inicio: '2026-09-03' });
  assert.equal(future.treatmentDays('2026-09-02'), 0);
  assert.match(future.coverageText('2026-09-02'), /sin días/);
  const chronic = new Medication({ Activo: 'Sí', Fecha_Inicio: '2026-09-01' });
  assert.equal(chronic.isProlonged('2026-09-30'), false);
});

test('Medication: reactivar ignora una fecha de omisión obsoleta', () => {
  const reactivated = new Medication({
    Activo: 'Sí', Fecha_Inicio: '2026-09-01', Fecha_Omision: '2026-09-03'
  });
  assert.equal(reactivated.treatmentDays('2026-09-10'), 10);
});

test('Culture: periodicidad respeta intervalos de 8 y 12 horas y valida el máximo de 720 horas', async () => {
  const { Culture } = await import('../src/models/ClinicalRecords.js');
  const now = new Date('2026-09-24T10:00:00-06:00');
  const culture = (hours, sentAt) => new Culture({
    id: hours, Tipo_Cultivo: `Cultivo ${hours}`, Es_Periodico: true,
    Intervalo_Horas: hours, Fecha_Envio: '2026-09-24', Fecha_Envio_Hora: sentAt
  });
  const statuses = Culture.periodicStatuses([
    culture(8, '2026-09-24T01:00:00-06:00'),
    culture(12, '2026-09-24T01:00:00-06:00')
  ], '2026-09-24', now);
  assert.equal(statuses.find(status => status.tipo === 'Cultivo 8').overdue, true);
  assert.equal(statuses.find(status => status.tipo === 'Cultivo 12').overdue, false);

  assert.doesNotThrow(() => Culture.fromForm({
    Tipo_Cultivo: 'Hemocultivo',
    Fecha_Envio_Hora: '2026-09-24T08:00',
    Es_Periodico: true,
    Intervalo_Horas: 720
  }, 'HC-1'));

  assert.throws(() => Culture.fromForm({
    Tipo_Cultivo: 'Hemocultivo',
    Fecha_Envio_Hora: '2026-09-24T08:00',
    Es_Periodico: true,
    Intervalo_Horas: 721
  }, 'HC-1'), /intervalo/i);
});

test('Patient: arma la edad y valida obligatorios', () => {
  const p = Patient.fromForm({ HC: ' 2026-1 ', Nombre_Completo: 'Ana', Servicio: 'Pediatría', Edad: '1', Edad_Unidad: 'meses' });
  assert.equal(p.HC, '2026-1');
  assert.equal(p.Edad, '1 mes');
  assert.throws(() => Patient.fromForm({ HC: '1' }).validate(), ValidationError);
  assert.equal('HC' in p.toUpdateRow(), false);
});

test('Patient: exige fecha para egreso/traslado y valida umbral de signos', () => {
  const invalidExit = Patient.fromForm({
    HC: 'HC-2', Nombre_Completo: 'Luis', Servicio: 'UCI',
    Estado_Episodio: 'Alta', Umbral_Signos_Horas: '24'
  });
  assert.throws(() => invalidExit.validate(), /fecha de egreso/);
  const valid = Patient.fromForm({
    HC: 'HC-2', Nombre_Completo: 'Luis', Servicio: 'UCI',
    Estado_Episodio: 'Trasladado', Fecha_Egreso: '2026-09-24', Umbral_Signos_Horas: '8'
  }).validate();
  assert.equal(valid.Estado_Episodio, 'Trasladado');
  assert.equal(valid.Umbral_Signos_Horas, 8);
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

test('PatientRecord: suspender y reactivar mueve medicamento entre listas con conteos separados', () => {
  const active = new Medication({ id: 8, Activo: 'Sí', Nombre_Medicamento: 'Cefepime' });
  const record = new PatientRecord({
    patient: new Patient({ HC: 'x', Nombre_Completo: 'Paciente' }),
    medications: [active],
    pagination: {
      medications: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      suspendedMedications: { page: 1, pageSize: 25, total: 0, totalPages: 1 }
    }
  });
  const suspended = record.withPatchedItem('medications', 8, { Activo: 'No', Fecha_Omision: '2026-09-24' });
  assert.equal(suspended.medications.length, 0);
  assert.equal(suspended.suspendedMedications[0].Activo, 'No');
  assert.equal(suspended.pagination.suspendedMedications.total, 1);
  const restored = suspended.withPatchedItem('medications', 8, { Activo: 'Sí', Fecha_Omision: null });
  assert.equal(restored.medications[0].Activo, 'Sí');
  assert.equal(restored.medications[0].Fecha_Omision, null);
  assert.equal(restored.pagination.suspendedMedications.total, 0);
});
