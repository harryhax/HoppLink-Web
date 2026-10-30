import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.min.css';
import 'bootstrap/js/dist/offcanvas.js';
import './styles.css';
import { createApi } from './api.js';
import { createAuth } from './auth.js';
import { showAlert } from './dom.js';
import { renderAccount } from './pages/account.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderLogin } from './pages/login.js';
import { renderStatus } from './pages/status.js';

const root = document.getElementById('app');
const api = createApi();
const auth = createAuth(api);

function show(element) {
  root.replaceChildren(element);
}

async function signOut() {
  const result = await auth.signOut();
  if (result.view === 'stay') {
    showAlert(root, result.message, 'warning');
    return;
  }
  render(result);
}

/** Renders one of the auth states produced by auth.js. */
function render(state) {
  switch (state.view) {
    case 'admin':
      show(renderDashboard({ user: state.user, api, onSignOut: signOut, onAuthLost: recheckSession }));
      break;
    case 'user':
      show(renderAccount({ user: state.user, onSignOut: signOut }));
      break;
    case 'suspended':
      show(renderStatus({ kind: 'suspended', message: state.message, onSignOut: signOut }));
      break;
    case 'offline':
      show(renderStatus({ kind: 'offline', message: state.message, onRetry: start }));
      break;
    default:
      show(renderLogin({
        message: state.message,
        tone: state.tone,
        onSignIn: async (email, password) => {
          const next = await auth.signIn(email, password);
          if (next.view === 'login') return next.message;
          render(next);
          return null;
        },
      }));
  }
}

/**
 * The dashboard API refused the session (401/403). Re-check it with the existing session handling
 * and show the right screen. Returns false (stay on the dashboard) if the server still reports an
 * active admin, so a disagreement between endpoints can't cause a render loop.
 */
async function recheckSession() {
  const next = await auth.restore();
  if (next.view === 'admin') return false;
  render(next);
  return true;
}

async function start() {
  render(await auth.restore());
}

start();
