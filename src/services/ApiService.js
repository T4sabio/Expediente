import { TABLES as T, SEARCH } from '../utils/constants.js';
import { todayISODate } from '../utils/formatters.js';
import { ApiError, ConflictError } from '../utils/errors.js';
import { Patient } from '../models/Patient.js';
import { VitalSigns } from '../models/VitalSigns.js';
import { Medication } from '../models/Medication.js';
import { LabResult, Consultation, Culture, PendingTask } from '../models/ClinicalRecords.js';
import { PatientRecord, modelForList } from '../models/PatientRecord.js';

const RPC_MISSING = new Set(['PGRST202', '42883']);
const DEFAULT_PAGE_SIZE = 25;
const SERVICES_CACHE_MS = 5 * 60 * 1000;

const PATIENT_SELECT = 'HC,Nombre_Completo,Servicio,Cama,Edad,Fecha_Ingreso,Num_RayosX,Motivo_Consulta,Diagnosticos,Modificado_En';
const SELECTS = Object.freeze({
  vitals: 'id,HC,Fecha_Hora,PA_Sistolica,PA_Diastolica,Frecuencia_Cardiaca,SpO2,Temperatura,Frecuencia_Respiratoria,PAM,Modificado_En',
  medications: 'id,HC,Nombre_Medicamento,Dosis_Frecuencia,Fecha_Inicio,Fecha_Omision,Activo,Dias_Tratamiento,Requiere_Seguimiento_Dias,Frecuencia_Horas,Modificado_En',
  labs: 'id,HC,Fecha,Tipo_Lab,Valor_Numerico,Resultado_Texto,Enlace_PDF_Hospital,Modificado_En',
  consultations: 'id,HC,Departamento_Consultado,Fecha_Envio,Fecha_Respuesta,Respuesta_Departamento,Modificado_En',
  cultures: 'id,HC,Tipo_Cultivo,Fecha_Envio,Fecha_Resultado,Resultado,Observaciones_Microbiologia,Es_Periodico,Intervalo_Horas,Modificado_En',
  tasks: 'id,HC,Descripcion_Tarea,Fecha_Solicitud,Fecha_Programada,Justificacion_Observaciones,Estado,Fecha_Completado,Modificado_En'
});

const TABLE_FOR_LIST = Object.freeze({
  vitals: T.VITALS,
  medications: T.MEDS,
  labs: T.LABS,
  consultations: T.CONSULTS,
  cultures: T.CULTURES,
  tasks: T.TASKS
});

const ORDER_FOR_LIST = Object.freeze({
  vitals: ['Fecha_Hora', false],
  medications: ['Fecha_Inicio', false],
  labs: ['Fecha', false],
  consultations: ['Fecha_Envio', false],
  cultures: ['Fecha_Envio', false],
  tasks: ['Fecha_Solicitud', false]
});

/** Única capa que conoce Supabase. Devuelve modelos de dominio, nunca filas crudas. */
export class ApiService {
  #db;
  #warnedRpc = new Set();
  #onDegraded;
  #servicesCache = null;
  #servicesCacheAt = 0;

  constructor(client, { onDegraded } = {}) {
    this.#db = client;
    this.#onDegraded = onDegraded;
  }

  /* ---------------------------- Búsqueda / catálogos ---------------------------- */

