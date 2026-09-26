import { escapeHtml as esc, fmtDate, isHttpUrl, orDash } from '../../utils/formatters.js';
import { sectionHeader, tableWrap, emptyRow } from '../components.js';

function tableRows(rows) {
  if (!rows.length) return emptyRow(5);
  return rows.slice().reverse().map(r => `
    <tr>
      <td class="py-2 px-3 font-mono-data text-xs">${fmtDate(r.Fecha)}</td>
      <td class="py-2 px-3 font-medium">${esc(r.Tipo_Lab)}</td>
      <td class="py-2 px-3 font-mono-data">${esc(orDash(r.Valor_Numerico))}</td>
      <td class="py-2 px-3 text-sm text-[#3C4A46]">${esc(orDash(r.Resultado_Texto))}</td>
      <td class="py-2 px-3">${isHttpUrl(r.Enlace_PDF_Hospital)
        ? `<a href="${esc(r.Enlace_PDF_Hospital)}" target="_blank" rel="noopener noreferrer" class="text-accent text-xs hover:underline">Ver PDF</a>` : '—'}</td>
    </tr>`).join('');
}

function drawChart(charts, labs, tipo) {
  const rows = labs.filter(l => l.Tipo_Lab === tipo && l.hasNumericValue);
  charts.render('labChart', rows.map(r => fmtDate(r.Fecha)), [
    { label: tipo, data: rows.map(r => Number(r.Valor_Numerico)), borderColor: '#1F7A6C', backgroundColor: '#E4F1EE', fill: true }
  ]);
}

export const laboratoriosSection = {
  id: 'laboratorios',

  render(record) {
    const tipos = record.labTypes;
    return `
      ${sectionHeader('Laboratorios', 'modal-lab')}
      <div class="bg-white rounded-lg border border-hairline p-4 mb-4">
        <label class="text-xs text-[#5C6B67]">Graficar:
          <select id="labMetricSelect" class="ml-2 border border-hairline rounded-md px-2 py-1 text-sm">
            ${tipos.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
          </select>
        </label>
        <div class="chart-wrap mt-3">${tipos.length
          ? '<canvas id="labChart"></canvas>'
          : '<p class="text-sm text-[#5C6B67] py-10 text-center">Sin resultados numéricos para graficar.</p>'}</div>
      </div>
      ${tableWrap(tableRows(record.labs), ['Fecha', 'Tipo', 'Valor', 'Resultado', 'PDF'])}`;
  },

  mount(root, record, { charts }) {
    const tipos = record.labTypes;
    if (!tipos.length) return;
    root.querySelector('#labMetricSelect')
      .addEventListener('change', e => drawChart(charts, record.labs, e.target.value));
    drawChart(charts, record.labs, tipos[0]);
  }
};
