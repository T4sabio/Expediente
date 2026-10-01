import { escapeHtml as esc, fmtDate, fmtDateTime, fmtRelative, orDash } from '../utils/formatters.js';
import { icon } from './icons.js';
import { renderRoundOverview } from './roundView.js';

const EDIT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 20h9" stroke="#5C6B67" stroke-width="1.8" stroke-linecap="round"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" stroke="#5C6B67" stroke-width="1.8" stroke-linejoin="round"/></svg>';

/** Estructura de la página: barra superior, búsqueda, cabecera del paciente y navegación. Sin lógica de negocio. */
export class DashboardView {
  #doc;
  #el;

  constructor(doc = document) {
    this.#doc = doc;
    const $ = id => doc.getElementById(id);
    this.#el = {
      loading: $('loadingScreen'), search: $('patientSearch'), results: $('searchResults'),
      servicio: $('servicioFilter'), serviceList: $('serviceList'), sideRail: $('sideRail'), mobileRail: $('mobileRail'),
      empty: $('emptyState'), patientView: $('patientView'), header: $('patientHeader'),
      section: $('sectionContainer'), labTypes: $('tipoLabList'),
      searchSpinner: $('searchSpinner'), searchStatus: $('searchStatus'), round: $('roundContainer'),
      login: $('loginScreen'), loginError: $('loginError'),
      userBadge: $('userBadge'), userNombre: $('userNombre'), userRol: $('userRol')
    };
  }

  /* ---- autenticación ---- */
  showLoginScreen() { this.#el.login.classList.remove('hidden'); }
  hideLoginScreen() { this.#el.login.classList.add('hidden'); }

  showLoginError(message) {
    this.#el.loginError.textContent = message;
    this.#el.loginError.classList.remove('hidden');
  }
  clearLoginError() { this.#el.loginError.classList.add('hidden'); }

  ROLE_LABELS = { medico: 'Médico', enfermeria: 'Enfermería', lectura: 'Solo lectura' };

  renderUser({ nombre, rol, pendiente }) {
    this.#el.userNombre.textContent = nombre || '';
    this.#el.userRol.textContent = pendiente ? 'Acceso pendiente de aprobación' : (this.ROLE_LABELS[rol] ?? rol);
    this.#el.userBadge.classList.remove('hidden');
    this.#el.userBadge.classList.add('flex');
    this.#doc.body.classList.toggle('role-medico', rol === 'medico');
    this.#doc.body.classList.toggle('role-enfermeria', rol === 'enfermeria');
    this.#doc.body.classList.toggle('role-lectura', rol === 'lectura' || (rol !== 'medico' && rol !== 'enfermeria'));
    const inactiveMedicationOption = this.#doc.getElementById('medInactiveOption');
    if (inactiveMedicationOption) inactiveMedicationOption.hidden = rol === 'enfermeria';
  }

  hideUser() {
    this.#el.userBadge.classList.add('hidden');
    this.#el.userBadge.classList.remove('flex');
    this.#doc.body.classList.remove('role-medico');
    this.#doc.body.classList.remove('role-enfermeria');
    this.#doc.body.classList.remove('role-lectura');
    const inactiveMedicationOption = this.#doc.getElementById('medInactiveOption');
    if (inactiveMedicationOption) inactiveMedicationOption.hidden = false;
  }

  clearProtectedData() {
    this.#el.header.replaceChildren();
    this.#el.section.replaceChildren();
    this.#el.round?.replaceChildren();
    this.#el.patientView.classList.add('hidden');
    this.#el.empty.classList.remove('hidden');
    this.hideSearchResults();
    this.setSearchText('');
  }

  /* ---- carga ---- */
  hideLoading() { this.#el.loading.classList.add('hidden'); }
  showFatalError(message) {
    this.#el.loading.innerHTML = `<p class="max-w-md text-center text-sm px-6">${esc(message)}</p>`;
  }

  /* ---- búsqueda ---- */
  getSearchInput() {
    return { query: this.#el.search.value.trim(), servicio: this.#el.servicio.value };
  }
  setSearchText(text) { this.#el.search.value = text; }
  focusSearch() { this.#el.search.focus(); this.#el.search.select?.(); }

  renderServicios(servicios) {
    const selectedService = this.#el.servicio.value;
    this.#el.servicio.innerHTML = '<option value="">Todos los servicios</option>' +
      servicios.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if (servicios.includes(selectedService)) this.#el.servicio.value = selectedService;
    if (this.#el.serviceList) this.#el.serviceList.innerHTML = servicios.map(s => `<option value="${esc(s)}">`).join('');
  }

  renderSearchResults(patients) {
    const box = this.#el.results;
    box.innerHTML = patients.length ? patients.map(p => `
      <button type="button" role="option" aria-selected="false" data-action="select-patient" data-hc="${esc(p.HC)}"
        class="w-full text-left px-3 py-2.5 hover:bg-accent-soft border-b border-hairline last:border-b-0 flex items-center justify-between gap-2">
        <span class="min-w-0">
          <span class="block text-sm font-medium truncate">${esc(p.Nombre_Completo)}</span>
          <span class="block text-xs text-[#5C6B67] font-mono-data">${esc(p.HC)} · ${esc(p.Servicio || '—')}${p.Edad ? ' · ' + esc(p.Edad) : ''}</span>
        </span>
        <span class="shrink-0 text-xs text-[#5C6B67] font-mono-data">Cama ${esc(p.Cama || '—')}</span>
      </button>`).join('')
      : '<div class="px-3 py-4 text-sm text-[#9AA6A2] text-center">Sin resultados.</div>';
    box.classList.remove('hidden');
    this.#el.search.setAttribute('aria-expanded', 'true');
  }

  hideSearchResults() {
    this.#el.results.classList.add('hidden');
    this.#el.results.innerHTML = '';
    this.#el.search.setAttribute('aria-expanded', 'false');
  }

  showSearchSpinner() { this.#el.searchSpinner.classList.remove('hidden'); }
  hideSearchSpinner() { this.#el.searchSpinner.classList.add('hidden'); }

  /** Región aria-live oculta: anuncia el resultado de la búsqueda para lectores de pantalla. */
  announceSearchStatus(text) { this.#el.searchStatus.textContent = text; }

  /* ---- navegación ---- */
  buildRail(sections) {
    this.#el.sideRail.innerHTML = sections.map(s => `
      <button data-action="switch-section" data-section="${s.id}"
        class="rail-btn flex items-center gap-3 px-4 md:px-5 py-2.5 text-sm text-[#3C4A46] hover:bg-[#F5F7F7] transition">
        <span class="shrink-0">${icon(s.icon)}</span>
        <span class="hidden md:inline">${esc(s.label)}</span>
      </button>`).join('');
    this.#el.mobileRail.innerHTML = sections.map(s => `
      <button data-action="switch-section" data-section="${s.id}"
        class="rail-btn-m shrink-0 px-3 py-1.5 rounded-full text-xs border border-hairline whitespace-nowrap">
        ${esc(s.label)}
      </button>`).join('');
  }

  highlightSection(id) {
    this.#doc.querySelectorAll('.rail-btn, .rail-btn-m')
      .forEach(b => b.classList.toggle('active', b.dataset.section === id));
  }

  renderRound(rows, options = {}) {
    if (!this.#el.round) return;
    this.#el.round.innerHTML = renderRoundOverview(rows, options);
  }

  renderRoundLoading() {
    if (!this.#el.round) return;
    this.#el.round.innerHTML = `<div class="rounded-xl border border-hairline bg-white p-5 animate-pulse"><div class="h-4 w-40 rounded bg-[#EEF2F1]"></div><div class="mt-3 h-3 w-72 rounded bg-[#EEF2F1]"></div><div class="mt-5 h-48 rounded-lg bg-[#EEF2F1]"></div></div>`;
  }

  setUiPreferences({ density = 'normal', highContrast = false, darkTheme = false } = {}) {
    const body = this.#doc.body;
    body.classList.remove('density-compact', 'density-normal', 'density-comfortable');
    body.classList.add(`density-${density}`);
    body.classList.toggle('contrast-high', Boolean(highContrast));
    body.classList.toggle('theme-dark', Boolean(darkTheme));
    this.#doc.querySelector('[data-action="toggle-contrast"]')?.setAttribute('aria-pressed', String(Boolean(highContrast)));
    const themeButtons = this.#doc.querySelectorAll?.('[data-action="toggle-theme"]') ?? [];
    themeButtons.forEach(themeButton => {
      themeButton.setAttribute('aria-pressed', String(Boolean(darkTheme)));
      themeButton.setAttribute('aria-label', darkTheme ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
      themeButton.setAttribute('title', darkTheme ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
      themeButton.innerHTML = icon(darkTheme ? 'sun' : 'moon');
    });
  }

  setNovedadesCount(count) {
    const el = this.#doc.getElementById('newActivityCount');
    if (!el) return;
    const value = Math.max(0, Number(count) || 0);
    el.textContent = value > 99 ? '99+' : String(value);
    el.classList.toggle('hidden', value === 0);
  }

  /* ---- paciente ---- */
  showEmptyState() {
    this.#el.round?.classList.remove('hidden');
    this.#el.patientView.classList.add('hidden');
    this.#el.empty.classList.remove('hidden');
  }

  showPatientView() {
    this.#el.round?.classList.add('hidden');
    this.#el.empty.classList.add('hidden');
    this.#el.patientView.classList.remove('hidden');
  }

  showPatientLoading() {
    this.showPatientView();
    this.#el.header.innerHTML = `
      <div class="animate-pulse" aria-hidden="true">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-[240px] space-y-2">
            <div class="h-3 w-40 bg-[#EEF2F1] rounded"></div>
            <div class="h-5 w-56 bg-[#EEF2F1] rounded"></div>
            <div class="h-3 w-72 bg-[#EEF2F1] rounded"></div>
          </div>
          <div class="flex flex-wrap gap-2">
            <div class="h-7 w-20 bg-[#EEF2F1] rounded-md"></div>
            <div class="h-7 w-16 bg-[#EEF2F1] rounded-md"></div>
            <div class="h-7 w-20 bg-[#EEF2F1] rounded-md"></div>
          </div>
        </div>
      </div>`;
    // Skeleton genérico de la sección: sugiere tarjetas de signos vitales / filas de tabla
    // mientras carga, en vez de un spinner sin forma (percepción de espera más corta).
    this.#el.section.innerHTML = `
      <div class="animate-pulse space-y-4" aria-hidden="true">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          ${Array.from({ length: 4 }, () => `
            <div class="border border-hairline rounded-lg p-3 space-y-2">
              <div class="h-3 w-16 bg-[#EEF2F1] rounded"></div>
              <div class="h-5 w-12 bg-[#EEF2F1] rounded"></div>
            </div>`).join('')}
        </div>
        <div class="border border-hairline rounded-lg divide-y divide-[#EEF2F1]">
          ${Array.from({ length: 5 }, () => `
            <div class="h-9 flex items-center gap-3 px-3">
              <div class="h-3 w-24 bg-[#EEF2F1] rounded"></div>
              <div class="h-3 w-16 bg-[#EEF2F1] rounded"></div>
              <div class="h-3 flex-1 bg-[#EEF2F1] rounded"></div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  renderHeader(g, { syncStatus = 'syncing', lastSyncedAt = null, newActivityCount = 0 } = {}) {
    const activity = g?.__lastActivity ?? null;
    const syncMap = { live: ['En vivo', 'ok'], syncing: ['Sincronizando', 'accent'], offline: ['Sin conexión', 'warn'] };
    const [syncLabel, syncTone] = syncMap[syncStatus] ?? syncMap.syncing;
    this.#el.header.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-[240px]">
          <button type="button" data-action="go-round" title="Volver a Ronda de hoy" class="mb-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[#3C4A46] hover:bg-[#EEF2F1] focus:outline-none focus:ring-2 focus:ring-accent">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 12H5m0 0 6 6m-6-6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Ronda de hoy
          </button>
          <div class="flex items-center gap-2 text-xs text-[#5C6B67] font-mono-data">${esc(g.HC)} · Ingreso ${fmtDate(g.Fecha_Ingreso)} · ${esc(g.Estado_Episodio || 'Hospitalizado')}</div>
          <div class="flex items-center gap-2 mt-0.5">
            <h1 class="text-xl font-semibold">${esc(g.Nombre_Completo)}</h1>
            <button data-action="editar-paciente" title="Editar paciente" class="p-1.5 rounded-md hover:bg-[#EEF2F1] transition">${EDIT_ICON}</button>
          </div>
          <p class="text-sm text-[#5C6B67] mt-1 max-w-xl">${esc(orDash(g.Motivo_Consulta))}</p>
          <div class="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <button type="button" data-action="open-novedades" class="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-white px-2.5 py-1 font-medium text-[#3C4A46] hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent">Novedades <span id="newActivityCount" class="${newActivityCount ? '' : 'hidden'} rounded-full bg-critical px-1.5 py-0.5 text-[10px] text-white">${newActivityCount > 99 ? '99+' : newActivityCount}</span></button>
            <span class="inline-flex items-center gap-1.5 rounded-full ${syncTone === 'ok' ? 'bg-ok-soft text-ok' : syncTone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-ink'} px-2.5 py-1"><span class="h-1.5 w-1.5 rounded-full ${syncStatus === 'live' ? 'bg-ok' : syncStatus === 'offline' ? 'bg-warn' : 'bg-accent'}" aria-hidden="true"></span>${syncLabel}</span>
            ${activity?.actor_name ? `<span class="text-[#7C8784]">Actualizado por ${esc(activity.actor_name)}${activity.event_at ? ` · ${esc(fmtDateTime(activity.event_at))}` : ''}</span>` : ''}
            ${lastSyncedAt ? `<span class="text-[#9AA6A2]">Sincronizado ${esc(fmtRelative(lastSyncedAt))}</span>` : ''}
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <span class="px-3 py-1.5 rounded-md bg-accent-soft text-ink text-xs font-medium">${esc(orDash(g.Servicio))}</span>
          <span class="px-3 py-1.5 rounded-md bg-[#EEF2F1] text-[#3C4A46] text-xs font-mono-data font-medium">${esc(g.Edad || 'Edad —')}</span>
          <span class="px-3 py-1.5 rounded-md bg-[#EEF2F1] text-[#3C4A46] text-xs font-mono-data font-medium">Cama ${esc(orDash(g.Cama))}</span>
          <span class="px-3 py-1.5 rounded-md bg-[#EEF2F1] text-[#3C4A46] text-xs font-mono-data font-medium">Rx ${esc(orDash(g.Num_RayosX))}</span>
        </div>
      </div>
      ${g.Diagnosticos ? `<div class="mt-3 text-sm text-[#3C4A46] whitespace-pre-wrap bg-[#FAFCFC] border border-hairline rounded-md p-3">${esc(g.Diagnosticos)}</div>` : ''}`;
  }

  get sectionContainer() { return this.#el.section; }

  setSectionHtml(html) { this.#el.section.innerHTML = html; }

  setSectionBusy(busy) {
    this.#el.section.setAttribute('aria-busy', busy ? 'true' : 'false');
    this.#el.section.classList.toggle('opacity-60', busy);
  }

  setLabTypes(types) {
    this.#el.labTypes.innerHTML = types.map(t => `<option value="${esc(t)}">`).join('');
  }

  confirm(message) { return this.#doc.defaultView.confirm(message); }
}
