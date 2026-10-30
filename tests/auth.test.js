// Tests for the API client and auth state logic, using a fake fetch (no browser, no server).
// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApi, describeError } from '../src/api.js';
import { createAuth } from '../src/auth.js';

const ADMIN = { id: 'a1', email: 'admin@example.test', name: 'Ada Admin', role: 'ADMIN', status: 'ACTIVE' };
const USER = { id: 'u1', email: 'user@example.test', name: 'Uma User', role: 'USER', status: 'ACTIVE' };

const json = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake fetch: routes "METHOD /path" to a handler, and records every call. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, ...init });
    const handler = routes[`${init.method ?? 'GET'} ${url}`];
    if (!handler) return json(404, { error: { code: 'NOT_FOUND' } });
    return handler(init);
  };
  return { fetch, calls };
}

const refused = () => { throw new TypeError('fetch failed'); };
const session = () => json(200, { session: { id: 's' }, user: { id: 'x' } });

function setup(routes) {
  const { fetch, calls } = fakeFetch(routes);
  return { auth: createAuth(createApi({ fetch })), calls };
}

describe('api client', () => {
  test('sends same-origin credentials and JSON, never an auth header', async () => {
    const { fetch, calls } = fakeFetch({ 'POST /api/v1/auth/sign-in/email': () => json(200, {}) });
    await createApi({ fetch }).signIn('a@example.test', 'pw');
    const call = calls[0];
    assert.equal(call.credentials, 'same-origin');
    assert.equal(call.headers['Content-Type'], 'application/json');
    assert.equal(call.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(call.body), { email: 'a@example.test', password: 'pw' });
  });

  test('reports network failures and gateway errors as "network"', async () => {
    const down = await createApi({ fetch: refused }).health();
    assert.equal(down.kind, 'network');
    const { fetch } = fakeFetch({ 'GET /api/v1/health': () => json(502) });
    assert.equal((await createApi({ fetch }).health()).kind, 'network');
  });

  test('reports timeouts', async () => {
    const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const result = await createApi({ fetch: hang, timeoutMs: 20 }).health();
    assert.equal(result.code, 'TIMEOUT');
    assert.match(describeError(result), /did not respond/);
  });

  test('reads both Better Auth and ProxyMarket error codes', async () => {
    const { fetch } = fakeFetch({
      'POST /api/v1/auth/sign-in/email': () => json(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'x' }),
      'GET /api/v1/account/me': () => json(403, { error: { code: 'ACCOUNT_SUSPENDED', message: 'x' } }),
    });
    const api = createApi({ fetch });
    assert.equal((await api.signIn('a', 'b')).code, 'INVALID_EMAIL_OR_PASSWORD');
    assert.equal((await api.accountMe()).code, 'ACCOUNT_SUSPENDED');
  });

  test('maps errors to readable messages', () => {
    assert.equal(describeError({ kind: 'http', status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' }), 'Incorrect email or password.');
    assert.match(describeError({ kind: 'http', status: 500, code: null }), /HTTP 500/);
    assert.match(describeError({ kind: 'http', status: 429, code: null }), /Too many attempts/);
    assert.match(describeError({ kind: 'network', status: 0, code: 'NETWORK' }), /Cannot reach/);
    assert.match(describeError({ kind: 'http', status: 403, code: 'INVALID_ORIGIN' }), /TRUSTED_ORIGINS/);
  });
});

describe('sign in', () => {
  test('an administrator gets the admin dashboard', async () => {
    const { auth } = setup({
      'POST /api/v1/auth/sign-in/email': () => json(200, { user: {} }),
      'GET /api/v1/account/me': () => json(200, { user: ADMIN }),
    });
    assert.deepEqual(await auth.signIn(' admin@example.test ', 'pw'), { view: 'admin', user: ADMIN });
  });

  test('a regular user gets the account page', async () => {
    const { auth } = setup({
      'POST /api/v1/auth/sign-in/email': () => json(200, {}),
      'GET /api/v1/account/me': () => json(200, { user: USER }),
    });
    assert.equal((await auth.signIn('user@example.test', 'pw')).view, 'user');
  });

  test('the role comes from the server, never from the email address', async () => {
    const { auth } = setup({
      'POST /api/v1/auth/sign-in/email': () => json(200, {}),
      'GET /api/v1/account/me': () => json(200, { user: { ...USER, email: 'admin@example.test' } }),
    });
    assert.equal((await auth.signIn('admin@example.test', 'pw')).view, 'user');
  });

  test('invalid credentials stay on the login page with a message', async () => {
    const { auth } = setup({ 'POST /api/v1/auth/sign-in/email': () => json(401, { code: 'INVALID_EMAIL_OR_PASSWORD' }) });
    assert.deepEqual(await auth.signIn('a@example.test', 'nope'), { view: 'login', message: 'Incorrect email or password.' });
  });

  test('a suspended account is denied', async () => {
    const { auth } = setup({ 'POST /api/v1/auth/sign-in/email': () => json(403, { code: 'BANNED_USER' }) });
    assert.equal((await auth.signIn('a@example.test', 'pw')).view, 'suspended');
  });

  test('a server that cannot be reached is reported as offline', async () => {
    const { auth } = setup({ 'POST /api/v1/auth/sign-in/email': refused });
    const state = await auth.signIn('a@example.test', 'pw');
    assert.equal(state.view, 'offline');
    assert.match(state.message, /Cannot reach/);
  });

  test('unexpected server errors are explained', async () => {
    const { auth } = setup({ 'POST /api/v1/auth/sign-in/email': () => json(500, {}) });
    assert.match((await auth.signIn('a@example.test', 'pw')).message, /HTTP 500/);
  });
});

describe('session restoration', () => {
  test('a valid session restores the right view', async () => {
    const { auth } = setup({ 'GET /api/v1/auth/get-session': session, 'GET /api/v1/account/me': () => json(200, { user: ADMIN }) });
    assert.equal((await auth.restore()).view, 'admin');
  });

  test('no session or an expired one shows the login page', async () => {
    const { auth } = setup({ 'GET /api/v1/auth/get-session': () => json(200, null) });
    assert.deepEqual(await auth.restore(), { view: 'login' });
    const expired = setup({ 'GET /api/v1/auth/get-session': session, 'GET /api/v1/account/me': () => json(401, { error: { code: 'UNAUTHORIZED' } }) });
    assert.deepEqual(await expired.auth.restore(), { view: 'login' });
  });

  test('a suspended session is denied', async () => {
    const { auth } = setup({ 'GET /api/v1/auth/get-session': () => json(403, { error: { code: 'ACCOUNT_SUSPENDED' } }) });
    assert.equal((await auth.restore()).view, 'suspended');
  });

  test('an outage is offline, not "signed out"', async () => {
    for (const handler of [refused, () => json(503), () => json(500, {})]) {
      const { auth } = setup({ 'GET /api/v1/auth/get-session': handler });
      assert.equal((await auth.restore()).view, 'offline');
    }
  });
});

describe('sign out', () => {
  test('success returns to the login page', async () => {
    const { auth, calls } = setup({ 'POST /api/v1/auth/sign-out': () => json(200, { success: true }) });
    const state = await auth.signOut();
    assert.equal(state.view, 'login');
    assert.equal(calls[0].credentials, 'same-origin');
  });

  test('a failed sign-out does not claim the session ended', async () => {
    for (const handler of [refused, () => json(403, { code: 'INVALID_ORIGIN' }), () => json(500, {})]) {
      const { auth } = setup({ 'POST /api/v1/auth/sign-out': handler });
      const state = await auth.signOut();
      assert.equal(state.view, 'stay');
      assert.match(state.message, /still active/);
    }
  });
});
