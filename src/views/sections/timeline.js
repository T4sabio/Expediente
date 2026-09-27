import { escapeHtml as esc, fmtDateTime, fmtRelative, orDash } from '../../utils/formatters.js';

const ICONS = {
  vitales: '◉', medicamentos: '●', laboratorios: '▣', consultas: '✚', cultivos: '◇', pendientes: '✓', paciente: '○'
};

export const timelineSection = {
  id: 'timeline',
  render(record, { timeline = [], newActivityCount = 0, lastViewedAt = 0 } = {}) {
    const rows = timeline.length ? timeline.map((item, index) => `
      <li class="relative pl-8 pb-5 ${index === timeline.length - 1 ? '' : 'border-l border-hairline ml-2'}">
        <span class="absolute -left-[9px] top-0 flex h-4 w-4 items-center justify-center rounded-full bg-accent-soft text-[9px] text-ink ring-4 ring-canvas" aria-hidden="true">${ICONS[item.kind] ?? '•'}</span>
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <div class="min-w-0"><p class="text-sm font-semibold text-ink">${esc(item.title)}</p><p class="mt-0.5 text-sm text-[#5C6B67]">${esc(orDash(item.detail))}</p></div>
          <time class="shrink-0 text-[11px] text-[#7C8784]" datetime="${esc(item.event_at)}" title="${esc(fmtDateTime(item.event_at))}">${esc(fmtRelative(item.event_at))}</time>
        </div>
        <p class="mt-1 text-[11px] text-[#9AA6A2]">${esc(item.actor_name || 'Personal clínico')} · ${esc(item.action_label || 'Actualización')}</p>
      </li>`).join('') : '<li class="rounded-lg border border-dashed border-hairline bg-white px-4 py-8 text-center text-sm text-[#7C8784]">No hay actividad clínica registrada.</li>';

    const note = lastViewedAt
      ? `${newActivityCount} novedad${newActivityCount === 1 ? '' : 'es'} desde tu última revisión.`
      : 'Este es el historial reciente del expediente. Las próximas modificaciones aparecerán aquí.';

    return `
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><h2 class="font-semibold text-[15px]">Línea temporal</h2><p class="mt-1 text-xs text-[#7C8784]">${esc(note)}</p></div>
        <button type="button" data-action="mark-timeline-read" class="rounded-md border border-hairline bg-white px-3 py-1.5 text-xs font-medium hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent">Marcar como revisado</button>
      </div>
      <div class="rounded-xl border border-hairline bg-canvas p-4 md:p-5">
        <ol aria-label="Actividad clínica reciente">${rows}</ol>
      </div>`;
  }
};
