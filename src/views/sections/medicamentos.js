import { escapeHtml as esc, fmtDate } from '../../utils/formatters.js';
import { sectionHeader, tableWrap, emptyRow, badge, paginationControls } from '../components.js';

export const medicamentosSection = {
  id: 'medicamentos',

  render(record, { today, pagination } = {}) {
    const medicationRows = (medications, active) => {
      const visible = medications.filter(m => m.isActive === active);
      return visible.length
      ? visible.map(m => {
          const days = m.treatmentDays(today);
          const prolonged = m.isProlonged(today);
          return `<tr>
            <td class="py-2 px-3 font-medium">${esc(m.Nombre_Medicamento)}${m.isTracked ? ` <span class="text-xs" title="Con seguimiento de días de cobertura">💊⏱</span>` : ''}</td>
            <td class="py-2 px-3 text-sm text-[#3C4A46]">${esc(m.Dosis_Frecuencia)}</td>
            <td class="py-2 px-3 font-mono-data text-xs">${fmtDate(m.Fecha_Inicio)}</td>
            <td class="py-2 px-3">
              <span class="font-mono-data font-semibold ${prolonged ? 'text-warn' : 'text-ink'}">${days}d</span>
              ${prolonged ? '<span class="ml-1 text-[10px] text-warn">tratamiento prolongado</span>' : ''}
            </td>
            <td class="py-2 px-3">${badge(m.isActive ? 'Activo' : 'Suspendido', m.isActive ? 'ok' : 'gray')}${!m.isActive && m.Motivo_Suspension ? `<p class="mt-1 text-xs text-[#5C6B67]">${esc(m.Motivo_Suspension)}</p>` : ''}</td>
            <td class="py-2 px-3 text-right">
              ${m.isActive ? `<button data-action="suspender-med" data-id="${Number(m.id)}" class="text-xs text-critical hover:underline">Suspender</button>` : ''}
            </td>
          </tr>`;
        }).join('')
      : emptyRow(6);
    };

    const suspended = record.suspendedMedications ?? [];
    return `${sectionHeader('Medicamentos', 'modal-med')}
      <h3 class="mb-2 text-xs font-semibold text-[#3C4A46]">Activos (${pagination?.total ?? record.medications.length})</h3>
      ${tableWrap(medicationRows(record.medications, true), ['Medicamento', 'Dosis / frecuencia', 'Inicio', 'Días de tratamiento', 'Estado', ''])}
      ${paginationControls(pagination, 'medicamentos activos')}
      <h3 class="mt-6 mb-2 text-xs font-semibold text-[#5C6B67]">Suspendidos (${record.pagination?.suspendedMedications?.total ?? suspended.length})</h3>
      ${tableWrap(medicationRows(suspended, false), ['Medicamento', 'Dosis / frecuencia', 'Inicio', 'Días de tratamiento', 'Estado', ''])}
      ${paginationControls(record.pagination?.suspendedMedications, 'medicamentos suspendidos')}`;
  }
};
