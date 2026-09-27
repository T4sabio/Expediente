/** Error de validación de datos ingresados por el usuario (mensaje apto para mostrar). */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Error de la capa de acceso a datos. Conserva el error original en `cause`. */
export class ApiError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ApiError';
    this.cause = cause;
    this.code = cause?.code;
  }
}

/**
 * Se lanza cuando una actualización esperaba un `Modificado_En` concreto (edición
 * optimista) y el servidor reporta 0 filas afectadas: alguien más ya cambió ese
 * mismo registro. No es un error de red ni de validación — es información para
 * que el controlador decida recargar y avisar, nunca sobrescribir en silencio.
 */
export class ConflictError extends ApiError {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.code = 'CONFLICT';
  }
}

/**
 * ¿Este error viene de no tener conexión (o de perderla a medio camino), en vez
 * de ser un error de negocio/servidor? `fetch` (y por lo tanto supabase-js)
 * lanza un `TypeError` con mensajes como "Failed to fetch" o "NetworkError"
 * cuando el navegador no puede siquiera contactar al servidor.
 */
export function isNetworkError(err) {
  if (!err) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String(err?.message ?? '').toLowerCase();
  return err instanceof TypeError || /failed to fetch|network ?error|load failed|ecconnrefused/.test(msg);
}
