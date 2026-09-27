import { escapeHtml as esc, fmtDate, fmtRelativeCalendarDate, orDash } from '../../utils/formatters.js';
import { sectionHeader, tableWrap, emptyRow, badge, paginationControls } from '../components.js';
import { Culture } from '../../models/ClinicalRecords.js';

export const cultivosSection = {
  id: 'cultivos',

  render(record, { today, pagination } = {}) {
    // Solo la fila más reciente de cada tipo periódico muestra próximo/último, para no
    // repetir la misma información en cada fila histórica (sería ruido).
    const periodicByLastId = new Map(Culture.periodicStatuses(record.cultures, today).map(s => [s.lastId, s]));
    const rows = record.cultures.length
      ? record.cultures.map(c => {
          const tone = c.isPending ? 'warn' : (c.Resultado === 'Positivo' ? 'critical' : 'ok');
          const dias = c.elapsedDays(today);
          const periodic = periodicByLastId.get(c.id);
          const periodicLine = periodic
            ? `<div class="mt-1">${periodic.overdue
                ? badge(`Atrasado desde ${fmtDate(periodic.nextDate)}`, 'critical')
                : badge(`Próximo: ${fmtRelativeCalendarDate(periodic.nextDate, today)}`, fmtRelativeCalendarDate(periodic.nextDate, today) === 'hoy' ? 'warn' : 'gray')}
              <span class="ml-1 text-[11px] text-[#9AA6A2]">Último: ${esc(fmtDate(periodic.lastDate))}</span></div>`
            : '';
          return `<tr>
            <td class="py-2 px-3 font-medium">${esc(c.Tipo_Cultivo)}${periodicLine}</td>
            <td class="py-2 px-3 font-mono-data text-xs">${fmtDate(c.Fecha_Envio)}</td>
            <td class="py-2 px-3 font-mono-data text-xs">${dias === null ? '—' : dias + 'd'}</td>
            <td class="py-2 px-3">${badge(c.Resultado || 'Pendiente', tone)}</td>
            <td class="py-2 px-3 text-sm text-[#3C4A46] max-w-xs">${esc(orDash(c.Observaciones_Microbiologia))}</td>
            <td class="py-2 px-3 text-right">
              ${c.isPending ? `<button data-action="resultado-cultivo" data-id="${Number(c.id)}" class="text-xs text-accent hover:underline">Registrar resultado</button>` : ''}
            </td>
          </tr>`;
        }).join('')
      : emptyRow(6);

    return `${sectionHeader('Cultivos', 'modal-cultivo')}
      ${tableWrap(rows, ['Tipo', 'Enviado', 'Días transcurridos', 'Resultado', 'Observaciones', ''])}
      ${paginationControls(pagination, 'cultivos')}`;
  }
};
