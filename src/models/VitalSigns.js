import { VITAL_RANGES, VITAL_LIMITS, VITAL_LABELS, VITAL_INPUT_KEYS } from '../utils/constants.js';
import { wallTimeToOffsetISO } from '../utils/formatters.js';
import { ValidationError } from '../utils/errors.js';

// KEYS = campos que se capturan en el formulario. PAM se calcula (ver #computePam) y
// NO se incluye aquí: si se incluyera, `validate()` la rechazaría por no tener un valor
// de formulario ni límites de captura propios (ver VITAL_INPUT_KEYS en constants.js).
const KEYS = VITAL_INPUT_KEYS;

/** Una toma de signos vitales, con detección de valores anormales y validación de captura. */
export class VitalSigns {
  constructor(row = {}) {
    this.id = row.id;
    this.HC = row.HC;
    this.Fecha_Hora = row.Fecha_Hora;
    for (const k of KEYS) this[k] = row[k] ?? null;
    // PAM: si la columna generada de la BD ya la trae (row.PAM), se respeta esa (fuente
    // única de verdad); si no existe todavía en el entorno, se calcula en el cliente
    // como espejo — mismo patrón defensivo que ya usa la app con RPCs faltantes.
    this.PAM = row.PAM !== undefined && row.PAM !== null
      ? Number(row.PAM)
      : VitalSigns.computePam(this.PA_Sistolica, this.PA_Diastolica);
  }

  /** PAM = diastólica + (sistólica − diastólica) / 3, redondeada a 1 decimal. */
  static computePam(sistolica, diastolica) {
    const s = Number(sistolica), d = Number(diastolica);
    if (!Number.isFinite(s) || !Number.isFinite(d)) return null;
    return Math.round((d + (s - d) / 3) * 10) / 10;
  }

  /** ¿Está el valor fuera del rango normal? Los valores vacíos no se marcan. */
  static isValueAbnormal(key, value) {
    const range = VITAL_RANGES[key];
    if (!range || value === '' || value === null || value === undefined) return false;
    return Number(value) < range[0] || Number(value) > range[1];
  }

  /** 'alto' | 'bajo' | null — para no depender solo del color al marcar valores anormales. */
  static abnormalDirection(key, value) {
    const range = VITAL_RANGES[key];
    if (!range || !VitalSigns.isValueAbnormal(key, value)) return null;
    return Number(value) > range[1] ? 'alto' : 'bajo';
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
