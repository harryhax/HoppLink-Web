import { html, text } from '../dom.js';

/** Regular users: their account details and a note that the user dashboard is coming. */
export function renderAccount({ user, onSignOut }) {
  const page = html(`
    <div class="pm-shell-simple">
      <nav class="navbar bg-white border-bottom px-3 px-lg-4">
        <span class="navbar-brand d-flex align-items-center gap-2 fw-semibold"><img src="/favicon.svg" alt="" width="26" height="26">ProxyMarket</span>
        <button class="btn btn-sm btn-outline-secondary" data-signout><i class="bi bi-box-arrow-right me-1"></i>Sign out</button>
      </nav>
      <main class="container py-5" style="max-width: 640px">
        <div data-alert hidden role="alert"></div>
        <div class="card shadow-sm">
          <div class="card-body p-4">
            <div class="d-flex align-items-center gap-3 mb-4">
              <div class="pm-avatar"><i class="bi bi-person" aria-hidden="true"></i></div>
              <div>
                <div class="fw-semibold fs-5" data-name></div>
                <div class="text-body-secondary small" data-email></div>
              </div>
            </div>
            <div class="alert alert-light border small mb-0">
              <i class="bi bi-info-circle me-1" aria-hidden="true"></i>
              Account management features are coming soon. Use the ProxyMarket desktop app in the meantime.
            </div>
          </div>
        </div>
      </main>
    </div>`);
  text(page, '[data-name]', user.name || user.email);
  text(page, '[data-email]', user.email);
  page.querySelector('[data-signout]').addEventListener('click', onSignOut);
  return page;
}
