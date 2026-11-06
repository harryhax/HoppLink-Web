import { describeError } from '../api.js';
import { html, setErrorBanner, text } from '../dom.js';
import { userHash, usersHash } from '../router.js';
import { isAuthLoss } from '../user-admin.js';

export const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');

/** Users list: server-side search (debounced) and pagination, kept in the URL hash. */
export function renderUsers({ api, onAuthLost, route: initialRoute }) {
  let route = { ...initialRoute };
  const page = html(`
    <div>
      <div class="d-flex flex-wrap align-items-start gap-2 mb-4">
        <div class="me-auto">
          <h1 class="h4 mb-1">Users</h1>
          <p class="text-body-secondary mb-0">Manage registered accounts and access.</p>
        </div>
      </div>

      <div class="card shadow-sm">
        <div class="card-body border-bottom">
          <div class="input-group" style="max-width: 420px">
            <span class="input-group-text bg-white"><i class="bi bi-search" aria-hidden="true"></i></span>
            <input type="search" class="form-control" data-search placeholder="Search users by name or email" aria-label="Search users by name or email" maxlength="100">
          </div>
        </div>
        <div class="alert alert-danger d-flex align-items-center gap-2 m-3" data-error hidden role="alert">
          <i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span class="me-auto" data-error-text></span>
          <button class="btn btn-sm btn-outline-danger" data-retry>Retry</button>
        </div>
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0 small">
            <thead class="table-light">
              <tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th>
                <th scope="col" class="text-end">Devices</th><th scope="col">Registered</th><th scope="col" class="text-end">Actions</th></tr>
            </thead>
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
    </div>`);

  const searchInput = page.querySelector('[data-search]');
  const rows = page.querySelector('[data-rows]');
  const errorBox = page.querySelector('[data-error]');
  const prev = page.querySelector('[data-prev]');
  const next = page.querySelector('[data-next]');
  searchInput.value = route.search;
  let latest = 0;

  const message = (markup) => rows.replaceChildren(html(`<tr><td colspan="7" class="text-center text-body-secondary py-4">${markup}</td></tr>`));

  async function load() {
    const request = ++latest;
    setErrorBanner(errorBox, null);
    prev.disabled = next.disabled = true;
    message('<span class="spinner-border spinner-border-sm me-2"></span>Loading…');
    const result = await api.listUsers({ search: route.search, page: route.page, pageSize: PAGE_SIZE });
    if (request !== latest || !page.isConnected) return; // a newer search/page superseded this one

    if (!result.ok) {
      if (isAuthLoss(result) && (await onAuthLost?.())) return;
      rows.replaceChildren();
      setErrorBanner(errorBox, describeError(result), { failed: true });
      text(page, '[data-summary]', '');
      text(page, '[data-page-label]', '');
      return;
    }

    const { users, total, pageSize } = result.data;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    text(page, '[data-summary]', `${total.toLocaleString()} ${total === 1 ? 'user' : 'users'}`);
    text(page, '[data-page-label]', `Page ${route.page} of ${pages}`);
    prev.disabled = route.page <= 1;
    next.disabled = route.page >= pages;

    if (users.length === 0) {
      message('No users found.');
      return;
    }
    rows.replaceChildren(...users.map((u) => {
      const row = html(`<tr>
        <td data-c="name"></td><td data-c="email" class="text-break"></td>
        <td><span data-c="role"></span></td><td><span data-c="status"></span></td>
        <td data-c="devices" class="text-end"></td><td data-c="date" class="text-nowrap"></td>
        <td class="text-end"><a class="btn btn-sm btn-outline-primary" data-c="view">View Details</a></td></tr>`);
      text(row, '[data-c="name"]', u.name || '—');
      text(row, '[data-c="email"]', u.email);
      const role = row.querySelector('[data-c="role"]');
      role.textContent = u.role === 'ADMIN' ? 'Administrator' : 'User';
      role.className = u.role === 'ADMIN' ? 'badge text-bg-primary' : 'badge text-bg-light border';
      const status = row.querySelector('[data-c="status"]');
      status.textContent = u.status === 'SUSPENDED' ? 'Suspended' : 'Active';
      status.className = u.status === 'SUSPENDED' ? 'badge text-bg-danger' : 'badge text-bg-success';
      text(row, '[data-c="devices"]', String(u.devices));
      text(row, '[data-c="date"]', formatDate(u.createdAt));
      row.querySelector('[data-c="view"]').href = userHash(u.id);
      return row;
    }));
  }

  // Typing reloads only the table (the search box keeps focus) and replaces the history entry, so the
  // URL stays shareable without a Back step per keystroke. Paging pushes a new history entry.
  let timer;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      route = { ...route, search: searchInput.value.trim(), page: 1 };
      history.replaceState(null, '', usersHash(route));
      load();
    }, SEARCH_DELAY_MS);
  });
  prev.addEventListener('click', () => { location.hash = usersHash({ search: route.search, page: route.page - 1 }); });
  next.addEventListener('click', () => { location.hash = usersHash({ search: route.search, page: route.page + 1 }); });
  page.querySelector('[data-retry]').addEventListener('click', load);

  load();
  return page;
}