  async searchPatients({ query = '', servicio = '', limit = SEARCH.MAX_RESULTS } = {}) {
    const q = query.trim();
    const safeLimit = Math.max(1, Math.min(Number(limit) || SEARCH.MAX_RESULTS, SEARCH.MAX_RESULTS));
    let { data, error } = await this.#db.rpc('buscar_pacientes_min', {
      p_query: q, p_servicio: servicio || null, p_limit: safeLimit
    });
    if (!error) return (data ?? []).map(r => new Patient(r));
    if (!RPC_MISSING.has(error.code)) throw new ApiError(error.message, error);

    ({ data, error } = await this.#db.rpc('buscar_pacientes', {
      p_query: q, p_servicio: servicio || null, p_limit: safeLimit
    }));
    if (!error) return (data ?? []).map(r => new Patient(r));
    if (!RPC_MISSING.has(error.code)) throw new ApiError(error.message, error);
    this.#warnMissingRpc('buscar_pacientes');
    return this.#searchFallback(q, servicio, safeLimit);
  }

  async #searchFallback(q, servicio, limit) {
    let req = this.#db.from(T.PATIENTS)
      .select('HC,Nombre_Completo,Servicio,Cama,Edad')
      .is('Eliminado_En', null)
      .order('Nombre_Completo')
      .limit(limit);
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

  async listServicios({ force = false } = {}) {
    const now = Date.now();
    if (!force && this.#servicesCache && now - this.#servicesCacheAt < SERVICES_CACHE_MS) return [...this.#servicesCache];
    const { data, error } = await this.#db.rpc('listar_servicios');
    let services;
    if (!error) {
      services = (data ?? []).map(r => (typeof r === 'string' ? r : r.Servicio ?? r.servicio)).filter(Boolean);
    } else {
      if (!RPC_MISSING.has(error.code)) throw new ApiError(error.message, error);
      this.#warnMissingRpc('listar_servicios');
      const rows = await this.#run(this.#db.from(T.PATIENTS).select('Servicio').is('Eliminado_En', null));
      services = [...new Set(rows.map(r => r.Servicio).filter(Boolean))].sort();
    }
    this.#servicesCache = services;
    this.#servicesCacheAt = now;
    return [...services];
  }

  #warnMissingRpc(name) {
    if (this.#warnedRpc.has(name)) return;
    this.#warnedRpc.add(name);
    console.warn(`[ApiService] Falta la función SQL "${name}". Despliega las migraciones de Supabase.`);
    this.#onDegraded?.(name);
  }

  /* ---------------------------- Lectura de expediente ---------------------------- */

  async getPatientRecord(hc, { pageSize = DEFAULT_PAGE_SIZE } = {}) {
    const size = normalizePageSize(pageSize);
    const patientQuery = this.#db.from(T.PATIENTS).select(PATIENT_SELECT).eq('HC', hc).is('Eliminado_En', null).single();
    const pageQueries = Object.keys(TABLE_FOR_LIST).map(listKey => this.#fetchListPage(hc, listKey, 1, size));
    const summaryQuery = this.getPatientSummary(hc);
    const activityQuery = this.getPatientLastActivity(hc);
    const [patient, ...rest] = await Promise.all([patientQuery, ...pageQueries, summaryQuery, activityQuery]);
    const pages = rest.slice(0, 6);
    const summary = rest[6];
    const activity = rest[7];

    if (patient.error) throw new ApiError('No se pudo cargar el paciente seleccionado.', patient.error);
    if (!patient.data) throw new ApiError('No se encontró el paciente seleccionado.');
    for (const page of pages) {
      if (page.error) throw new ApiError(page.error.message, page.error);
    }
    if (summary.error) throw new ApiError('No se pudo cargar el resumen clínico.', summary.error);
    if (activity.error) throw new ApiError('No se pudo cargar la última actividad del expediente.', activity.error);

    const vitals = pageModels('vitals', pages[0].data ?? []);
    // La página 1 se pide descendente para priorizar actualidad; el modelo conserva orden cronológico para el gráfico.
    vitals.reverse();
    return new PatientRecord({
      patient: new Patient(patient.data),
      vitals,
      medications: pageModels('medications', pages[1].data ?? []),
      labs: pageModels('labs', pages[2].data ?? []),
      consultations: pageModels('consultations', pages[3].data ?? []),
      cultures: pageModels('cultures', pages[4].data ?? []),
      tasks: pageModels('tasks', pages[5].data ?? []),
      summary: summary.data ? { ...summary.data, lastActivity: activity.data?.[0] ?? null } : null,
      pagination: Object.fromEntries(Object.keys(TABLE_FOR_LIST).map((key, i) => [key, {
        ...pages[i].pagination, listKey: key
      }]))
    });
  }

  /** Carga únicamente una sección/página; útil al navegar por historiales largos. */
  async getPatientSectionPage(hc, listKey, page = 1, { pageSize = DEFAULT_PAGE_SIZE } = {}) {
    if (!TABLE_FOR_LIST[listKey]) throw new ApiError('Sección de expediente inválida.');
    const response = await this.#fetchListPage(hc, listKey, page, normalizePageSize(pageSize));
    if (response.error) throw new ApiError(response.error.message, response.error);
    const items = pageModels(listKey, response.data ?? []);
    if (listKey === 'vitals') items.reverse();
    return {
      items,
      pagination: { ...response.pagination, listKey }
    };
  }

  async getPatientSummary(hc) {
    const { data, error } = await this.#db.rpc('resumen_paciente', { p_hc: hc });
    if (!error) return { data, error: null };
    if (!RPC_MISSING.has(error.code)) return { data: null, error };

    // Compatibilidad durante un despliegue parcial: consultas agregadas, nunca select('*').
    try {
      const summary = await this.#summaryFallback(hc);
      return { data: summary, error: null };
    } catch (fallbackError) {
      return { data: null, error: fallbackError?.cause ?? fallbackError };
    }
  }

  async getRoundOverview({ servicio = '', limit = 100 } = {}) {
    const { data, error } = await this.#db.rpc('ronda_hoy', {
      p_servicio: servicio || null,
      p_limit: Math.max(1, Math.min(Number(limit) || 100, 100))
    });
    if (!error) return (data ?? []).map(row => ({ ...row }));
    if (!RPC_MISSING.has(error.code)) throw new ApiError(error.message, error);
    this.#warnMissingRpc('ronda_hoy');
    return [];
  }

  async getPatientTimeline(hc, { limit = 40 } = {}) {
    const { data, error } = await this.#db.rpc('timeline_paciente', {
      p_hc: hc,
      p_limit: Math.max(1, Math.min(Number(limit) || 40, 80))
    });
    if (!error) return data ?? [];
    if (!RPC_MISSING.has(error.code)) throw new ApiError(error.message, error);
    this.#warnMissingRpc('timeline_paciente');
    return [];
  }

  async getPatientLastActivity(hc) {
    const { data, error } = await this.#db.rpc('ultima_actividad_paciente', { p_hc: hc });
    if (!error) return { data: data ?? [], error: null };
    if (!RPC_MISSING.has(error.code)) return { data: null, error };
    this.#warnMissingRpc('ultima_actividad_paciente');
    return { data: [], error: null };
  }

  async #summaryFallback(hc) {
    const countQuery = async (listKey, filter) => {
      let q = this.#db.from(TABLE_FOR_LIST[listKey]).select('id', { count: 'exact', head: true }).eq('HC', hc);
      q = filter?.(q) ?? q;
      const { count, error } = await q;
      if (error) throw new ApiError(error.message, error);
      return count ?? 0;
    };
    const [vitals, meds, medsActive, labs, consults, consultsOpen, cultures, culturesPending, tasks, tasksOpen] = await Promise.all([
      countQuery('vitals'), countQuery('medications'), countQuery('medications', q => q.eq('Activo', 'Sí')),
      countQuery('labs'), countQuery('consultations'), countQuery('consultations', q => q.is('Fecha_Respuesta', null)),
      countQuery('cultures'), countQuery('cultures', q => q.or('Resultado.is.null,Resultado.eq.Pendiente')),
      countQuery('tasks'), countQuery('tasks', q => q.eq('Estado', 'Pendiente'))
    ]);
    const latest = await this.#db.from(T.VITALS).select(SELECTS.vitals).eq('HC', hc).order('Fecha_Hora', { ascending: false }).limit(1).maybeSingle();
    if (latest.error) throw new ApiError(latest.error.message, latest.error);
    const labsRows = await this.#db.from(T.LABS).select('Tipo_Lab').eq('HC', hc).order('Fecha', { ascending: false }).limit(100);
    if (labsRows.error) throw new ApiError(labsRows.error.message, labsRows.error);
    return {
      counts: { vitals, medications: meds, labs, consultations: consults, cultures, tasks, activeMedications: medsActive, openTasks: tasksOpen, pendingCultures: culturesPending, unansweredConsultations: consultsOpen },
      labTypes: [...new Set((labsRows.data ?? []).map(r => r.Tipo_Lab).filter(Boolean))],
      latestVital: latest.data ?? null,
      activeMedications: [], openTasks: [], pendingCultures: [], unansweredConsultations: []
    };
  }

  async #fetchListPage(hc, listKey, page, pageSize) {
    const table = TABLE_FOR_LIST[listKey];
    const [orderColumn, ascending] = ORDER_FOR_LIST[listKey];
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let query = this.#db.from(table).select(SELECTS[listKey], { count: 'exact' }).eq('HC', hc).order(orderColumn, { ascending }).range(from, to);
    // The patient RLS policy already limits deleted patients; this explicit existence
    // check is intentionally kept in the database migration, not duplicated in every query.
    return query;
  }

  /* ---------------------------- Tiempo real ---------------------------- */

  subscribeToPatient(hc, onChange, onStatus) {
    const tables = [T.PATIENTS, T.VITALS, T.MEDS, T.LABS, T.CONSULTS, T.CULTURES, T.TASKS];
    let stopped = false;
    let channel = null;
    let retryTimer = null;
    let attempt = 0;

    const filterValue = quoteRealtimeValue(hc);
    const connect = () => {
      if (stopped) return;
      channel = this.#db.channel(`paciente-live-${stableChannelKey(hc)}`);
      for (const table of tables) {
        channel.on('postgres_changes', {
          event: '*', schema: 'public', table, filter: `HC=eq.${filterValue}`
        }, payload => onChange({ ...payload, table }));
      }
      channel.subscribe(status => {
        onStatus?.(status);
        if (status === 'SUBSCRIBED') {
          attempt = 0;
          return;
        }
        if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) && !stopped) scheduleReconnect();
      });
    };

    const scheduleReconnect = () => {
      if (retryTimer || stopped) return;
      const delay = Math.min(30_000, 1000 * (2 ** attempt) + Math.floor(Math.random() * 300));
      attempt += 1;
      retryTimer = globalThis.setTimeout(async () => {
        retryTimer = null;
        if (channel) await this.#db.removeChannel(channel);
        connect();
      }, delay);
    };

    connect();
    return async () => {
      stopped = true;
      if (retryTimer) globalThis.clearTimeout(retryTimer);
      retryTimer = null;
      if (channel) await this.#db.removeChannel(channel);
    };
  }

  /* ---------------------------- Escritura ---------------------------- */

  async createPatient(patient) {
    const { data, error } = await this.#db.from(T.PATIENTS).insert([patient.toInsertRow()]).select(PATIENT_SELECT).single();
    if (error) {
      throw new ApiError(
        error.code === '23505' ? 'Ya existe un paciente registrado con ese HC.' : 'No se pudo registrar el paciente: ' + error.message,
        error
      );
    }
    return new Patient(data);
  }

  async updatePatient(hc, patient, { expectedModificadoEn } = {}) {
    let q = this.#db.from(T.PATIENTS).update(patient.toUpdateRow()).eq('HC', hc);
    if (expectedModificadoEn) q = q.eq('Modificado_En', expectedModificadoEn);
    const { data, error } = await q.select(PATIENT_SELECT);
    if (error) throw new ApiError(error.message, error);
    if (expectedModificadoEn && (!data || data.length === 0)) {
      throw new ConflictError('Otra persona modificó este paciente mientras lo editabas. Recarga el expediente y vuelve a intentarlo para no perder su cambio.');
    }
    return data?.[0] ? new Patient(data[0]) : null;
  }

  deletePatient(hc) {
    return this.#run(this.#db.from(T.PATIENTS).update({ Eliminado_En: new Date().toISOString() }).eq('HC', hc).select(PATIENT_SELECT));
  }

  restorePatient(hc) {
    return this.#run(this.#db.from(T.PATIENTS).update({ Eliminado_En: null }).eq('HC', hc).select(PATIENT_SELECT));
  }

  addVitalSigns(v) { return this.#insert(T.VITALS, v, SELECTS.vitals, VitalSigns); }
  addMedication(m) { return this.#insert(T.MEDS, m, SELECTS.medications, Medication); }
  addLab(l) { return this.#insert(T.LABS, l, SELECTS.labs, LabResult); }
  addConsultation(c) { return this.#insert(T.CONSULTS, c, SELECTS.consultations, Consultation); }
  addCulture(c) { return this.#insert(T.CULTURES, c, SELECTS.cultures, Culture); }
  addTask(t) { return this.#insert(T.TASKS, t, SELECTS.tasks, PendingTask); }

  completeTask(id, expectedModificadoEn) {
    return this.#runWithConflictCheck(T.TASKS, id,
      { Estado: 'Realizado', Fecha_Completado: new Date().toISOString() }, expectedModificadoEn,
      'Otra persona ya actualizó este pendiente mientras tanto.', SELECTS.tasks, PendingTask);
  }

  uncompleteTask(id, expectedModificadoEn) {
    return this.#runWithConflictCheck(T.TASKS, id,
      { Estado: 'Pendiente', Fecha_Completado: null }, expectedModificadoEn,
      'Otra persona ya actualizó este pendiente mientras tanto.', SELECTS.tasks, PendingTask);
  }

  suspendMedication(id, expectedModificadoEn) {
    return this.#runWithConflictCheck(T.MEDS, id,
      { Activo: 'No', Fecha_Omision: todayISODate() }, expectedModificadoEn,
      'Otra persona ya actualizó este medicamento mientras tanto.', SELECTS.medications, Medication);
  }

  answerConsultation(id, respuesta, expectedModificadoEn) {
    return this.#runWithConflictCheck(T.CONSULTS, id,
      { Respuesta_Departamento: respuesta, Fecha_Respuesta: todayISODate() }, expectedModificadoEn,
      'Otra persona ya respondió o modificó esta interconsulta mientras tanto.', SELECTS.consultations, Consultation);
  }

  resolveCulture(id, resultado, observaciones, expectedModificadoEn) {
    const patch = { Resultado: resultado, Fecha_Resultado: todayISODate() };
    if (observaciones) patch.Observaciones_Microbiologia = observaciones;
    return this.#runWithConflictCheck(T.CULTURES, id, patch, expectedModificadoEn,
      'Otra persona ya registró un resultado para este cultivo mientras tanto.', SELECTS.cultures, Culture);
  }

  /* ---------------------------- Internos ---------------------------- */

  async #insert(table, entity, select, Model) {
    const { data, error } = await this.#db.from(table).insert([entity.toRow()]).select(select).single();
    if (error) throw new ApiError(error.message, error);
    return data ? new Model(data) : null;
  }

  async #run(query) {
    const { data, error } = await query;
    if (error) throw new ApiError(error.message, error);
    return data;
  }

  async #runWithConflictCheck(table, id, patch, expectedModificadoEn, conflictMessage, select, Model) {
    let q = this.#db.from(table).update(patch).eq('id', id);
    if (expectedModificadoEn) q = q.eq('Modificado_En', expectedModificadoEn);
    const { data, error } = await q.select(select);
    if (error) throw new ApiError(error.message, error);
    if (expectedModificadoEn && (!data || data.length === 0)) {
      throw new ConflictError(`${conflictMessage} Se recargó la información más reciente; revísala antes de intentar de nuevo.`);
    }
    return data?.[0] ? new Model(data[0]) : null;
  }
}

function pageModels(listKey, rows) {
  return rows.map(row => modelForList(listKey, row));
}

function normalizePageSize(value) {
  return Math.max(10, Math.min(Number(value) || DEFAULT_PAGE_SIZE, 100));
}

function quoteRealtimeValue(value) {
  const raw = String(value ?? '');
  return /[,()"\\\s]/.test(raw) ? `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : raw;
}

function stableChannelKey(value) {
  let hash = 2166136261;
  for (const char of String(value ?? '')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
