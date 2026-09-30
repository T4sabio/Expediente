import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiService } from '../src/services/ApiService.js';
import { ApiError, ConflictError } from '../src/utils/errors.js';

/**
 * Cliente de Supabase simulado. `tables` mapea nombre de tabla a un valor fijo
 * `{data, error}` o a una función que lo calcula (para simular RLS, conflictos,
 * etc. según lo que la prueba necesite). Los métodos de encadenamiento
 * (select/eq/is/order/...) no filtran nada de verdad: cada prueba configura
 * directamente el resultado final que le interesa observar.
 */
function makeBuilder(getResult) {
  const builder = {
    select: () => builder, eq: () => builder, is: () => builder, order: () => builder,
    limit: () => builder, range: () => builder, maybeSingle: () => builder, single: () => builder, insert: () => builder, update: () => builder, or: () => builder,
    then(resolve, reject) { Promise.resolve(getResult()).then(resolve, reject); }
  };
  return builder;
}

class MockSupabase {
  constructor({ tables = {}, rpcs = {} } = {}) {
    this.tables = tables;
    this.rpcs = rpcs;
    this.calls = { from: [], rpc: [], removedChannels: [] };
  }
  from(table) {
    this.calls.from.push(table);
    const cfg = this.tables[table];
    const getResult = typeof cfg === 'function' ? cfg : () => cfg ?? { data: [], error: null };
    return makeBuilder(getResult);
  }
  rpc(name, params) {
    this.calls.rpc.push({ name, params });
    const cfg = this.rpcs[name];
    if (cfg === undefined) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: `función ${name} no existe` } });
    return Promise.resolve(typeof cfg === 'function' ? cfg(params) : cfg);
  }
  channel(name) {
    const handlers = [];
    const ch = { name, on: (...args) => { handlers.push(args); return ch; }, subscribe: () => ch, _handlers: handlers };
    return ch;
  }
  removeChannel(ch) { this.calls.removedChannels.push(ch); }
}

/* ---------------------------- Búsqueda ---------------------------- */

test('searchPatients: usa el RPC cuando existe y devuelve instancias de Patient', async () => {
  const db = new MockSupabase({ rpcs: { buscar_pacientes: { data: [{ HC: '2026-1', Nombre_Completo: 'Ana' }], error: null } } });
  const api = new ApiService(db);
  const results = await api.searchPatients({ query: 'ana' });
  assert.equal(results.length, 1);
  assert.equal(results[0].constructor.name, 'Patient');
  assert.equal(results[0].HC, '2026-1');
});

test('searchPatients: si el RPC no existe, cae al respaldo y avisa UNA vez (onDegraded)', async () => {
  const db = new MockSupabase({ tables: { DB_Pacientes: { data: [{ HC: '2026-2', Nombre_Completo: 'Luis' }], error: null } } });
  const degraded = [];
  const api = new ApiService(db, { onDegraded: name => degraded.push(name) });
  const r1 = await api.searchPatients({ query: 'luis' });
  const r2 = await api.searchPatients({ query: 'luis' });
  assert.equal(r1.length, 1);
  assert.equal(r2.length, 1);
  assert.deepEqual(degraded, ['buscar_pacientes']); // solo una vez, no una por búsqueda
});

test('searchPatients: un error de RPC que NO es "función faltante" se propaga (no se enmascara como respaldo)', async () => {
  const db = new MockSupabase({ rpcs: { buscar_pacientes: { data: null, error: { code: '42501', message: 'permiso denegado' } } } });
  const api = new ApiService(db);
  await assert.rejects(() => api.searchPatients({ query: 'x' }), ApiError);
});

/* ---------------------------- Lectura de expediente (posible RLS) ---------------------------- */

test('getPatientRecord: agrega las 7 tablas en un PatientRecord', async () => {
  const db = new MockSupabase({
    rpcs: {
      resumen_paciente: { data: { counts: { vitals: 1, medications: 0, labs: 0, consultations: 0, cultures: 0, tasks: 0 }, labTypes: [], latestVital: null }, error: null },
      ultima_actividad_paciente: { data: [], error: null }
    },
    tables: {
      DB_Pacientes: { data: { HC: '2026-1', Nombre_Completo: 'Ana', Servicio: 'UCI' }, error: null },
      DB_SignosVitales: { data: [{ id: 1, PA_Sistolica: 120, PA_Diastolica: 80 }], error: null },
      DB_Medicamentos: { data: [], error: null },
      DB_Laboratorios: { data: [], error: null },
      DB_Consultas: { data: [], error: null },
      DB_Cultivos: { data: [], error: null },
      DB_Pendientes: { data: [], error: null }
    }
  });
  const api = new ApiService(db);
  const record = await api.getPatientRecord('2026-1');
  assert.equal(record.patient.Nombre_Completo, 'Ana');
  assert.equal(record.vitals.length, 1);
});

