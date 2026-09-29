import { PROLONGED_TREATMENT_DAYS } from '../utils/constants.js';
import { calendarDateOf, calendarDaysDiff, todayISODate } from '../utils/formatters.js';
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
    const elapsedDays = calendarDaysDiff(start, end);
    return elapsedDays === null || elapsedDays < 0 ? 0 : elapsedDays + 1;
  }

  isProlonged(today) {
    return this.isActive && this.isTracked && this.treatmentDays(today) >= PROLONGED_TREATMENT_DAYS;
  }

  /** Marca de "requiere seguimiento de días de cobertura" (típicamente antibióticos). */
  get isTracked() {
    return this.Requiere_Seguimiento_Dias === true || this.Requiere_Seguimiento_Dias === 'true';
  }

  /**
   * Frase de resumen para medicamentos con seguimiento de cobertura, ej.:
   * "Cefepime 2g cada 8 horas, cumpliendo hoy su día 4 de cobertura."
   * `Frecuencia_Horas` es opcional: si no se capturó, se usa `Dosis_Frecuencia` tal
   * cual (sin intentar extraer un número de un texto libre).
   */
  coverageText(today = todayISODate()) {
    const days = this.treatmentDays(today);
    const dayPhrase = days === 1
      ? 'cumpliendo hoy su primer día de cobertura'
      : days > 1 ? `cumpliendo hoy su día ${days} de cobertura` : 'sin días de cobertura cumplidos';
    const horas = Number(this.Frecuencia_Horas);
    const freqSuffix = Number.isFinite(horas) && horas > 0 ? ` cada ${horas} horas` : '';
    return `${this.Nombre_Medicamento} ${this.Dosis_Frecuencia}${freqSuffix}, ${dayPhrase}`;
  }

  static fromForm(form, hc) {
    const nombre = String(form.Nombre_Medicamento ?? '').trim();
    const dosis = String(form.Dosis_Frecuencia ?? '').trim();
    if (!nombre) throw new ValidationError('El nombre del medicamento es obligatorio.');
    if (!dosis) throw new ValidationError('La dosis y frecuencia son obligatorias.');
    if (!form.Fecha_Inicio) throw new ValidationError('La fecha de inicio es obligatoria.');
    const horasRaw = String(form.Frecuencia_Horas ?? '').trim();
    return new Medication({
      HC: hc,
      Nombre_Medicamento: nombre,
      Dosis_Frecuencia: dosis,
      Fecha_Inicio: form.Fecha_Inicio,
      Activo: form.Activo === 'No' ? 'No' : 'Sí',
      Requiere_Seguimiento_Dias: form.Requiere_Seguimiento_Dias === 'on' || form.Requiere_Seguimiento_Dias === true,
      Frecuencia_Horas: horasRaw === '' ? null : Number(horasRaw)
    });
  }

  toRow() {
    return { ...this };
  }
}
