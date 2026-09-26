import { formatEdad, parseEdad } from '../utils/formatters.js';
import { ValidationError } from '../utils/errors.js';

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
      Motivo_Consulta: t(form.Motivo_Consulta),
      Diagnosticos: String(form.Diagnosticos ?? '').trimEnd()
    });
  }

  /** @param {{requireHC?: boolean}} opts La HC no viaja en el formulario de edición. */
  validate({ requireHC = true } = {}) {
    if (requireHC && !this.HC) throw new ValidationError('La historia clínica (HC) es obligatoria.');
    if (!this.Nombre_Completo) throw new ValidationError('El nombre completo es obligatorio.');
    if (!this.Servicio) throw new ValidationError('El servicio es obligatorio.');
    return this;
  }

  toInsertRow() {
    return { ...this };
  }

  /** La HC es la clave primaria: no se actualiza. */
  toUpdateRow() {
    const { HC, ...rest } = this;
    return rest;
  }
}