test('getPatientRecord: recupera todas las páginas del historial de laboratorios para el gráfico', async () => {
  const labRows = Array.from({ length: 1001 }, (_, index) => ({
    id: index + 1, HC: '2026-1', Fecha: new Date(Date.UTC(2023, 0, 1 + 1000 - index)).toISOString().slice(0, 10),
    Tipo_Lab: 'Creatinina', Valor_Numerico: index
  }));
  const client = {
    rpc: async name => name === 'resumen_paciente'
      ? { data: { counts: { labs: labRows.length }, labTypes: ['Creatinina'] }, error: null }
      : { data: [], error: null },
    from(table) {
      let from = 0;
      let to = Infinity;
      const builder = {
        select: () => builder, eq: () => builder, is: () => builder, order: () => builder,
        range: (start, end) => { from = start; to = end; return builder; },
        single: () => builder,
        then(resolve) {
          const data = table === 'DB_Pacientes'
            ? { HC: '2026-1', Nombre_Completo: 'Ana' }
            : table === 'DB_Laboratorios' ? labRows.slice(from, to + 1) : [];
          resolve({ data, error: null });
        }
      };
      return builder;
    }
  };
  const record = await new ApiService(client).getPatientRecord('2026-1');
  assert.equal(record.labs.length, 25);
  assert.equal(record.labHistory.length, 1001);
});

test('getPatientRecord: paciente inexistente lanza un error legible', async () => {
  const db = new MockSupabase({ rpcs: { resumen_paciente: { data: { counts: {}, labTypes: [], latestVital: null }, error: null } }, tables: { DB_Pacientes: { data: null, error: null } } });
  const api = new ApiService(db);
  await assert.rejects(() => api.getPatientRecord('no-existe'), /No se encontró el paciente seleccionado/);
});

test('getPatientRecord: un bloqueo de RLS en cualquier tabla hija falla en voz alta (no oculta datos)', async () => {
  const db = new MockSupabase({
    rpcs: { resumen_paciente: { data: { counts: {}, labTypes: [], latestVital: null }, error: null } },
    tables: {
      DB_Pacientes: { data: { HC: '2026-1', Nombre_Completo: 'Ana' }, error: null },
      DB_SignosVitales: { data: null, error: { code: '42501', message: 'permission denied for table DB_SignosVitales' } },
      DB_Medicamentos: { data: [], error: null },
      DB_Laboratorios: { data: [], error: null },
      DB_Consultas: { data: [], error: null },
      DB_Cultivos: { data: [], error: null },
      DB_Pendientes: { data: [], error: null }
    }
  });
  const api = new ApiService(db);
  await assert.rejects(() => api.getPatientRecord('2026-1'), ApiError);
});

/* ---------------------------- Guardado ---------------------------- */

test('createPatient: HC duplicado da un mensaje amigable (23505)', async () => {
  const db = new MockSupabase({ tables: { DB_Pacientes: { data: null, error: { code: '23505', message: 'duplicate key' } } } });
  const api = new ApiService(db);
  await assert.rejects(() => api.createPatient({ toInsertRow: () => ({ HC: '2026-1' }) }), /Ya existe un paciente/);
});

test('addVitalSigns / addMedication: insertan sin lanzar cuando el servidor no reporta error', async () => {
  const db = new MockSupabase({ tables: { DB_SignosVitales: { data: { id: 1 }, error: null } } });
  const api = new ApiService(db);
  const result = await api.addVitalSigns({ toRow: () => ({ HC: '2026-1', PA_Sistolica: 120 }) });
  assert.equal(result.id, 1);
});

