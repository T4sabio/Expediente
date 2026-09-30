import { SECTIONS, SEARCH, DEFAULT_AGE_UNIT } from '../utils/constants.js';
import { calendarDateOf, fmtDateTime, todayISODate } from '../utils/formatters.js';
import { Patient } from '../models/Patient.js';
import { listKeyForTable } from '../models/PatientRecord.js';
import { VitalSigns } from '../models/VitalSigns.js';
import { Medication } from '../models/Medication.js';
import { LabResult, Consultation, Culture, PendingTask } from '../models/ClinicalRecords.js';
import { sectionViewFor } from '../views/sections/index.js';
import { ConflictError, InactiveUserError, isNetworkError } from '../utils/errors.js';
import { reportError } from '../utils/errorReporter.js';
import { markPerformance, measurePerformance } from '../utils/performance.js';
import { countTimelineUnread, getTimelineReadAt, markTimelineRead, readUiPreferences, writeUiPreferences } from '../utils/preferences.js';

const WRITE_ACTIONS = new Set([
  'nuevo-paciente', 'restaurar-paciente', 'editar-paciente', 'pedir-eliminar-paciente',
  'suspender-med', 'completar-pendiente', 'descompletar-pendiente', 'responder-consulta',
  'resultado-cultivo', 'open-modal'
]);
const NURSE_RESTRICTED_ACTIONS = new Set([
  'nuevo-paciente', 'editar-paciente', 'pedir-eliminar-paciente', 'restaurar-paciente', 'suspender-med'
]);
const newIdempotencyKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
  #pendingDelete = null; // { hc, nombre } — paciente a confirmar en modal-eliminar-paciente
  #pendingSearchPatient = null;
  #pendingEditModificadoEn = null; // sello de la última edición conocida, para detectar conflictos
  #unsubscribeRealtime = null;
  #realtimeDebounce = null;
  #idleTimer = null;
  #lastActivityAt = 0;
  #activityStorageKey = 'ronda-clinica:last-activity';
  #signOutReason = null;
  #palette = null;
  #timelineSeq = 0;
  #activityHandler = () => this.#touchActivity();
  #visibilityHandler = () => this.#handleVisibilityChange();
  static IDLE_TIMEOUT_MS = 15 * 60 * 1000;

  constructor({ api, auth, state, view, modals, toast, charts, palette = null }) {
    this.#api = api; this.#auth = auth; this.#state = state; this.#view = view;
    this.#modals = modals; this.#toast = toast; this.#charts = charts; this.#palette = palette;
    const prefs = readUiPreferences();
    this.#state.set({ density: prefs.density, highContrast: prefs.highContrast });

    this.#actions = {
      'switch-section': el => this.switchSection(el.dataset.section),
      'page-section': el => this.#loadSectionPage(el.dataset.listKey, Number(el.dataset.page)),
      'open-modal': el => { this.#resetConditionalFields(el.dataset.modal); this.#modals.open(el.dataset.modal); },
      'close-modal': el => this.#modals.requestClose?.(el.dataset.modal) ?? this.#modals.close(el.dataset.modal),
      'select-patient': el => this.#selectByHC(el.dataset.hc),
      'confirm-search-patient': () => this.#confirmSearchPatient(),
      'cancel-search-patient': () => { this.#pendingSearchPatient = null; this.#modals.close('modal-confirmar-paciente'); },
      'confirm-print-record': () => { this.#modals.close('modal-confirmar-impresion'); void this.#printRecord({ confirmed: true }); },
      'refresh': () => { if (this.#state.get().currentHC) this.loadPatient(this.#state.get().currentHC, { silent: true }); },
      'nuevo-paciente': () => this.#modals.open('modal-nuevo-paciente', { Edad_Unidad: this.#state.get().lastAgeUnit }),
      'restaurar-paciente': () => this.#openRestorePatient(),
      'editar-paciente': () => this.#openEditPatient(),
      'pedir-eliminar-paciente': () => this.#openDeleteConfirm(),
      'suspender-med': el => this.#openSuspendMedication(Number(el.dataset.id)),
      'completar-pendiente': el => this.#completeTaskWithUndo(Number(el.dataset.id)),
      'descompletar-pendiente': el => this.#quickActionOptimistic('tasks', Number(el.dataset.id),
        { Estado: 'Pendiente', Fecha_Completado: null },
        expected => this.#api.uncompleteTask(Number(el.dataset.id), expected), 'Pendiente marcado como no realizado'),
      'responder-consulta': el => this.#modals.open('modal-responder', { _row: el.dataset.id }),
      'resultado-cultivo': el => this.#modals.open('modal-resultado-cultivo', { _row: el.dataset.id }),
      'cerrar-sesion': () => this.#signOut(),
      'bloquear-sesion': () => this.#signOut('Sesión bloqueada por inactividad o por solicitud del usuario.'),
      'imprimir-expediente': () => this.#printRecord(),
      'open-command-palette': () => this.#openCommandPalette(),
      'open-novedades': () => this.#openNovedades(),
      'mark-timeline-read': () => this.#markTimelineRead(),
      'cycle-density': () => this.#cycleDensity(),
      'toggle-contrast': () => this.#toggleHighContrast()
    };

    // Formularios que solo agregan un registro al paciente abierto.
    const record = (listKey, modal, build, save, message) => form => this.#submitRecord(form, listKey, modal, build, save, message);
    this.#submitHandlers = {
      'form-vital': record('vitals', 'modal-vital', (f, hc) => VitalSigns.fromForm(f, hc), (e, o) => this.#api.addVitalSigns(e, o), 'Signos vitales registrados'),
      'form-med': record('medications', 'modal-med', (f, hc) => Medication.fromForm(f, hc), (e, o) => this.#api.addMedication(e, o), 'Medicamento agregado'),
      'form-lab': record('labs', 'modal-lab', (f, hc) => LabResult.fromForm(f, hc), (e, o) => this.#api.addLab(e, o), 'Resultado de laboratorio agregado'),
      'form-consulta': record('consultations', 'modal-consulta', (f, hc) => Consultation.fromForm(f, hc), (e, o) => this.#api.addConsultation(e, o), 'Interconsulta enviada'),
      'form-cultivo': record('cultures', 'modal-cultivo', (f, hc) => Culture.fromForm(f, hc), (e, o) => this.#api.addCulture(e, o), 'Cultivo enviado a microbiología'),
      'form-pendiente': record('tasks', 'modal-pendiente', (f, hc) => PendingTask.fromForm(f, hc), (e, o) => this.#api.addTask(e, o), 'Tarea pendiente agregada'),
      'form-pendiente-rapido': form => this.#addQuickTask(form),
      'form-responder': form => this.#submitSimple(form, 'modal-responder', 'Respuesta registrada', f =>
        this.#api.answerConsultation(Number(f._row), String(f.Respuesta_Departamento).trim(),
          this.#findItem('consultations', Number(f._row))?.Modificado_En)),
      'form-resultado-cultivo': form => this.#submitSimple(form, 'modal-resultado-cultivo', 'Resultado de cultivo registrado', f =>
        this.#api.resolveCulture(Number(f._row), f.Resultado, String(f.Observaciones_Microbiologia ?? '').trim(),
          this.#findItem('cultures', Number(f._row))?.Modificado_En)),
      'form-suspender-med': form => this.#suspendMedication(form),
      'form-nuevo-paciente': form => this.#createPatient(form),
      'form-editar-paciente': form => this.#updatePatient(form),
      'form-eliminar-paciente': form => this.#confirmDeletePatient(form),
      'form-restaurar-paciente': form => this.#restorePatient(form),
      'form-login': form => this.#submitLogin(form)
    };
  }

  /* ================================================================
     Arranque: sin sesión, se muestra el login antes que nada.
     El expediente completo nunca se carga hasta haber autenticado.
     ================================================================ */
  async init() {
    try {
      this.#view.buildRail(SECTIONS);
    this.#view.setUiPreferences(this.#state.get());
    this.#state.subscribe((s, prev) => this.#onStateChange(s, prev));
    this.#bindEvents();
    this.#view.hideLoading();

    const session = await this.#auth.getSession();
    if (session) {
      const lastActivityAt = this.#readActivityTimestamp();
      const elapsed = lastActivityAt === null ? Infinity : Date.now() - lastActivityAt;
      if (elapsed < 0 || elapsed >= DashboardController.IDLE_TIMEOUT_MS) {
        await this.#signOut('La sesión se cerró por 15 minutos de inactividad. Inicia sesión nuevamente para continuar.');
      } else {
        await this.#onSignedIn(lastActivityAt);
      }
    } else this.#view.showLoginScreen();

      this.#auth.onAuthStateChange(async s => {
        if (s && !this.#state.get().authed) await this.#onSignedIn();
        if (!s && this.#state.get().authed) this.#onSignedOut();
      });
    } catch (err) {
      reportError(err, { origin: 'bootstrap' });
      this.#view.showFatalError('No se pudo iniciar la aplicación. Verifica la configuración y la conexión.');
    }
  }

  async #onSignedIn(lastActivityAt = null) {
    try {
      const profile = await this.#auth.getMyProfile();
      if (profile.activo === false) {
        throw new InactiveUserError();
      }
      const session = await this.#auth.getSession();
      const userId = session?.user?.id ?? null;
      this.#state.set({ authed: true, userId, role: profile.rol, syncStatus: 'syncing', lastSyncedAt: null });
      this.#view.hideLoginScreen();
      this.#view.clearLoginError();
      this.#view.renderUser(profile);
      this.#startIdleWatch(lastActivityAt ?? Date.now());
      try {
        this.#state.set({ servicios: await this.#api.listServicios() });
      } catch (err) {
        this.#toast.show('Error al cargar servicios. Intenta actualizar.', 'error');
        reportError(err, { origin: 'load-services', operation: 'listServicios' });
      }
      void this.#loadRound();
    } catch (err) {
      reportError(err, { origin: 'profile', errorCode: err?.code ?? 'PROFILE_ERROR' });
      await this.#signOut(err instanceof InactiveUserError ? err.message : 'No se pudo verificar tu acceso.');
    }
  }

  #onSignedOut() {
    this.#stopIdleWatch();
    this.#modals.closeAll();
    this.#view.clearProtectedData();
    this.#clearActivityTimestamp();
    this.#loadSeq++; this.#searchSeq++;
    this.#stopRealtime();
    this.#state.set({ authed: false, record: null, currentHC: null, searchResults: null, servicios: [], round: [], timelineLoadedFor: null, syncStatus: 'idle', lastSyncedAt: null, newActivityCount: 0, lastViewedTimelineAt: 0, userId: null, role: null });
    this.#view.hideUser();
    this.#view.setSearchText('');
    this.#view.showLoginScreen();
    if (this.#signOutReason) {
      this.#view.showLoginError(this.#signOutReason);
      this.#signOutReason = null;
    } else {
      this.#view.clearLoginError();
    }
  }

  async #submitLogin(form) {
    const f = this.#modals.readForm(form);
    this.#view.clearLoginError();
    try {
      await this.#auth.signInWithPassword(f.email, f.password);
      form.reset();
    } catch (err) {
      this.#view.showLoginError(err.message);
    }
  }

  async #signOut(reason = null) {
    this.#signOutReason = reason;
    try {
      await this.#auth.signOut();
      // No dependemos de que el listener de Supabase llegue a tiempo;
      // limpiar el estado local también hace seguro el cierre durante bootstrap.
      this.#onSignedOut();
    } catch (err) {
      // Never leave a clinical screen visible just because remote logout failed.
      this.#onSignedOut();
      this.#toast.show('La sesión local se bloqueó, pero no se pudo confirmar el cierre con el servidor.', 'warn');
      reportError(err, { origin: 'signout' });
    }
  }

  /**
   * Arma una vista imprimible con TODAS las secciones (no solo la activa) y
   * dispara el diálogo de impresión del navegador (de ahí puede guardarse como PDF).
   * No usa una librería nueva: aprovecha el mismo render() de cada sección.
   */
  /** Vuelve a ocultar los campos condicionales (frecuencia/intervalo) al reabrir un modal. */
  #resetConditionalFields(modalId) {
    if (modalId === 'modal-med') document.getElementById('medFrecuenciaHorasWrap')?.classList.add('hidden');
    if (modalId === 'modal-cultivo') document.getElementById('cultivoIntervaloWrap')?.classList.add('hidden');
  }

  async #printRecord({ confirmed = false } = {}) {
    const state = this.#state.get();
    const record = state.record;
    if (!record) { this.#toast.show('Selecciona un paciente primero.', 'error'); return; }
    if (!confirmed) {
      const count = Object.values(record.pagination ?? {}).reduce((sum, meta) => sum + (Number(meta.total) || 0), 0);
      const summary = document.getElementById('printConfirmDetails');
      if (summary) summary.textContent = `Se incluirán todas las páginas del historial (${count} registros), la línea temporal y el gráfico de signos vitales.`;
      this.#modals.open('modal-confirmar-impresion');
      return;
    }

    const g = record.patient;
    this.#toast.show('Preparando la impresión completa…', 'warn');
    try {
      const sections = await Promise.all(Object.entries(record.pagination ?? {}).map(async ([listKey]) => {
        const first = await this.#api.getPatientSectionPage(g.HC, listKey, 1, { pageSize: 100 });
        const remaining = await Promise.all(Array.from(
          { length: Math.max(0, first.pagination.totalPages - 1) },
          (_, index) => this.#api.getPatientSectionPage(g.HC, listKey, index + 2, { pageSize: 100 })
        ));
        let items = [
          ...first.items,
          ...remaining.flatMap(page => page.items)
        ];
        if (listKey === 'vitals') {
          items = items.sort((a, b) => Date.parse(a.Fecha_Hora) - Date.parse(b.Fecha_Hora));
        }
        return [listKey, items, first.pagination];
      }));

      let printableRecord = record;
      for (const [listKey, items, pagination] of sections) {
        printableRecord = printableRecord.withListPage(listKey, items, {
          ...pagination, page: 1, pageSize: Math.max(1, items.length), total: items.length, totalPages: 1
        });
      }
      const timeline = await this.#api.getPatientTimeline(g.HC, { limit: 80 });
      printableRecord = printableRecord.withTimeline(timeline);
      if (this.#state.get().currentHC !== g.HC) throw new Error('El expediente cambió mientras se preparaba la impresión.');

      const vitals = printableRecord.vitals;
      const graph = vitals.length
        ? await this.#charts.toDataUrl(vitals.map(row => fmtDateTime(row.Fecha_Hora)), [
          { label: 'Sistólica', data: vitals.map(row => row.PA_Sistolica), borderColor: '#1F7A6C', backgroundColor: '#1F7A6C', fill: false },
          { label: 'Diastólica', data: vitals.map(row => row.PA_Diastolica), borderColor: '#B8863A', backgroundColor: '#B8863A', fill: false }
        ])
        : null;
      const graphMarkup = graph
        ? `<img class="print-chart" src="${graph}" alt="Gráfico de presión arterial con ${vitals.length} registros">`
        : '<p class="print-chart-empty">Sin signos vitales para graficar.</p>';
      const ctx = { charts: { render() {}, destroy() {} }, today: todayISODate(), pagination: null, timeline: printableRecord.timeline };
      let body = SECTIONS.map(section => {
        const html = sectionViewFor(section.id).render(printableRecord, ctx);
        return `<section class="print-section"><h2 class="print-section-title">${section.label}</h2>${html}</section>`;
      }).join('');
      body = body.replace(/<canvas id="vitalChart"[^>]*><\/canvas>/, () => graphMarkup);

      const container = document.createElement('div');
      container.className = 'print-only';

      const header = document.createElement('div');
      header.className = 'print-header';
      const meta = document.createElement('div');
      meta.className = 'print-meta';
      const profile = state.userId ? document.getElementById('userNombre')?.textContent?.trim() : '';
      meta.textContent = `CONFIDENCIAL · HC ${g.HC} · Impreso ${new Date().toLocaleString('es-GT')}${profile ? ` · ${profile}` : ''}`;
      const name = document.createElement('h1');
      name.className = 'print-name';
      name.textContent = g.Nombre_Completo || 'Paciente';
      const subline = document.createElement('div');
      subline.className = 'print-subline';
      subline.textContent = `${g.Servicio || '—'} · Cama ${g.Cama || '—'} · ${g.Edad || ''}`;
      const confidentiality = document.createElement('p');
      confidentiality.className = 'print-confidential';
      confidentiality.textContent = 'Documento clínico confidencial. Uso restringido a personal autorizado.';
      const disclosure = document.createElement('p');
      disclosure.className = 'print-disclosure';
      disclosure.textContent = `Impresión completa: ${Object.values(printableRecord.pagination).reduce((sum, metaRow) => sum + metaRow.total, 0)} registros en historiales, línea temporal y gráfico de signos vitales.`;
      header.append(confidentiality, meta, name, subline, disclosure);
      container.appendChild(header);

      const bodyContainer = document.createElement('div');
      bodyContainer.innerHTML = body;
      container.appendChild(bodyContainer);
      await this.#api.recordPatientPrint(g.HC, {
        ...Object.fromEntries(sections.map(([listKey, items]) => [listKey, items.length])),
        timeline: timeline.length
      });
      await this.#api.recordPatientExport(g.HC, {
        ...Object.fromEntries(sections.map(([listKey, items]) => [listKey, items.length])),
        timeline: timeline.length
      });
      if (this.#state.get().currentHC !== g.HC) throw new Error('El expediente cambió antes de iniciar la impresión.');
      document.body.appendChild(container);

      const cleanup = () => { container.remove(); window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup);
      window.print();
      this.#toast.show('Solicitud de impresión completa registrada en auditoría.', 'ok');
    } catch (err) {
      this.#toast.show('No se pudo preparar una impresión completa: ' + this.#friendlyErrorMessage(err), 'error');
      reportError(err, { action: 'print-record' });
    }
  }

  #startIdleWatch(lastActivityAt) {
    this.#stopIdleWatch();
    this.#lastActivityAt = lastActivityAt;
    this.#writeActivityTimestamp(lastActivityAt);
    if (!globalThis.window) return;
    this.#scheduleIdleTimeout();
  }

  #stopIdleWatch() {
    if (this.#idleTimer) globalThis.clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    const w = globalThis.window;
    w?.removeEventListener('pointerdown', this.#activityHandler);
    w?.removeEventListener('keydown', this.#activityHandler);
    w?.removeEventListener('scroll', this.#activityHandler);
    w?.removeEventListener('touchstart', this.#activityHandler);
    document.removeEventListener('visibilitychange', this.#visibilityHandler);
  }

  #handleVisibilityChange() {
    if (document.visibilityState !== 'visible' || !this.#state.get().authed) return;
    const elapsed = this.#lastActivityAt ? Date.now() - this.#lastActivityAt : 0;
    if (elapsed >= DashboardController.IDLE_TIMEOUT_MS) {
      void this.#signOut('La sesión se cerró por 15 minutos de inactividad. Inicia sesión nuevamente para continuar.');
      return;
    }
    this.#touchActivity();
  }

  #touchActivity() {
    if (!this.#state.get().authed) return;
    const now = Date.now();
    if (now - this.#lastActivityAt < 5000) return;
    this.#lastActivityAt = now;
    this.#writeActivityTimestamp(now);
    this.#scheduleIdleTimeout();
  }

  #scheduleIdleTimeout() {
    if (this.#idleTimer) globalThis.clearTimeout(this.#idleTimer);
    this.#idleTimer = globalThis.setTimeout(() => {
      if (Date.now() - this.#lastActivityAt >= DashboardController.IDLE_TIMEOUT_MS) {
        void this.#signOut('La sesión se cerró por 15 minutos de inactividad. Inicia sesión nuevamente para continuar.');
      } else {
        this.#touchActivity();
      }
    }, DashboardController.IDLE_TIMEOUT_MS + 50);
  }

  #readActivityTimestamp() {
    try {
      const value = Number(globalThis.sessionStorage?.getItem(this.#activityStorageKey));
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }

  #writeActivityTimestamp(timestamp) {
    try { globalThis.sessionStorage?.setItem(this.#activityStorageKey, String(timestamp)); } catch {}
  }

  #clearActivityTimestamp() {
    try { globalThis.sessionStorage?.removeItem(this.#activityStorageKey); } catch {}
  }

  #bindEvents() {
    const w = globalThis.window;
    w?.addEventListener('pointerdown', this.#activityHandler, { passive: true });
    w?.addEventListener('keydown', this.#activityHandler, { passive: true });
    w?.addEventListener('scroll', this.#activityHandler, { passive: true });
    w?.addEventListener('touchstart', this.#activityHandler, { passive: true });
    document.addEventListener('visibilitychange', this.#visibilityHandler, { passive: true });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.#openCommandPalette(); }
    });
    document.addEventListener('click', e => this.#onClick(e));
    document.addEventListener('submit', e => this.#onSubmit(e));
    document.addEventListener('input', e => { if (e.target.id === 'patientSearch') this.#scheduleSearch(); });
    document.addEventListener('focusin', e => { if (e.target.id === 'patientSearch') this.#scheduleSearch(0); });
    document.addEventListener('change', e => {
      if (e.target.id === 'servicioFilter') this.#runSearch();
      if (e.target.name === 'Edad_Unidad') this.#state.set({ lastAgeUnit: e.target.value });
      if (e.target.id === 'medRequiereSeguimiento') {
        document.getElementById('medFrecuenciaHorasWrap')?.classList.toggle('hidden', !e.target.checked);
      }
      if (e.target.id === 'cultivoEsPeriodico') {
        document.getElementById('cultivoIntervaloWrap')?.classList.toggle('hidden', !e.target.checked);
      }
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
    if (el && !this.#isActionAllowed(el.dataset.action, el)) {
      this.#toast.show('Tu rol no tiene permiso para realizar esta acción.', 'error');
      return;
    }
    this.#actions[el?.dataset.action]?.(el);
  }

  #onSubmit(e) {
    const form = e.target.closest('form');
    const handler = form && this.#submitHandlers[form.id];
    if (!handler) return;
    e.preventDefault();
    const role = this.#state.get().role;
    const nurseRestricted = role === 'enfermeria' && ['form-nuevo-paciente', 'form-editar-paciente', 'form-eliminar-paciente', 'form-restaurar-paciente'].includes(form.id);
    if (form.id !== 'form-login' && (!['medico', 'enfermeria'].includes(role) || nurseRestricted)) {
      this.#toast.show('Tu rol no tiene permiso para guardar estos cambios.', 'error');
      return;
    }
    if (form.id === 'form-med' && role === 'enfermeria' && form.elements.Activo.value === 'No') {
      this.#toast.show('Enfermería no puede registrar medicamentos como suspendidos.', 'error');
      return;
    }
    this.#guarded(form, () => handler(form));
  }

  #isActionAllowed(action, element) {
    if (!WRITE_ACTIONS.has(action)) return true;
    const role = this.#state.get().role;
    if (!['medico', 'enfermeria'].includes(role)) return false;
    if (role === 'enfermeria') {
      const modal = element?.dataset?.modal;
      return !NURSE_RESTRICTED_ACTIONS.has(action) && !['modal-nuevo-paciente', 'modal-editar-paciente', 'modal-eliminar-paciente', 'modal-restaurar-paciente'].includes(modal);
    }
    return true;
  }

  /* ================================================================
     Reacción a cambios de estado (flujo unidireccional)
     ================================================================ */
  #onStateChange(s, prev) {
    if (s.servicios !== prev.servicios) this.#view.renderServicios(s.servicios);
    if (s.round !== prev.round) this.#view.renderRound(s.round);
    if (s.density !== prev.density || s.highContrast !== prev.highContrast) this.#view.setUiPreferences(s);
    if (s.newActivityCount !== prev.newActivityCount) this.#view.setNovedadesCount(s.newActivityCount);

    if (s.searchResults !== prev.searchResults) {
      if (s.searchResults === null) this.#view.hideSearchResults();
      else this.#view.renderSearchResults(s.searchResults);
    }

    const recordChanged = s.record !== prev.record;
    const patientChanged = s.record?.patient !== prev.record?.patient;
    const sectionListKey = ({ vitales: 'vitals', medicamentos: 'medications', laboratorios: 'labs', consultas: 'consultations', cultivos: 'cultures', pendientes: 'tasks' })[s.currentSection];
    const activeSectionChanged = recordChanged && s.record && (
      patientChanged ||
      (s.currentSection === 'resumen' && s.record.summary !== prev.record?.summary) ||
      (s.currentSection === 'timeline' && s.record.timeline !== prev.record?.timeline) ||
      (sectionListKey && (s.record[sectionListKey] !== prev.record?.[sectionListKey] || s.record.pagination?.[sectionListKey] !== prev.record?.pagination?.[sectionListKey]))
    );
    const previousActivity = prev.record?.summary?.lastActivity;
    const currentActivity = s.record?.summary?.lastActivity;
    const activityChanged = previousActivity?.event_at !== currentActivity?.event_at || previousActivity?.actor_name !== currentActivity?.actor_name;
    const headerChanged = patientChanged || activityChanged || s.syncStatus !== prev.syncStatus || s.newActivityCount !== prev.newActivityCount;
    if (recordChanged && !s.record) {
      this.#charts.destroy();
      this.#view.showEmptyState();
    } else if (s.record) {
      if (patientChanged) this.#view.showPatientView();
      if (recordChanged) this.#view.setLabTypes(s.record.labTypes);
    }
    if (headerChanged && s.record) {
      const patient = { ...s.record.patient, __lastActivity: s.record.summary?.lastActivity ?? null };
      this.#view.renderHeader(patient, { syncStatus: s.syncStatus, lastSyncedAt: s.lastSyncedAt, newActivityCount: s.newActivityCount });
    }

    if (activeSectionChanged || s.currentSection !== prev.currentSection || s.timelineLoadedFor !== prev.timelineLoadedFor || (s.currentSection === 'timeline' && s.newActivityCount !== prev.newActivityCount)) {
      this.#view.highlightSection(s.currentSection);
      if (s.record) this.#renderSection();
    }
  }

  #renderSection() {
    const { record, currentSection, timelineLoadedFor } = this.#state.get();
    markPerformance('section-render-start');
    if (currentSection === 'timeline' && timelineLoadedFor !== record.patient.HC) {
      this.#charts.destroy();
      this.#view.setSectionHtml('<div class="rounded-xl border border-hairline bg-white p-6 text-sm text-[#7C8784]" aria-busy="true">Cargando línea temporal…</div>');
      void this.#loadTimeline(record.patient.HC);
      return;
    }
    const section = sectionViewFor(currentSection);
    const ctx = { charts: this.#charts, today: todayISODate(), pagination: record.pagination?.[currentSection] ?? null, timeline: record.timeline, newActivityCount: this.#state.get().newActivityCount, lastViewedAt: this.#state.get().lastViewedTimelineAt };
    this.#charts.destroy();
    try {
      const uiState = this.#captureSectionUiState();
      this.#view.setSectionHtml(section.render(record, ctx));
      this.#restoreSectionControls(uiState);
      section.mount?.(this.#view.sectionContainer, record, ctx);
      this.#restoreSectionDetailsAndFocus(uiState);
      measurePerformance(`section-render-${currentSection}`, 'section-render-start');
    } catch (err) {
      reportError(err, { origin: 'render-section', section: currentSection });
      this.#toast.show('No se pudo mostrar la sección. Intenta nuevamente.', 'error');
    }
  }

  #captureSectionUiState() {
    const root = this.#view.sectionContainer;
    if (typeof root.querySelectorAll !== 'function') return { controls: [], details: [], active: null };
    const controls = [...root.querySelectorAll('input, textarea, select')].map(el => ({
      value: el.value,
      checked: 'checked' in el ? el.checked : undefined
    }));
    const focusable = [...root.querySelectorAll('input, textarea, select, button, [tabindex]:not([tabindex="-1"])')];
    const activeElement = root.ownerDocument.activeElement;
    const activeIndex = focusable.indexOf(activeElement);
    const active = activeIndex < 0 ? null : {
      index: activeIndex,
      selectionStart: activeElement.selectionStart,
      selectionEnd: activeElement.selectionEnd
    };
    return { controls, details: [...root.querySelectorAll('details')].map(el => el.open), active };
  }

  #restoreSectionControls(state) {
    const root = this.#view.sectionContainer;
    if (typeof root.querySelectorAll !== 'function') return;
    const controls = [...root.querySelectorAll('input, textarea, select')];
    state.controls.forEach((saved, index) => {
      const el = controls[index];
      if (!el) return;
      el.value = saved.value;
      if (saved.checked !== undefined) el.checked = saved.checked;
    });
  }

  #restoreSectionDetailsAndFocus(state) {
    const root = this.#view.sectionContainer;
    if (typeof root.querySelectorAll !== 'function') return;
    [...root.querySelectorAll('details')].forEach((el, index) => { el.open = state.details[index] ?? false; });
    if (!state.active) return;
    const target = root.querySelectorAll('input, textarea, select, button, [tabindex]:not([tabindex="-1"])')[state.active.index];
    target?.focus();
    if (state.active.selectionStart !== null && typeof target?.setSelectionRange === 'function') {
      target.setSelectionRange(state.active.selectionStart, state.active.selectionEnd);
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
    markPerformance('search-start');
    const seq = ++this.#searchSeq;
    if (!query && !servicio) {
      this.#state.set({ searchResults: null });
      this.#view.hideSearchSpinner();
      return null;
    }
    this.#view.showSearchSpinner();
    try {
      const results = await this.#api.searchPatients({ query, servicio });
      if (seq !== this.#searchSeq) return null;
      this.#state.set({ searchResults: results });
      measurePerformance('search', 'search-start');
      this.#view.announceSearchStatus(
        results.length ? `${results.length} paciente${results.length === 1 ? '' : 's'} encontrado${results.length === 1 ? '' : 's'}.` : 'Sin resultados.'
      );
      return results;
    } catch (err) {
      if (seq === this.#searchSeq) this.#toast.show('No se pudo completar la búsqueda. Intenta nuevamente.', 'error');
      reportError(err, { origin: 'search', query, servicio });
      return null;
    } finally {
      if (seq === this.#searchSeq) this.#view.hideSearchSpinner();
    }
  }

  async #selectFirstMatch() {
    clearTimeout(this.#searchTimer);
    const results = await this.#runSearch();
    if (!results?.length) return;
    this.#pendingSearchPatient = results[0];
    const patient = this.#pendingSearchPatient;
    document.getElementById('searchConfirmName').textContent = patient.Nombre_Completo || 'Sin nombre';
    document.getElementById('searchConfirmHC').textContent = patient.HC || 'Sin HC';
    document.getElementById('searchConfirmContext').textContent = `${patient.Servicio || 'Sin servicio'} · Cama ${patient.Cama || '—'}`;
    document.getElementById('searchConfirmInput').value = '';
    document.getElementById('searchConfirmError').classList.add('hidden');
    this.#modals.open('modal-confirmar-paciente');
  }

  #confirmSearchPatient() {
    const patient = this.#pendingSearchPatient;
    const input = document.getElementById('searchConfirmInput');
    const error = document.getElementById('searchConfirmError');
    if (!patient || input.value.trim() !== patient.HC) {
      error.textContent = 'La HC no coincide. Comprueba el nombre y vuelve a escribirla.';
      error.classList.remove('hidden');
      input.focus();
      return;
    }
    this.#pendingSearchPatient = null;
    this.#modals.close('modal-confirmar-paciente');
    if (patient) this.#selectPatient(patient);
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
    const perfStart = `patient-load-${seq}`;
    markPerformance(perfStart);
    if (!silent) {
      // Nunca dejar visible el expediente de otro paciente mientras carga el nuevo.
      this.#state.set({ record: null, currentHC: hc, timelineLoadedFor: null, syncStatus: 'syncing', lastSyncedAt: null, newActivityCount: 0, lastViewedTimelineAt: getTimelineReadAt(this.#state.get().userId, hc) });
      this.#view.showPatientLoading();
    }
    try {
      const record = await this.#api.getPatientRecord(hc);
      if (seq !== this.#loadSeq) return;
      const lastViewedAt = getTimelineReadAt(this.#state.get().userId, hc);
      const unread = record.summary?.lastActivity?.event_at && new Date(record.summary.lastActivity.event_at).getTime() > lastViewedAt ? 1 : 0;
      const syncStatus = silent
        ? (this.#state.get().syncStatus === 'offline' ? 'offline' : 'live')
        : 'syncing';
      this.#state.set({ record, currentHC: hc, timelineLoadedFor: null, lastViewedTimelineAt: lastViewedAt, newActivityCount: unread, syncStatus, lastSyncedAt: Date.now() });
      if (!silent && this.#api.recordPatientRead) void this.#api.recordPatientRead(hc).catch(err => reportError(err, { origin: 'audit-patient-read' }));
      if (lastViewedAt) void this.#refreshTimelineUnread(hc, lastViewedAt);
      measurePerformance('patient-load', perfStart);
      if (!silent) this.#watchRealtime(hc);
    } catch (err) {
      if (seq !== this.#loadSeq) return;
      this.#toast.show('No se pudo cargar el paciente. Intenta nuevamente.', 'error', { persistent: true, id: 'patient-load-error' });
      reportError(err, { origin: 'load-patient', hc });
      if (!silent) { this.#state.set({ currentHC: null }); this.#view.showEmptyState(); }
    }
  }

  /**
   * Si alguien más (otra pestaña, otra persona) registra algo del mismo paciente,
   * el expediente se refresca solo — ya no hace falta pulsar "Actualizar" a mano.
   */
  #watchRealtime(hc) {
    this.#stopRealtime();
    this.#unsubscribeRealtime = this.#api.subscribeToPatient(
      hc,
      event => this.#handleRealtimeEvent(hc, event),
      status => this.#handleRealtimeStatus(hc, status)
    );
  }

  #handleRealtimeEvent(hc, event) {
    if (this.#state.get().currentHC !== hc || !event?.table) return;
    const current = this.#state.get().record;
    if (!current) return;

    const pageSize = Math.max(1, Number(current.pagination?.[listKeyForTable(event.table)]?.pageSize) || 25);
    const next = current.withRealtimeEvent(event.table, event, pageSize);
    if (next === null) {
      this.#loadSeq++;
      this.#stopRealtime();
      this.#state.set({ record: null, currentHC: null, searchResults: null });
      this.#view.setSearchText('');
      this.#view.showEmptyState();
      this.#toast.show('El expediente fue retirado o ya no está disponible.', 'warn');
      return;
    }
    if (next !== current) {
      const activityAt = event.commit_timestamp || event.new?.Modificado_En || event.old?.Modificado_En;
      const lastViewed = this.#state.get().lastViewedTimelineAt;
      const actorId = event.new?.Modificado_Por ?? event.old?.Modificado_Por;
      const isOwnEvent = actorId && actorId === this.#state.get().userId;
      const isNew = !isOwnEvent && activityAt && new Date(activityAt).getTime() > Number(lastViewed || 0);
      this.#state.set({ record: next, syncStatus: 'live', lastSyncedAt: Date.now(), newActivityCount: isNew ? this.#state.get().newActivityCount + 1 : this.#state.get().newActivityCount });
    } else {
      this.#state.set({ syncStatus: 'live', lastSyncedAt: Date.now() });
    }

    // Los cambios puntuales se aplican localmente; el resumen compacto solo se
    // vuelve a calcular una vez por ráfaga, evitando siete consultas por evento.
    // Si se elimina una fila visible, además resincronizamos esa página para
    // rellenar el hueco con el siguiente registro, sin descargar el expediente.
    clearTimeout(this.#realtimeDebounce);
    this.#realtimeDebounce = setTimeout(async () => {
      if (this.#state.get().currentHC !== hc) return;
      try {
        const listKey = listKeyForTable(event.table);
        const latest = this.#state.get().record;
        const meta = latest?.pagination?.[listKey];
        if (event.eventType === 'DELETE' && listKey && meta && latest) {
          const page = await this.#api.getPatientSectionPage(hc, listKey, meta.page, { pageSize: meta.pageSize });
          const refreshed = this.#state.get().record;
          if (refreshed && this.#state.get().currentHC === hc) {
            this.#state.set({ record: refreshed.withListPage(listKey, page.items, page.pagination) });
          }
        }
        const { data, error } = await this.#api.getPatientSummary(hc);
        if (error) return;
        const currentRecord = this.#state.get().record;
        if (currentRecord && this.#state.get().currentHC === hc) this.#state.set({ record: currentRecord.withSummary(data) });
      } catch (err) {
        reportError(err, { origin: 'realtime-summary' });
      }
    }, 350);
  }

  async #syncAfterRealtimeReconnect(hc) {
    if (this.#state.get().currentHC !== hc) return;
    const { currentSection, record } = this.#state.get();
    const meta = record?.pagination?.[currentSection];
    try {
      if (meta) {
        const page = await this.#api.getPatientSectionPage(hc, currentSection, meta.page, { pageSize: meta.pageSize });
        const latest = this.#state.get().record;
        if (latest && this.#state.get().currentHC === hc) this.#state.set({ record: latest.withListPage(currentSection, page.items, page.pagination) });
      }
      await this.#refreshRecordSummary();
    } catch (err) {
      reportError(err, { origin: 'realtime-resync' });
    }
  }

  #handleRealtimeStatus(hc, status) {
    if (status === 'SUBSCRIBED') {
      this.#toast.dismiss('realtime-offline');
      this.#state.set({ syncStatus: 'live', lastSyncedAt: Date.now() });
      // Al reconectar puede haber cambios ocurridos durante la desconexión.
      // Sin reconstruir todo el expediente, resincronizamos solo la sección visible
      // y el resumen compacto.
      void this.#syncAfterRealtimeReconnect(hc);
      return;
    }
    if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
      this.#state.set({ syncStatus: 'offline' });
      this.#toast.show('Actualización en tiempo real temporalmente desconectada. Se reintentará automáticamente.', 'warn', {
        persistent: true, id: 'realtime-offline'
      });
    }
  }

  #stopRealtime() {
    clearTimeout(this.#realtimeDebounce);
    this.#unsubscribeRealtime?.();
    this.#unsubscribeRealtime = null;
  }

  async #loadRound() {
    if (!this.#state.get().authed) return;
    this.#view.renderRoundLoading();
    try {
      const rows = await this.#api.getRoundOverview({ limit: 100 });
      if (this.#state.get().authed) this.#state.set({ round: rows });
    } catch (err) {
      this.#toast.show('No se pudo cargar la ronda de hoy.', 'warn');
      reportError(err, { origin: 'load-round' });
    }
  }

  async #refreshTimelineUnread(hc, readAt) {
    try {
      const events = await this.#api.getPatientTimeline(hc, { limit: 80 });
      if (this.#state.get().currentHC !== hc) return;
      this.#state.set({ newActivityCount: countTimelineUnread(events, readAt) });
    } catch (err) {
      reportError(err, { origin: 'timeline-unread' });
    }
  }

  async #loadTimeline(hc) {
    const seq = ++this.#timelineSeq;
    try {
      const timeline = await this.#api.getPatientTimeline(hc, { limit: 50 });
      if (seq !== this.#timelineSeq || this.#state.get().currentHC !== hc) return;
      const record = this.#state.get().record;
      if (!record) return;
      this.#state.set({ record: record.withTimeline(timeline), timelineLoadedFor: hc });
    } catch (err) {
      if (seq !== this.#timelineSeq) return;
      this.#toast.show('No se pudo cargar la línea temporal.', 'error');
      reportError(err, { origin: 'load-timeline' });
    }
  }

  #openNovedades() {
    if (!this.#state.get().record) return;
    this.switchSection('timeline');
  }

  #markTimelineRead() {
    const { currentHC, userId, record } = this.#state.get();
    if (!currentHC || !record) return;
    const at = markTimelineRead(userId, currentHC);
    this.#state.set({ lastViewedTimelineAt: at, newActivityCount: 0 });
    this.#toast.show('Novedades marcadas como revisadas.');
  }

  #cycleDensity() {
    const current = this.#state.get().density;
    const next = current === 'compact' ? 'normal' : current === 'normal' ? 'comfortable' : 'compact';
    writeUiPreferences({ density: next });
    this.#state.set({ density: next });
  }

  #toggleHighContrast() {
    const highContrast = !this.#state.get().highContrast;
    writeUiPreferences({ highContrast });
    this.#state.set({ highContrast });
    this.#toast.show(highContrast ? 'Alto contraste activado.' : 'Alto contraste desactivado.');
  }

  goToRound() {
    this.#loadSeq++;
    this.#stopRealtime();
    this.#state.set({ record: null, currentHC: null, currentSection: 'resumen', timelineLoadedFor: null, syncStatus: 'idle', lastSyncedAt: null });
    this.#view.setSearchText('');
    this.#state.set({ searchResults: null });
    this.#view.showEmptyState();
    void this.#loadRound();
  }

  #openCommandPalette() {
    if (!this.#palette) return;
    const { record, density, highContrast, newActivityCount } = this.#state.get();
    const commands = [
      { id: 'round', label: 'Ronda de hoy', hint: 'Volver a la lista de pacientes activos' },
      { id: 'search', label: 'Buscar paciente', hint: 'Foco en el buscador', shortcut: '⌘/Ctrl K' },
      ...SECTIONS.filter(s => s.id !== 'timeline').map(s => ({ id: `section:${s.id}`, label: `Ir a ${s.label}`, hint: 'Cambiar de sección', disabled: !record })),
      { id: 'timeline', label: 'Línea temporal', hint: newActivityCount ? `${newActivityCount} novedades sin revisar` : 'Actividad clínica reciente', disabled: !record },
      { id: 'density', label: `Cambiar densidad (actual: ${density})`, hint: 'Compacta · normal · cómoda' },
      { id: 'contrast', label: highContrast ? 'Desactivar alto contraste' : 'Activar alto contraste', hint: 'Preferencia visual persistente' },
      { id: 'print', label: 'Imprimir expediente', hint: 'Salida clínica confidencial', disabled: !record },
      { id: 'lock', label: 'Bloquear sesión', hint: 'Cerrar la sesión local' }
    ];
    this.#palette.open(commands, id => {
      if (id === 'round') this.goToRound();
      else if (id === 'search') this.#view.focusSearch();
      else if (id.startsWith('section:')) this.switchSection(id.slice(8));
      else if (id === 'timeline') this.#openNovedades();
      else if (id === 'density') this.#cycleDensity();
      else if (id === 'contrast') this.#toggleHighContrast();
      else if (id === 'print') this.#printRecord();
      else if (id === 'lock') this.#signOut('Sesión bloqueada por solicitud del usuario.');
    });
  }

  async #loadSectionPage(listKey, page) {
    const { currentHC, record } = this.#state.get();
    const meta = record?.pagination?.[listKey];
    if (!currentHC || !record || !meta) return;
    const target = Math.max(1, Math.min(Number(page) || 1, Number(meta.totalPages) || 1));
    if (target === Number(meta.page)) return;
    this.#view.setSectionBusy(true);
    try {
      const result = await this.#api.getPatientSectionPage(currentHC, listKey, target, { pageSize: meta.pageSize });
      if (this.#state.get().currentHC !== currentHC) return;
      const latest = this.#state.get().record;
      if (latest) this.#state.set({ record: latest.withListPage(listKey, result.items, result.pagination) });
    } catch (err) {
      this.#toast.show('No se pudo cargar esta página: ' + this.#friendlyErrorMessage(err), 'error');
      reportError(err, { action: 'page-section', listKey, page: target });
    } finally {
      this.#view.setSectionBusy(false);
    }
  }

  switchSection(id) {
    if (!SECTIONS.some(s => s.id === id)) return;
    this.#state.set({ currentSection: id, ...(id === 'timeline' ? { timelineLoadedFor: null } : {}) });
  }

  #reload() {
    return this.loadPatient(this.#state.get().currentHC, { silent: true });
  }

  async #refreshServicios() {
    try { this.#state.set({ servicios: await this.#api.listServicios({ force: true }) }); } catch { /* no crítico */ }
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
      this.#toast.show(this.#friendlyErrorMessage(err), 'error');
      if (!(err instanceof ConflictError)) reportError(err, { action: 'form', formId: form.id });
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async #submitRecord(form, listKey, modalId, build, save, message) {
    const hc = this.#state.get().currentHC;
    if (!hc) throw new Error('Selecciona un paciente primero.');
    const values = this.#modals.readForm(form);
    const payload = build(values, hc);
    const idempotencyKey = this.#idempotencyKey(form, { hc, values });
    const serverItem = await save(payload, { idempotencyKey });
    delete form.dataset.idempotencyKey;
    delete form.dataset.idempotencyPayload;
    this.#modals.close(modalId);
    this.#applyInsertedItem(listKey, serverItem);
    this.#toast.show(message);
    await this.#refreshRecordSummary();
  }

  #idempotencyKey(form, payload) {
    form.dataset ??= {};
    const signature = JSON.stringify(payload);
    if (!form.dataset.idempotencyKey || form.dataset.idempotencyPayload !== signature) {
      form.dataset.idempotencyKey = newIdempotencyKey();
      form.dataset.idempotencyPayload = signature;
    }
    return form.dataset.idempotencyKey;
  }

  #applyInsertedItem(listKey, item) {
    const record = this.#state.get().record;
    if (!record || !item) return;
    const meta = record.pagination?.[listKey];
    const pageSize = Math.max(1, Number(meta?.pageSize) || 25);
    this.#state.set({ record: record.withUpsertedItem(listKey, item, { pageSize }) });
  }

  async #refreshRecordSummary() {
    const hc = this.#state.get().currentHC;
    if (!hc) return;
    try {
      const { data, error } = await this.#api.getPatientSummary(hc);
      if (error) return;
      const record = this.#state.get().record;
      if (record && this.#state.get().currentHC === hc) this.#state.set({ record: record.withSummary(data) });
    } catch (err) {
      reportError(err, { origin: 'record-summary-refresh' });
    }
  }

  /** Atajo de "agregar rápido" del checklist de pendientes: solo descripción, programado para hoy. */
  async #addQuickTask(form) {
    const hc = this.#state.get().currentHC;
    if (!hc) throw new Error('Selecciona un paciente primero.');
    const descripcion = String(new FormData(form).get('Descripcion_Tarea') ?? '').trim();
    if (!descripcion) return;
    const idempotencyKey = this.#idempotencyKey(form, { hc, descripcion });
    const serverItem = await this.#api.addTask(PendingTask.fromForm({ Descripcion_Tarea: descripcion }, hc), { idempotencyKey });
    delete form.dataset.idempotencyKey;
    delete form.dataset.idempotencyPayload;
    form.reset();
    this.#applyInsertedItem('tasks', serverItem);
    await this.#refreshRecordSummary();
  }

  /** Marca un pendiente como realizado (optimista) y ofrece deshacerlo desde el toast (patrón tipo Gmail). */
  async #completeTaskWithUndo(id) {
    const { record } = this.#state.get();
    if (!record) return;
    const previous = record;
    const expected = this.#findItem('tasks', id)?.Modificado_En;
    this.#state.set({ record: record.withPatchedItem('tasks', id, { Estado: 'Realizado', Fecha_Completado: null }) });
    try {
      const serverItem = await this.#api.completeTask(id, expected);
      const latest = this.#state.get().record;
      if (latest && serverItem) this.#state.set({ record: latest.withPatchedItem('tasks', id, serverItem) });
      this.#toast.show('Pendiente marcado como realizado', 'ok', {
        action: {
          label: 'Deshacer',
          onClick: () => this.#quickActionOptimistic('tasks', id,
            { Estado: 'Pendiente', Fecha_Completado: null },
            exp => this.#api.uncompleteTask(id, exp), 'Pendiente restaurado')
        }
      });
    } catch (err) {
      if (this.#state.get().record !== previous) this.#state.set({ record: previous });
      if (err instanceof ConflictError) { this.#toast.show(err.message, 'error'); await this.#reload(); }
      else { this.#toast.show('No se pudo guardar: ' + this.#friendlyErrorMessage(err), 'error'); reportError(err, { action: 'completeTaskWithUndo' }); }
    }
  }

  /** Busca un elemento por id dentro de una lista del expediente abierto (medications, tasks, ...). */
  #findItem(listKey, id) {
    const record = this.#state.get().record;
    return record?.[listKey]?.find(item => item.id === id)
      ?? (listKey === 'medications' ? record?.suspendedMedications?.find(item => item.id === id) : null)
      ?? null;
  }

  async #submitSimple(form, modalId, message, save) {
    let serverItem;
    try {
      serverItem = await save(this.#modals.readForm(form));
    } catch (err) {
      if (err instanceof ConflictError) {
        // No se cierra el modal ni se pierde lo escrito: la persona ve el error,
        // puede revisar el expediente ya actualizado y decidir si reintenta.
        await this.#reload();
      }
      throw err;
    }
    this.#modals.close(modalId);
    if (modalId === 'modal-responder') this.#applyInsertedItem('consultations', serverItem);
    if (modalId === 'modal-resultado-cultivo') this.#applyInsertedItem('cultures', serverItem);
    this.#toast.show(message);
    await this.#refreshRecordSummary();
  }

  /**
   * Como #quickActionOptimistic, pero sin actualización optimista: espera la
   * respuesta del servidor antes de avisar. Se conserva para acciones que no
   * necesitan sentirse instantáneas.
   */
  async #quickAction(task, message) {
    try {
      await task();
      this.#toast.show(message);
      await this.#reload();
    } catch (err) {
      this.#toast.show(this.#friendlyErrorMessage(err), 'error');
      reportError(err, { action: 'quickAction' });
    }
  }

  #openSuspendMedication(id) {
    const medication = this.#findItem('medications', id);
    if (!medication) return;
    this.#modals.open('modal-suspender-med', { _row: id, Motivo_Suspension: '' });
    const name = document.getElementById('suspenderMedNombre');
    if (name) name.textContent = medication.Nombre_Medicamento;
  }

  async #suspendMedication(form) {
    const values = this.#modals.readForm(form);
    const id = Number(values._row);
    const reason = String(values.Motivo_Suspension ?? '').trim();
    if (!reason) throw new Error('Indica el motivo de suspensión.');
    const medication = this.#findItem('medications', id);
    if (!medication) throw new Error('El medicamento ya no está disponible.');
    const updated = await this.#api.suspendMedication(id, medication.Modificado_En, reason);
    const latest = this.#state.get().record;
    if (latest && updated) this.#state.set({ record: latest.withPatchedItem('medications', id, updated) });
    this.#modals.close('modal-suspender-med');
    this.#toast.show('Medicamento suspendido', 'ok', {
      persistent: true,
      action: {
        label: 'Deshacer',
        onClick: async () => {
          await this.#quickActionOptimistic('medications', id,
            { Activo: 'Sí', Fecha_Omision: null, Motivo_Suspension: null },
            expected => this.#api.unsuspendMedication(id, expected), 'Suspensión deshecha');
          await this.#refreshRecordSummary();
        }
      }
    });
    await this.#refreshRecordSummary();
  }

  /**
   * Actualiza la UI de inmediato (sin esperar la red ni recargar todo el
   * expediente) y revierte solo si la petición falla. `listKey` es la lista
   * del PatientRecord a parchar ('medications', 'tasks', ...). `apiCall` recibe
   * el `Modificado_En` que tenía el elemento ANTES del parche optimista, para
   * que el servidor pueda detectar si alguien más lo cambió mientras tanto.
   */
  async #quickActionOptimistic(listKey, id, patch, apiCall, message) {
    const { record } = this.#state.get();
    if (!record) return;
    const previous = record;
    const expected = this.#findItem(listKey, id)?.Modificado_En;
    this.#state.set({ record: record.withPatchedItem(listKey, id, patch) });
    try {
      const serverItem = await apiCall(expected);
      const latest = this.#state.get().record;
      if (latest && serverItem) this.#state.set({ record: latest.withPatchedItem(listKey, id, serverItem) });
      this.#toast.show(message);
    } catch (err) {
      // Revierte al estado anterior: la persona ve exactamente lo que había antes del intento.
      if (this.#state.get().record !== previous) this.#state.set({ record: previous });
      if (err instanceof ConflictError) {
        this.#toast.show(err.message, 'error');
        await this.#reload(); // la versión que tenía la persona ya no es la vigente
      } else {
        this.#toast.show('No se pudo guardar: ' + this.#friendlyErrorMessage(err), 'error');
        reportError(err, { action: 'quickActionOptimistic', listKey });
      }
    }
  }

  /** Mensaje mostrado a la persona: distingue "sin conexión" de un error de negocio/servidor. */
  #friendlyErrorMessage(err) {
    if (!err) return 'No se pudo completar la operación. Intenta nuevamente.';
    if (isNetworkError(err)) {
      return 'Sin conexión: no se pudo confirmar el guardado. Verifica el expediente antes de reintentar.';
    }
    if (err instanceof Error && /(?:obligat|inválid|debe|incorrect|no coincide|ya existe|no se puede)/i.test(err.message)) {
      return err.message;
    }
    return 'No se pudo completar la operación. Intenta nuevamente.';
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
    this.#pendingEditModificadoEn = g.Modificado_En ?? null;
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
    try {
      await this.#api.updatePatient(f._row, patient, { expectedModificadoEn: this.#pendingEditModificadoEn });
    } catch (err) {
      // Conflicto de edición concurrente: NO se cierra el modal ni se pierde lo escrito;
      // la persona decide si recarga (perdiendo su cambio) o reintenta tras revisar.
      this.#toast.show(err.message, 'error');
      return;
    }
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

  #openRestorePatient() {
    this.#modals.open('modal-restaurar-paciente');
    document.getElementById('restaurarPacienteError')?.classList.add('hidden');
  }

  async #restorePatient(form) {
    const f = this.#modals.readForm(form);
    const hc = f.HC.trim();
    const motivo = f.motivo.trim();
    const err = document.getElementById('restaurarPacienteError');
    try {
      await this.#api.restorePatient(hc, motivo);
      this.#modals.close('modal-restaurar-paciente');
      this.#toast.show('Paciente restaurado; motivo registrado en auditoría');
      await this.loadPatient(hc);
    } catch (apiErr) {
      if (err) { err.textContent = apiErr.message; err.classList.remove('hidden'); }
      else this.#toast.show(apiErr.message, 'error');
    }
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
      await this.#api.deletePatient(f._row, f.motivo.trim());
      this.#pendingDelete = null;
      this.#stopRealtime();
      this.#modals.close('modal-eliminar-paciente');
      this.#modals.close('modal-editar-paciente');
      this.#toast.show('Paciente eliminado; motivo registrado en auditoría');
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
