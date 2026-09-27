/** Dueño de la instancia activa de Chart.js. Chart.js se carga bajo demanda para
 * que el dashboard inicial no pague el coste de una librería que solo se necesita
 * en las secciones de gráficos. */
export class ChartManager {
  #chart = null;
  #chartCtor = null;
  #loadPromise = null;

  async #getChart() {
    if (this.#chartCtor) return this.#chartCtor;
    if (!this.#loadPromise) {
      this.#loadPromise = import('chart.js').then(({ Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend }) => {
        Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);
        this.#chartCtor = Chart;
        return Chart;
      });
    }
    return this.#loadPromise;
  }

  async render(canvasId, labels, datasets) {
    this.destroy();
    const Chart = await this.#getChart();
    const canvas = document.getElementById(canvasId);
    if (!canvas?.isConnected) return;
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
