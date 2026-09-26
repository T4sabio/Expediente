import { VITAL_LABELS } from '../../utils/constants.js';
import { fmtDateTime } from '../../utils/formatters.js';
import { sectionHeader, tableWrap, emptyRow, cellFlag } from '../components.js';

const OPTIONS = [
  { key: 'PA', label: 'Presión arterial (sistólica / diastólica)' },
  { key: 'Frecuencia_Cardiaca', label: 'Frecuencia cardíaca (lpm)' },
  { key: 'SpO2', label: 'Saturación de oxígeno (%)' },
  { key: 'Temperatura', label: 'Temperatura (°C)' },
  { key: 'Frecuencia_Respiratoria', label: 'Frecuencia respiratoria (rpm)' }
];

function tableRows(rows) {
  if (!rows.length) return emptyRow(6);
  return rows.slice().reverse().map(r => `
    <tr>
      <td class="py-2 px-3 font-mono-data text-xs">${fmtDateTime(r.Fecha_Hora)}</td>
      <td class="py-2 px-3 font-mono-data ${cellFlag('PA_Sistolica', r.PA_Sistolica)}">${r.PA_Sistolica}/${r.PA_Diastolica}</td>
      <td class="py-2 px-3 font-mono-data ${cellFlag('Frecuencia_Cardiaca', r.Frecuencia_Cardiaca)}">${r.Frecuencia_Cardiaca}</td>
      <td class="py-2 px-3 font-mono-data ${cellFlag('SpO2', r.SpO2)}">${r.SpO2}%</td>
      <td class="py-2 px-3 font-mono-data ${cellFlag('Temperatura', r.Temperatura)}">${r.Temperatura}°C</td>
      <td class="py-2 px-3 font-mono-data ${cellFlag('Frecuencia_Respiratoria', r.Frecuencia_Respiratoria)}">${r.Frecuencia_Respiratoria}</td>
    </tr>`).join('');
}

function drawChart(charts, vitals, metric) {
  const labels = vitals.map(r => fmtDateTime(r.Fecha_Hora));
  const datasets = metric === 'PA'
    ? [
        { label: 'Sistólica', data: vitals.map(r => r.PA_Sistolica), borderColor: '#1F7A6C', backgroundColor: '#1F7A6C', fill: false },
        { label: 'Diastólica', data: vitals.map(r => r.PA_Diastolica), borderColor: '#B8863A', backgroundColor: '#B8863A', fill: false }
      ]
    : [{ label: VITAL_LABELS[metric] ?? metric, data: vitals.map(r => r[metric]), borderColor: '#1F7A6C', backgroundColor: '#E4F1EE', fill: true }];
  charts.render('vitalChart', labels, datasets);
}

export const vitalesSection = {
  id: 'vitales',

  render(record) {
    return `
      ${sectionHeader('Signos vitales', 'modal-vital')}
      <div class="bg-white rounded-lg border border-hairline p-4 mb-4">
        <label class="text-xs text-[#5C6B67]">Graficar:
          <select id="vitalMetricSelect" class="ml-2 border border-hairline rounded-md px-2 py-1 text-sm">
            ${OPTIONS.map(o => `<option value="${o.key}">${o.label}</option>`).join('')}
          </select>
        </label>
        <div class="chart-wrap mt-3"><canvas id="vitalChart"></canvas></div>
      </div>
      ${tableWrap(tableRows(record.vitals))}`;
  },

  mount(root, record, { charts }) {
    root.querySelector('#vitalMetricSelect')
      .addEventListener('change', e => drawChart(charts, record.vitals, e.target.value));
    drawChart(charts, record.vitals, 'PA');
  }
};
