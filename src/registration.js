import { describeError } from './api.js';
import { isAuthLoss } from './user-admin.js';

export const REGISTRATION_UNAVAILABLE = 'New registrations are currently unavailable. If you already have an account, you can still sign in.';

/**
 * Which registration screen to show. This only decides what the page displays: the server enforces the
 * setting on every sign-up, whatever this says.
 * Returns { screen: 'form' } | { screen: 'unavailable', message } | { screen: 'error', message }.
 */
export async function checkRegistration(api) {
  const result = await api.registrationAvailability();
  if (!result.ok) return { screen: 'error', message: `Could not check whether registration is available. ${describeError(result)}` };
  if (typeof result.data?.enabled !== 'boolean') return { screen: 'error', message: 'The server returned an unexpected response.' };
  return result.data.enabled ? { screen: 'form' } : { screen: 'unavailable', message: REGISTRATION_UNAVAILABLE };
}

/**
 * Checks for obvious mistakes before sending; the server validates everything again. Returns
 * { error, values }. The values hold exactly what is sent, so no role can be included.
 */
export function validateRegistrationForm({ name, email, password }) {
  const cleanName = String(name ?? '').trim();
  const cleanEmail = String(email ?? '').trim();
  const secret = String(password ?? '');
  const fail = (error) => ({ error, values: null });
  if (!cleanName) return fail('Enter your name.');
  if (!/^[^\s@]+@[^\s@]+$/.test(cleanEmail)) return fail('Enter a valid email address.');
  if (secret.length < 8 || secret.length > 128) return fail('The password must be 8-128 characters.');
  return { error: null, values: { name: cleanName, email: cleanEmail, password: secret } };
}

const label = (enabled) => (enabled ? 'enabled' : 'disabled');

/**
 * The administrator's Public Registration control. `enabled` only ever holds a value the server has
 * confirmed: true, false, or null if it has never been read. `onChange` receives each new state.
 * load() and save() return 'done', 'failed', 'auth' (the session was refused) or 'ignored'.
 */
export function createRegistrationSetting(api, onChange = () => {}) {
  const state = { enabled: null, loading: false, saving: false, message: null, tone: null };
  const update = (changes) => {
    Object.assign(state, changes);
    onChange({ ...state });
  };
  const confirmedValue = (result) => {
    const value = result.data?.publicRegistrationEnabled;
    return result.ok && typeof value === 'boolean' ? value : null;
  };
  const failureText = (result) => (result.ok ? 'The server returned an unexpected response.' : describeError(result));

  return {
    async load() {
      if (state.loading || state.saving) return 'ignored';
      update({ loading: true, message: null, tone: null });
      const result = await api.getRegistrationSetting();
      const value = confirmedValue(result);
      if (value !== null) {
        update({ loading: false, enabled: value });
        return 'done';
      }
      update({ loading: false, message: `Could not load this setting. ${failureText(result)}`, tone: 'danger' });
      return !result.ok && isAuthLoss(result) ? 'auth' : 'failed';
    },

    async save(enabled) {
      if (state.loading || state.saving || state.enabled === null || enabled === state.enabled) return 'ignored';
      update({ saving: true, message: null, tone: null });
      const result = await api.setRegistrationSetting(enabled);
      const value = confirmedValue(result);
      if (value !== null) {
        update({ saving: false, enabled: value, message: `Public registration is now ${label(value)}.`, tone: 'success' });
        return 'done';
      }
      update({
        saving: false,
        message: `The change was not confirmed. The last confirmed state is ${label(state.enabled)}. ${failureText(result)}`,
        tone: 'danger',
      });
      return !result.ok && isAuthLoss(result) ? 'auth' : 'failed';
    },
  };
}
