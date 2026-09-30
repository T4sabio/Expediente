import { Patient } from './Patient.js';
import { VitalSigns } from './VitalSigns.js';
import { Medication } from './Medication.js';
import { LabResult, Consultation, Culture, PendingTask } from './ClinicalRecords.js';

const TABLE_TO_LIST = Object.freeze({
  DB_SignosVitales: 'vitals',
  DB_Medicamentos: 'medications',
  DB_Laboratorios: 'labs',
  DB_Consultas: 'consultations',
  DB_Cultivos: 'cultures',
  DB_Pendientes: 'tasks'
});

const LIST_TO_MODEL = Object.freeze({
  vitals: VitalSigns,
  medications: Medication,
  labs: LabResult,
  consultations: Consultation,
  cultures: Culture,
  tasks: PendingTask
});

const SORT_KEYS = Object.freeze({
  vitals: 'Fecha_Hora',
  medications: 'Fecha_Inicio',
  labs: 'Fecha',
  consultations: 'Fecha_Envio',
  cultures: 'Fecha_Envio',
  tasks: 'Fecha_Solicitud'
});

export class PatientRecord {
  constructor({ patient, vitals = [], medications = [], suspendedMedications = [], labs = [], labHistory = labs, consultations = [], cultures = [], tasks = [], summary = null, pagination = {}, timeline = [] }) {
    this.patient = patient;
    this.vitals = vitals;
    this.medications = medications;
    this.suspendedMedications = suspendedMedications;
    this.labs = labs;
    this.labHistory = labHistory;
    this.consultations = consultations;
    this.cultures = cultures;
    this.tasks = tasks;
    this.summary = summary ? normalizeSummary(summary) : null;
    this.pagination = { ...pagination };
    this.timeline = Array.isArray(timeline) ? timeline : [];
  }

  get latestVitals() {
    return this.summary?.latestVital ?? this.vitals.at(-1) ?? this.vitals[0] ?? null;
  }

  get activeMedications() {
    return this.medications.filter(m => m.isActive);
  }

  get openTasks() {
    return this.tasks.filter(t => !t.isDone);
  }

  get pendingCultures() {
    return this.cultures.filter(c => c.isPending);
  }

  get unansweredConsultations() {
    return this.consultations.filter(c => !c.isAnswered);
  }

  get labTypes() {
    return this.summary?.labTypes?.length
      ? this.summary.labTypes
      : [...new Set(this.labs.map(l => l.Tipo_Lab).filter(Boolean))];
  }

  count(listKey) {
    const total = this.summary?.counts?.[listKey];
    return Number.isFinite(total) ? total : (this[listKey]?.length ?? 0);
  }

