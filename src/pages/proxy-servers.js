import { describeError } from '../api.js';
import { confirmDialog, html, showAlert, text } from '../dom.js';
import { createProxyAdmin } from '../proxy-admin.js';
import { isAuthLoss } from '../user-admin.js';

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');

/** Proxy server administration: list, add, edit, enable/disable and delete (records only). */
export function renderProxyServers({ api, onAuthLost, confirm = confirmDialog }) {
  const actions = createProxyAdmin(api, confirm);
  const page = html(`
    <div>
      <div class="d-flex flex-wrap align-items-start gap-2 mb-4">
        <div class="me-auto">
          <h1 class="h4 mb-1">Proxy Servers</h1>
          <p class="text-body-secondary mb-0">Manage available proxy servers.</p>
        </div>
        <button class="btn btn-sm btn-primary" data-add><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Add Proxy Server</button>
      </div>
      <div data-alert hidden role="alert"></div>
      <div class="card shadow-sm">
        <div class="alert alert-danger d-flex align-items-center gap-2 m-3" data-error hidden role="alert">
          <i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span class="me-auto" data-error-text></span>
          <button class="btn btn-sm btn-outline-danger" data-retry>Retry</button>
        </div>
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0 small">
            <thead class="table-light"><tr>
              <th scope="col">Name</th><th scope="col">Host</th><th scope="col">Port</th><th scope="col">Status</th>
              <th scope="col">Created</th><th scope="col" class="text-end">Actions</th>
            </tr></thead>
            <tbody data-rows></tbody>
          </table>
        </div>
      </div>
      <p class="small text-body-secondary mt-3 mb-0"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>These are HoppLink's configuration records. Changing or deleting them never stops, reconfigures or removes the proxy itself.</p>
    </div>`);

  const rows = page.querySelector('[data-rows]');
  const errorBox = page.querySelector('[data-error]');
  let latest = 0;

  const placeholder = (markup) => rows.replaceChildren(html(`<tr><td colspan="6" class="text-center text-body-secondary py-4">${markup}</td></tr>`));

  async function load() {
    const request = ++latest;
    errorBox.hidden = true;
    placeholder('<span class="spinner-border spinner-border-sm me-2"></span>Loading…');
    const result = await api.listProxyServers();
    if (request !== latest || !page.isConnected) return;
    if (!result.ok) {
      if (isAuthLoss(result) && (await onAuthLost?.())) return;
      rows.replaceChildren();
      text(page, '[data-error-text]', describeError(result));
      errorBox.hidden = false;
      return;
    }
    const servers = result.data?.servers;
    if (!Array.isArray(servers)) {
      rows.replaceChildren();
      text(page, '[data-error-text]', 'The server returned unexpected data.');
      errorBox.hidden = false;
      return;
    }
    if (servers.length === 0) {
      placeholder('No proxy servers configured.<div class="mt-3"><button class="btn btn-sm btn-primary" data-add-empty><i class="bi bi-plus-lg me-1"></i>Add Proxy Server</button></div>');
      rows.querySelector('[data-add-empty]').addEventListener('click', () => openForm());
      return;
    }
    rows.replaceChildren(...servers.map(row));
  }

  function row(server) {
    const tr = html(`<tr>
      <td data-c="name" class="fw-medium"></td><td data-c="host" class="font-monospace text-break"></td><td data-c="port" class="font-monospace"></td>
      <td><span data-c="status"></span></td><td data-c="created" class="text-nowrap"></td>
      <td class="text-end text-nowrap">
        <button class="btn btn-sm btn-outline-secondary" data-edit><i class="bi bi-pencil me-1" aria-hidden="true"></i>Edit</button>
        <button class="btn btn-sm" data-toggle></button>
        <button class="btn btn-sm btn-outline-danger" data-delete><i class="bi bi-trash me-1" aria-hidden="true"></i>Delete</button>
      </td></tr>`);
    text(tr, '[data-c="name"]', server.name);
    text(tr, '[data-c="host"]', server.host);
    text(tr, '[data-c="port"]', String(server.port));
    const status = tr.querySelector('[data-c="status"]');
    status.textContent = server.enabled ? 'Enabled' : 'Disabled';
    status.className = server.enabled ? 'badge text-bg-success' : 'badge text-bg-secondary';
    text(tr, '[data-c="created"]', formatDate(server.createdAt));

    const toggle = tr.querySelector('[data-toggle]');
    toggle.textContent = server.enabled ? 'Disable' : 'Enable';
    toggle.classList.add(server.enabled ? 'btn-outline-warning' : 'btn-outline-success');
    tr.querySelector('[data-edit]').addEventListener('click', () => openForm(server));
    toggle.addEventListener('click', () => act(actions.toggle(server), toggle));
    tr.querySelector('[data-delete]').addEventListener('click', (event) => act(actions.remove(server), event.currentTarget));
    return tr;
  }

  /** Runs a list action; on anything but cancel, shows the result and reloads from the server. */
  async function act(pending, button) {
    button.disabled = true;
    const result = await pending;
    if (!page.isConnected) return;
    button.disabled = false;
    if (result.outcome === 'cancelled') return;
    if (result.outcome === 'auth') {
      if (await onAuthLost?.()) return;
      showAlert(page, 'The server refused this action for your session. Sign out and sign in again if this continues.');
      return;
    }
    showAlert(page, result.message, result.outcome === 'done' ? 'success' : 'danger');
    await load();
  }

  async function openForm(existing = null) {
    const { default: Modal } = await import('bootstrap/js/dist/modal.js');
    const dialog = html(`
      <div class="modal fade" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <form class="modal-content" novalidate>
            <div class="modal-header"><h2 class="modal-title h5" data-title></h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cancel"></button></div>
            <div class="modal-body">
              <div data-alert hidden role="alert"></div>
              <div class="mb-3"><label class="form-label small fw-medium" for="ps-name">Name</label>
                <input class="form-control" id="ps-name" name="name" maxlength="100" required><div class="invalid-feedback" data-err="name"></div></div>
              <div class="mb-3"><label class="form-label small fw-medium" for="ps-host">Host</label>
                <input class="form-control font-monospace" id="ps-host" name="host" maxlength="255" placeholder="proxy.example.com or 192.0.2.10" required autocapitalize="off" spellcheck="false">
                <div class="form-text">Hostname or IP address only: no http://, port or path.</div><div class="invalid-feedback" data-err="host"></div></div>
              <div class="mb-3"><label class="form-label small fw-medium" for="ps-port">Port</label>
                <input class="form-control font-monospace" id="ps-port" name="port" type="number" min="1" max="65535" step="1" inputmode="numeric" required style="max-width: 10rem">
                <div class="invalid-feedback" data-err="port"></div></div>
              <div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="ps-enabled" name="enabled">
                <label class="form-check-label small" for="ps-enabled">Enabled</label></div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn btn-primary" data-save><span class="spinner-border spinner-border-sm me-1" hidden aria-hidden="true"></span><span data-save-label></span></button>
            </div>
          </form>
        </div>
      </div>`);
    const form = dialog.querySelector('form');
    text(dialog, '[data-title]', existing ? `Edit ${existing.name}` : 'Add Proxy Server');
    text(dialog, '[data-save-label]', existing ? 'Save Changes' : 'Add Server');
    // Inputs by id: on a <form>, `form.name` is the form's own name attribute, not the "name" input.
    const fields = {
      name: dialog.querySelector('#ps-name'),
      host: dialog.querySelector('#ps-host'),
      port: dialog.querySelector('#ps-port'),
      enabled: dialog.querySelector('#ps-enabled'),
    };
    fields.name.value = existing?.name ?? '';
    fields.host.value = existing?.host ?? '';
    fields.port.value = existing ? String(existing.port) : '3128';
    fields.enabled.checked = existing ? existing.enabled : true;
    document.body.append(dialog);
    const modal = new Modal(dialog);
    dialog.addEventListener('hidden.bs.modal', () => { modal.dispose(); dialog.remove(); }, { once: true });

    const save = dialog.querySelector('[data-save]');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (save.disabled) return; // a request is already in flight
      for (const input of form.querySelectorAll('.is-invalid')) input.classList.remove('is-invalid');
      showAlert(dialog, '');
      save.disabled = true;
      save.querySelector('.spinner-border').hidden = false;
      const result = await actions.save(
        { name: fields.name.value, host: fields.host.value, port: fields.port.value, enabled: fields.enabled.checked },
        existing,
      );
      save.disabled = false;
      save.querySelector('.spinner-border').hidden = true;

      if (result.outcome === 'invalid') {
        for (const [field, message] of Object.entries(result.errors)) {
          fields[field]?.classList.add('is-invalid');
          text(dialog, `[data-err="${field}"]`, message);
        }
        return;
      }
      if (result.outcome === 'failed') {
        showAlert(dialog, result.message); // the form stays open with the values entered
        return;
      }
      modal.hide();
      if (result.outcome === 'auth') {
        if (await onAuthLost?.()) return;
        showAlert(page, 'The server refused this action for your session. Sign out and sign in again if this continues.');
        return;
      }
      showAlert(page, result.message, 'success');
      await load();
    });
    modal.show();
  }

  page.querySelector('[data-add]').addEventListener('click', () => openForm());
  page.querySelector('[data-retry]').addEventListener('click', load);
  load();
  return page;
}
