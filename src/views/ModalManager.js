export class ModalManager {
  #doc;

  constructor(doc = document) {
    this.#doc = doc;
    doc.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeAll(); });
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
  }

  close(id) {
    const modal = this.#doc.getElementById(id);
    modal.classList.add('hidden');
    modal.querySelector('form')?.reset();
  }

  closeAll() {
    this.#doc.querySelectorAll('[id^="modal-"]:not(.hidden)').forEach(m => this.close(m.id));
  }

  /** Campos habilitados del formulario como objeto plano. */
  readForm(form) {
    return Object.fromEntries(new FormData(form));
  }
}
