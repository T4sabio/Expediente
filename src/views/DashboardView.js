import { escapeHtml as esc, fmtDate, orDash } from '../utils/formatters.js';
import { icon } from './icons.js';

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
      servicio: $('servicioFilter'), sideRail: $('sideRail'), mobileRail: $('mobileRail'),
      empty: $('emptyState'), patientView: $('patientView'), header: $('patientHeader'),
      section: $('sectionContainer'), labTypes: $('tipoLabList'),
      login: $('loginScreen'), loginError: $('loginError'), loginSubtitle: $('loginSubtitle'),
      loginNombreLabel: $('loginNombreLabel'), toggleSignupBtn: $('toggleSignupBtn'),
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

  setSignupMode(isSignup) {
    this.#el.loginSubtitle.textContent = isSignup
      ? 'Crea tu cuenta de personal. Quedará en modo solo lectura hasta que un médico te asigne rol.'
      : 'Inicia sesión con tu cuenta de personal para ver el expediente clínico.';
    this.#el.loginNombreLabel.classList.toggle('hidden', !isSignup);
    this.#el.loginNombreLabel.querySelector('input').required = isSignup;
    this.#el.toggleSignupBtn.textContent = isSignup ? '¿Ya tienes cuenta? Inicia sesión' : '¿Personal nuevo? Crear una cuenta';
  }

  ROLE_LABELS = { medico: 'Médico', enfermeria: 'Enfermería', lectura: 'Solo lectura' };

  renderUser({ nombre, rol, pendiente }) {
    this.#el.userNombre.textContent = nombre || '';
    this.#el.userRol.textContent = pendiente ? 'Acceso pendiente de aprobación' : (this.ROLE_LABELS[rol] ?? rol);
    this.#el.userBadge.classList.remove('hidden');
    this.#el.userBadge.classList.add('flex');
    this.#doc.body.classList.toggle('role-lectura', rol !== 'medico' && rol !== 'enfermeria');
  }

  hideUser() {
    this.#el.userBadge.classList.add('hidden');
    this.#el.userBadge.classList.remove('flex');
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

  renderServicios(servicios) {
    this.#el.servicio.innerHTML = '<option value="">Todos los servicios</option>' +
      servicios.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  }

  renderSearchResults(patients) {
    const box = this.#el.results;
    box.innerHTML = patients.length ? patients.map(p => `
      <button type="button" data-action="select-patient" data-hc="${esc(p.HC)}"
        class="w-full text-left px-3 py-2.5 hover:bg-accent-soft border-b border-hairline last:border-b-0 flex items-center justify-between gap-2">
        <span class="min-w-0">
          <span class="block text-sm font-medium truncate">${esc(p.Nombre_Completo)}</span>
          <span class="block text-xs text-[#5C6B67] font-mono-data">${esc(p.HC)} · ${esc(p.Servicio || '—')}${p.Edad ? ' · ' + esc(p.Edad) : ''}</span>
        </span>
        <span class="shrink-0 text-xs text-[#5C6B67] font-mono-data">Cama ${esc(p.Cama || '—')}</span>
      </button>`).join('')
      : '<div class="px-3 py-4 text-sm text-[#9AA6A2] text-center">Sin resultados.</div>';
    box.classList.remove('hidden');
  }

  hideSearchResults() {
    this.#el.results.classList.add('hidden');
    this.#el.results.innerHTML = '';
  }

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

  /* ---- paciente ---- */
  showEmptyState() {
    this.#el.patientView.classList.add('hidden');
    this.#el.empty.classList.remove('hidden');
  }

  showPatientView() {
    this.#el.empty.classList.add('hidden');
    this.#el.patientView.classList.remove('hidden');
  }

  showPatientLoading() {
    this.showPatientView();
    this.#el.header.innerHTML = '<p class="text-sm text-[#5C6B67]">Cargando expediente…</p>';
    this.#el.section.innerHTML = '';
  }

  renderHeader(g) {
    this.#el.header.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-[240px]">
          <div class="flex items-center gap-2 text-xs text-[#5C6B67] font-mono-data">${esc(g.HC)} · Ingreso ${fmtDate(g.Fecha_Ingreso)}</div>
          <div class="flex items-center gap-2 mt-0.5">
            <h1 class="text-xl font-semibold">${esc(g.Nombre_Completo)}</h1>
            <button data-action="editar-paciente" title="Editar paciente" class="p-1.5 rounded-md hover:bg-[#EEF2F1] transition">${EDIT_ICON}</button>
          </div>
          <p class="text-sm text-[#5C6B67] mt-1 max-w-xl">${esc(orDash(g.Motivo_Consulta))}</p>
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

  setLabTypes(types) {
    this.#el.labTypes.innerHTML = types.map(t => `<option value="${esc(t)}">`).join('');
  }

  confirm(message) { return this.#doc.defaultView.confirm(message); }
}
