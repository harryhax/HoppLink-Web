import { html, text } from '../dom.js';

/** Full-page notice: server unreachable (with Retry) or account suspended. */
export function renderStatus({ kind, message, onRetry, onSignOut }) {
  const offline = kind === 'offline';
  const page = html(`
    <main class="pm-center pm-auth-bg">
      <div class="card pm-auth-card shadow-sm">
        <div class="card-body p-4 p-sm-5 text-center">
          <i class="bi ${offline ? 'bi-cloud-slash text-warning' : 'bi-slash-circle text-danger'} pm-status-icon" aria-hidden="true"></i>
          <h1 class="h5 mt-3">${offline ? 'Cannot connect to HoppLink Server' : 'Account suspended'}</h1>
          <p class="text-body-secondary small" data-message></p>
          <div data-alert hidden role="alert"></div>
          <div class="d-flex gap-2 justify-content-center mt-4">
            ${offline ? '<button class="btn btn-primary" data-retry><i class="bi bi-arrow-clockwise me-1"></i>Retry</button>' : ''}
            ${onSignOut ? '<button class="btn btn-outline-secondary" data-signout>Sign out</button>' : ''}
          </div>
        </div>
      </div>
    </main>`);
  text(page, '[data-message]', message);
  page.querySelector('[data-retry]')?.addEventListener('click', onRetry);
  page.querySelector('[data-signout]')?.addEventListener('click', onSignOut);
  return page;
}