test('addMedication: un reintento con la misma clave devuelve la fila ya insertada', async () => {
  let insertedRow;
  const db = {
    from() {
      let isInsert = false;
      const builder = {
        insert: rows => { isInsert = true; insertedRow = rows[0]; return builder; },
        select: () => builder, eq: () => builder, maybeSingle: () => builder, single: () => builder,
        then(resolve, reject) {
          const result = isInsert
            ? { data: null, error: { code: '23505', message: 'duplicate key' } }
            : { data: { id: 12, HC: 'HC-2', Nombre_Medicamento: 'Ceftriaxona' }, error: null };
          return Promise.resolve(result).then(resolve, reject);
        }
      };
      return builder;
    }
  };
  const api = new ApiService(db);
  const medication = await api.addMedication({ toRow: () => ({ HC: 'HC-2', Nombre_Medicamento: 'Ceftriaxona' }) }, { idempotencyKey: 'retry-1' });
  assert.equal(insertedRow.Idempotency_Key, 'retry-1');
  assert.equal(medication.id, 12);
});

test('deletePatient / restorePatient: usan RPC con motivo y devuelven la HC afectada', async () => {
  const db = new MockSupabase({ rpcs: {
    eliminar_paciente: ({ p_hc }) => ({ data: p_hc, error: null }),
    restaurar_paciente: ({ p_hc }) => ({ data: p_hc, error: null })
  } });
  const api = new ApiService(db);

  assert.equal(await api.deletePatient('HC-7', 'Duplicado'), 'HC-7');
  assert.equal(await api.restorePatient('HC-7', 'Corrección validada'), 'HC-7');
  assert.deepEqual(db.calls.rpc, [
    { name: 'eliminar_paciente', params: { p_hc: 'HC-7', p_motivo: 'Duplicado' } },
    { name: 'restaurar_paciente', params: { p_hc: 'HC-7', p_motivo: 'Corrección validada' } }
  ]);
  assert.deepEqual(db.calls.from, []);
});

test('recordPatientPrint: registra la HC y el conteo de registros mediante RPC', async () => {
  const db = new MockSupabase({ rpcs: { registrar_impresion_expediente: { data: null, error: null } } });
  await new ApiService(db).recordPatientPrint('HC-9', { vitals: 30, labs: 4 });
  assert.deepEqual(db.calls.rpc.at(-1), {
    name: 'registrar_impresion_expediente',
    params: { p_hc: 'HC-9', p_registros: { vitals: 30, labs: 4 } }
  });
});

test('recordPatientRead / recordPatientExport: registran acceso y salida clínica', async () => {
  const db = new MockSupabase({ rpcs: {
    registrar_lectura_expediente: { data: null, error: null },
    registrar_exporte_expediente: { data: null, error: null }
  } });
  const api = new ApiService(db);
  await api.recordPatientRead('HC-8');
  await api.recordPatientExport('HC-8', { vitals: 12 });
  assert.deepEqual(db.calls.rpc, [
    { name: 'registrar_lectura_expediente', params: { p_hc: 'HC-8' } },
    { name: 'registrar_exporte_expediente', params: { p_hc: 'HC-8', p_registros: { vitals: 12 } } }
  ]);
});

/* ---------------------------- Concurrencia (2.5) ---------------------------- */

test('updatePatient: conflicto de edición concurrente cuando 0 filas cambian', async () => {
  const db = new MockSupabase({ tables: { DB_Pacientes: { data: [], error: null } } });
  const api = new ApiService(db);
  await assert.rejects(
    () => api.updatePatient('2026-1', { toUpdateRow: () => ({}) }, { expectedModificadoEn: '2026-01-01T00:00:00Z' }),
    /Otra persona modificó este paciente/
  );
});

test('updatePatient: un sello nulo sigue siendo condición y 0 filas siempre falla', async () => {
  const db = new MockSupabase({ tables: { DB_Pacientes: { data: [], error: null } } });
  const api = new ApiService(db);
  await assert.rejects(() => api.updatePatient('HC-1', { toUpdateRow: () => ({}) }), ConflictError);
  await assert.rejects(() => api.updatePatient('HC-1', { toUpdateRow: () => ({}) }, { expectedModificadoEn: null }), ConflictError);
});

test('completeTask: sin Modificado_En esperado, actualiza sin exigir coincidencia', async () => {
  const db = new MockSupabase({ tables: { DB_Pendientes: { data: [{ id: 5 }], error: null } } });
  const api = new ApiService(db);
  const result = await api.completeTask(5);
  assert.equal(result.id, 5);
});

