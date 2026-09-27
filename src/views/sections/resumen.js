import { VITAL_RANGES, VITAL_LABELS } from '../../utils/constants.js';
import { escapeHtml as esc, fmtDateTime, fmtDate, fmtRelative, fmtRelativeCalendarDate, orDash } from '../../utils/formatters.js';
import { summaryPanel, abnormalMark } from '../components.js';
import { Culture } from '../../models/ClinicalRecords.js';

/** "Próximo hemocultivo: mañana" / "atrasado desde 26/09/2026", como texto plano para el panel. */
function periodicCultureLines(cultures, today) {
  return Culture.periodicStatuses(cultures, today).map(s => {
    const proximo = s.overdue
      ? `⚠ ${s.tipo}: atrasado desde ${fmtDate(s.nextDate)}`
      : `🩸 Próximo ${s.tipo}: ${fmtRelativeCalendarDate(s.nextDate, today)}`;
    return `${proximo} (último: ${fmtDate(s.lastDate)})`;
  });
}

export const resumenSection = {
  id: 'resumen',

  render(record, { today }) {
    const summary = record.summary ?? {};
    const counts = summary.counts ?? {};
    const last = record.latestVitals;

    const meds = summary.activeMedications?.length ? summary.activeMedications : record.activeMedications;
    const tasks = summary.openTasks?.length ? summary.openTasks : record.openTasks;
    const cultures = summary.pendingCultures?.length ? summary.pendingCultures : record.pendingCultures;
    const consults = summary.unansweredConsultations?.length ? summary.unansweredConsultations : record.unansweredConsultations;

    const vitalCards = last
      ? Object.keys(VITAL_RANGES).map(key => {
          const flag = last.isAbnormal(key);
          return `<div class="rounded-lg border ${flag ? 'border-critical/40 bg-critical-soft' : 'border-hairline bg-white'} p-3">
            <div class="text-[11px] text-[#5C6B67]">${VITAL_LABELS[key]}</div>
            <div class="text-lg font-mono-data font-semibold ${flag ? 'text-critical' : 'text-ink'}">${esc(orDash(last[key]))}${abnormalMark(key, last[key])}</div>
          </div>`;
        }).join('')
      : '<p class="text-sm text-[#5C6B67]">Sin registros de signos vitales.</p>';

    // Antibióticos con seguimiento de días de cobertura, el que lleva más días primero
    // (es el que más urge revisar/suspender o ajustar).
    const tracked = meds.filter(m => m.isTracked)
      .sort((a, b) => b.treatmentDays(today) - a.treatmentDays(today));
    const periodicLines = periodicCultureLines(cultures, today);

    return `
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-[15px]">Resumen clínico</h2>
        ${last ? `<span class="text-xs text-[#5C6B67]" title="${esc(fmtDateTime(last.Fecha_Hora))}">Última toma: ${esc(fmtRelative(last.Fecha_Hora))}</span>` : ''}
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 mb-6">${vitalCards}</div>
      <div class="grid md:grid-cols-3 gap-4">
        ${summaryPanel('Medicamentos activos', Number(counts.activeMedications ?? meds.length), meds.map(m => `${m.Nombre_Medicamento} ·${m.treatmentDays(today)}d`), 'medicamentos')}
        ${summaryPanel('Pendientes abiertos', Number(counts.openTasks ?? tasks.length), tasks.map(t => t.Descripcion_Tarea), 'pendientes')}
        ${summaryPanel('Cultivos en curso', Number(counts.pendingCultures ?? cultures.length), [...periodicLines, ...cultures.map(c => `${c.Tipo_Cultivo} · enviado ${fmtDate(c.Fecha_Envio)}`)], 'cultivos')}
        ${summaryPanel('Interconsultas sin respuesta', Number(counts.unansweredConsultations ?? consults.length), consults.map(c => c.Departamento_Consultado), 'consultas')}
        ${summaryPanel('Laboratorios registrados', Number(counts.labs ?? record.labs.length), record.labTypes, 'laboratorios')}
        ${summaryPanel('Signos vitales registrados', Number(counts.vitals ?? record.vitals.length), [], 'vitales')}
      </div>
      ${tracked.length ? `
      <div class="mt-4 rounded-lg border border-[#B8863A]/30 bg-[#FBF4E8] p-4">
        <h3 class="text-sm font-semibold text-[#B8863A] mb-2">Antibióticos en curso</h3>
        <ul class="space-y-1.5">
          ${tracked.map(m => `<li class="text-sm text-[#5C3E14]" title="Inicio: ${esc(fmtDate(m.Fecha_Inicio))}">
            ${esc(m.coverageText(today))}${m.isProlonged(today) ? ' <span class="text-[11px] font-semibold">— tratamiento prolongado, considerar reevaluar</span>' : ''}
          </li>`).join('')}
        </ul>
      </div>` : ''}`;
  }
};
