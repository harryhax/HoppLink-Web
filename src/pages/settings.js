import { html, showAlert, text } from '../dom.js';
import { createRegistrationSetting } from '../registration.js';

/** Administration settings. The switch shows only what the server has confirmed. */
export function renderSettings({ api, onAuthLost }) {
  const page = html(`
    <div>
      <div class="mb-4">
        <h1 class="h4 mb-1">Settings</h1>
        <p class="text-body-secondary mb-0">Settings that apply to the whole HoppLink service.</p>
      </div>
      <div class="card shadow-sm">
        <div class="card-header bg-white fw-semibold d-flex align-items-center gap-2">
          <i class="bi bi-person-plus text-primary" aria-hidden="true"></i>
          <span class="me-auto">Public Registration</span>
          <span class="spinner-border spinner-border-sm" data-busy hidden aria-hidden="true"></span>
          <span class="badge" data-status></span>
        </div>
        <div class="card-body">
          <div data-alert hidden role="alert"></div>
          <p class="small text-body-secondary">When enabled, anyone who can reach this website can create an
            ordinary user account from the sign-in page. Email addresses are not verified. Existing users can
            sign in whether this is enabled or not.</p>
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" role="switch" id="public-registration" disabled>
            <label class="form-check-label small" for="public-registration">Allow public registration</label>
          </div>
          <button class="btn btn-sm btn-outline-primary mt-3" type="button" data-retry hidden>Retry</button>
        </div>
      </div>
    </div>`);

  const toggle = page.querySelector('#public-registration');
  const status = page.querySelector('[data-status]');
  const busy = page.querySelector('[data-busy]');
  const retry = page.querySelector('[data-retry]');
  let confirmed = null;

  const setting = createRegistrationSetting(api, (state) => {
    confirmed = state.enabled;
    const working = state.loading || state.saving;
    toggle.checked = state.enabled === true;
    toggle.disabled = working || state.enabled === null;
    busy.hidden = !working;
    retry.hidden = working || state.enabled !== null;
    text(page, '[data-status]', state.enabled === null ? 'Unknown' : state.enabled ? 'Enabled' : 'Disabled');
    status.className = `badge ${state.enabled ? 'text-bg-success' : 'text-bg-secondary'}`;
    showAlert(page, state.message, state.tone ?? undefined);
  });

  const run = async (action) => {
    if (await action() === 'auth') await onAuthLost?.();
  };

  toggle.addEventListener('change', () => {
    const wanted = toggle.checked;
    // The browser has already moved the switch, so put it back until the server confirms the change.
    toggle.checked = confirmed === true;
    run(() => setting.save(wanted));
  });
  retry.addEventListener('click', () => run(() => setting.load()));
  run(() => setting.load());

  return page;
}
