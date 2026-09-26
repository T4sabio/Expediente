/**
 * Store mínimo e inmutable. Reemplaza las variables globales sueltas:
 * el estado se lee con `get()`, solo se modifica con `set()` y cada cambio se notifica
 * a los suscriptores con (estadoNuevo, estadoAnterior).
 */
export class AppState {
  #state;
  #listeners = new Set();

  constructor(initial = {}) {
    this.#state = Object.freeze({ ...initial });
  }

  get() {
    return this.#state;
  }

  set(patch) {
    const prev = this.#state;
    const next = { ...prev, ...patch };
    const changed = Object.keys(patch).some(k => !Object.is(prev[k], next[k]));
    if (!changed) return;
    this.#state = Object.freeze(next);
    for (const fn of [...this.#listeners]) fn(this.#state, prev);
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export const createInitialState = () => ({
  authed: false,
  record: null,          // PatientRecord del paciente abierto
  currentHC: null,
  currentSection: 'resumen',
  searchResults: null,   // null = panel de resultados oculto
  servicios: [],
  lastAgeUnit: 'años'
});
