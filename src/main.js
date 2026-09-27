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
import { enhanceFormValidation } from './views/formValidation.js';
import { initErrorReporting, reportError } from './utils/errorReporter.js';

// Monitoreo de errores (2.4): si VITE_SENTRY_DSN no está configurado, esto no
// hace nada más que dejar `reportError` funcionando como console.error.
initErrorReporting();

// Cualquier excepción o promesa rechazada que se escape de un try/catch
// específico igual queda registrada, en vez de perderse en silencio.
window.addEventListener('error', e => reportError(e.error ?? new Error(e.message), { origin: 'window.onerror' }));
window.addEventListener('unhandledrejection', e => reportError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), { origin: 'unhandledrejection' }));

enhanceFormValidation(document);
const view = new DashboardView(document);
const toast = new Toast(document.getElementById('toast'));

// Estado de conexión (2.3): aviso persistente mientras no hay red; no bloquea
// la interfaz, solo dejar claro por qué algo podría no guardarse.
function updateConnectionBanner() {
  if (navigator.onLine === false) {
    toast.show('Sin conexión a internet. Podés seguir viendo lo ya cargado, pero nada nuevo se guardará hasta reconectar.', 'warn', { persistent: true, id: 'offline' });
  } else {
    toast.dismiss('offline');
  }
}
window.addEventListener('online', updateConnectionBanner);
window.addEventListener('offline', updateConnectionBanner);
updateConnectionBanner();

try {
  const client = createSupabaseClient();
  const controller = new DashboardController({
    api: new ApiService(client, {
      // 2.6: si la función de búsqueda tolerante a acentos/tipeo no está
      // desplegada, que se note en la interfaz (persistente) y no solo en la
      // consola — es una degradación funcional, no un detalle de rendimiento.
      onDegraded: name => toast.show(
        `La búsqueda de pacientes está en modo básico (sensible a acentos) porque falta desplegar "${name}". Pide a un administrador que ejecute supabase/001_search_and_indexes.sql.`,
        'warn', { persistent: true, id: 'rpc-' + name }
      )
    }),
    auth: new AuthService(client),
    state: new AppState(createInitialState()),
    view,
    modals: new ModalManager(document),
    toast,
    charts: new ChartManager()
  });
  controller.init();
} catch (err) {
  reportError(err, { origin: 'bootstrap' });
  view.showFatalError(err.message);
}
