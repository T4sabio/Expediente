import { APP_LOCALE, APP_TIMEZONE, DEFAULT_AGE_UNIT } from './constants.js';

/* ------------------------------------------------------------------
   Reglas de fechas (zona horaria de Guatemala)
   - "Fecha calendario" (YYYY-MM-DD): se trata como día, NUNCA como instante.
     `new Date('2026-09-24')` es medianoche UTC y en Guatemala se vería como el día 23.
   - "Instante" (ISO con hora): se convierte siempre a la zona APP_TIMEZONE.
   ------------------------------------------------------------------ */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DAY_MS = 86_400_000;

const F = {
  date: new Intl.DateTimeFormat(APP_LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: APP_TIMEZONE }),
  calendarDate: new Intl.DateTimeFormat(APP_LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }),
  short: new Intl.DateTimeFormat(APP_LOCALE, { day: '2-digit', month: '2-digit', timeZone: APP_TIMEZONE }),
  time: new Intl.DateTimeFormat(APP_LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: APP_TIMEZONE }),
  parts: new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
};

const isDateOnly = v => typeof v === 'string' && DATE_ONLY.test(v);

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function zonedParts(date) {
  return Object.fromEntries(F.parts.formatToParts(date).map(p => [p.type, p.value]));
}

export function dateTimeLocalValue(now = new Date()) {
  const p = zonedParts(now);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** '24/09/2026' o '—'. */
export function fmtDate(value) {
  if (!value) return '—';
  if (isDateOnly(value)) return F.calendarDate.format(new Date(`${value}T00:00:00Z`));
  const d = toDate(value);
  return d ? F.date.format(d) : '—';
}

/** '24/09 2:30 p. m.' o '—'. */
export function fmtDateTime(value) {
  const d = toDate(value);
  return d ? `${F.short.format(d)} ${F.time.format(d)}` : '—';
}

/**
 * "hace 12 min", "hace 3 h", "hace 2 d" — más útil clínicamente que solo la hora
 * absoluta para detectar signos vitales atrasados. Cae a fmtDateTime si es muy
 * antiguo (>2 días) o si la fecha es inválida.
 */
export function fmtRelative(value, now = new Date()) {
  const d = toDate(value);
  if (!d) return '—';
  const diffMs = now.getTime() - d.getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return 'justo ahora';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const days = Math.round(hr / 24);
  if (days <= 2) return `hace ${days} d`;
  return fmtDateTime(value);
}

/** Día calendario (YYYY-MM-DD) de una fecha o instante, según la zona de la aplicación. */
export function calendarDateOf(value) {
  if (!value) return null;
  if (isDateOnly(value)) return value;
  const d = toDate(value);
  if (!d) return null;
  const p = zonedParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "Hoy" en Guatemala (no en UTC: después de las 18:00 locales UTC ya es "mañana"). */
export function todayISODate(now = new Date()) {
  return calendarDateOf(now);
}

/** Días calendario con signo entre dos fechas/instantes (to - from). `null` si alguna es inválida. */
export function calendarDaysDiff(from, to) {
  const a = calendarDateOf(from);
  const b = calendarDateOf(to);
  if (!a || !b) return null;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Días calendario entre dos fechas/instantes. `null` si alguna es inválida. Nunca negativo. */
export function daysBetween(from, to) {
  const diff = calendarDaysDiff(from, to);
  return diff === null ? null : Math.max(0, diff);
}

/** Suma (o resta) días —pueden ser fraccionarios, ej. 48h = 2— a una fecha calendario (YYYY-MM-DD). */
export function addDaysToCalendarDate(value, days) {
  const d = calendarDateOf(value);
  if (!d || !Number.isFinite(days)) return null;
  const ms = Date.parse(`${d}T00:00:00Z`) + days * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Fraseo relativo para una fecha CALENDARIO futura o pasada respecto a "hoy" (no un instante):
 * 'hoy' / 'mañana' / fecha completa si falta más de un día, o `null` si ya pasó (atrasado) —
 * el llamador decide cómo frasear el atraso, ya que el tono visual difiere ("atrasado desde...").
 */
export function fmtRelativeCalendarDate(value, today = todayISODate()) {
  const diff = calendarDaysDiff(today, value);
  if (diff === null) return '—';
  if (diff < 0) return null;
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  return fmtDate(value);
}

function tzOffsetMs(ts) {
  const p = zonedParts(new Date(ts));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - Math.floor(ts / 1000) * 1000;
}

function formatOffset(ms) {
  const minutes = Math.abs(ms) / 60000;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${ms < 0 ? '-' : '+'}${hh}:${mm}`;
}

/**
 * Convierte el valor de un <input type="datetime-local"> ("2026-09-24T14:30", hora de pared
 * sin zona) a ISO con offset explícito ("2026-09-24T14:30:00-06:00"). Así el servidor nunca
 * tiene que adivinar la zona horaria. Devuelve null si el formato no es válido.
 */
export function wallTimeToOffsetISO(local) {
  const m = WALL_TIME.exec(local ?? '');
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  const s = Number(m[6] ?? 0);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let offset = tzOffsetMs(wall);
  offset = tzOffsetMs(wall - offset); // segunda pasada por si el offset cambia en ese instante
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${String(s).padStart(2, '0')}${formatOffset(offset)}`;
}

/* ------------------------------------------------------------------
   Edad
   ------------------------------------------------------------------ */
const SINGULAR_UNITS = { años: 'año', meses: 'mes', semanas: 'semana' };

export function formatEdad(valor, unidad) {
  if (valor === '' || valor === null || valor === undefined) return '';
  const label = Number(valor) === 1 && SINGULAR_UNITS[unidad] ? SINGULAR_UNITS[unidad] : (unidad || DEFAULT_AGE_UNIT);
  return `${valor} ${label}`;
}

export function parseEdad(str, fallbackUnit = DEFAULT_AGE_UNIT) {
  const m = String(str ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(años?|meses?|semanas?)$/i);
  if (!m) return { valor: '', unidad: fallbackUnit };
  const raw = m[2].toLowerCase();
  const unidad = raw.startsWith('año') ? 'años' : raw.startsWith('mes') ? 'meses' : 'semanas';
  return { valor: m[1], unidad };
}

/* ------------------------------------------------------------------
   Texto y valores
   ------------------------------------------------------------------ */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto proveniente de la BD antes de interpolarlo en innerHTML (previene XSS). */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

export const isHttpUrl = v => /^https?:\/\//i.test(String(v ?? '').trim());

export const blankToNull = v => {
  const t = String(v ?? '').trim();
  return t === '' ? null : t;
};

export const orDash = v => (v === null || v === undefined || v === '' ? '—' : v);

/**
 * Limpia texto libre largo (diagnósticos, motivo de consulta) antes de guardarlo:
 * quita espacios al final de cada línea, colapsa más de 2 líneas en blanco seguidas
 * a solo 2, y recorta espacios al inicio/final del bloque. No cambia el contenido
 * clínico, solo el formato — para que copiar/pegar desde otro sistema no arrastre
 * espacios invisibles que después hacen ver "distinto" un texto idéntico.
 */
export function normalizeMultiline(value) {
  const text = String(value ?? '');
  return text
    .replace(/\r\n/g, '\n')
    .split('\n').map(line => line.replace(/[ \t]+$/g, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
