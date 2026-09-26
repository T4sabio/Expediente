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
