import { html, showAlert } from '../dom.js';

export function renderLogin({ onSignIn, message, tone }) {
  const page = html(`
    <main class="pm-center pm-auth-bg">
      <div class="card pm-auth-card shadow-sm">
        <div class="card-body p-4 p-sm-5">
          <div class="d-flex align-items-center gap-2 mb-4">
            <img src="/favicon.svg" alt="" width="32" height="32">
            <span class="fs-4 fw-semibold">ProxyMarket</span>
          </div>
          <h1 class="h5 mb-1">Sign in</h1>
          <p class="text-body-secondary small mb-4">Use your ProxyMarket account, the same one as in the desktop app.</p>
          <div data-alert hidden role="alert"></div>
          <form novalidate>
            <div class="mb-3">
              <label for="email" class="form-label small fw-medium">Email</label>
              <input id="email" name="email" type="email" class="form-control" autocomplete="username" required>
            </div>
            <div class="mb-4">
              <label for="password" class="form-label small fw-medium">Password</label>
              <div class="input-group">
                <input id="password" name="password" type="password" class="form-control" autocomplete="current-password" required>
                <button class="btn btn-outline-secondary" type="button" data-toggle-password aria-label="Show password" aria-pressed="false">
                  <i class="bi bi-eye" aria-hidden="true"></i>
                </button>
              </div>
            </div>
            <button type="submit" class="btn btn-primary w-100" data-submit>
              <span class="spinner-border spinner-border-sm me-2" hidden aria-hidden="true"></span>Sign in
            </button>
          </form>
        </div>
      </div>
    </main>`);

  const form = page.querySelector('form');
  const password = page.querySelector('#password');
  const toggle = page.querySelector('[data-toggle-password]');
  const submit = page.querySelector('[data-submit]');
  showAlert(page, message, tone);

  toggle.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    toggle.querySelector('i').className = show ? 'bi bi-eye-slash' : 'bi bi-eye';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = form.email.value.trim();
    if (!email || !password.value) {
      showAlert(page, 'Enter your email and password.');
      return;
    }
    submit.disabled = true;
    submit.querySelector('.spinner-border').hidden = false;
    showAlert(page, '');
    const error = await onSignIn(email, password.value);
    password.value = '';
    submit.disabled = false;
    submit.querySelector('.spinner-border').hidden = true;
    if (error) showAlert(page, error);
  });

  return page;
}
