import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);
const unique = `phase2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let admin;
let createClient;
let ApiService;
let doctor;
let nurse;
let reader;
let patient;
const users = [];

function userClient() {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createRoleUser(role, label) {
  const email = `${label}-${unique}@example.test`;
  const password = `Phase2-${unique}!Aa9`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nombre: `Usuario ${label}` } });
  assert.ifError(created.error);
  users.push(created.data.user.id);
  const { error: profileError } = await admin.from('personal').update({ rol: role, activo: true }).eq('id', created.data.user.id);
  assert.ifError(profileError);
  const client = userClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  return client;
}

before(async t => {
  if (!enabled) { t.skip('Define SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY y SUPABASE_TEST_SERVICE_ROLE_KEY para ejecutar integración contra Postgres/Supabase real.'); return; }
  ({ createClient } = await import('@supabase/supabase-js'));
  ({ ApiService } = await import('../../src/services/ApiService.js'));
  admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  doctor = await createRoleUser('medico', 'doctor');
  nurse = await createRoleUser('enfermeria', 'nurse');
  reader = await createRoleUser('lectura', 'reader');

  patient = {
    HC: `INT-${unique}`,
    Nombre_Completo: 'Paciente de Integración Fase 2',
    Servicio: 'UCI-TEST',
    Cama: 'TEST-01',
    Edad: '40 años',
    Fecha_Ingreso: '2026-09-27',
    Motivo_Consulta: 'Prueba automatizada; no es dato clínico real.'
  };
  const { error } = await doctor.from('DB_Pacientes').insert(patient);
  assert.ifError(error);
});

after(async () => {
  if (!enabled || !admin) return;
  await admin.from('DB_Pacientes').delete().eq('HC', patient?.HC ?? '');
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

test('RLS real: lectura sí, escritura no para rol lectura', { skip: !enabled, concurrency: false }, async () => {
  const { data, error } = await reader.from('DB_Pacientes').select('HC,Nombre_Completo').eq('HC', patient.HC).maybeSingle();
  assert.ifError(error);
  assert.equal(data?.HC, patient.HC);
  const insert = await reader.from('DB_Pendientes').insert({ HC: patient.HC, Descripcion_Tarea: 'no debe insertarse', Fecha_Solicitud: '2026-09-27' }).select('id');
  assert.ok(insert.error, 'el rol lectura no debe insertar');
});

test('Integridad real: HC inmutable y filas hijas respetan paciente activo', { skip: !enabled, concurrency: false }, async () => {
  const child = await nurse.from('DB_Pendientes').insert({ HC: patient.HC, Descripcion_Tarea: 'Integración', Fecha_Solicitud: '2026-09-27', Estado: 'Pendiente' }).select('id,HC').single();
  assert.ifError(child.error);
  const id = child.data.id;
  const movePatient = await doctor.from('DB_Pacientes').update({ HC: `MOVED-${unique}` }).eq('HC', patient.HC);
  assert.ok(movePatient.error, 'HC del paciente debe ser inmutable');
  const moveChild = await nurse.from('DB_Pendientes').update({ HC: `MOVED-${unique}` }).eq('id', id);
  assert.ok(moveChild.error, 'HC de la fila hija debe ser inmutable');
});

test('Borrado lógico real: expediente eliminado deja de ser visible y sus hijos no pueden operar', { skip: !enabled, concurrency: false }, async () => {
  const deleted = await doctor.from('DB_Pacientes').update({ Eliminado_En: new Date().toISOString() }).eq('HC', patient.HC);
  assert.ifError(deleted.error);
  const patientRead = await reader.from('DB_Pacientes').select('HC').eq('HC', patient.HC);
  assert.ifError(patientRead.error);
  assert.equal(patientRead.data.length, 0);
  const childRead = await nurse.from('DB_Pendientes').select('id').eq('HC', patient.HC);
  assert.ifError(childRead.error);
  assert.equal(childRead.data.length, 0);
  const childWrite = await nurse.from('DB_Pendientes').insert({ HC: patient.HC, Descripcion_Tarea: 'bloqueada', Fecha_Solicitud: '2026-09-27' });
  assert.ok(childWrite.error, 'no debe poder escribirse sobre expediente eliminado');
  const restored = await doctor.from('DB_Pacientes').update({ Eliminado_En: null }).eq('HC', patient.HC);
  assert.ifError(restored.error);
});

test('Auditoría real: lectura restringida y diffs compactos', { skip: !enabled, concurrency: false }, async () => {
  const readerAudit = await reader.from('audit_log').select('id').eq('registro_id', patient.HC);
  assert.ifError(readerAudit.error);
  assert.equal(readerAudit.data.length, 0, 'la política RLS debe ocultar la bitácora al rol lectura');
  const doctorAudit = await doctor.from('audit_log').select('tabla,registro_id,accion,datos_nuevos').eq('registro_id', patient.HC).order('creado_en', { ascending: false }).limit(5);
  assert.ifError(doctorAudit.error);
  assert.ok(doctorAudit.data.length >= 1);
  assert.ok(!JSON.stringify(doctorAudit.data).includes('Motivo_Consulta'), 'el audit log de fase 2 no debe almacenar PHI completa');
});

test('Paginación y selects mínimos: historial > 25 filas se divide en páginas', { skip: !enabled, concurrency: false }, async () => {
  const rows = Array.from({ length: 31 }, (_, i) => ({
    HC: patient.HC, Fecha_Solicitud: '2026-09-27', Fecha_Programada: '2026-09-27',
    Descripcion_Tarea: `Tarea integración ${String(i + 1).padStart(2, '0')}`, Estado: 'Pendiente'
  }));
  const seed = await nurse.from('DB_Pendientes').insert(rows);
  assert.ifError(seed.error);
  const api = new ApiService(nurse);
  const record = await api.getPatientRecord(patient.HC, { pageSize: 25 });
  assert.equal(record.tasks.length, 25);
  assert.equal(record.pagination.tasks.total, 31);
  assert.equal(record.pagination.tasks.totalPages, 2);
  const second = await api.getPatientSectionPage(patient.HC, 'tasks', 2, { pageSize: 25 });
  assert.equal(second.items.length, 6);
});

test('Realtime real: una inserción llega como evento de tabla sin recargar el expediente completo', { skip: !enabled, concurrency: false }, async () => {
  const api = new ApiService(nurse);
  const eventPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime no entregó el evento dentro del plazo')), 10000);
    const stop = api.subscribeToPatient(patient.HC, event => {
      if (event?.table === 'DB_Pendientes' && event?.eventType === 'INSERT') {
        clearTimeout(timer);
        void Promise.resolve(stop()).finally(() => resolve(event));
      }
    });
  });
  const created = await nurse.from('DB_Pendientes').insert({ HC: patient.HC, Fecha_Solicitud: '2026-09-27', Descripcion_Tarea: 'Realtime integration', Estado: 'Pendiente' }).select('id').single();
  assert.ifError(created.error);
  const event = await eventPromise;
  assert.equal(event.new.HC, patient.HC);
});
