/**
 * Telemetría de errores sin PHI. La regla es deny-by-default: solo se envían
 * metadatos técnicos explícitamente permitidos y una excepción sanitizada.
 */

const ALLOWED_CONTEXT_KEYS = new Set([
  'origin', 'action', 'section', 'formId', 'operation', 'component', 'errorCode'
]);

const SAFE_ERROR_NAMES = new Set([
  'Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError',
  'ApiError', 'ConflictError', 'ValidationError', 'InactiveUserError'
]);

const HC_PATTERN = /\b(?:hc\s*[:=#-]?\s*)?[A-Z0-9]{2,12}(?:[-/][A-Z0-9]{1,12}){1,3}\b/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

function sanitizeText(value) {
  return String(value ?? '')
    .replace(EMAIL_PATTERN, '[email]')
    .replace(UUID_PATTERN, '[id]')
    .replace(HC_PATTERN, '[hc]')
    .slice(0, 240);
}

const CONTEXT_IDENTIFIER_KEYS = new Set([
  'origin', 'action', 'section', 'formId', 'operation', 'component', 'errorCode'
]);

function sanitizeContextValue(key, value) {
  const raw = String(value ?? '').slice(0, 120);
  // Los valores de contexto son códigos técnicos, no texto clínico. Para evitar
  // falsos positivos (p. ej. `form-med`), no aplicamos aquí el detector de HC;
  // el contenido de excepciones se reemplaza por completo en `safeError`.
  if (CONTEXT_IDENTIFIER_KEYS.has(key)) return raw.replace(/[^a-zA-Z0-9._:/-]/g, '_');
  return sanitizeText(raw);
}

export function scrubContext(context = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(context)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) continue;
    if (value == null) continue;
    clean[key] = sanitizeContextValue(key, value);
  }
  return clean;
}

function safeError(err) {
  const name = SAFE_ERROR_NAMES.has(err?.name) ? err.name : 'Error';
  const code = sanitizeText(err?.code ?? 'UNCLASSIFIED');
  const clean = new Error(`Client exception [${code}]`);
  clean.name = name;
  return clean;
}

let sentryClient = null;
let initAttempted = false;

export async function initErrorReporting(env = import.meta.env) {
  if (initAttempted) return;
  initAttempted = true;
  const dsn = env.VITE_SENTRY_DSN;
  if (!dsn) return;
  try {
    const Sentry = await import('@sentry/browser');
    Sentry.init({
      dsn,
      environment: env.MODE ?? 'production',
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeBreadcrumb() { return null; },
      beforeSend(event) {
        // Strip every high-risk surface before the SDK serializes/sends it.
        delete event.request;
        delete event.user;
        delete event.breadcrumbs;
        delete event.contexts?.trace;
        if (event.message) event.message = 'Client exception';
        if (event.exception?.values) {
          event.exception.values = event.exception.values.map(item => ({
            type: SAFE_ERROR_NAMES.has(item.type) ? item.type : 'Error',
            value: 'Client exception'
          }));
        }
        event.extra = scrubContext(event.extra ?? {});
        event.tags = scrubContext(event.tags ?? {});
        return event;
      }
    });
    sentryClient = Sentry;
  } catch (err) {
    console.warn('[errorReporter] No se pudo inicializar el monitoreo de errores:', sanitizeText(err?.message));
  }
}

export function reportError(err, context = {}) {
  const cleanContext = scrubContext(context);
  const safe = safeError(err);
  if (import.meta.env?.DEV) {
    console.error('[app-error]', err, cleanContext);
  } else {
    console.error('[app-error]', safe, cleanContext);
  }
  if (sentryClient) {
    sentryClient.captureException(safe, { extra: cleanContext });
  }
}

export const __testing = Object.freeze({ sanitizeText, safeError });
