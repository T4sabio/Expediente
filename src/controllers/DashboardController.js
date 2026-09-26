import { SECTIONS, SEARCH, DEFAULT_AGE_UNIT } from '../utils/constants.js';
import { calendarDateOf, todayISODate } from '../utils/formatters.js';
import { Patient } from '../models/Patient.js';
import { VitalSigns } from '../models/VitalSigns.js';
import { Medication } from '../models/Medication.js';
import { LabResult, Consultation, Culture, PendingTask } from '../models/ClinicalRecords.js';
import { sectionViewFor } from '../views/sections/index.js';

/**
 * Orquestador: escucha eventos del DOM (delegación por data-action), llama al ApiService,
 * actualiza el AppState y reacciona a sus cambios delegando el dibujo a las vistas.
 * No construye HTML ni conoce Supabase.
 */
export class DashboardController {
  #api; #auth; #state; #view; #modals; #toast; #charts;
  #searchTimer = null;
  #searchSeq = 0; // descarta respuestas de búsquedas viejas
  #loadSeq = 0;   // descarta expedientes de pacientes que ya no son el actual
  #actions;
  #submitHandlers;
  #signupMode = false;
  #pendingDelete = null; // { hc, nombre } — paciente a confirmar en modal-eliminar-paciente

  constructor({ api, auth, state, view, modals, toast, charts }) {
    this.#api = api; this.#auth = auth; this.#state = state; this.#view = view;
    this.#modals = modals; this.#toast = toast; this.#charts = charts;

    this.#actions = {
      'switch-section': el => this.switchSection(el.dataset.section),
      'open-modal': el => this.#modals.open(el.dataset.modal),
      'close-modal': el => this.#modals.close(el.dataset.modal),
      'select-patient': el => this.#selectByHC(el.dataset.hc),
      'refresh': () => { if (this.#state.get().currentHC) this.loadPatient(this.#state.get().currentHC, { silent: true }); },
      'nuevo-paciente': () => this.#modals.open('modal-nuevo-paciente', { Edad_Unidad: this.#state.get().lastAgeUnit }),
      'editar-paciente': () => this.#openEditPatient(),
      'pedir-eliminar-paciente': () => this.#openDeleteConfirm(),
      'suspender-med': el => this.#quickAction(() => this.#api.suspendMedication(Number(el.dataset.id)), 'Medicamento suspendido'),
      'completar-pendiente': el => this.#quickAction(() => this.#api.completeTask(Number(el.dataset.id)), 'Pendiente marcado como realizado'),
      'responder-consulta': el => this.#modals.open('modal-responder', { _row: el.dataset.id }),
      'resultado-cultivo': el => this.#modals.open('modal-resultado-cultivo', { _row: el.dataset.id }),
      'cerrar-sesion': () => this.#signOut(),
      'toggle-signup': () => { this.#signupMode = !this.#signupMode; this.#view.setSignupMode(this.#signupMode); }
    };

    // Formularios que solo agregan un registro al paciente abierto.
    const record = (modal, build, save, message) => form => this.#submitRecord(form, modal, build, save, message);
    this.#submitHandlers = {
      'form-vital': record('modal-vital', (f, hc) => VitalSigns.fromForm(f, hc), e => this.#api.addVitalSigns(e), 'Signos vitales registrados'),
      'form-med': record('modal-med', (f, hc) => Medication.fromForm(f, hc), e => this.#api.addMedication(e), 'Medicamento agregado'),
      'form-lab': record('modal-lab', (f, hc) => LabResult.fromForm(f, hc), e => this.#api.addLab(e), 'Resultado de laboratorio agregado'),
      'form-consulta': record('modal-consulta', (f, hc) => Consultation.fromForm(f, hc), e => this.#api.addConsultation(e), 'Interconsulta enviada'),
      'form-cultivo': record('modal-cultivo', (f, hc) => Culture.fromForm(f, hc), e => this.#api.addCulture(e), 'Cultivo enviado a microbiología'),
      'form-pendiente': record('modal-pendiente', (f, hc) => PendingTask.fromForm(f, hc), e => this.#api.addTask(e), 'Tarea pendiente agregada'),
      'form-responder': form => this.#submitSimple(form, 'modal-responder', 'Respuesta registrada', f =>
        this.#api.answerConsultation(Number(f._row), String(f.Respuesta_Departamento).trim())),
      'form-resultado-cultivo': form => this.#submitSimple(form, 'modal-resultado-cultivo', 'Resultado de cultivo registrado', f =>
        this.#api.resolveCulture(Number(f._row), f.Resultado, String(f.Observaciones_Microbiologia ?? '').trim())),
      'form-nuevo-paciente': form => this.#createPatient(form),
      'form-editar-paciente': form => this.#updatePatient(form),
      'form-eliminar-paciente': form => this.#confirmDeletePatient(form),
      'form-login': form => this.#submitLogin(form)
    };
  }

  /* ================================================================
     Arranque: sin sesión, se muestra el login antes que nada.
     El expediente completo nunca se carga hasta haber autenticado.
     ================================================================ */
  async init() {
    this.#view.buildRail(SECTIONS);
    this.#state.subscribe((s, prev) => this.#onStateChange(s, prev));
    this.#bindEvents();
    this.#view.hideLoading();

    const session = await this.#auth.getSession();
    if (session) await this.#onSignedIn();
    else this.#view.showLoginScreen();

    this.#auth.onAuthStateChange(async s => {
      if (s && !this.#state.get().authed) await this.#onSignedIn();
      if (!s && this.#state.get().authed) this.#onSignedOut();
    });
  }

  async #onSignedIn() {
    this.#state.set({ authed: true });
    this.#view.hideLoginScreen();
    try {
      const profile = await this.#auth.getMyProfile();
      this.#view.renderUser(profile);
    } catch { /* la UI seguirá funcionando; el servidor decide qué se puede hacer */ }
    try {
      this.#state.set({ servicios: await this.#api.listServicios() });
    } catch (err) {
      this.#toast.show('Error al cargar servicios: ' + err.message, 'error');
    }
  }

  #onSignedOut() {
    this.#loadSeq++; this.#searchSeq++;
    this.#state.set({ authed: false, record: null, currentHC: null, searchResults: null, servicios: [] });
    this.#view.hideUser();
    this.#view.setSearchText('');
    this.#view.showLoginScreen();
  }

  async #submitLogin(form) {
    const f = this.#modals.readForm(form);
    this.#view.clearLoginError();
    try {
      if (this.#signupMode) await this.#auth.signUp(f.email, f.password, f.nombre);
      else await this.#auth.signInWithPassword(f.email, f.password);
      form.reset();
      // onAuthStateChange dispara #onSignedIn(); si Supabase pide confirmar el
      // correo, no habrá sesión todavía y se lo indicamos a la persona.
      if (!(await this.#auth.getSession())) {
        this.#view.showLoginError('Revisa tu correo para confirmar la cuenta antes de iniciar sesión.');
      }
    } catch (err) {
      this.#view.showLoginError(err.message);
    }
  }

  async #signOut() {
    try { await this.#auth.signOut(); } catch (err) { this.#toast.show(err.message, 'error'); }
  }

  #bindEvents() {
    document.addEventListener('click', e => this.#onClick(e));
    document.addEventListener('submit', e => this.#onSubmit(e));
    document.addEventListener('input', e => { if (e.target.id === 'patientSearch') this.#scheduleSearch(); });
    document.addEventListener('focusin', e => { if (e.target.id === 'patientSearch') this.#scheduleSearch(0); });
    document.addEventListener('change', e => {
      if (e.target.id === 'servicioFilter') this.#runSearch();
      if (e.target.name === 'Edad_Unidad') this.#state.set({ lastAgeUnit: e.target.value });
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.id === 'patientSearch') { e.preventDefault(); this.#selectFirstMatch(); }
    });
  }

  #onClick(e) {
    if (!e.target.closest('#patientSearch, #searchResults') && this.#state.get().searchResults !== null) {
      this.#state.set({ searchResults: null });
    }
    const el = e.target.closest('[data-action]');
    this.#actions[el?.dataset.action]?.(el);
  }

  #onSubmit(e) {
    const form = e.target.closest('form');
    const handler = form && this.#submitHandlers[form.id];
    if (!handler) return;
    e.preventDefault();
    this.#guarded(form, () => handler(form));
  }

  /* ================================================================
     Reacción a cambios de estado (flujo unidireccional)
     ================================================================ */
  #onStateChange(s, prev) {
    if (s.servicios !== prev.servicios) this.#view.renderServicios(s.servicios);

    if (s.searchResults !== prev.searchResults) {
      if (s.searchResults === null) this.#view.hideSearchResults();
      else this.#view.renderSearchResults(s.searchResults);
    }

    const recordChanged = s.record !== prev.record;
    if (recordChanged) {
      if (s.record) {
        this.#view.showPatientView();
        this.#view.renderHeader(s.record.patient);
        this.#view.setLabTypes(s.record.labTypes);
      } else {
        this.#charts.destroy();
        this.#view.showEmptyState();
      }
    }

    if (recordChanged || s.currentSection !== prev.currentSection) {
      this.#view.highlightSection(s.currentSection);
      if (s.record) this.#renderSection();
    }
  }

  #renderSection() {
    const { record, currentSection } = this.#state.get();
    const section = sectionViewFor(currentSection);
    const ctx = { charts: this.#charts, today: todayISODate() };
    this.#charts.destroy();
    try {
      this.#view.setSectionHtml(section.render(record, ctx));
      section.mount?.(this.#view.sectionContainer, record, ctx);
    } catch (err) {
      console.error(err);
      this.#toast.show('No se pudo mostrar la sección: ' + err.message, 'error');
    }
  }

  /* ================================================================
     Búsqueda (en el servidor, con debounce)
     ================================================================ */
  #scheduleSearch(delay = SEARCH.DEBOUNCE_MS) {
    clearTimeout(this.#searchTimer);
    this.#searchTimer = setTimeout(() => this.#runSearch(), delay);
  }

  async #runSearch() {
    const { query, servicio } = this.#view.getSearchInput();
    const seq = ++this.#searchSeq;
    if (!query && !servicio) {
      this.#state.set({ searchResults: null });
      return null;
    }
    try {
      const results = await this.#api.searchPatients({ query, servicio });
      if (seq !== this.#searchSeq) return null;
      this.#state.set({ searchResults: results });
      return results;
    } catch (err) {
      if (seq === this.#searchSeq) this.#toast.show('Error en la búsqueda: ' + err.message, 'error');
      return null;
    }
  }

  async #selectFirstMatch() {
    clearTimeout(this.#searchTimer);
    const results = await this.#runSearch();
    if (results?.length) this.#selectPatient(results[0]);
  }

  #selectByHC(hc) {
    const found = this.#state.get().searchResults?.find(p => p.HC === hc);
    this.#selectPatient(found ?? new Patient({ HC: hc, Nombre_Completo: hc }));
  }

  #selectPatient(patient) {
    this.#searchSeq++; // invalida búsquedas en vuelo
    this.#state.set({ searchResults: null });
    this.#view.setSearchText(patient.Nombre_Completo);
    this.loadPatient(patient.HC);
  }

  /* ================================================================
     Carga de paciente
     ================================================================ */
  async loadPatient(hc, { silent = false } = {}) {
    const seq = ++this.#loadSeq;
    if (!silent) {
      // Nunca dejar visible el expediente de otro paciente mientras carga el nuevo.
      this.#state.set({ record: null, currentHC: hc });
      this.#view.showPatientLoading();
    }
    try {
      const record = await this.#api.getPatientRecord(hc);
      if (seq !== this.#loadSeq) return;
      this.#state.set({ record, currentHC: hc });
    } catch (err) {
      if (seq !== this.#loadSeq) return;
      this.#toast.show('Error al cargar el paciente: ' + err.message, 'error');
      if (!silent) { this.#state.set({ currentHC: null }); this.#view.showEmptyState(); }
    }
  }

  switchSection(id) {
    if (SECTIONS.some(s => s.id === id)) this.#state.set({ currentSection: id });
  }

  #reload() {
    return this.loadPatient(this.#state.get().currentHC, { silent: true });
  }

  async #refreshServicios() {
    try { this.#state.set({ servicios: await this.#api.listServicios() }); } catch { /* no crítico */ }
  }

  /* ================================================================
     Formularios
     ================================================================ */
  /** Deshabilita el botón mientras se guarda y muestra cualquier error como toast. */
  async #guarded(form, task) {
    const btn = form.querySelector('button[type="submit"]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      await task();
    } catch (err) {
      this.#toast.show(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async #submitRecord(form, modalId, build, save, message) {
    const hc = this.#state.get().currentHC;
    if (!hc) throw new Error('Selecciona un paciente primero.');
    await save(build(this.#modals.readForm(form), hc));
    this.#modals.close(modalId);
    this.#toast.show(message);
    await this.#reload();
  }

  async #submitSimple(form, modalId, message, save) {
    await save(this.#modals.readForm(form));
    this.#modals.close(modalId);
    this.#toast.show(message);
    await this.#reload();
  }

  async #quickAction(task, message) {
    try {
      await task();
      this.#toast.show(message);
      await this.#reload();
    } catch (err) {
      this.#toast.show(err.message, 'error');
    }
  }

  async #createPatient(form) {
    const f = this.#modals.readForm(form);
    this.#state.set({ lastAgeUnit: f.Edad_Unidad || DEFAULT_AGE_UNIT });
    const patient = Patient.fromForm(f).validate();
    await this.#api.createPatient(patient);
    this.#modals.close('modal-nuevo-paciente');
    this.#toast.show('Paciente registrado correctamente');
    this.#refreshServicios();
    this.#view.setSearchText(patient.Nombre_Completo);
    this.loadPatient(patient.HC);
  }

  #openEditPatient() {
    const { record, lastAgeUnit } = this.#state.get();
    if (!record) return;
    const g = record.patient;
    const age = g.age(lastAgeUnit);
    this.#modals.open('modal-editar-paciente', {
      _row: g.HC, HC: g.HC, Edad: age.valor, Edad_Unidad: age.unidad,
      Nombre_Completo: g.Nombre_Completo, Servicio: g.Servicio, Cama: g.Cama,
      Fecha_Ingreso: calendarDateOf(g.Fecha_Ingreso) ?? '', Num_RayosX: g.Num_RayosX,
      Motivo_Consulta: g.Motivo_Consulta, Diagnosticos: g.Diagnosticos
    });
  }

  async #updatePatient(form) {
    const f = this.#modals.readForm(form);
    this.#state.set({ lastAgeUnit: f.Edad_Unidad || DEFAULT_AGE_UNIT });
    const patient = Patient.fromForm(f).validate({ requireHC: false });
    await this.#api.updatePatient(f._row, patient);
    this.#modals.close('modal-editar-paciente');
    this.#toast.show('Datos del paciente actualizados');
    this.#refreshServicios();
    await this.#reload();
  }

  /** Abre el modal de confirmación escrita (no usa confirm() del navegador). */
  #openDeleteConfirm() {
    const { record } = this.#state.get();
    if (!record) return;
    const g = record.patient;
    this.#pendingDelete = { hc: g.HC, nombre: g.Nombre_Completo };
    this.#modals.open('modal-eliminar-paciente', { _row: g.HC, confirmacion: '' });
    const aviso = document.getElementById('eliminarPacienteAviso');
    const err = document.getElementById('eliminarPacienteError');
    if (aviso) aviso.textContent = `Vas a eliminar a "${g.Nombre_Completo}" (HC ${g.HC}). El registro y su historial se ocultarán pero no se borran permanentemente.`;
    if (err) err.classList.add('hidden');
  }

  /** Solo procede si la persona escribió el nombre exacto del paciente: barrera contra clics accidentales. */
  async #confirmDeletePatient(form) {
    const f = this.#modals.readForm(form);
    const err = document.getElementById('eliminarPacienteError');
    if (!this.#pendingDelete || f.confirmacion.trim() !== this.#pendingDelete.nombre.trim()) {
      if (err) { err.textContent = 'El nombre no coincide. Escríbelo exactamente como aparece en el expediente.'; err.classList.remove('hidden'); }
      return;
    }
    try {
      await this.#api.deletePatient(f._row);
      this.#pendingDelete = null;
      this.#modals.close('modal-eliminar-paciente');
      this.#modals.close('modal-editar-paciente');
      this.#toast.show('Paciente eliminado (puede restaurarse desde la base de datos si fue un error)');
      this.#loadSeq++;
      this.#state.set({ record: null, currentHC: null });
      this.#view.setSearchText('');
      this.#refreshServicios();
    } catch (apiErr) {
      if (err) { err.textContent = apiErr.message; err.classList.remove('hidden'); }
      else this.#toast.show(apiErr.message, 'error');
    }
  }
}
