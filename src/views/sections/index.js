import { resumenSection } from './resumen.js';
import { vitalesSection } from './vitales.js';
import { medicamentosSection } from './medicamentos.js';
import { laboratoriosSection } from './laboratorios.js';
import { consultasSection } from './consultas.js';
import { cultivosSection } from './cultivos.js';
import { pendientesSection } from './pendientes.js';

/**
 * Registro de secciones. Contrato de cada una:
 *   render(record, ctx) -> string HTML (funciones puras: fáciles de probar)
 *   mount?(root, record, ctx) -> engancha eventos/gráficos después de insertar el HTML
 * Para agregar una pestaña nueva: crear el archivo, registrarlo aquí y en SECTIONS (constants.js).
 */
const REGISTRY = Object.fromEntries(
  [resumenSection, vitalesSection, medicamentosSection, laboratoriosSection,
   consultasSection, cultivosSection, pendientesSection].map(s => [s.id, s])
);

export const sectionViewFor = id => REGISTRY[id] ?? resumenSection;
