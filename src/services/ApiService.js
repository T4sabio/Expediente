import { TABLES as T, SEARCH } from '../utils/constants.js';
import { todayISODate } from '../utils/formatters.js';
import { ApiError, ConflictError } from '../utils/errors.js';
import { Patient } from '../models/Patient.js';
import { VitalSigns } from '../models/VitalSigns.js';
import { Medication } from '../models/Medication.js';
import { LabResult, Consultation, Culture, PendingTask } from '../models/ClinicalRecords.js';
import { PatientRecord } from '../models/PatientRecord.js';

// Códigos de PostgREST/Postgres cuando la función RPC aún no fue creada en la base.
const RPC_MISSING = new Set(['PGRST202', '42883']);

/**
 * Única capa que conoce Supabase. Recibe el cliente por constructor (inyección de dependencias),
 * así puede probarse con un cliente falso. Devuelve modelos de dominio, nunca filas crudas.
 */
export class ApiService {
  #db;
  #warnedRpc = new Set();
  #onDegraded;

  /**
   * @param {*} client Cliente de Supabase.
   * @param {{onDegraded?: (rpcName: string) => void}} [opts] `onDegraded` se llama
   *   UNA vez la primera vez que una función SQL esperada (RPC) no existe todavía
   *   y la app cae a un modo de respaldo más simple (ver `#searchFallback`).
   *   Sirve para que la UI muestre un aviso visible y persistente en vez de que
   *   la degradación quede escondida solo en la consola del navegador.
   */
  constructor(client, { onDegraded } = {}) {
    this.#db = client;
    this.#onDegraded = onDegraded;
  }

  /* ---------------------------- Búsqueda / catálogos ---------------------------- */

