import { TABLES as T, SEARCH } from '../utils/constants.js';
import { todayISODate } from '../utils/formatters.js';
import { ApiError } from '../utils/errors.js';
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

  constructor(client) {
    this.#db = client;
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

  #warnMissingRpc(name) {
    if (this.#warnedRpc.has(name)) return;
    this.#warnedRpc.add(name);
    console.warn(`[ApiService] Falta la función SQL "${name}". Ejecuta supabase/001_search_and_indexes.sql para mejor rendimiento.`);
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

  updatePatient(hc, patient) {
    return this.#run(this.#db.from(T.PATIENTS).update(patient.toUpdateRow()).eq('HC', hc));
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

  completeTask(id) {
    return this.#run(this.#db.from(T.TASKS)
      .update({ Estado: 'Realizado', Fecha_Completado: new Date().toISOString() }).eq('id', id));
  }

  suspendMedication(id) {
    return this.#run(this.#db.from(T.MEDS)
      .update({ Activo: 'No', Fecha_Omision: todayISODate() }).eq('id', id));
  }

  answerConsultation(id, respuesta) {
    return this.#run(this.#db.from(T.CONSULTS)
      .update({ Respuesta_Departamento: respuesta, Fecha_Respuesta: todayISODate() }).eq('id', id));
  }

  resolveCulture(id, resultado, observaciones) {
    const patch = { Resultado: resultado, Fecha_Resultado: todayISODate() };
    if (observaciones) patch.Observaciones_Microbiologia = observaciones;
    return this.#run(this.#db.from(T.CULTURES).update(patch).eq('id', id));
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
}
