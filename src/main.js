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

const view = new DashboardView(document);

try {
  const client = createSupabaseClient();
  const controller = new DashboardController({
    api: new ApiService(client),
    auth: new AuthService(client),
    state: new AppState(createInitialState()),
    view,
    modals: new ModalManager(document),
    toast: new Toast(document.getElementById('toast')),
    charts: new ChartManager()
  });
  controller.init();
} catch (err) {
  console.error(err);
  view.showFatalError(err.message);
}
