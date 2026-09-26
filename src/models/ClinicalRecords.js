import { blankToNull, daysBetween, isHttpUrl, todayISODate } from '../utils/formatters.js';
import { ValidationError } from '../utils/errors.js';

const required = (value, message) => {
  const t = String(value ?? '').trim();
  if (!t) throw new ValidationError(message);
  return t;
};

class BaseRecord {
  constructor(row = {}) {
    Object.assign(this, row);
  }
  toRow() {
    return { ...this };
  }
}

export class LabResult extends BaseRecord {
  get hasNumericValue() {
    const v = this.Valor_Numerico;
    return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  }

  static fromForm(form, hc) {
    const raw = String(form.Valor_Numerico ?? '').trim();
    const value = raw === '' ? null : Number(raw);
    if (value !== null && !Number.isFinite(value)) throw new ValidationError('El valor numérico no es válido.');
    const link = blankToNull(form.Enlace_PDF_Hospital);
    if (link && !isHttpUrl(link)) throw new ValidationError('El enlace debe comenzar con http:// o https://');
    if (!form.Fecha) throw new ValidationError('La fecha es obligatoria.');
    return new LabResult({
      HC: hc,
      Fecha: form.Fecha,
      Tipo_Lab: required(form.Tipo_Lab, 'El tipo de laboratorio es obligatorio.'),
      Valor_Numerico: value,
      Resultado_Texto: blankToNull(form.Resultado_Texto),
      Enlace_PDF_Hospital: link
    });
  }
}

export class Consultation extends BaseRecord {
  get isAnswered() {
    return Boolean(this.Fecha_Respuesta);
  }

  static fromForm(form, hc) {
    if (!form.Fecha_Envio) throw new ValidationError('La fecha de envío es obligatoria.');
    return new Consultation({
      HC: hc,
      Departamento_Consultado: required(form.Departamento_Consultado, 'El departamento es obligatorio.'),
      Fecha_Envio: form.Fecha_Envio
    });
  }
}

export class Culture extends BaseRecord {
  get isPending() {
    return !this.Resultado || this.Resultado === 'Pendiente';
  }

  /** Días desde el envío hasta el resultado (o hasta hoy si sigue pendiente). */
  elapsedDays(today = todayISODate()) {
    return daysBetween(this.Fecha_Envio, this.Fecha_Resultado || today);
  }

  static fromForm(form, hc) {
    if (!form.Fecha_Envio) throw new ValidationError('La fecha de envío es obligatoria.');
    return new Culture({
      HC: hc,
      Tipo_Cultivo: required(form.Tipo_Cultivo, 'El tipo de cultivo es obligatorio.'),
      Fecha_Envio: form.Fecha_Envio
    });
  }
}

export class PendingTask extends BaseRecord {
  get isDone() {
    return this.Estado === 'Realizado';
  }

  static fromForm(form, hc) {
    return new PendingTask({
      HC: hc,
      Descripcion_Tarea: required(form.Descripcion_Tarea, 'La descripción de la tarea es obligatoria.'),
      Fecha_Programada: blankToNull(form.Fecha_Programada),
      Justificacion_Observaciones: blankToNull(form.Justificacion_Observaciones)
    });
  }
}