test('completeTask: con Modificado_En esperado y 0 filas afectadas, lanza ConflictError (no sobrescribe en silencio)', async () => {
  const db = new MockSupabase({ tables: { DB_Pendientes: { data: [], error: null } } });
  const api = new ApiService(db);
  await assert.rejects(() => api.completeTask(5, '2026-01-01T00:00:00Z'), ConflictError);
});

test('resolveCulture: conflicto también se detecta al registrar un resultado', async () => {
  const db = new MockSupabase({ tables: { DB_Cultivos: { data: [], error: null } } });
  const api = new ApiService(db);
  await assert.rejects(
    () => api.resolveCulture(9, 'Positivo', 'obs', '2026-01-01T00:00:00Z'),
    err => err instanceof ConflictError && /cultivo/.test(err.message)
  );
});

test('suspendMedication / answerConsultation: propagan errores de servidor como ApiError', async () => {
  const db = new MockSupabase({
    tables: {
      DB_Medicamentos: { data: null, error: { message: 'boom' } },
      DB_Consultas: { data: null, error: { message: 'boom' } }
    }
  });
  const api = new ApiService(db);
  await assert.rejects(() => api.suspendMedication(1), ApiError);
  await assert.rejects(() => api.answerConsultation(1, 'ok'), ApiError);
});

/* ---------------------------- Tiempo real ---------------------------- */

test('subscribeToPatient: se suscribe a las 7 tablas y la función de cancelación remueve el canal', () => {
  const db = new MockSupabase();
  const api = new ApiService(db);
  const unsubscribe = api.subscribeToPatient('2026-1', () => {});
  unsubscribe();
  assert.equal(db.calls.removedChannels.length, 1);
});

/* ---------------------------- Producto Fase 3 ---------------------------- */

test('getRoundOverview: usa RPC mínimo y limita el tamaño solicitado', async () => {
  const db = new MockSupabase({ rpcs: { ronda_hoy: { data: [{ hc: '1', nombre_completo: 'Ana', due_tasks: 0, latest_activity_at: null, vitals_overdue: true, total_active: 1 }], error: null } } });
  const api = new ApiService(db);
  const rows = await api.getRoundOverview({ servicio: 'UCI', limit: 999 });
  assert.equal(rows.length, 1);
  assert.deepEqual(db.calls.rpc.at(-1), { name: 'ronda_hoy', params: { p_servicio: 'UCI', p_limit: 100 } });
});

test('getRoundOverview: no acepta el contrato SQL antiguo con métricas incompletas', async () => {
  const db = new MockSupabase({ rpcs: { ronda_hoy: { data: [{ hc: '1', open_tasks: 1 }], error: null } } });
  await assert.rejects(() => new ApiService(db).getRoundOverview(), /está desactualizada/);
});

test('getRoundOverview y getPatientTimeline: RPC ausentes generan error visible, no lista vacía', async () => {
  const api = new ApiService(new MockSupabase());
  await assert.rejects(() => api.getRoundOverview(), /requiere desplegar/);
  await assert.rejects(() => api.getPatientTimeline('HC-1'), /requiere desplegar/);
});

test('getPatientTimeline: propaga errores reales y devuelve eventos del RPC', async () => {
  const db = new MockSupabase({ rpcs: { timeline_paciente: { data: [{ kind: 'vitales', title: 'Signos vitales' }], error: null } } });
  const api = new ApiService(db);
  const rows = await api.getPatientTimeline('HC-1');
  assert.equal(rows[0].kind, 'vitales');

  const failing = new MockSupabase({ rpcs: { timeline_paciente: { data: null, error: { code: '42501', message: 'permission denied' } } } });
  await assert.rejects(() => new ApiService(failing).getPatientTimeline('HC-1'), ApiError);
});

test('getPatientLastActivity: RPC ausente devuelve un error visible, no actividad vacía', async () => {
  const degraded = [];
  const db = new MockSupabase();
  const api = new ApiService(db, { onDegraded: name => degraded.push(name) });
  const result = await api.getPatientLastActivity('HC-1');
  assert.equal(result.data, null);
  assert.match(result.error.message, /requiere desplegar/);
  assert.deepEqual(degraded, ['ultima_actividad_paciente']);
});
