import { describeError, FALLBACK_ERROR, meaningfulMessage } from '../api.js';
import { confirmDialog, html, showAlert, text } from '../dom.js';
import { transferHash } from '../router.js';
import {
  PERIODS, TERMS, formatAverage, formatBytes, formatCount, formatDateTime, formatExactBytes, loadUserUsage,
} from '../usage.js';
import { createUserAdmin, isAuthLoss } from '../user-admin.js';

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');

const badge = (element, label, tone) => {
  element.textContent = label;
  element.className = `badge ${tone}`;
};

/**
 * One user's details, plus suspend/reactivate and role changes. After any change the user is
 * reloaded from the server; nothing is updated optimistically.
 */
export function renderUserDetails({ user: me, api, onAuthLost, id, confirm = confirmDialog }) {
  const actions = createUserAdmin(api, confirm);
  const page = html(`
    <div>
      <nav aria-label="breadcrumb" class="mb-2"><ol class="breadcrumb small mb-0">
        <li class="breadcrumb-item"><a href="#users">Users</a></li><li class="breadcrumb-item active" aria-current="page" data-crumb>User</li>
      </ol></nav>
      <div data-alert hidden role="alert"></div>
      <div data-body><div class="text-center text-body-secondary py-5"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</div></div>
    </div>`);
  const body = page.querySelector('[data-body]');

  function failed(message) {
    body.replaceChildren(html(`
      <div class="alert alert-danger d-flex align-items-center gap-2" role="alert">
        <i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span class="me-auto" data-text></span>
        <button class="btn btn-sm btn-outline-danger" data-retry>Retry</button>
      </div>`));
    text(body, '[data-text]', meaningfulMessage(message) ?? FALLBACK_ERROR); // a failure is never shown blank
    body.querySelector('[data-retry]').addEventListener('click', load);
  }

  async function load() {
    const result = await api.getUser(id);
    if (!page.isConnected) return;
    if (!result.ok) {
      if (isAuthLoss(result) && (await onAuthLost?.())) return;
      failed(result.status === 404 ? 'This user does not exist.' : describeError(result));
      return;
    }
    render(result.data);
  }

  function render({ user, devices, sessions }) {
    text(page, '[data-crumb]', user.name || user.email);
    const isSelf = user.id === me.id;
    const suspended = user.status === 'SUSPENDED';
    const admin = user.role === 'ADMIN';
    const view = html(`
      <div>
        <div class="d-flex flex-wrap align-items-start gap-2 mb-4">
          <div class="me-auto"><h1 class="h4 mb-1" data-title></h1><p class="text-body-secondary mb-0" data-subtitle></p></div>
        </div>
        <div class="row g-3">
          <div class="col-12 col-xl-7">
            <div class="card shadow-sm h-100">
              <div class="card-header bg-white fw-semibold"><i class="bi bi-person-badge me-2 text-primary"></i>Account</div>
              <div class="card-body"><dl class="row mb-0 small pm-details">
                <dt class="col-sm-4">Name</dt><dd class="col-sm-8" data-f="name"></dd>
                <dt class="col-sm-4">Email</dt><dd class="col-sm-8 text-break" data-f="email"></dd>
                <dt class="col-sm-4">Account ID</dt><dd class="col-sm-8 font-monospace text-break" data-f="id"></dd>
                <dt class="col-sm-4">Role</dt><dd class="col-sm-8"><span data-f="role"></span></dd>
                <dt class="col-sm-4">Status</dt><dd class="col-sm-8"><span data-f="status"></span></dd>
                <dt class="col-sm-4">Registered</dt><dd class="col-sm-8" data-f="created"></dd>
                <dt class="col-sm-4">Last updated</dt><dd class="col-sm-8" data-f="updated"></dd>
              </dl></div>
            </div>
          </div>
          <div class="col-12 col-xl-5">
            <div class="card shadow-sm h-100">
              <div class="card-header bg-white fw-semibold"><i class="bi bi-sliders me-2 text-primary"></i>Access</div>
              <div class="card-body small">
                <div class="mb-3">
                  <div class="fw-medium mb-1">Account status</div>
                  <button class="btn btn-sm" data-status-action></button>
                </div>
                <div>
                  <div class="fw-medium mb-1">Role</div>
                  <button class="btn btn-sm" data-role-action></button>
                </div>
                <p class="text-body-secondary mt-3 mb-0" data-self-note hidden>You can't suspend your own account or remove your own administrator role.</p>
              </div>
            </div>
          </div>

          <div class="col-12">
            <div class="card shadow-sm">
              <div class="card-header bg-white d-flex align-items-center">
                <span class="fw-semibold me-auto"><i class="bi bi-arrow-down-up me-2 text-primary"></i>Data Transfer</span>
                <a class="small" data-transfer-link>All users</a>
              </div>
              <div data-usage><div class="text-center text-body-secondary small py-3"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</div></div>
              <div class="card-footer bg-white small text-body-secondary">Recorded when each connection closes, so connections that are still open are not included yet. Periods use UTC.</div>
            </div>
          </div>

          <div class="col-12">
            <div class="card shadow-sm">
              <div class="card-header bg-white fw-semibold"><i class="bi bi-laptop me-2 text-primary"></i>Devices</div>
              <div class="table-responsive"><table class="table align-middle mb-0 small">
                <thead class="table-light"><tr><th>Device name</th><th>Platform</th><th>Registered</th><th>Last seen</th><th>Status</th></tr></thead>
                <tbody data-devices></tbody></table></div>
              <div class="card-footer bg-white small text-body-secondary">Devices are account registrations; "Last seen" is not live connection status.</div>
            </div>
          </div>

          <div class="col-12">
            <div class="card shadow-sm">
              <div class="card-header bg-white fw-semibold"><i class="bi bi-shield-check me-2 text-primary"></i>Active sessions</div>
              <div class="table-responsive"><table class="table align-middle mb-0 small">
                <thead class="table-light"><tr><th>Session</th><th>Created</th><th>Expires</th><th>Browser / device</th></tr></thead>
                <tbody data-sessions></tbody></table></div>
            </div>
          </div>
        </div>
      </div>`);

    text(view, '[data-title]', user.name || user.email);
    text(view, '[data-subtitle]', user.email);
    text(view, '[data-f="name"]', user.name || '—');
    text(view, '[data-f="email"]', user.email);
    text(view, '[data-f="id"]', user.id);
    badge(view.querySelector('[data-f="role"]'), admin ? 'Administrator' : 'User', admin ? 'text-bg-primary' : 'text-bg-light border');
    badge(view.querySelector('[data-f="status"]'), suspended ? 'Suspended' : 'Active', suspended ? 'text-bg-danger' : 'text-bg-success');
    text(view, '[data-f="created"]', formatDate(user.createdAt));
    text(view, '[data-f="updated"]', formatDate(user.updatedAt));

    const statusButton = view.querySelector('[data-status-action]');
    statusButton.textContent = suspended ? 'Reactivate Account' : 'Suspend Account';
    statusButton.classList.add(suspended ? 'btn-outline-success' : 'btn-outline-danger');
    statusButton.disabled = isSelf && !suspended; // the server refuses self-suspension too
    statusButton.addEventListener('click', () => run(suspended ? actions.reactivate(user) : actions.suspend(user), statusButton));

    const roleButton = view.querySelector('[data-role-action]');
    roleButton.textContent = admin ? 'Remove Administrator Role' : 'Make Administrator';
    roleButton.classList.add('btn-outline-primary');
    roleButton.disabled = isSelf && admin; // the server refuses self-demotion too
    roleButton.addEventListener('click', () => run(admin ? actions.removeAdmin(user) : actions.makeAdmin(user), roleButton));
    view.querySelector('[data-self-note]').hidden = !isSelf;

    const deviceRows = view.querySelector('[data-devices]');
    deviceRows.replaceChildren(...(devices.length === 0
      ? [html('<tr><td colspan="5" class="text-center text-body-secondary py-3">No registered devices.</td></tr>')]
      : devices.map((d) => {
        const row = html('<tr><td data-c="name"></td><td data-c="platform"></td><td data-c="created"></td><td data-c="seen"></td><td><span data-c="status"></span></td></tr>');
        text(row, '[data-c="name"]', d.name);
        text(row, '[data-c="platform"]', d.platform);
        text(row, '[data-c="created"]', formatDate(d.createdAt));
        text(row, '[data-c="seen"]', d.lastSeenAt ? formatDate(d.lastSeenAt) : 'Never');
        badge(row.querySelector('[data-c="status"]'), d.revokedAt ? `Revoked ${new Date(d.revokedAt).toLocaleDateString()}` : 'Registered', d.revokedAt ? 'text-bg-secondary' : 'text-bg-success');
        if (d.revokedAt) row.classList.add('text-body-secondary');
        return row;
      })));

    const sessionRows = view.querySelector('[data-sessions]');
    sessionRows.replaceChildren(...(sessions.length === 0
      ? [html('<tr><td colspan="4" class="text-center text-body-secondary py-3">No active sessions.</td></tr>')]
      : sessions.map((s) => {
        const row = html('<tr><td class="font-monospace" data-c="id"></td><td data-c="created"></td><td data-c="expires"></td><td class="text-break" data-c="agent"></td></tr>');
        text(row, '[data-c="id"]', `${s.id.slice(0, 8)}…`);
        row.querySelector('[data-c="id"]').title = s.id;
        text(row, '[data-c="created"]', formatDate(s.createdAt));
        text(row, '[data-c="expires"]', formatDate(s.expiresAt));
        text(row, '[data-c="agent"]', [s.userAgent, s.ipAddress].filter(Boolean).join(' · ') || '—');
        return row;
      })));

    view.querySelector('[data-transfer-link]').href = transferHash();
    body.replaceChildren(view);
    loadUsage(view.querySelector('[data-usage]'), user.id);
  }

  /** The user's Data Transfer section. It loads on its own, so a failure here never hides the account. */
  async function loadUsage(box, userId) {
    const result = await loadUserUsage(api, userId);
    if (!box.isConnected) return;
    if (result.state === 'auth' && (await onAuthLost?.())) return;
    if (result.state !== 'ready') {
      const failure = html(`
        <div class="d-flex align-items-center gap-2 m-3 small text-danger">
          <i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span class="me-auto" data-text></span>
          <button class="btn btn-sm btn-outline-danger" data-retry>Retry</button>
        </div>`);
      text(failure, '[data-text]', result.state === 'missing' ? 'This user no longer exists.'
        : result.state === 'auth' ? 'The server refused access to usage figures for your session.' : meaningfulMessage(result.message) ?? FALLBACK_ERROR);
      failure.querySelector('[data-retry]').addEventListener('click', () => loadUsage(box, userId));
      box.replaceChildren(failure);
      return;
    }
    const table = html(`
      <div>
        <div class="table-responsive"><table class="table align-middle mb-0 small">
          <thead class="table-light"><tr><th scope="col">Period</th><th scope="col" class="text-end">${TERMS.down}</th><th scope="col" class="text-end">${TERMS.up}</th>
            <th scope="col" class="text-end">Total</th><th scope="col" class="text-end">${TERMS.transactions}</th><th scope="col" class="text-end">Average per Connection</th></tr></thead>
          <tbody data-rows></tbody></table></div>
        <div class="px-3 py-2 small"><span class="text-body-secondary">${TERMS.lastActivity}:</span> <span data-last></span></div>
      </div>`);
    const rows = table.querySelector('[data-rows]');
    for (const period of PERIODS) {
      const totals = result.periods[period.id];
      const row = html('<tr><th scope="row" class="fw-medium"></th><td class="text-end"></td><td class="text-end"></td><td class="text-end fw-medium"></td><td class="text-end"></td><td class="text-end"></td></tr>');
      const cells = row.children;
      cells[0].textContent = period.label;
      [['bytesDown', 1], ['bytesUp', 2], ['bytesTotal', 3]].forEach(([key, i]) => {
        cells[i].textContent = formatBytes(totals[key]);
        cells[i].title = formatExactBytes(totals[key]);
      });
      cells[4].textContent = formatCount(totals.transactions);
      cells[5].textContent = formatAverage(totals.avgBytesPerTransaction);
      cells[5].title = TERMS.averageNote;
      rows.append(row);
    }
    text(table, '[data-last]', formatDateTime(result.periods.all.lastActivityAt));
    box.replaceChildren(table);
  }

  async function run(pending, button) {
    button.disabled = true;
    showAlert(page, '');
    const result = await pending;
    if (!page.isConnected) return;
    if (result.outcome === 'cancelled') {
      button.disabled = false;
      return;
    }
    if (result.outcome === 'auth') {
      if (await onAuthLost?.()) return;
      showAlert(page, 'The server refused this action for your session. Sign out and sign in again if this continues.');
    } else {
      showAlert(page, result.message, result.outcome === 'done' ? 'success' : 'danger');
    }
    await load(); // always show the server's current state
  }

  load();
  return page;
}