  /**
   * Búsqueda en el servidor (paginada por `limit`): la app ya NO descarga todos los pacientes.
   * Usa la función SQL `buscar_pacientes` (sin acentos + tolerante a errores de tipeo).
   * Si aún no existe, cae a una búsqueda ILIKE más simple.
   */
  async searchPatients({ query = '', servicio = '', limit = SEARCH.MAX_RESULTS } = {}) {
    const q = query.trim();
    const { data, error } = await this.#db.rpc('buscar_pacientes', {
      p_query: q, p_servicio: servicio || null, p_limit: limit
    });
    if (!error) return (data ?? []).map(r => new Patient(r));
    if (!RPC_MISSING.has(error.code)) throw new ApiError(error.message, error);
    this.#warnMissingRpc('buscar_pacientes');
    return this.#searchFallback(q, servicio, limit);
  }

  async #searchFallback(q, servicio, limit) {
    let req = this.#db.from(T.PATIENTS).select('*').is('Eliminado_En', null).order('Nombre_Completo').limit(limit);
    if (servicio) req = req.eq('Servicio', servicio);
    if (q) {
      const safe = q.replace(/[%,()*\\]/g, ' ').replace(/\s+/g, ' ').trim();
      if (safe) {
        const cama = safe.replace(/^cama\s*/i, '');
        req = req.or(`Nombre_Completo.ilike.%${safe.replace(/ /g, '%')}%,HC.ilike.${safe.replace(/ /g, '')}%,Cama.eq.${cama}`);
      }
    }
    const { data, error } = await req;
    if (error) throw new ApiError(error.message, error);
    return (data ?? []).map(r => new Patient(r));
  }

  async listServicios() {
    const { data, error } = await this.#db.rpc('listar_servicios');
    if (!error) return (data ?? []).map(r => (typeof r === 'string' ? r : r.Servicio ?? r.servicio)).filter(Boolean);
    if (!RPC_MISSING.has(error.code)) throw new ApiError(error.message, error);
    this.#warnMissingRpc('listar_servicios');
    const rows = await this.#run(this.#db.from(T.PATIENTS).select('Servicio').is('Eliminado_En', null));
    return [...new Set(rows.map(r => r.Servicio).filter(Boolean))].sort();
  }

  /**
   * Avisa (una sola vez por función) que se está usando el modo de respaldo.
   * IMPORTANTE: el respaldo NO es equivalente al RPC — no tolera acentos ni
   * errores de tipeo — así que esto no es solo una nota de rendimiento, es una
   * degradación funcional real que alguien con permisos de base de datos debe
   * corregir corriendo la migración correspondiente.
   */
  #warnMissingRpc(name) {
    if (this.#warnedRpc.has(name)) return;
    this.#warnedRpc.add(name);
    console.warn(`[ApiService] Falta la función SQL "${name}". Ejecuta supabase/001_search_and_indexes.sql para restaurar la búsqueda tolerante a acentos y errores de tipeo.`);
    this.#onDegraded?.(name);
  }

  /* ---------------------------- Lectura de expediente ---------------------------- */

  async getPatientRecord(hc) {
    const q = table => this.#db.from(table).select('*').eq('HC', hc);
    const [patient, vitals, meds, labs, consults, cultures, tasks] = await Promise.all([
      q(T.PATIENTS).is('Eliminado_En', null).single(),
      q(T.VITALS).order('Fecha_Hora', { ascending: true }),
      q(T.MEDS).order('Fecha_Inicio', { ascending: false }),
      q(T.LABS).order('Fecha', { ascending: true }),
      q(T.CONSULTS).order('Fecha_Envio', { ascending: false }),
      q(T.CULTURES).order('Fecha_Envio', { ascending: false }),
      q(T.TASKS).order('Fecha_Solicitud', { ascending: false })
    ]);

    if (patient.error || !patient.data) throw new Error(`No se encontró ningún paciente con HC = ${hc}`);
    // En un expediente clínico una lista vacía por error de red sería engañosa: se falla en voz alta.
    for (const r of [vitals, meds, labs, consults, cultures, tasks]) {
      if (r.error) throw new ApiError(r.error.message, r.error);
    }

    return new PatientRecord({
      patient: new Patient(patient.data),
      vitals: vitals.data.map(r => new VitalSigns(r)),
      medications: meds.data.map(r => new Medication(r)),
      labs: labs.data.map(r => new LabResult(r)),
      consultations: consults.data.map(r => new Consultation(r)),
      cultures: cultures.data.map(r => new Culture(r)),
      tasks: tasks.data.map(r => new PendingTask(r))
    });
  }

  /* ---------------------------- Tiempo real ---------------------------- */

  /**
   * Se suscribe a cambios (insert/update/delete) en cualquiera de las 7 tablas
   * para un paciente puntual. Si otra persona registra algo mientras alguien
   * más tiene el mismo expediente abierto, `onChange` se dispara para que la
   * pantalla se actualice sola (antes había que pulsar "Actualizar" a mano).
   * Devuelve una función para cancelar la suscripción.
   */
  subscribeToPatient(hc, onChange) {
    const channel = this.#db.channel(`paciente-${hc}`);
    const tables = [T.PATIENTS, T.VITALS, T.MEDS, T.LABS, T.CONSULTS, T.CULTURES, T.TASKS];
    for (const table of tables) {
      const filterColumn = table === T.PATIENTS ? 'HC' : 'HC';
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `${filterColumn}=eq.${hc}` }, onChange);
    }
    channel.subscribe();
    return () => this.#db.removeChannel(channel);
  }

  /* ---------------------------- Escritura ---------------------------- */

  async createPatient(patient) {
    const { error } = await this.#db.from(T.PATIENTS).insert([patient.toInsertRow()]);
    if (error) {
      throw new ApiError(
        error.code === '23505' ? 'Ya existe un paciente registrado con ese HC.' : 'No se pudo registrar el paciente: ' + error.message,
        error
      );
    }
  }

  /**
   * Verifica conflictos de edición: si `expectedModificadoEn` no coincide con el valor
   * actual en el servidor, alguien más ya guardó cambios sobre este paciente mientras
   * el formulario estaba abierto. En ese caso no se sobrescribe nada (0 filas afectadas)
   * y se avisa a la persona en vez de perder el cambio ajeno en silencio.
   */
  async updatePatient(hc, patient, { expectedModificadoEn } = {}) {
    let q = this.#db.from(T.PATIENTS).update(patient.toUpdateRow()).eq('HC', hc);
    if (expectedModificadoEn) q = q.eq('Modificado_En', expectedModificadoEn);
    const { data, error } = await q.select('HC');
    if (error) throw new ApiError(error.message, error);
    if (expectedModificadoEn && (!data || data.length === 0)) {
      throw new ApiError('Otra persona modificó este paciente mientras lo editabas. Recarga el expediente y vuelve a intentarlo para no perder su cambio.');
    }
    return data;
  }

  /**
   * Borrado LÓGICO (nunca DELETE físico): marca Eliminado_En y deja de aparecer en
   * búsquedas y expedientes, pero el historial completo se conserva y puede
   * restaurarse. El servidor (trigger + RLS, ver supabase/002_auth_rls_audit.sql)
   * exige además que quien hace esto tenga rol "medico"; si no, la petición falla.
   */
  deletePatient(hc) {
    return this.#run(this.#db.from(T.PATIENTS)
      .update({ Eliminado_En: new Date().toISOString() }).eq('HC', hc));
  }

  restorePatient(hc) {
    return this.#run(this.#db.from(T.PATIENTS)
      .update({ Eliminado_En: null }).eq('HC', hc));
  }

  addVitalSigns(v) { return this.#insert(T.VITALS, v); }
  addMedication(m) { return this.#insert(T.MEDS, m); }
  addLab(l) { return this.#insert(T.LABS, l); }
  addConsultation(c) { return this.#insert(T.CONSULTS, c); }
  addCulture(c) { return this.#insert(T.CULTURES, c); }
  addTask(t) { return this.#insert(T.TASKS, t); }

  /**
   * @param {number} id
   * @param {string} [expectedModificadoEn] Si se pasa, la actualización solo se
   *   aplica cuando `Modificado_En` en el servidor sigue siendo ese valor —
   *   igual que ya hacía `updatePatient`. Si alguien más ya modificó esta misma
   *   fila mientras tanto, se lanza `ConflictError` en vez de sobrescribir.
   */
  completeTask(id, expectedModificadoEn) {
    return this.#runWithConflictCheck(T.TASKS, id,
      { Estado: 'Realizado', Fecha_Completado: new Date().toISOString() }, expectedModificadoEn,
      'Otra persona ya actualizó este pendiente mientras tanto.');
  }

  /** Revierte "completeTask" — usado por el botón "Deshacer" del toast (patrón tipo Gmail). */
  uncompleteTask(id, expectedModificadoEn) {
    return this.#runWithConflictCheck(T.TASKS, id,
      { Estado: 'Pendiente', Fecha_Completado: null }, expectedModificadoEn,
      'Otra persona ya actualizó este pendiente mientras tanto.');
  }

  suspendMedication(id, expectedModificadoEn) {
    return this.#runWithConflictCheck(T.MEDS, id,
      { Activo: 'No', Fecha_Omision: todayISODate() }, expectedModificadoEn,
      'Otra persona ya actualizó este medicamento mientras tanto.');
  }

  answerConsultation(id, respuesta, expectedModificadoEn) {
    return this.#runWithConflictCheck(T.CONSULTS, id,
      { Respuesta_Departamento: respuesta, Fecha_Respuesta: todayISODate() }, expectedModificadoEn,
      'Otra persona ya respondió o modificó esta interconsulta mientras tanto.');
  }

  resolveCulture(id, resultado, observaciones, expectedModificadoEn) {
    const patch = { Resultado: resultado, Fecha_Resultado: todayISODate() };
    if (observaciones) patch.Observaciones_Microbiologia = observaciones;
    return this.#runWithConflictCheck(T.CULTURES, id, patch, expectedModificadoEn,
      'Otra persona ya registró un resultado para este cultivo mientras tanto.');
  }

  /* ---------------------------- Internos ---------------------------- */

  #insert(table, entity) {
    return this.#run(this.#db.from(table).insert([entity.toRow()]));
  }

  async #run(query) {
    const { data, error } = await query;
    if (error) throw new ApiError(error.message, error);
    return data;
  }

  /**
   * Como `#run`, pero si se pasa `expectedModificadoEn` agrega esa condición al
   * `WHERE` (`Modificado_En = expectedModificadoEn`). Si la fila no cambió (0
   * resultados) NO significa que el id no existe — el filtro por id ya se
   * cumplió antes; significa que `Modificado_En` ya no coincide, es decir,
   * alguien más escribió encima primero.
   */
  async #runWithConflictCheck(table, id, patch, expectedModificadoEn, conflictMessage) {
    let q = this.#db.from(table).update(patch).eq('id', id);
    if (expectedModificadoEn) q = q.eq('Modificado_En', expectedModificadoEn);
    const { data, error } = await q.select('id');
    if (error) throw new ApiError(error.message, error);
    if (expectedModificadoEn && (!data || data.length === 0)) {
      throw new ConflictError(`${conflictMessage} Se recargó la información más reciente; revísala antes de intentar de nuevo.`);
    }
    return data;
  }
}
