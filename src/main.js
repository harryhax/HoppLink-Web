import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.min.css';
import 'bootstrap/js/dist/offcanvas.js';
import './styles.css';
import { createApi } from './api.js';
import { createAuth } from './auth.js';
import { isDownloadsPath } from './downloads.js';
import { showAlert } from './dom.js';
import { homeRedirect } from './home-redirect.js';
import { renderAccount } from './pages/account.js';
import { renderAdminShell } from './pages/admin-shell.js';
import { renderDownloads } from './pages/downloads.js';
import { renderLogin } from './pages/login.js';
import { renderRegister } from './pages/register.js';
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
      show(renderAdminShell({ user: state.user, api, onSignOut: signOut, onAuthLost: recheckSession }));
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
    case 'register':
      show(renderRegister({
        api,
        onBack: () => render({ view: 'login' }),
        onRegister: async (values) => {
          const next = await auth.signUp(values);
          if (next.refused) return next.refused;
          render(next);
          return null;
        },
      }));
      break;
    default:
      show(renderLogin({
        message: state.message,
        tone: state.tone,
        onCreateAccount: () => render({ view: 'register' }),
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

// / redirects to /downloads for now (see home-redirect.js). /downloads is public: it shows the release manifest and
// never checks for a session. Nginx serves this same page for it, through its fallback to index.html. Everything else
// is the signed-in application.
const redirect = homeRedirect(window.location.pathname, window.location.hash);
if (redirect) {
  window.location.replace(redirect);
} else if (isDownloadsPath(window.location.pathname)) {
  show(renderDownloads());
} else {
  start();
}