  withSummary(summary) {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, {
      summary: normalizeSummary(summary)
    });
  }

  withTimeline(timeline) {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { timeline: Array.isArray(timeline) ? timeline : [] });
  }

  withListPage(listKey, items, pagination) {
    if (!Object.hasOwn(this, listKey)) throw new Error(`Lista de expediente desconocida: ${listKey}`);
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, {
      [listKey]: items,
      pagination: { ...this.pagination, [listKey]: pagination }
    });
  }


  withUpsertedItem(listKey, item, { pageSize = 25 } = {}) {
    if (!Object.hasOwn(this, listKey) || !item) return this;
    const list = this[listKey] ?? [];
    const id = Number(item.id);
    const Model = LIST_TO_MODEL[listKey];
    if (!Model) return this;
    const model = item instanceof Model ? item : new Model(item);
    const existing = list.findIndex(row => Number(row.id) === id);
    const meta = this.pagination[listKey];
    const wasNew = existing < 0;
    const page = Number(meta?.page) || 1;
    const size = Math.max(1, Number(meta?.pageSize) || Number(pageSize) || 25);
    const shouldPatchVisiblePage = page === 1 || existing >= 0;
    const next = shouldPatchVisiblePage
      ? (existing >= 0 ? list.map((row, index) => index === existing ? model : row) : [model, ...list])
      : list;
    const sorted = shouldPatchVisiblePage
      ? sortPage(listKey, next).slice(0, size)
      : list;
    const updatedMeta = meta && wasNew
      ? { ...meta, total: Number(meta.total ?? 0) + 1, totalPages: Math.max(1, Math.ceil((Number(meta.total ?? 0) + 1) / size)) }
      : meta;
    const nextLabHistory = listKey === 'labs'
      ? sortPage('labs', upsertById(this.labHistory ?? [], model))
      : this.labHistory;
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, {
      [listKey]: shouldPatchVisiblePage ? (listKey === 'vitals' ? sorted.slice().reverse() : sorted) : list,
      ...(listKey === 'labs' ? { labHistory: nextLabHistory } : {}),
      pagination: meta ? { ...this.pagination, [listKey]: updatedMeta } : this.pagination
    });
  }

  /**
   * Parchea un registro visible tras un evento Realtime sin recargar las siete tablas.
   * Devuelve el mismo expediente si el evento no aporta una fila utilizable.
   */
  withRealtimeEvent(table, event, pageSize = 25) {
    if (table === 'DB_Pacientes') {
      if (event.eventType === 'DELETE' || event.new?.Eliminado_En) return null;
      if (!event.new) return this;
      return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { patient: new Patient(event.new) });
    }

    const listKey = TABLE_TO_LIST[table];
    if (!listKey) return this;
    const Model = LIST_TO_MODEL[listKey];
    const current = this[listKey] ?? [];
    const eventRow = event.eventType === 'DELETE' ? event.old : event.new;
    const id = eventRow?.id == null ? null : Number(eventRow.id);
    if (id == null || !Model) return this;

    const pageMeta = this.pagination[listKey];
    const currentPage = Number(pageMeta?.page) || 1;
    const visible = current.some(item => Number(item.id) === id);
    let next = current;
    if (event.eventType === 'INSERT') {
      // Una inserción nueva solo pertenece a la página visible si estamos en la primera.
      // En páginas posteriores actualizamos el total, pero no desplazamos filas de la página.
      if (!visible && currentPage === 1) next = [...current, new Model(event.new)];
    } else if (event.eventType === 'UPDATE') {
      next = visible ? current.map(item => Number(item.id) === id ? new Model(event.new) : item) : current;
    } else if (event.eventType === 'DELETE') {
      next = visible ? current.filter(item => Number(item.id) !== id) : current;
    }

    const delta = event.eventType === 'INSERT' && !visible ? 1 : event.eventType === 'DELETE' ? -1 : 0;
    const updatedMeta = pageMeta
      ? { ...pageMeta, total: Math.max(0, Number(pageMeta.total ?? 0) + delta), totalPages: Math.max(1, Math.ceil(Math.max(0, Number(pageMeta.total ?? 0) + delta) / Number(pageMeta.pageSize || pageSize))) }
      : pageMeta;
    const nextLabHistory = listKey === 'labs'
      ? event.eventType === 'DELETE'
        ? (this.labHistory ?? []).filter(row => Number(row.id) !== id)
        : sortPage('labs', upsertById(this.labHistory ?? [], new Model(event.new)))
      : this.labHistory;
    const listChanged = next !== current;
    const metaChanged = updatedMeta !== pageMeta;
    const historyChanged = listKey === 'labs' && nextLabHistory !== this.labHistory;
    if (!listChanged && !metaChanged && !historyChanged) return this;
    if (listChanged) next = sortPage(listKey, next).slice(0, Number(pageMeta?.pageSize || pageSize));
    if (listKey === 'vitals' && listChanged) next = next.slice().reverse();
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, {
      [listKey]: next,
      ...(listKey === 'labs' ? { labHistory: nextLabHistory } : {}),
      pagination: pageMeta ? { ...this.pagination, [listKey]: updatedMeta } : this.pagination
    });
  }

  /**
   * Copia superficial del expediente con un elemento parchado por id. Se usa para
   * actualizaciones optimistas y conserva la instancia de los demás elementos.
   */
  withPatchedItem(listKey, id, patch) {
    if (listKey === 'medications' && Object.hasOwn(patch, 'Activo')) {
      const source = this.medications.find(item => Number(item.id) === Number(id))
        ?? this.suspendedMedications.find(item => Number(item.id) === Number(id));
      if (!source) return this;
      const patched = Object.assign(Object.create(Object.getPrototypeOf(source)), source, patch);
      const active = patched.isActive;
      const medications = [...this.medications.filter(item => Number(item.id) !== Number(id)), ...(active ? [patched] : [])];
      const suspendedMedications = [...this.suspendedMedications.filter(item => Number(item.id) !== Number(id)), ...(!active ? [patched] : [])];
      const pagination = { ...this.pagination };
      for (const [key, belongs] of [['medications', active], ['suspendedMedications', !active]]) {
        const meta = pagination[key];
        if (meta) pagination[key] = {
          ...meta,
          total: Math.max(0, Number(meta.total ?? 0) + (belongs ? 1 : -1)),
          totalPages: Math.max(1, Math.ceil(Math.max(0, Number(meta.total ?? 0) + (belongs ? 1 : -1)) / Number(meta.pageSize || 25)))
        };
      }
      return Object.assign(Object.create(Object.getPrototypeOf(this)), this, {
        medications, suspendedMedications, pagination
      });
    }
    const list = this[listKey].map(item =>
      Number(item.id) === Number(id)
        ? Object.assign(Object.create(Object.getPrototypeOf(item)), item, patch)
        : item);
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { [listKey]: list });
  }
}

