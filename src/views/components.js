import { escapeHtml as esc } from '../utils/formatters.js';
import { VitalSigns } from '../models/VitalSigns.js';

const PLUS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="white" stroke-width="2.2" stroke-linecap="round"/></svg>';
const VITAL_HEADERS = ['Fecha / hora', 'PA', 'PAM', 'FC', 'SpO2', 'Temp', 'FR'];

export function sectionHeader(title, modalId) {
  return `<div class="flex items-center justify-between mb-4">
    <h2 class="font-semibold text-[15px]">${esc(title)}</h2>
    <button type="button" data-action="open-modal" data-modal="${esc(modalId)}" class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-sm hover:bg-ink transition">
      ${PLUS}
      Agregar
    </button>
  </div>`;
}

export function tableWrap(rowsHtml, headers = VITAL_HEADERS) {
  return `<div class="bg-white rounded-lg border border-hairline overflow-x-auto">
    <table class="clinical w-full text-sm">
      <thead><tr>${headers.map(x => `<th scope="col" class="py-2.5 px-3 text-left">${esc(x)}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}

export function emptyRow(colspan) {
  return `<tr><td colspan="${colspan}" class="py-8 text-center text-sm text-[#9AA6A2]">Sin registros todavía.</td></tr>`;
}

export function paginationControls(meta, label = 'registros') {
  if (!meta || meta.totalPages <= 1) return '';
  const current = Number(meta.page) || 1;
  const totalPages = Number(meta.totalPages) || 1;
  const total = Number(meta.total) || 0;
  return `<nav class="mt-4 flex items-center justify-between gap-3" aria-label="Paginación de ${esc(label)}">
    <span class="text-xs text-[#5C6B67]">Página ${current} de ${totalPages} · ${total} ${esc(label)}</span>
    <div class="flex items-center gap-1.5">
      <button type="button" data-action="page-section" data-list-key="${esc(meta.listKey ?? '')}" data-page="${current - 1}" ${current <= 1 ? 'disabled' : ''}
        class="px-2.5 py-1.5 text-xs rounded-md border border-hairline disabled:opacity-40 hover:border-accent">Anterior</button>
      <button type="button" data-action="page-section" data-list-key="${esc(meta.listKey ?? '')}" data-page="${current + 1}" ${current >= totalPages ? 'disabled' : ''}
        class="px-2.5 py-1.5 text-xs rounded-md border border-hairline disabled:opacity-40 hover:border-accent">Siguiente</button>
    </div>
  </nav>`;
}

const TONES = {
  ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn',
  critical: 'bg-critical-soft text-critical', accent: 'bg-accent-soft text-ink', gray: 'bg-[#EEF2F1] text-[#5C6B67]'
};

export function badge(text, tone) {
  return `<span class="px-2 py-0.5 rounded-full text-xs font-medium ${TONES[tone] || TONES.gray}">${esc(text)}</span>`;
}

export function summaryPanel(title, count, items, gotoSection) {
  const list = items.slice(0, 3).map(i => `<li class="text-xs text-[#5C6B67] truncate">· ${esc(i)}</li>`).join('')
    || '<li class="text-xs text-[#9AA6A2]">Sin datos</li>';
  return `<button type="button" data-action="switch-section" data-section="${esc(gotoSection)}"
    class="text-left w-full rounded-lg border border-hairline bg-white p-4 cursor-pointer hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent transition">
    <div class="flex items-baseline justify-between">
      <span class="text-sm text-[#3C4A46]">${esc(title)}</span>
      <span class="text-2xl font-mono-data font-semibold text-ink">${count}</span>
    </div>
    <ul class="mt-2 space-y-1">${list}</ul>
  </button>`;
}

export const cellFlag = (key, val) => (VitalSigns.isValueAbnormal(key, val) ? 'text-critical font-semibold' : '');

export function abnormalMark(key, val) {
  if (!VitalSigns.isValueAbnormal(key, val)) return '';
  const dir = VitalSigns.abnormalDirection ? VitalSigns.abnormalDirection(key, val) : null;
  const arrow = dir === 'bajo' ? '▼' : dir === 'alto' ? '▲' : '⚠';
  const label = dir ? (dir === 'bajo' ? 'bajo' : 'alto') : 'anormal';
  return ` <span class="text-critical text-[11px] font-semibold" aria-label="${label}" title="${label}">${arrow}</span>`;
}
