import { formatEdad, parseEdad, normalizeMultiline } from '../utils/formatters.js';
import { ValidationError } from '../utils/errors.js';
import { FIELD_LIMITS } from '../utils/constants.js';

/** Datos demográficos y clínicos generales de un paciente. */
export class Patient {
  constructor(row = {}) {
    this.HC = row.HC ?? '';
    this.Nombre_Completo = row.Nombre_Completo ?? '';
    this.Servicio = row.Servicio ?? '';
    this.Cama = row.Cama ?? '';
    this.Edad = row.Edad ?? '';
    this.Fecha_Ingreso = row.Fecha_Ingreso ?? '';
    this.Num_RayosX = row.Num_RayosX ?? '';
    this.Motivo_Consulta = row.Motivo_Consulta ?? '';
    this.Diagnosticos = row.Diagnosticos ?? '';
    this.Tiene_EPOC = row.Tiene_EPOC === true;
    this.Estado_Episodio = row.Estado_Episodio ?? 'Hospitalizado';
    this.Fecha_Egreso = row.Fecha_Egreso ?? '';
    this.Umbral_Signos_Horas = Number(row.Umbral_Signos_Horas) || 24;
    // Sello de la última modificación (llenado por el servidor); se usa para detectar
    // ediciones concurrentes, nunca se envía de vuelta al servidor (ver toUpdateRow()).
    this.Modificado_En = row.Modificado_En ?? null;
  }

  /** { valor, unidad } a partir del texto "3 meses". */
  age(fallbackUnit) {
    return parseEdad(this.Edad, fallbackUnit);
  }

  /** Construye el paciente desde los campos crudos del formulario (incluye Edad_Unidad). */
  static fromForm(form) {
    const t = v => String(v ?? '').trim();
    return new Patient({
      HC: t(form.HC),
      Nombre_Completo: t(form.Nombre_Completo),
      Servicio: t(form.Servicio),
      Cama: t(form.Cama),
      Edad: formatEdad(form.Edad, form.Edad_Unidad || 'años'),
      Fecha_Ingreso: form.Fecha_Ingreso ?? '',
      Num_RayosX: t(form.Num_RayosX),
      Motivo_Consulta: normalizeMultiline(form.Motivo_Consulta),
      Diagnosticos: normalizeMultiline(form.Diagnosticos),
      Tiene_EPOC: form.Tiene_EPOC === 'on' || form.Tiene_EPOC === true,
      Estado_Episodio: form.Estado_Episodio || 'Hospitalizado',
      Fecha_Egreso: form.Fecha_Egreso || null,
      Umbral_Signos_Horas: Number(form.Umbral_Signos_Horas) || 24
    });
  }

  /** @param {{requireHC?: boolean}} opts La HC no viaja en el formulario de edición. */
  validate({ requireHC = true } = {}) {
    if (requireHC && !this.HC) throw new ValidationError('La historia clínica (HC) es obligatoria.');
    if (!this.Nombre_Completo) throw new ValidationError('El nombre completo es obligatorio.');
    if (!this.Servicio) throw new ValidationError('El servicio es obligatorio.');
    if (!['Hospitalizado', 'Trasladado', 'Alta', 'Defunción'].includes(this.Estado_Episodio)) {
      throw new ValidationError('El estado del episodio no es válido.');
    }
    if (this.Estado_Episodio !== 'Hospitalizado' && !this.Fecha_Egreso) {
      throw new ValidationError('La fecha de egreso o traslado es obligatoria.');
    }
    if (!Number.isInteger(this.Umbral_Signos_Horas) || this.Umbral_Signos_Horas < 1 || this.Umbral_Signos_Horas > 720) {
      throw new ValidationError('El umbral de signos debe estar entre 1 y 720 horas.');
    }
    for (const [field, max] of Object.entries(FIELD_LIMITS)) {
      const len = String(this[field] ?? '').length;
      if (len > max) {
        throw new ValidationError(`${field.replace(/_/g, ' ')}: máximo ${max} caracteres (tiene ${len}).`);
      }
    }
    return this;
  }

  toInsertRow() {
    return { ...this };
  }

  /** La HC es la clave primaria: no se actualiza. Modificado_En lo pone el servidor. */
  toUpdateRow() {
    const { HC, Modificado_En, ...rest } = this;
    return rest;
  }
}
