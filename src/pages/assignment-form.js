import { describeError } from '../api.js';
import { hostPort, serverOptions } from '../assignment-admin.js';
import { html, showAlert, text } from '../dom.js';
import { isAuthLoss } from '../user-admin.js';

const USER_RESULTS = 8;
const SEARCH_DELAY_MS = 300;

/**
 * The Assign / Change Proxy dialog, shared by the Proxy Assignments page and the user details page.
 *
 * `target` is `{ user, assignment }`:
 * - with an assignment: Change (the user is fixed; pick a replacement server);
 * - with a user only: Assign to that user;
 * - null: Assign, picking the user with a server-side search (never the whole user list).
 *
 * `onFinished(result)` runs after the dialog closes on success ('done') or a lost session ('auth').
 * On any other failure the dialog stays open with the values chosen and the server's message.
 */
export async function openAssignmentForm({ api, actions, target = null, onFinished }) {
  const { default: Modal } = await import('bootstrap/js/dist/modal.js');
  const changing = Boolean(target?.assignment);
  let chosenUser = target?.user ?? null;

  const dialog = html(`
    <div class="modal fade" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <form class="modal-content" novalidate>
          <div class="modal-header"><h2 class="modal-title h5" data-title></h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cancel"></button></div>
          <div class="modal-body">
            <div data-alert hidden role="alert"></div>
            <div class="mb-3">
              <div class="form-label small fw-medium">User</div>
              <div class="border rounded px-3 py-2 small d-flex align-items-center gap-2" data-chosen hidden>
                <div class="me-auto text-break"><div class="fw-medium" data-chosen-name></div><div class="text-body-secondary" data-chosen-email></div></div>
                <button type="button" class="btn btn-sm btn-link p-0" data-rechoose hidden>Choose another</button>
              </div>
              <div data-picker hidden>
                <input type="search" class="form-control" id="as-user-search" placeholder="Search by name or email" aria-label="Search users by name or email" maxlength="100" autocomplete="off">
                <div class="list-group mt-2 small" data-results aria-live="polite"></div>
              </div>
              <div class="small text-warning-emphasis mt-1" data-existing hidden></div>
              <div class="invalid-feedback d-block" data-err="user"></div>
            </div>
            <div class="mb-3" data-current hidden>
              <div class="form-label small fw-medium">Current proxy server</div>
              <div class="small"><span data-current-text></span> <span data-current-status></span></div>
            </div>
            <div>
              <label class="form-label small fw-medium" for="as-server" data-server-label></label>
              <select class="form-select" id="as-server" disabled><option value="">Loading proxy servers…</option></select>
              <div class="form-text" data-server-hint></div>
              <div class="invalid-feedback" data-err="server"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="submit" class="btn btn-primary" data-save disabled><span class="spinner-border spinner-border-sm me-1" hidden aria-hidden="true"></span><span data-save-label></span></button>
          </div>
        </form>
      </div>
    </div>`);

  text(dialog, '[data-title]', changing ? 'Change Proxy' : 'Assign Proxy');
  text(dialog, '[data-save-label]', changing ? 'Change Proxy' : 'Assign Proxy');
  text(dialog, '[data-server-label]', changing ? 'New proxy server' : 'Proxy server');
  const form = dialog.querySelector('form');
  const select = dialog.querySelector('#as-server');
  const save = dialog.querySelector('[data-save]');
  const searchInput = dialog.querySelector('#as-user-search');
  const results = dialog.querySelector('[data-results]');
  let serversLoaded = false;
  let finished = null; // set when the dialog closes because of success or a lost session

  document.body.append(dialog);
  const modal = new Modal(dialog);
  dialog.addEventListener('hidden.bs.modal', () => {
    modal.dispose();
    dialog.remove();
    if (finished) onFinished?.(finished);
  }, { once: true });
  const close = (result) => { finished = result; modal.hide(); };

  function showUser() {
    const fixed = Boolean(target?.user);
    dialog.querySelector('[data-chosen]').hidden = !chosenUser;
    dialog.querySelector('[data-picker]').hidden = Boolean(chosenUser);
    dialog.querySelector('[data-rechoose]').hidden = fixed;
    text(dialog, '[data-chosen-name]', chosenUser?.name || chosenUser?.email || '');
    text(dialog, '[data-chosen-email]', chosenUser?.name ? chosenUser.email : '');
    // The users list says who already has a server; the server refuses a second assignment anyway.
    const existing = !changing && chosenUser?.proxyServer;
    dialog.querySelector('[data-existing]').hidden = !existing;
    if (existing) text(dialog, '[data-existing]', `This user is already assigned to "${chosenUser.proxyServer.name}". Use Change on the Proxy Assignments page or the user's details page to move them.`);
    updateSave();
  }

  const updateSave = () => { save.disabled = !serversLoaded || !chosenUser; };

  let latestSearch = 0;
  async function searchUsers() {
    const request = ++latestSearch;
    results.replaceChildren(html('<div class="list-group-item text-body-secondary"><span class="spinner-border spinner-border-sm me-2"></span>Searching…</div>'));
    const result = await api.listUsers({ search: searchInput.value, page: 1, pageSize: USER_RESULTS });
    if (request !== latestSearch || !dialog.isConnected) return;
    if (!result.ok) {
      if (isAuthLoss(result)) return close({ outcome: 'auth' });
      results.replaceChildren(html('<div class="list-group-item text-danger" data-msg></div>'));
      text(results, '[data-msg]', describeError(result));
      return;
    }
    const { users, total } = result.data;
    if (users.length === 0) {
      results.replaceChildren(html('<div class="list-group-item text-body-secondary">No users found.</div>'));
      return;
    }
    const items = users.map((u) => {
      const item = html(`<button type="button" class="list-group-item list-group-item-action d-flex gap-2 align-items-center">
        <span class="me-auto text-break"><span class="fw-medium d-block" data-c="name"></span><span class="text-body-secondary" data-c="email"></span></span>
        <span class="badge text-bg-light border" data-c="server"></span></button>`);
      text(item, '[data-c="name"]', u.name || u.email);
      text(item, '[data-c="email"]', u.email);
      const server = item.querySelector('[data-c="server"]');
      server.textContent = u.proxyServer ? `Assigned: ${u.proxyServer.name}` : 'No proxy';
      if (u.status === 'SUSPENDED') item.querySelector('[data-c="name"]').append(' (suspended)');
      item.addEventListener('click', () => {
        chosenUser = u;
        dialog.querySelector('[data-err="user"]').textContent = '';
        showUser();
      });
      return item;
    });
    if (total > users.length) items.push(html(`<div class="list-group-item text-body-secondary">Showing ${users.length} of ${total.toLocaleString()}. Refine the search to find others.</div>`));
    results.replaceChildren(...items);
  }

  async function loadServers() {
    const result = await api.listProxyServers();
    if (!dialog.isConnected) return;
    if (!result.ok) {
      if (isAuthLoss(result)) return close({ outcome: 'auth' });
      select.replaceChildren(html('<option value="">Proxy servers could not be loaded</option>'));
      showAlert(dialog, describeError(result));
      return;
    }
    const options = serverOptions(result.data?.servers ?? [], target?.assignment?.server.id ?? null);
    const placeholder = html('<option value="">Choose a proxy server…</option>');
    select.replaceChildren(placeholder, ...options.map((o) => {
      const option = document.createElement('option');
      option.value = o.value;
      option.textContent = o.label;
      option.disabled = o.disabled;
      return option;
    }));
    select.value = ''; // never pre-select a server
    select.disabled = false;
    serversLoaded = true;
    text(dialog, '[data-server-hint]', options.some((o) => !o.disabled)
      ? 'Disabled servers are listed but cannot receive assignments.'
      : 'No enabled proxy server is available. Add or enable one on the Proxy Servers page.');
    updateSave();
  }

  if (changing) {
    dialog.querySelector('[data-current]').hidden = false;
    const { server } = target.assignment;
    text(dialog, '[data-current-text]', `${server.name} — ${hostPort(server)}`);
    const status = dialog.querySelector('[data-current-status]');
    status.textContent = server.enabled ? 'Enabled' : 'Disabled';
    status.className = server.enabled ? 'badge text-bg-success' : 'badge text-bg-secondary';
  }
  if (!target?.user) {
    let timer;
    searchInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(searchUsers, SEARCH_DELAY_MS); });
    dialog.querySelector('[data-rechoose]').addEventListener('click', () => { chosenUser = null; showUser(); searchInput.focus(); });
  }
  showUser();
  // Load once fully shown: Bootstrap ignores hide() during the opening transition, which a fast
  // auth failure would otherwise hit.
  dialog.addEventListener('shown.bs.modal', () => {
    if (!target?.user) {
      searchUsers();
      searchInput.focus();
    }
    loadServers();
  }, { once: true });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (save.disabled) return; // still loading, or a request is already in flight
    select.classList.remove('is-invalid');
    for (const field of ['user', 'server']) text(dialog, `[data-err="${field}"]`, '');
    showAlert(dialog, '');
    save.disabled = true;
    save.querySelector('.spinner-border').hidden = false;
    const result = changing
      ? await actions.change(target, select.value)
      : await actions.assign({ user: chosenUser, serverId: select.value });
    save.querySelector('.spinner-border').hidden = true;
    updateSave();

    if (result.outcome === 'invalid') {
      if (result.errors.server) select.classList.add('is-invalid');
      for (const [field, message] of Object.entries(result.errors)) text(dialog, `[data-err="${field}"]`, message);
      return;
    }
    if (result.outcome === 'failed') {
      showAlert(dialog, result.message); // stays open; nothing is shown as assigned
      return;
    }
    close(result);
  });

  modal.show();
}

/** Shared handling of a finished dialog or action: a lost session, or a message, then a reload. */
export async function handleAssignmentResult(result, { root, onAuthLost, reload }) {
  if (result.outcome === 'cancelled') return;
  if (result.outcome === 'auth') {
    if (await onAuthLost?.()) return;
    showAlert(root, 'The server refused this action for your session. Sign out and sign in again if this continues.');
    return;
  }
  showAlert(root, result.message, result.outcome === 'done' ? 'success' : 'danger');
  await reload();
}
