import { escapeHtml as esc, fmtRelative } from '../utils/formatters.js';

function issueCount(row) {
  return Number(row.due_tasks || 0) + Number(row.pending_cultures || 0)
    + Number(row.unanswered_consultations || 0) + (hasOverdueVitals(row) ? 1 : 0);
}

function isVitalDataStale(value) {
  if (!value) return true;
  const age = Date.now() - Date.parse(value);
  return !Number.isFinite(age) || age < 0 || age >= 24 * 60 * 60 * 1000;
}

function hasOverdueVitals(row) {
  return typeof row.vitals_overdue === 'boolean'
    ? row.vitals_overdue
    : isVitalDataStale(row.latest_vital_at);
}

export function renderRoundOverview(rows = [], { selectedService = '' } = {}) {
  const visible = selectedService ? rows.filter(r => r.servicio === selectedService) : rows;
  const ordered = visible.slice().sort((a, b) => String(a.servicio || '').localeCompare(String(b.servicio || '')) || String(a.cama || '').localeCompare(String(b.cama || ''), 'es', { numeric: true }) || String(a.nombre_completo || '').localeCompare(String(b.nombre_completo || '')));
  if (!ordered.length) return `
    <div class="rounded-xl border border-dashed border-hairline bg-white px-5 py-10 text-center">
      <p class="text-sm font-medium text-ink">No hay pacientes activos en esta vista.</p>
      <p class="mt-1 text-xs text-[#7C8784]">Prueba otro servicio o busca un paciente por HC.</p>
    </div>`;

  const serviceCount = new Set(ordered.map(r => r.servicio).filter(Boolean)).size;
  const issues = ordered.reduce((sum, row) => sum + issueCount(row), 0);
  const freshVitals = ordered.filter(r => !hasOverdueVitals(r)).length;
  const issueLabel = issues === 1 ? 'punto' : 'puntos';
  const rowsHtml = ordered.map((r) => {
    const alerts = issueCount(r);
    const last = r.latest_activity_at;
    const stats = [
      Number(r.active_medications || 0) ? `${r.active_medications} meds` : '',
      Number(r.due_tasks || 0) ? `${r.due_tasks} pendientes para hoy` : '',
      Number(r.pending_cultures || 0) ? `${r.pending_cultures} cultivos` : '',
      Number(r.unanswered_consultations || 0) ? `${r.unanswered_consultations} interconsultas` : '',
      hasOverdueVitals(r) ? 'Signos atrasados' : ''
    ].filter(Boolean).slice(0, 2).join(' · ');
    return `<tr class="border-t border-hairline hover:bg-canvas">
      <td class="px-3 py-3"><button type="button" data-action="select-patient" data-hc="${esc(r.hc)}" class="w-full text-left focus:outline-none focus:ring-2 focus:ring-accent rounded-md">
        <span class="block text-sm font-semibold text-ink">${esc(r.nombre_completo || 'Paciente')}</span>
        <span class="mt-0.5 block text-[11px] font-mono-data text-[#7C8784]">${esc(r.hc)}</span>
      </button></td>
      <td class="px-3 py-3 text-sm text-[#3C4A46]">${esc(r.servicio || '—')}</td>
      <td class="px-3 py-3 text-sm font-mono-data text-[#3C4A46]">${esc(r.cama || '—')}</td>
      <td class="px-3 py-3"><div class="text-xs text-[#5C6B67]">${esc(last ? fmtRelative(last) : 'Sin actividad')}</div><div class="mt-1 text-[10px] text-[#9AA6A2]">${esc(stats || 'Sin pendientes visibles')}</div></td>
      <td class="px-3 py-3 text-right">${alerts ? `<span class="inline-flex min-w-6 items-center justify-center rounded-full bg-critical-soft px-2 py-1 text-xs font-semibold text-critical" title="${alerts} novedades clínicas">${alerts}</span>` : '<span class="text-xs text-ok">Al día</span>'}</td>
    </tr>`;
  }).join('');
  const totalActive = Math.max(ordered.length, ...rows.map(r => Number(r.total_active) || 0));
  const truncated = totalActive > ordered.length;

  return `<section aria-labelledby="roundTitle" class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div><div class="flex items-center gap-2"><span class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-ink" aria-hidden="true">◫</span><h2 id="roundTitle" class="text-base font-semibold text-ink">Ronda de hoy</h2></div><p class="mt-1 text-xs text-[#7C8784]">Vista de trabajo para recorrer pacientes activos de forma rápida. Selecciona una fila para abrir el expediente.</p></div>
      <div class="flex gap-2 text-xs"><span class="rounded-full bg-white px-2.5 py-1 border border-hairline">${ordered.length} pacientes</span><span class="rounded-full bg-white px-2.5 py-1 border border-hairline">${serviceCount} servicios</span><span class="rounded-full ${issues ? 'bg-critical-soft text-critical' : 'bg-ok-soft text-ok'} px-2.5 py-1 border border-transparent">${issues} ${issueLabel} a revisar</span></div>
    </div>
    ${truncated ? `<p class="border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn" role="status">La ronda muestra ${ordered.length} de ${totalActive} pacientes activos. Usa la búsqueda para abrir otros expedientes.</p>` : ''}
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-3">
      <div class="rounded-lg border border-hairline bg-white p-4"><div class="text-[11px] uppercase tracking-wide text-[#7C8784]">Pacientes</div><div class="mt-1 text-2xl font-mono-data font-semibold text-ink">${ordered.length}</div><div class="mt-1 text-xs text-[#7C8784]">de ${totalActive} activos</div></div>
      <div class="rounded-lg border border-hairline bg-white p-4"><div class="text-[11px] uppercase tracking-wide text-[#7C8784]">Novedades visibles</div><div class="mt-1 text-2xl font-mono-data font-semibold ${issues ? 'text-critical' : 'text-ok'}">${issues}</div><div class="mt-1 text-xs text-[#7C8784]">pendientes de hoy, cultivos, interconsultas y signos atrasados</div></div>
      <div class="rounded-lg border border-hairline bg-white p-4"><div class="text-[11px] uppercase tracking-wide text-[#7C8784]">Signos recientes</div><div class="mt-1 text-2xl font-mono-data font-semibold text-ink">${freshVitals}</div><div class="mt-1 text-xs text-[#7C8784]">pacientes con signos en las últimas 24 h</div></div>
    </div>
    <div class="overflow-x-auto rounded-xl border border-hairline bg-white">
      <table class="clinical min-w-[760px] w-full text-sm"><caption class="sr-only">Pacientes activos de la ronda de hoy</caption><thead><tr><th scope="col" class="px-3 py-2.5 text-left">Paciente</th><th scope="col" class="px-3 py-2.5 text-left">Servicio</th><th scope="col" class="px-3 py-2.5 text-left">Cama</th><th scope="col" class="px-3 py-2.5 text-left">Última actividad</th><th scope="col" class="px-3 py-2.5 text-right">Revisión</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    </div>
    <p class="text-[11px] text-[#9AA6A2]">Los indicadores son ayudas de organización y seguimiento del expediente; no sustituyen la valoración clínica.</p>
  </section>`;
}
