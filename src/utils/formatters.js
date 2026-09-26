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

/** Días calendario entre dos fechas/instantes. `null` si alguna es inválida. Nunca negativo. */
export function daysBetween(from, to) {
  const a = calendarDateOf(from);
  const b = calendarDateOf(to);
  if (!a || !b) return null;
  const diff = (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS;
  return Math.max(0, Math.round(diff));
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
