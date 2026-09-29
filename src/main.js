import './styles/main.css';
import { createSupabaseClient } from './config/supabase.js';
import { ApiService } from './services/ApiService.js';
import { AuthService } from './services/AuthService.js';
import { AppState, createInitialState } from './state/AppState.js';
import { DashboardController } from './controllers/DashboardController.js';
import { DashboardView } from './views/DashboardView.js';
import { ModalManager } from './views/ModalManager.js';
import { Toast } from './views/Toast.js';
import { ChartManager } from './views/ChartManager.js';
import { CommandPalette } from './views/CommandPalette.js';
import { enhanceFormValidation } from './views/formValidation.js';
import { initErrorReporting, reportError } from './utils/errorReporter.js';
import { markPerformance, measurePerformance } from './utils/performance.js';

window.addEventListener('error', e => reportError(e.error ?? new Error(e.message), { origin: 'window.onerror' }));
window.addEventListener('unhandledrejection', e => reportError(
  e.reason instanceof Error ? e.reason : new Error('Unhandled promise rejection'),
  { origin: 'unhandledrejection' }
));

async function bootstrap() {
  markPerformance('boot-start');
  await initErrorReporting();
  enhanceFormValidation(document);

  const view = new DashboardView(document);
  const toast = new Toast(document.getElementById('toast'));

  function updateConnectionBanner() {
    if (navigator.onLine === false) {
      toast.show('Sin conexión. Lo nuevo no se guardará hasta reconectar.', 'warn', { persistent: true, id: 'offline' });
    } else {
      toast.dismiss('offline');
    }
  }
  window.addEventListener('online', updateConnectionBanner);
  window.addEventListener('offline', updateConnectionBanner);
  updateConnectionBanner();

  const client = createSupabaseClient();
  const degradedMessages = {
    buscar_pacientes: 'La búsqueda está en modo básico porque falta desplegar la búsqueda optimizada.',
    listar_servicios: 'La lista de servicios usa una consulta de respaldo porque falta desplegar su función SQL.',
    ronda_hoy: 'La ronda no está disponible: falta desplegar su función SQL.',
    timeline_paciente: 'La línea temporal no está disponible: falta desplegar su función SQL.',
    ultima_actividad_paciente: 'La última actividad no está disponible: falta desplegar su función SQL.'
  };
  const controller = new DashboardController({
    api: new ApiService(client, {
      onDegraded: name => toast.show(
        degradedMessages[name] ?? `La función SQL \"${name}\" no está desplegada.`,
        'warn', { persistent: true, id: 'rpc-' + name }
      )
    }),
    auth: new AuthService(client),
    state: new AppState(createInitialState()),
    view,
    modals: new ModalManager(document),
    toast,
    charts: new ChartManager(),
    palette: new CommandPalette(document)
  });

  await controller.init();
  measurePerformance('boot', 'boot-start');
}

void bootstrap().catch(err => {
  reportError(err, { origin: 'bootstrap' });
  const loading = document.getElementById('loadingScreen');
  if (loading) loading.innerHTML = '<p class="max-w-md text-center text-sm px-6">No se pudo iniciar la aplicación. Verifica la configuración y la conexión.</p>';
});
