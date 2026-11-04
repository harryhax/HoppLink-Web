import { html, showAlert, text } from '../dom.js';
import { checkRegistration, validateRegistrationForm } from '../registration.js';

/**
 * The registration screen: the form appears only when the server reports that registration is open.
 * The server enforces the setting regardless, so a refused sign-up switches to the unavailable message.
 */
export function renderRegister({ api, onRegister, onBack }) {
  const page = html(`
    <main class="pm-center pm-auth-bg">
      <div class="card pm-auth-card shadow-sm">
        <div class="card-body p-4 p-sm-5">
          <div class="d-flex align-items-center gap-2 mb-4">
            <img src="/favicon.svg" alt="" width="32" height="32">
            <span class="fs-4 fw-semibold">HoppLink</span>
          </div>
          <h1 class="h5 mb-3">Create an account</h1>
          <div data-alert hidden role="alert"></div>
          <div class="text-center text-body-secondary small py-3" data-loading role="status">
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Checking availability…
          </div>
          <p class="small mb-3" data-unavailable hidden></p>
          <button class="btn btn-outline-primary btn-sm w-100 mb-3" type="button" data-retry hidden>Retry</button>
          <form novalidate hidden>
            <div class="mb-3">
              <label for="name" class="form-label small fw-medium">Name</label>
              <input id="name" name="name" type="text" class="form-control" autocomplete="name" required>
            </div>
            <div class="mb-3">
              <label for="email" class="form-label small fw-medium">Email</label>
              <input id="email" name="email" type="email" class="form-control" autocomplete="username" required>
            </div>
            <div class="mb-4">
              <label for="password" class="form-label small fw-medium">Password</label>
              <input id="password" name="password" type="password" class="form-control" autocomplete="new-password" aria-describedby="password-help" required>
              <div id="password-help" class="form-text">8-128 characters.</div>
            </div>
            <button type="submit" class="btn btn-primary w-100 mb-3" data-submit>
              <span class="spinner-border spinner-border-sm me-2" hidden aria-hidden="true"></span>Create account
            </button>
          </form>
          <button class="btn btn-link btn-sm w-100" type="button" data-back>Back to sign in</button>
        </div>
      </div>
    </main>`);

  const form = page.querySelector('form');
  const loading = page.querySelector('[data-loading]');
  const unavailable = page.querySelector('[data-unavailable]');
  const retry = page.querySelector('[data-retry]');
  const submit = page.querySelector('[data-submit]');

  function showScreen({ screen, message }) {
    loading.hidden = screen !== 'loading';
    form.hidden = screen !== 'form';
    unavailable.hidden = screen !== 'unavailable';
    retry.hidden = screen !== 'error';
    text(page, '[data-unavailable]', screen === 'unavailable' ? message : '');
    showAlert(page, screen === 'error' ? message : '');
  }

  async function load() {
    showScreen({ screen: 'loading' });
    showScreen(await checkRegistration(api));
  }

  page.querySelector('[data-back]').addEventListener('click', onBack);
  retry.addEventListener('click', load);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { error, values } = validateRegistrationForm({ name: form.name.value, email: form.email.value, password: form.password.value });
    if (error) {
      showAlert(page, error);
      return;
    }
    submit.disabled = true;
    submit.querySelector('.spinner-border').hidden = false;
    showAlert(page, '');
    const refused = await onRegister(values);
    form.password.value = '';
    submit.disabled = false;
    submit.querySelector('.spinner-border').hidden = true;
    if (refused?.screen) showScreen(refused);
    else if (refused) showAlert(page, refused.message);
  });

  load();
  return page;
}
