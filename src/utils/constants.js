/** Constantes de la aplicación. Nada aquí depende del DOM ni de librerías externas. */

export const APP_TIMEZONE = 'America/Guatemala'; // UTC-6, sin horario de verano
export const APP_LOCALE = 'es-GT';

export const TABLES = Object.freeze({
  PATIENTS: 'DB_Pacientes',
  VITALS: 'DB_SignosVitales',
  MEDS: 'DB_Medicamentos',
  LABS: 'DB_Laboratorios',
  CONSULTS: 'DB_Consultas',
  CULTURES: 'DB_Cultivos',
  TASKS: 'DB_Pendientes'
});

/** Rangos normales: fuera de ellos el valor se marca como anormal. */
export const VITAL_RANGES = Object.freeze({
  PA_Sistolica: [90, 140],
  PA_Diastolica: [60, 90],
  Frecuencia_Cardiaca: [60, 100],
  SpO2: [95, 100],
  Temperatura: [36.0, 37.5],
  Frecuencia_Respiratoria: [12, 20],
  // PAM se calcula (no se captura en el formulario), pero se agrega aquí para que
  // las tarjetas de "Resumen clínico" (genéricas por Object.keys(VITAL_RANGES)) y el
  // marcado de anormalidad la reconozcan igual que a los demás signos vitales.
  // Por debajo de 65 se considera hipoperfusión en adultos.
  PAM: [70, 100]
});

/** Signos vitales que se capturan en el formulario (excluye PAM, que es calculada). */
export const VITAL_INPUT_KEYS = Object.freeze([
  'PA_Sistolica', 'PA_Diastolica', 'Frecuencia_Cardiaca', 'SpO2', 'Temperatura', 'Frecuencia_Respiratoria'
]);

/** Límites fisiológicamente posibles: fuera de ellos se asume error de digitación y se rechaza. */
export const VITAL_LIMITS = Object.freeze({
  PA_Sistolica: [30, 300],
  PA_Diastolica: [10, 200],
  Frecuencia_Cardiaca: [10, 300],
  SpO2: [0, 100],
  Temperatura: [25, 45],
  Frecuencia_Respiratoria: [1, 80]
});

export const VITAL_LABELS = Object.freeze({
  PA_Sistolica: 'PA Sist.',
  PA_Diastolica: 'PA Diast.',
  Frecuencia_Cardiaca: 'FC',
  SpO2: 'SpO2',
  Temperatura: 'Temp.',
  Frecuencia_Respiratoria: 'FR',
  PAM: 'PAM'
});

export const PROLONGED_TREATMENT_DAYS = 14;

/**
 * Límites de longitud para campos de texto libre. Existen por dos razones:
 * 1) Un campo sin límite visible invita a pegar documentos completos, lo que
 *    vuelve el expediente difícil de escanear rápido durante una ronda.
 * 2) Deben coincidir con los `check` de longitud del lado del servidor
 *    (ver supabase/004_correcciones_produccion.sql) para que el mensaje de
 *    error aparezca ANTES de enviar el formulario, no después.
 */
export const FIELD_LIMITS = Object.freeze({
  Nombre_Completo: 200,
  Servicio: 100,
  Cama: 20,
  Num_RayosX: 50,
  Motivo_Consulta: 1000,
  Diagnosticos: 4000
});

export const SEARCH = Object.freeze({ DEBOUNCE_MS: 250, MAX_RESULTS: 30 });

export const DEFAULT_AGE_UNIT = 'años';

export const SECTIONS = Object.freeze([
  { id: 'resumen', label: 'Resumen', icon: 'grid' },
  { id: 'vitales', label: 'Signos Vitales', icon: 'pulse' },
  { id: 'medicamentos', label: 'Medicamentos', icon: 'pill' },
  { id: 'laboratorios', label: 'Laboratorios', icon: 'flask' },
  { id: 'consultas', label: 'Interconsultas', icon: 'chat' },
  { id: 'cultivos', label: 'Cultivos', icon: 'dish' },
  { id: 'pendientes', label: 'Pendientes', icon: 'check' },
  { id: 'timeline', label: 'Línea temporal', icon: 'clock' }
]);
