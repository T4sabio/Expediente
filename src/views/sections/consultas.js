import { escapeHtml as esc, fmtDate, orDash } from '../../utils/formatters.js';
import { sectionHeader, tableWrap, emptyRow, badge } from '../components.js';

export const consultasSection = {
  id: 'consultas',

  render(record) {
    const rows = record.consultations.length
      ? record.consultations.map(c => `
        <tr>
          <td class="py-2 px-3 font-medium">${esc(c.Departamento_Consultado)}</td>
          <td class="py-2 px-3 font-mono-data text-xs">${fmtDate(c.Fecha_Envio)}</td>
          <td class="py-2 px-3">${c.isAnswered ? badge('Respondida', 'ok') : badge('En espera', 'warn')}</td>
          <td class="py-2 px-3 text-sm text-[#3C4A46] max-w-xs">${esc(orDash(c.Respuesta_Departamento))}</td>
          <td class="py-2 px-3 text-right">
            ${!c.isAnswered ? `<button data-action="responder-consulta" data-id="${Number(c.id)}" class="text-xs text-accent hover:underline">Registrar respuesta</button>` : ''}
          </td>
        </tr>`).join('')
      : emptyRow(5);

    return `${sectionHeader('Interconsultas', 'modal-consulta')}
      ${tableWrap(rows, ['Departamento', 'Enviada', 'Estado', 'Respuesta', ''])}`;
  }
};
