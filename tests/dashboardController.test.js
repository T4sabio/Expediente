import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, ConflictError } from '../src/utils/errors.js';
import { PatientRecord } from '../src/models/PatientRecord.js';
import { PendingTask } from '../src/models/ClinicalRecords.js';
import { Patient } from '../src/models/Patient.js';

/**
 * DashboardController escucha eventos directamente en el `document` global (no
 * inyectado), así que aquí se instala un `document` mínimo ANTES de importar
 * el controlador, y se disparan los eventos "a mano". Todo lo demás (vista,
 * modales, api, auth, toast) sí es inyectado por constructor, así que se
 * reemplaza por dobles de prueba simples que solo registran llamadas.
 */
const listeners = {};
globalThis.document = {
  addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
  removeEventListener() {},
  getElementById() { return null; },
  querySelectorAll() { return []; }
};
function dispatch(type, evt) { for (const fn of [...(listeners[type] || [])]) fn(evt); }

const { DashboardController } = await import('../src/controllers/DashboardController.js');
const { AppState, createInitialState } = await import('../src/state/AppState.js');

function fakeForm(id, { onSubmitButton } = {}) {
  const btn = { disabled: false, textContent: 'Guardar', get label() { return this.textContent; } };
  const form = {
    id,
    reset() {},
    querySelector(sel) { return sel.includes('submit') ? btn : null; },
    closest(sel) { return sel === 'form' ? form : null; }
  };
  onSubmitButton?.(btn);
  return form;
}
function submit(form) { dispatch('submit', { target: form, preventDefault() {} }); }
function click(el) { dispatch('click', { target: { closest: sel => (sel === '[data-action]' ? el : null) } }); }

function makeView() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    buildRail: record('buildRail'), hideLoading: record('hideLoading'),
    showLoginScreen: record('showLoginScreen'), hideLoginScreen: record('hideLoginScreen'),
    clearLoginError: record('clearLoginError'), showLoginError: record('showLoginError'),
    renderUser: record('renderUser'), hideUser: record('hideUser'),
    setSearchText: record('setSearchText'), renderServicios: record('renderServicios'),
    showEmptyState: record('showEmptyState'), showPatientView: record('showPatientView'),
    showPatientLoading: record('showPatientLoading'), renderHeader: record('renderHeader'),
    setLabTypes: record('setLabTypes'), highlightSection: record('highlightSection'),
    setSectionHtml: record('setSectionHtml'), sectionContainer: {},
    getSearchInput: () => ({ query: '', servicio: '' }),
    renderSearchResults: record('renderSearchResults'), hideSearchResults: record('hideSearchResults'),
    showSearchSpinner: record('showSearchSpinner'), hideSearchSpinner: record('hideSearchSpinner'),
    announceSearchStatus: record('announceSearchStatus'), showFatalError: record('showFatalError'),
    renderRound: record('renderRound'), renderRoundLoading: record('renderRoundLoading'), setUiPreferences: record('setUiPreferences'),
    setNovedadesCount: record('setNovedadesCount'), focusSearch: record('focusSearch')
  };
}
function makeModals(formValues = {}) {
  const calls = [];
  return { calls, open: (...a) => calls.push(['open', ...a]), close: (...a) => calls.push(['close', ...a]), readForm: () => formValues };
}
function makeToast() {
  const calls = [];
  return { calls, show: (...a) => calls.push(a), dismiss: (...a) => calls.push(['dismiss', ...a]) };
}
const charts = { render() {}, destroy() {} };

function setup({ session = null, auth = {}, api = {} } = {}) {
  for (const k of Object.keys(listeners)) delete listeners[k];
  const view = makeView();
  const modals = makeModals();
  const toast = makeToast();
  const state = new AppState(createInitialState());
  const fullAuth = {
    getSession: async () => session,
    onAuthStateChange: () => {},
    getMyProfile: async () => ({ nombre: 'Dra. Ruiz', rol: 'medico', activo: true, pendiente: false }),
    signInWithPassword: async () => ({}),
    signUp: async () => ({}),
    signOut: async () => {},
    ...auth
  };
  const fullApi = { listServicios: async () => [], getRoundOverview: async () => [], ...api };
  const controller = new DashboardController({ api: fullApi, auth: fullAuth, state, view, modals, toast, charts });
  return { controller, view, modals, toast, state, auth: fullAuth, api: fullApi };
}

/* ---------------------------- Auth ---------------------------- */

test('init(): sin sesión, muestra la pantalla de login y NO carga nada del servidor', async () => {
  const { controller, view, api } = setup({ session: null });
  let listServiciosCalled = false;
  api.listServicios = async () => { listServiciosCalled = true; return []; };
  await controller.init();
  assert.ok(view.calls.some(c => c[0] === 'showLoginScreen'));
  assert.equal(listServiciosCalled, false);
});

test('init(): con sesión activa, entra directo y carga servicios', async () => {
  const { controller, view } = setup({ session: { user: { id: 'u1' } } });
  await controller.init();
  assert.ok(view.calls.some(c => c[0] === 'hideLoginScreen'));
  assert.ok(view.calls.some(c => c[0] === 'renderServicios'));
});

