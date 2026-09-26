const BASE = 'fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium text-white fade-in ';

export class Toast {
  #el;
  #timer = null;

  constructor(element) {
    this.#el = element;
  }

  /** @param {'ok'|'error'} type */
  show(message, type = 'ok') {
    this.#el.textContent = message; // textContent: nunca interpreta HTML
    this.#el.className = BASE + (type === 'error' ? 'bg-critical' : 'bg-ok');
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#el.classList.add('hidden'), 3200);
  }
}
