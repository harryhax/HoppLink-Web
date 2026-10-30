import { describeError } from './api.js';

/**
 * Authentication state for the page. The server is the authority: the role shown here only picks
 * which screen to render, and every admin endpoint enforces it on the server.
 *
 * Possible states:
 *   { view: 'login', message? }               no valid session
 *   { view: 'admin', user }                   active ADMIN (role from /api/v1/account/me)
 *   { view: 'user', user }                    active USER
 *   { view: 'suspended', message }            account is suspended
 *   { view: 'offline', message }              server unreachable: state unknown, offer Retry
 */
export function createAuth(api) {
  /** Reads the current account (id, email, name, role, status) from the server. */
  async function loadAccount() {
    const me = await api.accountMe();
    if (me.ok) {
      const user = me.data?.user;
      if (!user) return { view: 'offline', message: 'The server returned an unexpected response.' };
      if (user.status === 'SUSPENDED') return suspended();
      return { view: user.role === 'ADMIN' ? 'admin' : 'user', user };
    }
    if (me.status === 401) return { view: 'login' };
    if (me.code === 'ACCOUNT_SUSPENDED') return suspended();
    return failure(me);
  }

  /** On page load: is there still a valid session cookie? */
  async function restore() {
    const session = await api.getSession();
    if (!session.ok) {
      if (session.code === 'ACCOUNT_SUSPENDED') return suspended();
      return session.kind === 'network' || session.status >= 500 ? failure(session) : { view: 'login' };
    }
    if (!session.data?.session) return { view: 'login' };
    return loadAccount();
  }

  async function signIn(email, password) {
    const result = await api.signIn(email.trim(), password);
    if (!result.ok) {
      if (result.code === 'BANNED_USER') return suspended();
      if (result.kind === 'network') return failure(result);
      const message = result.code === 'VALIDATION_ERROR' || result.code === 'INVALID_EMAIL'
        ? 'Enter a valid email address and password.'
        : describeError(result);
      return { view: 'login', message };
    }
    return loadAccount();
  }

  /**
   * On success: { view: 'login' }. On failure: { view: 'stay', message }. The HttpOnly cookie can only
   * be cleared by the server, so an unconfirmed sign-out leaves the user where they are (still signed
   * in) instead of pretending the session ended.
   */
  async function signOut() {
    const result = await api.signOut();
    if (result.ok) return { view: 'login', message: 'You have been signed out.', tone: 'success' };
    return { view: 'stay', message: `Sign-out failed and your session is still active. ${describeError(result)}` };
  }

  return { restore, signIn, signOut };
}

function suspended() {
  return { view: 'suspended', message: 'This account is suspended. Contact an administrator.' };
}

function failure(result) {
  return result.kind === 'network' || result.status >= 500
    ? { view: 'offline', message: describeError(result) }
    : { view: 'login', message: describeError(result) };
}
