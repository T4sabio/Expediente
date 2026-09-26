import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend } from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);

/** Dueño de la instancia activa de Chart.js (antes era la variable global `activeChart`). */
export class ChartManager {
  #chart = null;

  render(canvasId, labels, datasets) {
    this.destroy();
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    this.#chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: datasets.length > 1 } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { grid: { color: '#EEF2F1' }, ticks: { font: { size: 10 } } }
        },
        elements: { point: { radius: 3, hoverRadius: 5 }, line: { tension: 0.3 } }
      }
    });
  }

  destroy() {
    this.#chart?.destroy();
    this.#chart = null;
  }
}
