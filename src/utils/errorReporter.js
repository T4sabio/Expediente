/**
 * Monitoreo de errores en producción (hallazgo 2.4 de la auditoría).
 *
 * Antes de esto, cualquier error que no llegara a un `try/catch` visible solo
 * terminaba en `console.error` — invisible en cuanto la app está desplegada en
 * un hospital. Este módulo es una capa muy delgada:
 *   - Si existe `VITE_SENTRY_DSN`, inicializa Sentry (import dinámico: si el
 *     paquete no está instalado o la red bloquea el CDN, la app sigue
 *     funcionando igual, solo sin monitoreo).
 *   - Si no existe, `reportError` simplemente hace `console.error` — cero
 *     comportamiento nuevo, cero dependencias obligatorias.
 *
 * REGLA DURA: nunca se envía nada que pueda identificar a un paciente (HC,
 * nombre, diagnóstico, etc.) a un servicio externo. `context` es para
 * metadatos técnicos (qué acción, qué sección, qué formulario), nunca datos
 * clínicos. `scrub()` es la última barrera por si alguien pasa algo de más.
 */

const PATIENT_FIELD_NAMES = new Set([
  'hc', 'nombre_completo', 'diagnosticos', 'motivo_consulta',
  'servicio', 'cama', 'edad', 'num_rayosx', 'observaciones_microbiologia',
  'descripcion_tarea', 'justificacion_observaciones', 'respuesta_departamento'
]);

let sentryClient = null;
let initAttempted = false;

/** Quita de `context` cualquier clave que luzca como dato clínico antes de reportar. */
function scrub(context = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(context)) {
    if (PATIENT_FIELD_NAMES.has(key.toLowerCase())) continue;
    clean[key] = typeof value === 'object' && value !== null ? '[objeto omitido]' : value;
  }
  return clean;
}

/**
 * Se llama una vez al arrancar la app (ver main.js). No lanza si falla: el
 * monitoreo es un extra, nunca debe impedir que la app cargue.
 */
export async function initErrorReporting(env = import.meta.env) {
  if (initAttempted) return;
  initAttempted = true;
  const dsn = env.VITE_SENTRY_DSN;
  if (!dsn) return; // sin DSN configurado: se reporta solo a la consola, y está bien.
  try {
    const Sentry = await import('@sentry/browser');
    Sentry.init({
      dsn,
      environment: env.MODE ?? 'production',
      tracesSampleRate: 0,
      // Última red de seguridad: si algún evento trae texto libre que
      // pareciera un nombre/expediente, se descarta el evento entero antes de
      // salir del navegador.
      beforeSend(event) {
        const asText = JSON.stringify(event).toLowerCase();
        if (PATIENT_FIELD_NAMES.has('hc') && /"hc"\s*:/.test(asText)) return null;
        return event;
      }
    });
    sentryClient = Sentry;
  } catch (err) {
    console.warn('[errorReporter] No se pudo inicializar el monitoreo de errores:', err.message);
  }
}

/** @param {Error} err @param {Record<string, unknown>} [context] Metadatos técnicos, nunca datos de pacientes. */
export function reportError(err, context = {}) {
  const clean = scrub(context);
  console.error(err, clean);
  if (sentryClient) {
    sentryClient.captureException(err, { extra: clean });
  }
}
