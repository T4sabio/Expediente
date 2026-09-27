/** Expediente completo de un paciente: datos generales + todas sus listas clínicas. */
export class PatientRecord {
  constructor({ patient, vitals = [], medications = [], labs = [], consultations = [], cultures = [], tasks = [] }) {
    this.patient = patient;
    this.vitals = vitals; // orden cronológico ascendente
    this.medications = medications;
    this.labs = labs;
    this.consultations = consultations;
    this.cultures = cultures;
    this.tasks = tasks;
  }

  get latestVitals() {
    return this.vitals.at(-1) ?? null;
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
    return [...new Set(this.labs.map(l => l.Tipo_Lab))];
  }

  /**
   * Copia superficial del expediente con un elemento de una lista (medicamentos,
   * pendientes, etc.) parchado por id. Se usa para actualizaciones optimistas de UI:
   * la pantalla refleja el cambio antes de que el servidor confirme, y se revierte
   * si la petición falla.
   */
  withPatchedItem(listKey, id, patch) {
    const list = this[listKey].map(item =>
      item.id === id ? Object.assign(Object.create(Object.getPrototypeOf(item)), item, patch) : item);
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { [listKey]: list });
  }
}
