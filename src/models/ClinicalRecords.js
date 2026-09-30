import { blankToNull, daysBetween, isHttpUrl, todayISODate, calendarDaysDiff, calendarDateOf, wallTimeToOffsetISO } from '../utils/formatters.js';
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

  get isPeriodic() {
    return (this.Es_Periodico === true || this.Es_Periodico === 'true') && Number(this.Intervalo_Horas) > 0;
  }

  static fromForm(form, hc) {
    const sentAtInput = String(form.Fecha_Envio_Hora ?? '').trim();
    const sentAt = sentAtInput ? wallTimeToOffsetISO(sentAtInput) : null;
    const sentDate = sentAtInput ? sentAtInput.slice(0, 10) : form.Fecha_Envio;
    if (!sentDate || (sentAtInput && !sentAt)) throw new ValidationError('La fecha y hora de envío no es válida.');
    if (sentAt && Date.parse(sentAt) > Date.now() + 60_000) throw new ValidationError('La fecha y hora de envío no puede estar en el futuro.');
    const periodico = form.Es_Periodico === 'on' || form.Es_Periodico === true;
    const intervalo = String(form.Intervalo_Horas ?? '').trim();
    const intervaloHoras = intervalo === '' ? null : Number(intervalo);
    if (periodico && (!Number.isInteger(intervaloHoras) || intervaloHoras < 1 || intervaloHoras > 32767)) {
      throw new ValidationError('El intervalo debe ser un número entero de horas mayor que cero.');
    }
    return new Culture({
      HC: hc,
      Tipo_Cultivo: required(form.Tipo_Cultivo, 'El tipo de cultivo es obligatorio.'),
      Fecha_Envio: sentDate,
      Fecha_Envio_Hora: sentAt,
      Es_Periodico: periodico,
      Intervalo_Horas: periodico ? intervaloHoras : null
    });
  }

  /**
   * Agrupa los cultivos periódicos de un paciente por Tipo_Cultivo (ej. "Hemocultivo")
   * y calcula, para el más reciente de cada tipo, cuándo corresponde el próximo.
   * Cada fila real sigue siendo una toma independiente; esto es solo metadato de
   * "cómo se agendó", no un cultivo recurrente virtual.
   */
  static periodicStatuses(cultures, today = todayISODate(), now = new Date()) {
    const byType = new Map();
    for (const c of cultures) {
      if (!c.isPeriodic) continue;
      if (!byType.has(c.Tipo_Cultivo)) byType.set(c.Tipo_Cultivo, []);
      byType.get(c.Tipo_Cultivo).push(c);
    }
    const out = [];
    for (const [tipo, list] of byType) {
      const last = list.slice().sort((a, b) => cultureSentTime(b) - cultureSentTime(a))[0];
      const precise = Boolean(last.Fecha_Envio_Hora);
      const lastTime = cultureSentTime(last);
      const nextTime = lastTime + Number(last.Intervalo_Horas) * 60 * 60 * 1000;
      const nextDate = calendarDateOf(new Date(nextTime));
      const overdue = precise
        ? nextTime <= now.getTime()
        : calendarDaysDiff(today, nextDate) !== null && calendarDaysDiff(today, nextDate) < 0;
      out.push({ tipo, lastId: last.id, lastDate: last.Fecha_Envio_Hora || last.Fecha_Envio, nextDate, nextTime, overdue });
    }
    return out;
  }
}

function cultureSentTime(culture) {
  if (culture.Fecha_Envio_Hora) return Date.parse(culture.Fecha_Envio_Hora);
  return Date.parse(`${culture.Fecha_Envio}T12:00:00-06:00`);
}

export class PendingTask extends BaseRecord {
  get isDone() {
    return this.Estado === 'Realizado';
  }

  /** Día para el que "vive" el pendiente: si no se programó, se trata como si fuera para hoy. */
  scheduledDay(today = todayISODate()) {
    return this.Fecha_Programada || calendarDateOf(this.Fecha_Solicitud) || today;
  }

  isOverdue(today = todayISODate()) {
    if (this.isDone) return false;
    const diff = calendarDaysDiff(today, this.scheduledDay(today));
    return diff !== null && diff < 0;
  }

  isForToday(today = todayISODate()) {
    if (this.isDone) return false;
    const diff = calendarDaysDiff(today, this.scheduledDay(today));
    return diff === 0;
  }

  isFuture(today = todayISODate()) {
    if (this.isDone) return false;
    const diff = calendarDaysDiff(today, this.scheduledDay(today));
    return diff !== null && diff > 0;
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
