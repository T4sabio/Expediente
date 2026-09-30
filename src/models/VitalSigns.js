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
    this.Oxigeno_Suplementario = row.Oxigeno_Suplementario ?? null;
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

  static rangeFor(key, { age, hasCOPD = false } = {}) {
    let ageYears = Number(age?.valor);
    if (!Number.isFinite(ageYears)) ageYears = null;
    else if (age.unidad === 'meses') ageYears /= 12;
    else if (age.unidad === 'semanas') ageYears /= 52;

    if (ageYears !== null && ageYears < 18) {
      if (['PA_Sistolica', 'PA_Diastolica', 'PAM'].includes(key)) return null;
      if (key === 'Frecuencia_Cardiaca') {
        if (ageYears < 1) return [100, 160];
        if (ageYears < 3) return [90, 150];
        if (ageYears < 6) return [80, 140];
        if (ageYears < 13) return [70, 120];
      }
      if (key === 'Frecuencia_Respiratoria') {
        if (ageYears < 1) return [30, 60];
        if (ageYears < 3) return [22, 40];
        if (ageYears < 6) return [20, 34];
        if (ageYears < 13) return [18, 30];
      }
    }

    const range = VITAL_RANGES[key];
    if (key === 'SpO2' && hasCOPD === true) return [88, 100];
    return range;
  }

  /** ¿Está el valor fuera del rango normal? Los valores vacíos no se marcan. */
  static isValueAbnormal(key, value, context) {
    const range = VitalSigns.rangeFor(key, context);
    if (!range || value === '' || value === null || value === undefined) return false;
    return Number(value) < range[0] || Number(value) > range[1];
  }

  /** 'alto' | 'bajo' | null — para no depender solo del color al marcar valores anormales. */
  static abnormalDirection(key, value, context) {
    const range = VitalSigns.rangeFor(key, context);
    if (!range || !VitalSigns.isValueAbnormal(key, value, context)) return null;
    return Number(value) > range[1] ? 'alto' : 'bajo';
  }

  isAbnormal(key, context) {
    return VitalSigns.isValueAbnormal(key, this[key], context);
  }

  /** @param {Record<string,string>} form campos crudos; Fecha_Hora viene en hora local sin zona. */
  static fromForm(form, hc) {
    const fecha = wallTimeToOffsetISO(form.Fecha_Hora);
    if (!fecha) throw new ValidationError('La fecha y hora no es válida.');
    if (Date.parse(fecha) > Date.now() + 60_000) throw new ValidationError('La fecha y hora no puede estar en el futuro.');
    const row = { HC: hc, Fecha_Hora: fecha };
    for (const k of KEYS) row[k] = form[k] === '' || form[k] == null ? null : Number(form[k]);
    row.Oxigeno_Suplementario = form.Oxigeno_Suplementario === 'Sí' || form.Oxigeno_Suplementario === true
      ? true
      : form.Oxigeno_Suplementario === 'No' || form.Oxigeno_Suplementario === false ? false : null;
    return new VitalSigns(row).validate();
  }

  /** Rechaza valores imposibles (errores de digitación), no valores simplemente anormales. */
  validate() {
    if (KEYS.every(k => this[k] === null || this[k] === undefined)) {
      throw new ValidationError('Captura al menos un signo vital.');
    }
    for (const k of KEYS) {
      if (this[k] === null || this[k] === undefined) continue;
      const [min, max] = VITAL_LIMITS[k];
      const v = this[k];
      if (!Number.isFinite(v) || v < min || v > max || (k !== 'Temperatura' && !Number.isInteger(v))) {
        throw new ValidationError(`${VITAL_LABELS[k]}: el valor debe estar entre ${min} y ${max}.`);
      }
    }
    if (this.PA_Sistolica != null && this.PA_Diastolica != null && this.PA_Sistolica <= this.PA_Diastolica) {
      throw new ValidationError('La PA sistólica debe ser mayor que la diastólica.');
    }
    return this;
  }

  toRow() {
    const row = { HC: this.HC, Fecha_Hora: this.Fecha_Hora, Oxigeno_Suplementario: this.Oxigeno_Suplementario };
    for (const k of KEYS) row[k] = this[k];
    return row;
  }
}
