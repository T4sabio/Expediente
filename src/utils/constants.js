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
  Frecuencia_Respiratoria: [12, 20]
});

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
  Frecuencia_Respiratoria: 'FR'
});

export const PROLONGED_TREATMENT_DAYS = 14;

export const SEARCH = Object.freeze({ DEBOUNCE_MS: 250, MAX_RESULTS: 30 });

export const DEFAULT_AGE_UNIT = 'años';

export const SECTIONS = Object.freeze([
  { id: 'resumen', label: 'Resumen', icon: 'grid' },
  { id: 'vitales', label: 'Signos Vitales', icon: 'pulse' },
  { id: 'medicamentos', label: 'Medicamentos', icon: 'pill' },
  { id: 'laboratorios', label: 'Laboratorios', icon: 'flask' },
  { id: 'consultas', label: 'Interconsultas', icon: 'chat' },
  { id: 'cultivos', label: 'Cultivos', icon: 'dish' },
  { id: 'pendientes', label: 'Pendientes', icon: 'check' }
]);
