const TONE = { ok: 'bg-ok', error: 'bg-critical', warn: 'bg-warn' };

/**
 * Contenedor de toasts apilables con aria-live: un lector de pantalla anuncia
 * cada mensaje (antes solo había uno visual y sin aria-live, y dos errores
 * seguidos se pisaban). `element` es el contenedor (ver index.html #toast).
 */
export class Toast {
  #container;
  #seq = 0;

  constructor(container) {
    this.#container = container;
    this.#container.classList.remove('hidden');
    this.#container.setAttribute('role', 'status');
    this.#container.setAttribute('aria-live', 'polite');
    this.#container.setAttribute('aria-atomic', 'false');
  }

  /**
   * @param {'ok'|'error'|'warn'} type
   * @param {{persistent?: boolean, id?: string}} [opts] `persistent` evita el auto-cierre
   *   y agrega un botón para cerrar a mano — para avisos que siguen siendo válidos
   *   más allá de los ~4s de un toast normal (ej. "sin conexión", "búsqueda en modo
   *   básico"). `id` permite reemplazar/actualizar un aviso persistente existente
   *   en vez de apilar uno nuevo cada vez que se repite la misma condición.
   */
  show(message, type = 'ok', opts = {}) {
    const { persistent = false, id: stickyId } = opts;
    if (stickyId) this.dismiss(stickyId);
    const id = ++this.#seq;
    const el = document.createElement('div');
    el.dataset.toastId = String(id);
    if (stickyId) el.dataset.stickyId = stickyId;
    el.className = `px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium text-white fade-in flex items-center gap-3 ${TONE[type] ?? TONE.ok}`;
    // El error se anuncia de inmediato (assertive); los mensajes de éxito no interrumpen (aria-live=polite del contenedor).
    if (type === 'error') el.setAttribute('role', 'alert');
    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);
    if (persistent) {
      const close = document.createElement('button');
      close.type = 'button';
      close.setAttribute('aria-label', 'Cerrar aviso');
      close.className = 'shrink-0 opacity-80 hover:opacity-100 leading-none text-base';
      close.textContent = '×';
      close.addEventListener('click', () => el.remove());
      el.appendChild(close);
    } else {
      setTimeout(() => el.remove(), 4200);
    }
    this.#container.appendChild(el);
  }

  /** Quita un aviso persistente por su `id` (ver `stickyId` en `show`), si sigue presente. */
  dismiss(stickyId) {
    this.#container.querySelector(`[data-sticky-id="${CSS.escape(stickyId)}"]`)?.remove();
  }
}
