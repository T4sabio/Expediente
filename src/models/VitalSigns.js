import { VITAL_RANGES, VITAL_LIMITS, VITAL_LABELS } from '../utils/constants.js';
import { wallTimeToOffsetISO } from '../utils/formatters.js';
import { ValidationError } from '../utils/errors.js';

const KEYS = Object.keys(VITAL_RANGES);

/** Una toma de signos vitales, con detección de valores anormales y validación de captura. */
export class VitalSigns {
  constructor(row = {}) {
    this.id = row.id;
    this.HC = row.HC;
    this.Fecha_Hora = row.Fecha_Hora;
    for (const k of KEYS) this[k] = row[k] ?? null;
  }

  /** ¿Está el valor fuera del rango normal? Los valores vacíos no se marcan. */
  static isValueAbnormal(key, value) {
    const range = VITAL_RANGES[key];
    if (!range || value === '' || value === null || value === undefined) return false;
    return Number(value) < range[0] || Number(value) > range[1];
  }

  isAbnormal(key) {
    return VitalSigns.isValueAbnormal(key, this[key]);
  }

  /** @param {Record<string,string>} form campos crudos; Fecha_Hora viene en hora local sin zona. */
  static fromForm(form, hc) {
    const fecha = wallTimeToOffsetISO(form.Fecha_Hora);
    if (!fecha) throw new ValidationError('La fecha y hora no es válida.');
    const row = { HC: hc, Fecha_Hora: fecha };
    for (const k of KEYS) row[k] = form[k] === '' || form[k] == null ? null : Number(form[k]);
    return new VitalSigns(row).validate();
  }

  /** Rechaza valores imposibles (errores de digitación), no valores simplemente anormales. */
  validate() {
    for (const k of KEYS) {
      const [min, max] = VITAL_LIMITS[k];
      const v = this[k];
      if (!Number.isFinite(v) || v < min || v > max) {
        throw new ValidationError(`${VITAL_LABELS[k]}: el valor debe estar entre ${min} y ${max}.`);
      }
    }
    if (this.PA_Sistolica <= this.PA_Diastolica) {
      throw new ValidationError('La PA sistólica debe ser mayor que la diastólica.');
    }
    return this;
  }

  toRow() {
    const row = { HC: this.HC, Fecha_Hora: this.Fecha_Hora };
    for (const k of KEYS) row[k] = this[k];
    return row;
  }
}
