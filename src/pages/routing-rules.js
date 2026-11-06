import { confirmDialog, html, showAlert, text } from '../dom.js';
import { createRoutingRules, describeSync, isKeyboardActivation, PREVIEW_NOTICE, PREVIEW_NOTICE_TITLE, PREVIEW_SQUID_NOTE, switchToRefocus } from '../routing-rules.js';

const REFUSED = 'The server refused this action for your session. Sign out and sign in again if this continues.';

async function openModal(markup) {
  const { default: Modal } = await import('bootstrap/js/dist/modal.js');
  const dialog = html(markup);
  document.body.append(dialog);
  const modal = new Modal(dialog);
  dialog.addEventListener('hidden.bs.modal', () => { modal.dispose(); dialog.remove(); }, { once: true });
  return { dialog, modal };
}

/**
 * The Routing Rules section of the Proxy Servers page, for one selected server. It's self-contained:
 * its errors appear in its own alert and never affect the server list.
 */
export function createRoutingPanel({ api, onAuthLost, onClose, confirm = confirmDialog }) {
  const panel = html(`
    <section class="card shadow-sm mt-4" aria-label="Routing rules" hidden>
      <div class="card-header bg-white d-flex flex-wrap align-items-center gap-2">
        <h2 class="h6 mb-0 me-auto">Routing Rules: <span data-server-name></span></h2>
        <button class="btn btn-sm btn-primary" data-add><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Add Domain</button>
        <button class="btn btn-sm btn-outline-secondary" data-copy><i class="bi bi-files me-1" aria-hidden="true"></i>Copy From Server</button>
        <button class="btn btn-sm btn-outline-secondary" data-preview><i class="bi bi-code-slash me-1" aria-hidden="true"></i>View PAC Preview</button>
        <button type="button" class="btn-close" data-close aria-label="Close routing rules"></button>
      </div>
      <div class="card-body border-bottom small" data-sync-section>
        <div class="d-flex flex-wrap align-items-center gap-2">
          <span class="badge" data-sync-badge></span>
          <span class="me-auto" data-sync-detail role="status"></span>
          <button class="btn btn-sm btn-outline-secondary" data-sync-check><i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Check Status</button>
          <button class="btn btn-sm btn-primary" data-sync-now><span class="spinner-border spinner-border-sm me-1" data-sync-spinner hidden aria-hidden="true"></span><i class="bi bi-cloud-upload me-1" data-sync-icon aria-hidden="true"></i><span data-sync-label>Sync to Squid</span></button>
        </div>
        <div class="text-danger mt-2 text-break" data-sync-warning hidden></div>
      </div>
      <div class="card-body pb-0" data-alert-wrap>
        <div data-alert hidden role="alert"></div>
      </div>
      <div class="table-responsive">
        <table class="table table-hover align-middle mb-0 small">
          <thead class="table-light"><tr>
            <th scope="col">Domain</th><th scope="col">Enabled</th><th scope="col" class="text-end">Actions</th>
          </tr></thead>
          <tbody data-rows></tbody>
        </table>
      </div>
    </section>`);
  const rows = panel.querySelector('[data-rows]');
  const alertWrap = panel.querySelector('[data-alert-wrap]');

  const alert = (message, tone = 'danger') => {
    showAlert(panel, message, tone);
    alertWrap.hidden = !message;
  };
  alert('');

  // The domain whose switch was toggled from the keyboard, until that toggle and its refresh finish.
  let keyboardToggle = null;

  const rules = createRoutingRules({ api, confirm, onChange: render });

  function renderSync(state) {
    const badge = panel.querySelector('[data-sync-badge]');
    const view = state.sync ? describeSync(state.sync) : null;
    badge.className = `badge text-bg-${view?.tone ?? 'secondary'}`;
    badge.textContent = state.syncing ? 'Synchronizing' : (view?.label ?? (state.syncChecking ? 'Checking' : 'Unknown'));
    let detail = view?.detail ?? (state.syncChecking ? 'Asking the node…' : '');
    if (state.syncing) detail = 'Sending the rules to the node. This can take up to a minute or two.';
    text(panel, '[data-sync-detail]', detail);
    const warning = panel.querySelector('[data-sync-warning]');
    const message = state.syncError ?? view?.warning ?? null;
    warning.hidden = !message || state.syncing;
    warning.textContent = message ?? '';
    panel.querySelector('[data-sync-now]').disabled = state.syncing || state.status !== 'ready';
    panel.querySelector('[data-sync-check]').disabled = state.syncing || state.syncChecking;
    panel.querySelector('[data-sync-spinner]').hidden = !state.syncing;
    panel.querySelector('[data-sync-icon]').hidden = state.syncing;
    text(panel, '[data-sync-label]', state.syncing ? 'Synchronizing…' : 'Sync to Squid');
  }

  function render(state) {
    panel.hidden = !state.server;
    if (!state.server) return;
    text(panel, '[data-server-name]', state.server.name);
    renderSync(state);
    if (state.status === 'none' || state.status === 'loading') {
      placeholder('<span class="spinner-border spinner-border-sm me-2"></span>Loading…');
    } else if (state.status === 'error') {
      placeholder('<span data-load-error></span><div class="mt-3"><button class="btn btn-sm btn-outline-danger" data-retry>Retry</button></div>');
      text(rows, '[data-load-error]', state.error ?? 'Routing rules could not be loaded.');
      rows.querySelector('[data-retry]').addEventListener('click', () => run(rules.reload()));
    } else if (state.domains.length === 0) {
      placeholder(`No routing rules for this server.
        <div class="mt-3 d-flex justify-content-center gap-2">
          <button class="btn btn-sm btn-primary" data-add-empty><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Add Domain</button>
          <button class="btn btn-sm btn-outline-secondary" data-copy-empty><i class="bi bi-files me-1" aria-hidden="true"></i>Copy From Server</button>
        </div>`);
      rows.querySelector('[data-add-empty]').addEventListener('click', () => openForm());
      rows.querySelector('[data-copy-empty]').addEventListener('click', openCopy);
    } else {
      rows.replaceChildren(...state.domains.map((domain) => row(domain, state.pending.has(domain.id))));
      switchToRefocus({
        switches: [...rows.querySelectorAll('[data-toggle]')],
        domainId: keyboardToggle,
        focusIsFree: document.activeElement === document.body || document.activeElement === null,
      })?.focus();
    }
  }

  const placeholder = (markup) => rows.replaceChildren(html(`<tr><td colspan="3" class="text-center text-body-secondary py-4">${markup}</td></tr>`));

  function row(domain, pending) {
    const tr = html(`<tr>
      <td data-c="domain" class="font-monospace text-break"></td>
      <td><div class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox" role="switch" data-toggle></div></td>
      <td class="text-end text-nowrap">
        <button class="btn btn-sm btn-outline-secondary" data-edit><i class="bi bi-pencil me-1" aria-hidden="true"></i>Edit</button>
        <button class="btn btn-sm btn-outline-danger" data-delete><i class="bi bi-trash me-1" aria-hidden="true"></i>Delete</button>
      </td></tr>`);
    text(tr, '[data-c="domain"]', domain.domain);
    const toggle = tr.querySelector('[data-toggle]');
    toggle.dataset.domainId = domain.id;
    toggle.checked = domain.enabled;
    toggle.disabled = pending;
    toggle.setAttribute('aria-label', `${domain.enabled ? 'Disable' : 'Enable'} ${domain.domain}`);
    tr.querySelector('[data-edit]').disabled = pending;
    tr.querySelector('[data-delete]').disabled = pending;
    toggle.addEventListener('click', async (event) => {
      alert('');
      if (isKeyboardActivation(event)) keyboardToggle = domain.id;
      await runChange(rules.toggle(domain));
      if (keyboardToggle === domain.id) keyboardToggle = null;
    });
    tr.querySelector('[data-edit]').addEventListener('click', () => openForm(domain));
    tr.querySelector('[data-delete]').addEventListener('click', () => runChange(rules.remove(domain)));
    return tr;
  }

  /** Shows an action's result. Returns true if the session was lost and the page has moved on. */
  async function run(pending) {
    const result = await pending;
    if (result.outcome === 'auth') {
      if (await onAuthLost?.()) return true;
      alert(REFUSED);
    } else if (result.outcome === 'failed') {
      alert(result.message);
    } else if (result.outcome === 'done' && result.message) {
      alert(result.message, result.warning ? 'warning' : 'success');
    }
    return false;
  }

  /** Runs a change to the rules, then shows that the status may now be different. */
  async function runChange(pending) {
    const lost = await run(pending);
    if (!lost) checkSync();
    return lost;
  }

  /** The status has its own line on the panel, so its failure doesn't replace another action's message. */
  async function checkSync() {
    const result = await rules.checkSync();
    if (result.outcome === 'auth' && (await onAuthLost?.()) !== true) alert(REFUSED);
  }

  async function openForm(existing = null) {
    const { dialog, modal } = await openModal(`
      <div class="modal fade" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <form class="modal-content" novalidate>
            <div class="modal-header"><h2 class="modal-title h5" data-title></h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cancel"></button></div>
            <div class="modal-body">
              <div data-alert hidden role="alert"></div>
              <div class="mb-3"><label class="form-label small fw-medium" for="rr-domain">Domain</label>
                <input class="form-control font-monospace" id="rr-domain" maxlength="255" placeholder="clob.example.com or *.example.com" required autocapitalize="off" spellcheck="false">
                <div class="form-text">An exact hostname, or a wildcard such as *.example.com. A wildcard matches subdomains only, not example.com itself.</div>
                <div class="invalid-feedback" data-err="domain"></div></div>
              <div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="rr-enabled">
                <label class="form-check-label small" for="rr-enabled">Enabled</label></div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn btn-primary" data-save><span class="spinner-border spinner-border-sm me-1" hidden aria-hidden="true"></span><span data-save-label></span></button>
            </div>
          </form>
        </div>
      </div>`);
    const domainInput = dialog.querySelector('#rr-domain');
    const enabledInput = dialog.querySelector('#rr-enabled');
    text(dialog, '[data-title]', existing ? `Edit ${existing.domain}` : `Add Domain to ${rules.state.server.name}`);
    text(dialog, '[data-save-label]', existing ? 'Save Changes' : 'Add Domain');
    domainInput.value = existing?.domain ?? '';
    enabledInput.checked = existing ? existing.enabled : true;

    const save = dialog.querySelector('[data-save]');
    dialog.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      domainInput.classList.remove('is-invalid');
      showAlert(dialog, '');
      save.disabled = true;
      save.querySelector('.spinner-border').hidden = false;
      const result = await rules.save({ domain: domainInput.value, enabled: enabledInput.checked }, existing);
      save.disabled = false;
      save.querySelector('.spinner-border').hidden = true;

      if (result.outcome === 'invalid') {
        domainInput.classList.add('is-invalid');
        text(dialog, '[data-err="domain"]', result.errors.domain);
        return;
      }
      if (result.outcome === 'failed') {
        showAlert(dialog, result.message);
        return;
      }
      if (result.outcome === 'busy') return;
      modal.hide();
      await runChange(Promise.resolve(result));
    });
    modal.show();
  }

  async function openCopy() {
    alert('');
    const sources = await rules.copySources();
    if (sources.outcome !== 'ready') {
      await run(Promise.resolve(sources));
      return;
    }
    if (sources.servers.length === 0) {
      alert('There are no other proxy servers to copy from.', 'info');
      return;
    }
    const { dialog, modal } = await openModal(`
      <div class="modal fade" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <form class="modal-content" novalidate>
            <div class="modal-header"><h2 class="modal-title h5">Copy From Server</h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cancel"></button></div>
            <div class="modal-body">
              <div class="mb-3"><label class="form-label small fw-medium" for="rr-source">Source server</label>
                <select class="form-select" id="rr-source" required></select></div>
              <p class="small mb-0">Destination: <strong data-destination></strong></p>
              <div class="form-text">Next, you'll see how many rules will be copied and confirm the replacement.</div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn btn-primary">Continue</button>
            </div>
          </form>
        </div>
      </div>`);
    const select = dialog.querySelector('#rr-source');
    select.replaceChildren(...sources.servers.map((server) => {
      const option = document.createElement('option');
      option.value = server.id;
      option.textContent = server.enabled ? server.name : `${server.name} (disabled)`;
      return option;
    }));
    text(dialog, '[data-destination]', rules.state.server.name);
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const source = sources.servers.find((server) => server.id === select.value);
      dialog.addEventListener('hidden.bs.modal', () => runChange(rules.copyFrom(source)), { once: true });
      modal.hide();
    });
    modal.show();
  }

  async function openPreview() {
    const { dialog, modal } = await openModal(`
      <div class="modal fade" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header"><h2 class="modal-title h5" data-title></h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
            <div class="modal-body">
              <div class="alert alert-warning small" role="note">
                <div class="fw-semibold" data-notice-title></div>
                <div data-notice></div>
                <div class="mt-1" data-squid-note></div>
              </div>
              <div data-alert hidden role="alert"></div>
              <div class="text-center text-body-secondary py-4" data-loading><span class="spinner-border spinner-border-sm me-2"></span>Loading…</div>
              <pre class="border rounded bg-light p-3 small mb-0" style="max-height: 50vh; overflow: auto" tabindex="0" hidden data-pac><code></code></pre>
            </div>
            <div class="modal-footer">
              <span class="small text-body-secondary me-auto" data-copied role="status"></span>
              <button type="button" class="btn btn-outline-secondary" data-copy-pac hidden><i class="bi bi-clipboard me-1" aria-hidden="true"></i>Copy to Clipboard</button>
              <button type="button" class="btn btn-primary" data-bs-dismiss="modal">Close</button>
            </div>
          </div>
        </div>
      </div>`);
    text(dialog, '[data-title]', `PAC Preview: ${rules.state.server.name}`);
    text(dialog, '[data-notice-title]', PREVIEW_NOTICE_TITLE);
    text(dialog, '[data-notice]', PREVIEW_NOTICE);
    text(dialog, '[data-squid-note]', PREVIEW_SQUID_NOTE);
    modal.show();

    const result = await rules.preview();
    dialog.querySelector('[data-loading]').hidden = true;
    if (result.outcome === 'stale') {
      modal.hide();
      return;
    }
    if (result.outcome === 'auth') {
      modal.hide();
      await run(Promise.resolve(result));
      return;
    }
    if (result.outcome !== 'done') {
      showAlert(dialog, result.message);
      return;
    }
    dialog.querySelector('[data-pac] code').textContent = result.pac;
    dialog.querySelector('[data-pac]').hidden = false;
    const copyButton = dialog.querySelector('[data-copy-pac]');
    if (navigator.clipboard) {
      copyButton.hidden = false;
      copyButton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(result.pac);
          text(dialog, '[data-copied]', 'Copied.');
        } catch {
          text(dialog, '[data-copied]', 'Couldn\'t copy. Select the text instead.');
        }
      });
    }
  }

  panel.querySelector('[data-sync-check]').addEventListener('click', checkSync);
  panel.querySelector('[data-sync-now]').addEventListener('click', () => {
    alert('');
    run(rules.syncNow());
  });
  panel.querySelector('[data-add]').addEventListener('click', () => openForm());
  panel.querySelector('[data-copy]').addEventListener('click', openCopy);
  panel.querySelector('[data-preview]').addEventListener('click', openPreview);
  panel.querySelector('[data-close]').addEventListener('click', () => {
    alert('');
    rules.clear();
    onClose?.();
  });

  return {
    element: panel,
    get selectedId() {
      return rules.state.server?.id ?? null;
    },
    select(server) {
      alert('');
      run(rules.select(server));
      checkSync();
      panel.hidden = false;
      panel.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    },
    /** After the server list reloads: follow a rename, and close if the selected server has gone. */
    sync(servers) {
      const { server } = rules.state;
      if (!server) return;
      const updated = servers.find((candidate) => candidate.id === server.id);
      if (updated) {
        rules.updateServer(updated);
        return;
      }
      alert('');
      rules.clear();
    },
  };
}
