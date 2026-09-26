import { VITAL_RANGES, VITAL_LABELS } from '../../utils/constants.js';
import { escapeHtml as esc, fmtDateTime, fmtDate, orDash } from '../../utils/formatters.js';
import { summaryPanel } from '../components.js';

export const resumenSection = {
  id: 'resumen',

  render(record, { today }) {
    const last = record.latestVitals;

    const vitalCards = last
      ? Object.keys(VITAL_RANGES).map(key => {
          const flag = last.isAbnormal(key);
          return `<div class="rounded-lg border ${flag ? 'border-critical/40 bg-critical-soft' : 'border-hairline bg-white'} p-3">
            <div class="text-[11px] text-[#5C6B67]">${VITAL_LABELS[key]}</div>
            <div class="text-lg font-mono-data font-semibold ${flag ? 'text-critical' : 'text-ink'}">${esc(orDash(last[key]))}</div>
          </div>`;
        }).join('')
      : '<p class="text-sm text-[#5C6B67]">Sin registros de signos vitales.</p>';

    const meds = record.activeMedications;
    const tasks = record.openTasks;
    const cultures = record.pendingCultures;
    const consults = record.unansweredConsultations;

    return `
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-[15px]">Resumen clínico</h2>
        ${last ? `<span class="text-xs text-[#5C6B67]">Última toma: ${fmtDateTime(last.Fecha_Hora)}</span>` : ''}
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 mb-6">${vitalCards}</div>
      <div class="grid md:grid-cols-3 gap-4">
        ${summaryPanel('Medicamentos activos', meds.length, meds.map(m => `${m.Nombre_Medicamento} ·${m.treatmentDays(today)}d`), 'medicamentos')}
        ${summaryPanel('Pendientes abiertos', tasks.length, tasks.map(t => t.Descripcion_Tarea), 'pendientes')}
        ${summaryPanel('Cultivos en curso', cultures.length, cultures.map(c => `${c.Tipo_Cultivo} · enviado ${fmtDate(c.Fecha_Envio)}`), 'cultivos')}
        ${summaryPanel('Interconsultas sin respuesta', consults.length, consults.map(c => c.Departamento_Consultado), 'consultas')}
        ${summaryPanel('Laboratorios registrados', record.labs.length, record.labTypes, 'laboratorios')}
        ${summaryPanel('Signos vitales registrados', record.vitals.length, [], 'vitales')}
      </div>`;
  }
};
