import { VITAL_LABELS } from '../../utils/constants.js';
import { fmtDateTime } from '../../utils/formatters.js';
import { sectionHeader, tableWrap, emptyRow, cellFlag, abnormalMark, paginationControls } from '../components.js';

const OPTIONS = [
  { key: 'PA', label: 'Presión arterial (sistólica / diastólica)' },
  { key: 'PAM', label: 'Presión arterial media (PAM)' },
  { key: 'Frecuencia_Cardiaca', label: 'Frecuencia cardíaca (lpm)' },
  { key: 'SpO2', label: 'Saturación de oxígeno (%)' },
  { key: 'Temperatura', label: 'Temperatura (°C)' },
  { key: 'Frecuencia_Respiratoria', label: 'Frecuencia respiratoria (rpm)' }
];

function tableRows(rows) {
  if (!rows.length) return emptyRow(7);
  return rows.slice().reverse().map(r => `
    <tr>
      <td class="py-2 px-3 font-mono-data text-xs">${fmtDateTime(r.Fecha_Hora)}</td>
      <td class="py-2 px-3 font-mono-data ${cellFlag('PA_Sistolica', r.PA_Sistolica)}">${r.PA_Sistolica}/${r.PA_Diastolica}${abnormalMark('PA_Sistolica', r.PA_Sistolica)}</td>
      <td class="py-2 px-3 font-mono-data ${cellFlag('PAM', r.PAM)}">${r.PAM ?? '—'}${abnormalMark('PAM', r.PAM)}</td>
      <td class="py-2 px-3 font-mono-data ${cellFlag('Frecuencia_Cardiaca', r.Frecuencia_Cardiaca)}">${r.Frecuencia_Cardiaca}${abnormalMark('Frecuencia_Cardiaca', r.Frecuencia_Cardiaca)}</td>
      <td class="py-2 px-3 font-mono-data ${cellFlag('SpO2', r.SpO2)}">${r.SpO2}%${abnormalMark('SpO2', r.SpO2)}</td>
      <td class="py-2 px-3 font-mono-data ${cellFlag('Temperatura', r.Temperatura)}">${r.Temperatura}°C${abnormalMark('Temperatura', r.Temperatura)}</td>
      <td class="py-2 px-3 font-mono-data ${cellFlag('Frecuencia_Respiratoria', r.Frecuencia_Respiratoria)}">${r.Frecuencia_Respiratoria}${abnormalMark('Frecuencia_Respiratoria', r.Frecuencia_Respiratoria)}</td>
    </tr>`).join('');
}

/** Tabla oculta (sr-only) equivalente al gráfico: un lector de pantalla no puede "ver"
 * la tendencia en un <canvas>, así que la misma serie se ofrece como texto. */
function chartTextAlternative(vitals, metric) {
  if (!vitals.length) return '<p class="sr-only">Sin datos suficientes para graficar.</p>';
  const label = metric === 'PA' ? 'Presión arterial' : (VITAL_LABELS[metric] ?? metric);
  const values = metric === 'PA'
    ? vitals.map(r => `${fmtDateTime(r.Fecha_Hora)}: ${r.PA_Sistolica}/${r.PA_Diastolica}`)
    : vitals.map(r => `${fmtDateTime(r.Fecha_Hora)}: ${r[metric]}`);
  const first = metric === 'PA' ? vitals[0].PA_Sistolica : vitals[0][metric];
  const last = metric === 'PA' ? vitals[vitals.length - 1].PA_Sistolica : vitals[vitals.length - 1][metric];
  const tendencia = last > first ? 'en aumento' : last < first ? 'en descenso' : 'estable';
  return `<div class="sr-only" role="table" aria-label="Datos de ${label} en formato tabla, alternativa al gráfico">
    <p>${label}: tendencia ${tendencia} (de ${first} a ${last}).</p>
    <ul>${values.map(v => `<li>${v}</li>`).join('')}</ul>
  </div>`;
}

function drawChart(charts, vitals, metric) {
  const labels = vitals.map(r => fmtDateTime(r.Fecha_Hora));
  const datasets = metric === 'PA'
    ? [
        { label: 'Sistólica', data: vitals.map(r => r.PA_Sistolica), borderColor: '#1F7A6C', backgroundColor: '#1F7A6C', fill: false },
        { label: 'Diastólica', data: vitals.map(r => r.PA_Diastolica), borderColor: '#B8863A', backgroundColor: '#B8863A', fill: false }
      ]
    : metric === 'PAM'
      // Línea punteada en un tono neutro: se diferencia de sistólica/diastólica si en
      // algún momento se muestran las tres series a la vez.
      ? [{ label: 'PAM', data: vitals.map(r => r.PAM), borderColor: '#5C6B67', backgroundColor: '#5C6B67', borderDash: [5, 4], fill: false }]
      : [{ label: VITAL_LABELS[metric] ?? metric, data: vitals.map(r => r[metric]), borderColor: '#1F7A6C', backgroundColor: '#E4F1EE', fill: true }];
  charts.render('vitalChart', labels, datasets);
  const alt = document.getElementById('vitalChartTextAlt');
  if (alt) alt.innerHTML = chartTextAlternative(vitals, metric);
}

export const vitalesSection = {
  id: 'vitales',

  render(record, { pagination } = {}) {
    return `
      ${sectionHeader('Signos vitales', 'modal-vital')}
      <div class="bg-white rounded-lg border border-hairline p-4 mb-4">
        <label class="text-xs text-[#5C6B67]" for="vitalMetricSelect">Graficar:
          <select id="vitalMetricSelect" class="ml-2 border border-hairline rounded-md px-2 py-1 text-sm">
            ${OPTIONS.map(o => `<option value="${o.key}">${o.label}</option>`).join('')}
          </select>
        </label>
        <div class="chart-wrap mt-3"><canvas id="vitalChart" role="img" aria-label="Gráfico de tendencia de signos vitales; ver tabla equivalente debajo"></canvas></div>
        <div id="vitalChartTextAlt"></div>
      </div>
      ${tableWrap(tableRows(record.vitals))}
      ${paginationControls(pagination, 'signos vitales')}`;
  },

  mount(root, record, { charts }) {
    root.querySelector('#vitalMetricSelect')
      .addEventListener('change', e => drawChart(charts, record.vitals, e.target.value));
    drawChart(charts, record.vitals, 'PA');
  }
};
