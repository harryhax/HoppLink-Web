import { html, text } from '../dom.js';
import { createStatsLoader } from '../stats.js';

const CARDS = [
  { key: 'totalUsers', label: 'Total Users', icon: 'bi-people' },
  { key: 'activeUsers', label: 'Active Users', icon: 'bi-person-check', note: 'Not suspended' },
  { key: 'registeredDevices', label: 'Registered Devices', icon: 'bi-laptop', note: 'Not revoked' },
  { key: 'proxyServers', label: 'Proxy Servers', icon: 'bi-hdd-network', note: (s) => `${s.enabledProxyServers.toLocaleString()} enabled` },
  { key: 'proxyAssignments', label: 'Proxy Assignments', icon: 'bi-diagram-3' },
  { key: 'activeSessions', label: 'Active Sessions', icon: 'bi-shield-check', note: 'Unexpired; not users online' },
];

function statCards() {
  return CARDS.map((card) => `
    <div class="col-12 col-md-6 col-xl-4">
      <div class="card shadow-sm h-100 pm-stat" data-stat="${card.key}">
        <div class="card-body d-flex align-items-start gap-3">
          <div class="pm-stat-icon"><i class="bi ${card.icon}" aria-hidden="true"></i></div>
          <div class="min-w-0">
            <div class="small text-body-secondary">${card.label}</div>
            <div class="pm-stat-value placeholder-glow" data-value><span class="placeholder col-6"></span></div>
            <div class="small text-body-secondary" data-note></div>
          </div>
        </div>
      </div>
    </div>`).join('');
}

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
export function renderDashboard({ user, api, onSignOut, onAuthLost }) {
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
          <div class="d-flex flex-wrap align-items-start gap-2 mb-4">
            <div class="me-auto">
              <h1 class="h4 mb-1">Welcome, <span data-first></span></h1>
              <p class="text-body-secondary mb-0">This is the ProxyMarket administration console.</p>
            </div>
            <button class="btn btn-sm btn-outline-primary" data-refresh>
              <span class="spinner-border spinner-border-sm me-1" hidden aria-hidden="true"></span><i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Refresh
            </button>
          </div>

          <div class="alert alert-danger d-flex align-items-center gap-2" data-stats-error hidden role="alert">
            <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
            <span class="me-auto" data-stats-error-text></span>
            <button class="btn btn-sm btn-outline-danger" data-retry>Retry</button>
          </div>

          <div data-stats>
            <div class="row g-3 mb-4">${statCards()}</div>

            <div class="card shadow-sm mb-4">
              <div class="card-header bg-white fw-semibold"><i class="bi bi-person-plus me-2 text-primary"></i>Recently Registered Users</div>
              <div class="table-responsive">
                <table class="table table-hover align-middle mb-0 small">
                  <thead class="table-light">
                    <tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Registered</th></tr>
                  </thead>
                  <tbody data-recent>
                    <tr><td colspan="5" class="text-center text-body-secondary py-4"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
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

  // ---- Statistics (independent of the health check) ----
  const loader = createStatsLoader(api);
  const statsBox = page.querySelector('[data-stats]');
  const errorBox = page.querySelector('[data-stats-error]');
  const refresh = page.querySelector('[data-refresh]');

  function setLoading(loading) {
    refresh.disabled = loading;
    refresh.querySelector('.spinner-border').hidden = !loading;
    refresh.querySelector('.bi').hidden = loading;
  }

  function showCards(summary) {
    for (const card of CARDS) {
      const element = page.querySelector(`[data-stat="${card.key}"]`);
      const value = element.querySelector('[data-value]');
      value.classList.remove('placeholder-glow');
      value.textContent = summary[card.key].toLocaleString();
      const note = typeof card.note === 'function' ? card.note(summary) : card.note ?? '';
      text(element, '[data-note]', note);
    }
  }

  function showRecent(users) {
    const body = page.querySelector('[data-recent]');
    if (users.length === 0) {
      body.replaceChildren(html('<tr><td colspan="5" class="text-center text-body-secondary py-4">No users to display.</td></tr>'));
      return;
    }
    body.replaceChildren(...users.map((u) => {
      const row = html(`<tr><td data-c="name"></td><td data-c="email" class="text-break"></td><td><span data-c="role" class="badge"></span></td>
        <td><span data-c="status" class="badge"></span></td><td data-c="date" class="text-nowrap"></td></tr>`);
      text(row, '[data-c="name"]', u.name || '—');
      text(row, '[data-c="email"]', u.email);
      const role = row.querySelector('[data-c="role"]');
      role.textContent = u.role === 'ADMIN' ? 'Administrator' : 'User';
      role.className = u.role === 'ADMIN' ? 'badge text-bg-primary' : 'badge text-bg-light border';
      const status = row.querySelector('[data-c="status"]');
      status.textContent = u.status === 'SUSPENDED' ? 'Suspended' : 'Active';
      status.className = u.status === 'SUSPENDED' ? 'badge text-bg-danger' : 'badge text-bg-success';
      const date = new Date(u.createdAt);
      text(row, '[data-c="date"]', Number.isNaN(date.getTime()) ? '—' : date.toLocaleString());
      return row;
    }));
  }

  async function loadStats() {
    setLoading(true);
    errorBox.hidden = true;
    const result = await loader.load();
    setLoading(false);
    if (result.state === 'ready') {
      statsBox.hidden = false;
      showCards(result.summary);
      showRecent(result.recentUsers);
    } else if (result.state === 'auth') {
      // Session ended or no longer an active admin: hide the figures and let the app re-check the session.
      statsBox.hidden = true;
      const handled = await onAuthLost?.();
      if (!handled) {
        text(page, '[data-stats-error-text]', 'The server refused access to the dashboard statistics. Sign out and sign in again if this continues.');
        errorBox.hidden = false;
      }
    } else {
      // Keep whatever was shown out of view rather than presenting stale or zeroed figures.
      statsBox.hidden = true;
      text(page, '[data-stats-error-text]', result.message);
      errorBox.hidden = false;
    }
  }

  refresh.addEventListener('click', loadStats);
  page.querySelector('[data-retry]').addEventListener('click', loadStats);
  loadStats();

  return page;
}
