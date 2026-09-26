import { PROLONGED_TREATMENT_DAYS } from '../utils/constants.js';
import { calendarDateOf, daysBetween, todayISODate } from '../utils/formatters.js';
import { ValidationError } from '../utils/errors.js';

export class Medication {
  constructor(row = {}) {
    Object.assign(this, row);
  }

  get isActive() {
    return this.Activo === 'Sí';
  }

  /**
   * Días de tratamiento: desde el inicio hasta la fecha de omisión (o hoy, en Guatemala, si sigue activo).
   * Si no hay fecha de inicio válida se usa el valor almacenado `Dias_Tratamiento`.
   */
  treatmentDays(today = todayISODate()) {
    const start = calendarDateOf(this.Fecha_Inicio);
    if (!start) return Number(this.Dias_Tratamiento) || 0;
    const end = this.Fecha_Omision ? calendarDateOf(this.Fecha_Omision) : today;
    return daysBetween(start, end) ?? 0;
  }

  isProlonged(today) {
    return this.isActive && this.treatmentDays(today) >= PROLONGED_TREATMENT_DAYS;
  }

  static fromForm(form, hc) {
    const nombre = String(form.Nombre_Medicamento ?? '').trim();
    const dosis = String(form.Dosis_Frecuencia ?? '').trim();
    if (!nombre) throw new ValidationError('El nombre del medicamento es obligatorio.');
    if (!dosis) throw new ValidationError('La dosis y frecuencia son obligatorias.');
    if (!form.Fecha_Inicio) throw new ValidationError('La fecha de inicio es obligatoria.');
    return new Medication({
      HC: hc,
      Nombre_Medicamento: nombre,
      Dosis_Frecuencia: dosis,
      Fecha_Inicio: form.Fecha_Inicio,
      Activo: form.Activo === 'No' ? 'No' : 'Sí'
    });
  }

  toRow() {
    return { ...this };
  }
}
