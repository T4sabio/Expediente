const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Maneja apertura/cierre de modales con foco accesible (WCAG 2.4.3):
 *  - Al abrir, el foco se mueve al primer campo del formulario.
 *  - Mientras está abierto, Tab/Shift+Tab quedan atrapados dentro del modal.
 *  - Al cerrar, el foco vuelve al elemento que lo abrió.
 *  - Clic en el fondo oscuro (backdrop) cierra el modal, igual que Escape.
 */
export class ModalManager {
  #doc;
  #openStack = []; // { id, trigger } — pila por si un modal abre a otro

  constructor(doc = document) {
    this.#doc = doc;
    doc.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.closeTop();
      else if (e.key === 'Tab') this.#trapTab(e);
    });
    doc.addEventListener('click', e => {
      // Solo cierra si el clic fue exactamente sobre el fondo (backdrop), no sobre el formulario.
      if (e.target.classList?.contains('modal-backdrop') && !e.target.classList.contains('hidden')) {
        this.close(e.target.id);
      }
    });
  }

  /** Abre el modal. Si se pasan `values` (nombre de campo → valor), reinicia el formulario y los precarga. */
  open(id, values) {
    const modal = this.#doc.getElementById(id);
    const form = modal.querySelector('form');
    if (values && form) {
      form.reset();
      for (const [name, value] of Object.entries(values)) {
        if (form.elements[name]) form.elements[name].value = value ?? '';
      }
    }
    modal.classList.remove('hidden');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const heading = form?.querySelector('h3, h2, [data-modal-title]');
    if (heading) {
      if (!heading.id) heading.id = `${id}-title`;
      modal.setAttribute('aria-labelledby', heading.id);
    }
    this.#openStack.push({ id, trigger: this.#doc.activeElement });
    this.#focusFirst(modal);
  }

  close(id) {
    const modal = this.#doc.getElementById(id);
    modal.classList.add('hidden');
    modal.querySelector('form')?.reset();
    const idx = this.#openStack.findIndex(e => e.id === id);
    if (idx === -1) return;
    const [entry] = this.#openStack.splice(idx, 1);
    if (!this.#openStack.length) entry.trigger?.focus?.();
  }

  closeTop() {
    const top = this.#openStack[this.#openStack.length - 1];
    if (top) this.close(top.id);
  }

  closeAll() {
    this.#doc.querySelectorAll('[id^="modal-"]:not(.hidden)').forEach(m => this.close(m.id));
  }

  /** Campos habilitados del formulario como objeto plano. */
  readForm(form) {
    return Object.fromEntries(new FormData(form));
  }

  #focusFirst(modal) {
    const target = modal.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])')
      ?? modal.querySelector(FOCUSABLE);
    target?.focus();
  }

  /** Atrapa Tab/Shift+Tab dentro del modal visible más reciente (focus trap). */
  #trapTab(e) {
    const top = this.#openStack[this.#openStack.length - 1];
    if (!top) return;
    const modal = this.#doc.getElementById(top.id);
    const focusables = [...modal.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = this.#doc.activeElement;
    if (e.shiftKey && (active === first || !modal.contains(active))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault(); first.focus();
    }
  }
}