test('login: credenciales incorrectas muestran el error en la pantalla de login, no un toast genérico', async () => {
  const { controller, view } = setup({
    session: null,
    auth: { signInWithPassword: async () => { throw new ApiError('Correo o contraseña incorrectos.'); } }
  });
  await controller.init();
  const form = fakeForm('form-login');
  submit(form);
  await new Promise(r => setTimeout(r, 0));
  assert.ok(view.calls.some(c => c[0] === 'showLoginError' && c[1] === 'Correo o contraseña incorrectos.'));
});

/* ---------------------------- Guardado ---------------------------- */

test('guardado: al fallar, el modal NO se cierra y el botón vuelve a habilitarse', async () => {
  const { controller, modals, toast } = setup({
    session: { user: { id: 'u1' } },
    api: {
      getPatientRecord: async () => new PatientRecord({ patient: new Patient({ HC: '2026-1', Nombre_Completo: 'Ana' }) }),
      addVitalSigns: async () => { throw new ApiError('La PA sistólica debe ser mayor que la diastólica.'); }
    }
  });
  await controller.init();
  await controller.loadPatient('2026-1', { silent: true });

  let btnRef;
  const form = fakeForm('form-vital', { onSubmitButton: b => (btnRef = b) });
  submit(form);
  await new Promise(r => setTimeout(r, 0));

  assert.equal(modals.calls.some(c => c[0] === 'close'), false, 'el modal no debería cerrarse tras un error');
  assert.equal(btnRef.disabled, false, 'el botón debe volver a habilitarse');
  assert.ok(toast.calls.some(c => c[1] === 'error'));
});

test('guardado: sin conexión, el mensaje es sobre la red y no el texto crudo del error', async () => {
  const { controller, toast, modals } = setup({
    session: { user: { id: 'u1' } },
    api: {
      getPatientRecord: async () => new PatientRecord({ patient: new Patient({ HC: '2026-1', Nombre_Completo: 'Ana' }) }),
      addVitalSigns: async () => { throw new TypeError('Failed to fetch'); }
    }
  });
  modals.readForm = () => ({
    Fecha_Hora: '2026-09-24T14:30', PA_Sistolica: '120', PA_Diastolica: '80',
    Frecuencia_Cardiaca: '72', SpO2: '98', Temperatura: '36.8', Frecuencia_Respiratoria: '16'
  });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  await controller.init();
  await controller.loadPatient('2026-1', { silent: true });
  submit(fakeForm('form-vital'));
  await new Promise(r => setTimeout(r, 0));
  const errorToast = toast.calls.find(c => c[1] === 'error');
  assert.match(errorToast[0], /[Ss]in conexión/);
});

/* ---------------------------- Concurrencia (2.5) ---------------------------- */

function makeRecord(tasks) {
  return new PatientRecord({ patient: new Patient({ HC: '2026-1', Nombre_Completo: 'Ana' }), tasks });
}

test('completar-pendiente: en conflicto, revierte el cambio optimista y recarga el expediente', async () => {
  let reloadCount = 0;
  const record = makeRecord([new PendingTask({ id: 5, Estado: 'Pendiente', Modificado_En: 'v1' })]);
  const { controller, state, toast } = setup({
    session: { user: { id: 'u1' } },
    api: {
      getPatientRecord: async () => { reloadCount++; return record; },
      completeTask: async () => { throw new ConflictError('Otra persona ya actualizó este pendiente mientras tanto.'); }
    }
  });
  await controller.init();
  await controller.loadPatient('2026-1', { silent: true }); // reloadCount = 1

  click({ dataset: { action: 'completar-pendiente', id: '5' } });
  await new Promise(r => setTimeout(r, 0));

  assert.equal(state.get().record.tasks[0].Estado, 'Pendiente', 'debe revertir el parche optimista');
  assert.ok(toast.calls.some(c => c[0].includes('Otra persona')));
  assert.ok(reloadCount >= 2, 'debe recargar el expediente tras el conflicto');
});

test('completar-pendiente: sin conflicto, el cambio optimista se mantiene', async () => {
  const record = makeRecord([new PendingTask({ id: 6, Estado: 'Pendiente', Modificado_En: 'v1' })]);
  const { controller, state } = setup({
    session: { user: { id: 'u1' } },
    api: { getPatientRecord: async () => record, completeTask: async () => [{ id: 6 }] }
  });
  await controller.init();
  await controller.loadPatient('2026-1', { silent: true });

  click({ dataset: { action: 'completar-pendiente', id: '6' } });
  await new Promise(r => setTimeout(r, 0));

  assert.equal(state.get().record.tasks[0].Estado, 'Realizado');
});


test('init(): una cuenta inactiva no entra al dashboard', async () => {
  const { controller, view, auth } = setup({
    session: { user: { id: 'u1' } },
    auth: { getMyProfile: async () => ({ nombre: 'Dra. Ruiz', rol: 'medico', activo: false, pendiente: false }) }
  });
  await controller.init();
  assert.ok(view.calls.some(c => c[0] === 'showLoginScreen'));
  assert.ok(view.calls.some(c => c[0] === 'showLoginError' && /inactivo/i.test(c[1])));
  assert.ok(!view.calls.some(c => c[0] === 'hideLoginScreen'));
  assert.ok(auth);
});
