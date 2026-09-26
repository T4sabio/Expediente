import { escapeHtml as esc, fmtDate, orDash } from '../../utils/formatters.js';
import { sectionHeader, tableWrap, emptyRow, badge } from '../components.js';

const TONE = { Pendiente: 'warn', Programado: 'accent', Realizado: 'ok' };

export const pendientesSection = {
  id: 'pendientes',

  render(record) {
    const rows = record.tasks.length
      ? record.tasks.map(t => `
        <tr>
          <td class="py-2 px-3 font-medium max-w-xs">${esc(t.Descripcion_Tarea)}</td>
          <td class="py-2 px-3 font-mono-data text-xs">${fmtDate(t.Fecha_Solicitud)}</td>
          <td class="py-2 px-3 font-mono-data text-xs">${fmtDate(t.Fecha_Programada)}</td>
          <td class="py-2 px-3">${badge(orDash(t.Estado), TONE[t.Estado] || 'gray')}</td>
          <td class="py-2 px-3 text-sm text-[#3C4A46] max-w-xs">${esc(orDash(t.Justificacion_Observaciones))}</td>
          <td class="py-2 px-3 text-right">
            ${!t.isDone ? `<button data-action="completar-pendiente" data-id="${Number(t.id)}" class="text-xs text-accent hover:underline">Marcar realizado</button>` : ''}
          </td>
        </tr>`).join('')
      : emptyRow(6);

    return `${sectionHeader('Pendientes clínicos', 'modal-pendiente')}
      ${tableWrap(rows, ['Tarea', 'Solicitada', 'Programada', 'Estado', 'Observaciones', ''])}`;
  }
};
