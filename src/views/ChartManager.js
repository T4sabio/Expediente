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

  async render(canvasId, labels, datasets, { yAxis = {} } = {}) {
    this.destroy();
    const Chart = await this.#getChart();
    const canvas = document.getElementById(canvasId);
    if (!canvas?.isConnected) return;
    const darkTheme = document.body.classList.contains('theme-dark');
    const axisText = darkTheme ? '#B0BFBB' : '#5C6B67';
    const gridColor = darkTheme ? '#394643' : '#EEF2F1';
    this.#chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: datasets.length > 1, labels: { color: axisText } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: axisText, font: { size: 10 } } },
          y: { ...yAxis, grid: { color: gridColor }, ticks: { color: axisText, font: { size: 10 }, ...yAxis.ticks } }
        },
        elements: { point: { radius: 3, hoverRadius: 5 }, line: { tension: 0.3 } }
      }
    });
  }

  async toDataUrl(labels, datasets, { yAxis = {} } = {}) {
    const Chart = await this.#getChart();
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 480;
    const chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: false, animation: false, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: datasets.length > 1 } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 18 } },
          y: { grid: { color: '#EEF2F1' }, ticks: { font: { size: 12 }, ...yAxis.ticks }, ...yAxis }
        },
        elements: { point: { radius: 2 }, line: { tension: 0.3 } }
      }
    });
    try {
      return canvas.toDataURL('image/png');
    } finally {
      chart.destroy();
    }
  }

  destroy() {
    this.#chart?.destroy();
    this.#chart = null;
  }
}
