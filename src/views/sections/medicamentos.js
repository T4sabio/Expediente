import { escapeHtml as esc, fmtDate } from '../../utils/formatters.js';
import { sectionHeader, tableWrap, emptyRow, badge } from '../components.js';

export const medicamentosSection = {
  id: 'medicamentos',

  render(record, { today }) {
    const rows = record.medications.length
      ? record.medications.map(m => {
          const days = m.treatmentDays(today);
          const prolonged = m.isProlonged(today);
          return `<tr>
            <td class="py-2 px-3 font-medium">${esc(m.Nombre_Medicamento)}</td>
            <td class="py-2 px-3 text-sm text-[#3C4A46]">${esc(m.Dosis_Frecuencia)}</td>
            <td class="py-2 px-3 font-mono-data text-xs">${fmtDate(m.Fecha_Inicio)}</td>
            <td class="py-2 px-3">
              <span class="font-mono-data font-semibold ${prolonged ? 'text-warn' : 'text-ink'}">${days}d</span>
              ${prolonged ? '<span class="ml-1 text-[10px] text-warn">tratamiento prolongado</span>' : ''}
            </td>
            <td class="py-2 px-3">${badge(m.isActive ? 'Activo' : 'Inactivo', m.isActive ? 'ok' : 'gray')}</td>
            <td class="py-2 px-3 text-right">
              ${m.isActive ? `<button data-action="suspender-med" data-id="${Number(m.id)}" class="text-xs text-critical hover:underline">Suspender</button>` : ''}
            </td>
          </tr>`;
        }).join('')
      : emptyRow(6);

    return `${sectionHeader('Medicamentos', 'modal-med')}
      ${tableWrap(rows, ['Medicamento', 'Dosis / frecuencia', 'Inicio', 'Días de tratamiento', 'Estado', ''])}`;
  }
};
