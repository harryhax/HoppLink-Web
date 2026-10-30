import { html, text } from '../dom.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'bi-speedometer2', ready: true },
  { id: 'users', label: 'Users', icon: 'bi-people' },
  { id: 'servers', label: 'Proxy Servers', icon: 'bi-hdd-network' },
  { id: 'assignments', label: 'Assignments', icon: 'bi-diagram-3' },
];

function navItems() {
  return NAV.map((item) => item.ready
    ? `<li class="nav-item"><a class="nav-link active" aria-current="page" href="#dashboard"><i class="bi ${item.icon}"></i><span>${item.label}</span></a></li>`
    : `<li class="nav-item"><span class="nav-link disabled" aria-disabled="true"><i class="bi ${item.icon}"></i><span>${item.label}</span><span class="badge text-bg-light border ms-auto">Soon</span></span></li>`).join('');
}

/**
 * Administrator layout. Display only: every admin endpoint is enforced by the server, not by this
 * page. No statistics are shown yet (Step 14).
 */
export function renderDashboard({ user, api, onSignOut }) {
  const page = html(`
    <div class="pm-shell">
      <aside class="pm-sidebar offcanvas-lg offcanvas-start" tabindex="-1" id="pm-sidebar" aria-label="Navigation">
        <div class="offcanvas-header border-bottom d-lg-none">
          <span class="fw-semibold">ProxyMarket</span>
          <button type="button" class="btn-close" data-bs-dismiss="offcanvas" data-bs-target="#pm-sidebar" aria-label="Close"></button>
        </div>
        <div class="offcanvas-body d-flex flex-column p-0">
          <div class="pm-sidebar-brand d-none d-lg-flex"><img src="/favicon.svg" alt="" width="26" height="26"><span>ProxyMarket</span><span class="badge text-bg-primary-subtle text-primary-emphasis ms-1">Admin</span></div>
          <ul class="nav flex-column pm-nav">${navItems()}</ul>
        </div>
      </aside>

      <div class="pm-main">
        <nav class="navbar bg-white border-bottom px-3 px-lg-4 sticky-top">
          <button class="btn btn-sm btn-light border d-lg-none me-2" type="button" data-bs-toggle="offcanvas" data-bs-target="#pm-sidebar" aria-controls="pm-sidebar" aria-label="Open navigation">
            <i class="bi bi-list"></i>
          </button>
          <span class="navbar-brand d-lg-none fw-semibold me-auto">ProxyMarket</span>
          <div class="ms-auto d-flex align-items-center gap-3">
            <span class="small text-body-secondary d-none d-sm-inline"><i class="bi bi-person-circle me-1"></i><span data-who></span></span>
            <button class="btn btn-sm btn-outline-secondary" data-signout><i class="bi bi-box-arrow-right me-1"></i>Sign out</button>
          </div>
        </nav>

        <main class="p-3 p-lg-4">
          <div data-alert hidden role="alert"></div>
          <div class="mb-4">
            <h1 class="h4 mb-1">Welcome, <span data-first></span></h1>
            <p class="text-body-secondary mb-0">This is the ProxyMarket administration console.</p>
          </div>

          <div class="row g-3">
            <div class="col-12 col-xl-7">
              <div class="card shadow-sm h-100">
                <div class="card-header bg-white fw-semibold"><i class="bi bi-person-badge me-2 text-primary"></i>Your account</div>
                <div class="card-body">
                  <dl class="row mb-0 small pm-details">
                    <dt class="col-sm-4">Name</dt><dd class="col-sm-8" data-name></dd>
                    <dt class="col-sm-4">Email</dt><dd class="col-sm-8" data-email></dd>
                    <dt class="col-sm-4">Role</dt><dd class="col-sm-8"><span class="badge text-bg-primary" data-role></span></dd>
                    <dt class="col-sm-4">Status</dt><dd class="col-sm-8"><span class="badge text-bg-success" data-status></span></dd>
                    <dt class="col-sm-4">Account ID</dt><dd class="col-sm-8 font-monospace text-break" data-id></dd>
                  </dl>
                </div>
              </div>
            </div>
            <div class="col-12 col-xl-5">
              <div class="card shadow-sm h-100">
                <div class="card-header bg-white fw-semibold d-flex align-items-center">
                  <i class="bi bi-hdd-rack me-2 text-primary"></i>ProxyMarket Server
                  <button class="btn btn-sm btn-link ms-auto p-0" data-check><i class="bi bi-arrow-clockwise me-1"></i>Check</button>
                </div>
                <div class="card-body">
                  <div class="d-flex align-items-center gap-2">
                    <span class="pm-dot" data-dot></span><span class="fw-medium" data-health>Checking…</span>
                  </div>
                  <div class="small text-body-secondary mt-1" data-health-detail></div>
                </div>
              </div>
            </div>
          </div>

          <p class="small text-body-secondary mt-4 mb-0"><i class="bi bi-info-circle me-1"></i>Users, proxy servers and assignments will be managed here in upcoming releases.</p>
        </main>
      </div>
    </div>`);

  text(page, '[data-who]', user.name || user.email);
  text(page, '[data-first]', (user.name || user.email).split(' ')[0]);
  text(page, '[data-name]', user.name);
  text(page, '[data-email]', user.email);
  text(page, '[data-role]', user.role);
  text(page, '[data-status]', user.status);
  text(page, '[data-id]', user.id);
  page.querySelector('[data-signout]').addEventListener('click', onSignOut);

  async function checkHealth() {
    const dot = page.querySelector('[data-dot]');
    dot.className = 'pm-dot';
    text(page, '[data-health]', 'Checking…');
    text(page, '[data-health-detail]', '');
    const result = await api.health();
    const connected = result.ok && result.data?.status === 'ok' && result.data?.service === 'proxymarket-server';
    dot.className = `pm-dot ${connected ? 'pm-dot-ok' : 'pm-dot-bad'}`;
    text(page, '[data-health]', connected ? 'Connected' : 'Disconnected');
    text(page, '[data-health-detail]', connected ? `Version ${result.data.version}` : 'The server could not be reached or returned an error.');
  }
  page.querySelector('[data-check]').addEventListener('click', checkHealth);
  checkHealth();

  return page;
}
