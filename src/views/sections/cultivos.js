import { escapeHtml as esc, fmtDate, orDash } from '../../utils/formatters.js';
import { sectionHeader, tableWrap, emptyRow, badge } from '../components.js';

export const cultivosSection = {
  id: 'cultivos',

  render(record, { today }) {
    const rows = record.cultures.length
      ? record.cultures.map(c => {
          const tone = c.isPending ? 'warn' : (c.Resultado === 'Positivo' ? 'critical' : 'ok');
          const dias = c.elapsedDays(today);
          return `<tr>
            <td class="py-2 px-3 font-medium">${esc(c.Tipo_Cultivo)}</td>
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
      ${tableWrap(rows, ['Tipo', 'Enviado', 'Días transcurridos', 'Resultado', 'Observaciones', ''])}`;
  }
};