export function modelForList(listKey, row) {
  const Model = LIST_TO_MODEL[listKey];
  return Model ? new Model(row) : null;
}

export function listKeyForTable(table) {
  return TABLE_TO_LIST[table] ?? null;
}

function sortPage(listKey, rows) {
  const key = SORT_KEYS[listKey];
  if (!key) return rows;
  return rows.slice().sort((a, b) => String(b[key] ?? '').localeCompare(String(a[key] ?? '')) || Number(b.id ?? 0) - Number(a.id ?? 0));
}

function upsertById(rows, item) {
  const index = rows.findIndex(row => Number(row.id) === Number(item.id));
  return index < 0 ? [...rows, item] : rows.map((row, i) => i === index ? item : row);
}

function normalizeSummary(input = {}) {
  return {
    counts: { ...(input.counts ?? {}) },
    labTypes: Array.isArray(input.labTypes) ? input.labTypes.filter(Boolean) : [],
    latestVital: input.latestVital
      ? (input.latestVital instanceof VitalSigns ? input.latestVital : new VitalSigns(input.latestVital))
      : null,
    activeMedications: (input.activeMedications ?? []).map(r => r instanceof Medication ? r : new Medication(r)),
    trackedMedications: (input.trackedMedications ?? []).map(r => r instanceof Medication ? r : new Medication(r)),
    openTasks: (input.openTasks ?? []).map(r => r instanceof PendingTask ? r : new PendingTask(r)),
    overdueTasks: (input.overdueTasks ?? []).map(r => r instanceof PendingTask ? r : new PendingTask(r)),
    pendingCultures: (input.pendingCultures ?? []).map(r => r instanceof Culture ? r : new Culture(r)),
    periodicCultures: (input.periodicCultures ?? []).map(r => r instanceof Culture ? r : new Culture(r)),
    unansweredConsultations: (input.unansweredConsultations ?? []).map(r => r instanceof Consultation ? r : new Consultation(r)),
    lastActivity: input.lastActivity ? { ...input.lastActivity } : null
  };
}
