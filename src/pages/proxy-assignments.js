import { describeError } from '../api.js';
import { assignmentActions, createAssignmentAdmin } from '../assignment-admin.js';
import { confirmDialog, html, text } from '../dom.js';
import { assignmentsHash, userHash } from '../router.js';
import { isAuthLoss } from '../user-admin.js';
import { handleAssignmentResult, openAssignmentForm } from './assignment-form.js';

export const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');

/**
 * Proxy assignments: server-side search, filter (assigned / unassigned / all users) and pagination,
 * kept in the URL hash, plus Assign, Change and Remove through the server API.
 */
export function renderProxyAssignments({ api, onAuthLost, route: initialRoute, confirm = confirmDialog }) {
  const actions = createAssignmentAdmin(api, confirm);
  let route = { ...initialRoute };
  const page = html(`
    <div>
      <div class="d-flex flex-wrap align-items-start gap-2 mb-4">
        <div class="me-auto">
          <h1 class="h4 mb-1">Proxy Assignments</h1>
          <p class="text-body-secondary mb-0">Manage which proxy server each user can access.</p>
        </div>
        <button class="btn btn-sm btn-primary" data-assign><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Assign Proxy</button>
      </div>
      <div data-alert hidden role="alert"></div>

      <div class="card shadow-sm">
        <div class="card-body border-bottom d-flex flex-wrap gap-2">
          <div class="input-group" style="max-width: 420px">
            <span class="input-group-text bg-white"><i class="bi bi-search" aria-hidden="true"></i></span>
            <input type="search" class="form-control" data-search placeholder="Search by user, email, or proxy server" aria-label="Search by user, email, or proxy server" maxlength="100">
          </div>
          <select class="form-select" data-filter aria-label="Show" style="max-width: 220px">
            <option value="all">All Users</option>
            <option value="assigned">Assigned Users</option>
            <option value="unassigned">Unassigned Users</option>
          </select>
        </div>
        <div class="alert alert-danger d-flex align-items-center gap-2 m-3" data-error hidden role="alert">
          <i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span class="me-auto" data-error-text></span>
          <button class="btn btn-sm btn-outline-danger" data-retry>Retry</button>
        </div>
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0 small">
            <thead class="table-light"><tr>
              <th scope="col">User</th><th scope="col">Email</th><th scope="col">Proxy Server</th><th scope="col">Host</th><th scope="col">Port</th>
              <th scope="col">Server Status</th><th scope="col">Assigned</th><th scope="col" class="text-end">Actions</th>
            </tr></thead>
            <tbody data-rows></tbody>
          </table>
        </div>
        <div class="card-footer bg-white d-flex flex-wrap align-items-center gap-2 small">
          <span class="text-body-secondary me-auto" data-summary></span>
          <button class="btn btn-sm btn-outline-secondary" data-prev><i class="bi bi-chevron-left"></i> Previous</button>
          <span data-page-label></span>
          <button class="btn btn-sm btn-outline-secondary" data-next>Next <i class="bi bi-chevron-right"></i></button>
        </div>
      </div>
      <p class="small text-body-secondary mt-3 mb-0"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>Each user has at most one proxy server. Changes are database records only: they take effect the next time a client requests its proxy configuration, and nothing is pushed to running apps.</p>
    </div>`);

  const searchInput = page.querySelector('[data-search]');
  const filterSelect = page.querySelector('[data-filter]');
  const rows = page.querySelector('[data-rows]');
  const errorBox = page.querySelector('[data-error]');
  const prev = page.querySelector('[data-prev]');
  const next = page.querySelector('[data-next]');
  searchInput.value = route.search;
  filterSelect.value = route.filter;
  let latest = 0;

  const message = (markup) => rows.replaceChildren(html(`<tr><td colspan="8" class="text-center text-body-secondary py-4">${markup}</td></tr>`));
  const finish = (result) => handleAssignmentResult(result, { root: page, onAuthLost, reload: load });
  const openForm = (target = null) => openAssignmentForm({ api, actions, target, onFinished: finish });

  function fail(messageText) {
    rows.replaceChildren();
    text(page, '[data-error-text]', messageText);
    errorBox.hidden = false;
    text(page, '[data-summary]', '');
    text(page, '[data-page-label]', '');
  }

  async function load() {
    const request = ++latest;
    errorBox.hidden = true;
    prev.disabled = next.disabled = true;
    message('<span class="spinner-border spinner-border-sm me-2"></span>Loading…');
    const result = await api.listAssignments({ filter: route.filter, search: route.search, page: route.page, pageSize: PAGE_SIZE });
    if (request !== latest || !page.isConnected) return; // a newer search, filter or page superseded this one

    if (!result.ok) {
      if (isAuthLoss(result) && (await onAuthLost?.())) return;
      fail(describeError(result));
      return;
    }
    const { entries, total, pageSize } = result.data ?? {};
    if (!Array.isArray(entries) || !Number.isInteger(total)) {
      fail('The server returned unexpected data.');
      return;
    }

    const pages = Math.max(1, Math.ceil(total / pageSize));
    const noun = route.filter === 'assigned' ? (total === 1 ? 'assignment' : 'assignments') : (total === 1 ? 'user' : 'users');
    text(page, '[data-summary]', `${total.toLocaleString()} ${noun}`);
    text(page, '[data-page-label]', `Page ${route.page} of ${pages}`);
    prev.disabled = route.page <= 1;
    next.disabled = route.page >= pages;

    if (entries.length === 0) {
      if (route.search || route.page > 1) message('No matching users.');
      else if (route.filter === 'unassigned') message('Every user has a proxy server assigned.');
      else {
        message('No proxy assignments configured.<div class="mt-3"><button class="btn btn-sm btn-primary" data-assign-empty><i class="bi bi-plus-lg me-1"></i>Assign Proxy</button></div>');
        rows.querySelector('[data-assign-empty]').addEventListener('click', () => openForm());
      }
      return;
    }
    rows.replaceChildren(...entries.map(row));
  }

  function row(entry) {
    const { user, assignment } = entry;
    const tr = html(`<tr>
      <td><a data-c="name"></a> <span class="badge text-bg-danger" data-c="suspended" hidden>Suspended</span></td>
      <td data-c="email" class="text-break"></td><td data-c="server" class="fw-medium"></td>
      <td data-c="host" class="font-monospace text-break"></td><td data-c="port" class="font-monospace"></td>
      <td><span data-c="status"></span></td><td data-c="date" class="text-nowrap"></td>
      <td class="text-end text-nowrap" data-c="actions"></td></tr>`);
    const name = tr.querySelector('[data-c="name"]');
    name.textContent = user.name || user.email;
    name.href = userHash(user.id);
    tr.querySelector('[data-c="suspended"]').hidden = user.status !== 'SUSPENDED';
    text(tr, '[data-c="email"]', user.email);
    text(tr, '[data-c="server"]', assignment?.server.name ?? '—');
    text(tr, '[data-c="host"]', assignment?.server.host ?? '—');
    text(tr, '[data-c="port"]', assignment ? String(assignment.server.port) : '—');
    const status = tr.querySelector('[data-c="status"]');
    if (assignment) {
      status.textContent = assignment.server.enabled ? 'Enabled' : 'Disabled';
      status.className = assignment.server.enabled ? 'badge text-bg-success' : 'badge text-bg-secondary';
    } else {
      status.textContent = 'Not assigned';
      status.className = 'text-body-secondary';
    }
    text(tr, '[data-c="date"]', assignment ? formatDate(assignment.createdAt) : '—');

    const cell = tr.querySelector('[data-c="actions"]');
    for (const action of assignmentActions(entry)) {
      const button = html({
        assign: '<button class="btn btn-sm btn-outline-primary"><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Assign</button>',
        change: '<button class="btn btn-sm btn-outline-secondary"><i class="bi bi-arrow-left-right me-1" aria-hidden="true"></i>Change</button>',
        remove: '<button class="btn btn-sm btn-outline-danger ms-1"><i class="bi bi-x-lg me-1" aria-hidden="true"></i>Remove</button>',
      }[action]);
      button.addEventListener('click', async () => {
        if (action !== 'remove') return openForm(entry);
        button.disabled = true;
        const result = await actions.remove(entry);
        if (!page.isConnected) return;
        button.disabled = false;
        await finish(result);
      });
      cell.append(button);
    }
    return tr;
  }

  // As on the Users page: typing reloads only the table and replaces the history entry; the filter
  // and paging push new entries.
  let timer;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      route = { ...route, search: searchInput.value.trim(), page: 1 };
      history.replaceState(null, '', assignmentsHash(route));
      load();
    }, SEARCH_DELAY_MS);
  });
  filterSelect.addEventListener('change', () => { location.hash = assignmentsHash({ ...route, filter: filterSelect.value, page: 1 }); });
  prev.addEventListener('click', () => { location.hash = assignmentsHash({ ...route, page: route.page - 1 }); });
  next.addEventListener('click', () => { location.hash = assignmentsHash({ ...route, page: route.page + 1 }); });
  page.querySelector('[data-retry]').addEventListener('click', load);
  page.querySelector('[data-assign]').addEventListener('click', () => openForm());

  load();
  return page;
}
