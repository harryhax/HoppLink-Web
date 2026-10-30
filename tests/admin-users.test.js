// Tests for user administration: API client requests, account actions, and URL routes.
// Uses a fake fetch (no browser, no server). Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApi, describeError } from '../src/api.js';
import { parseRoute, userHash, usersHash } from '../src/router.js';
import { createUserAdmin, isAuthLoss } from '../src/user-admin.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function apiWith(respond = () => json(200, {})) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, credentials: init.credentials });
    return respond(url, init);
  };
  return { api: createApi({ fetch }), calls };
}

const TARGET = { id: 'user/1?x', email: 'jane@example.test' };

describe('API client: user administration', () => {
  test('listUsers sends search and pagination as query parameters', async () => {
    const { api, calls } = apiWith();
    await api.listUsers({ search: '  jane doe ', page: 3, pageSize: 20 });
    const url = new URL(calls[0].url, 'http://x');
    assert.equal(url.pathname, '/api/v1/admin/users');
    assert.equal(url.searchParams.get('search'), 'jane doe');
    assert.equal(url.searchParams.get('page'), '3');
    assert.equal(url.searchParams.get('pageSize'), '20');
    assert.equal(calls[0].credentials, 'same-origin');
  });

  test('listUsers omits an empty search', async () => {
    const { api, calls } = apiWith();
    await api.listUsers({ search: '   ' });
    assert.equal(new URL(calls[0].url, 'http://x').searchParams.has('search'), false);
  });

  test('search text is encoded, not interpolated raw', async () => {
    const { api, calls } = apiWith();
    await api.listUsers({ search: 'a&page=999#x' });
    const url = new URL(calls[0].url, 'http://x');
    assert.equal(url.searchParams.get('search'), 'a&page=999#x');
    assert.equal(url.searchParams.get('page'), '1');
  });

  test('getUser encodes the id into the path', async () => {
    const { api, calls } = apiWith();
    await api.getUser(TARGET.id);
    assert.equal(calls[0].url, '/api/v1/admin/users/user%2F1%3Fx');
  });

  test('account changes use Better Auth\'s admin endpoints with the user id', async () => {
    const { api, calls } = apiWith();
    await api.suspendUser('u1');
    await api.reactivateUser('u1');
    await api.setUserRole('u1', 'admin');
    assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
      ['POST', '/api/v1/auth/admin/ban-user', { userId: 'u1' }],
      ['POST', '/api/v1/auth/admin/unban-user', { userId: 'u1' }],
      ['POST', '/api/v1/auth/admin/set-role', { userId: 'u1', role: 'admin' }],
    ]);
  });

  test('server rule violations get clear messages', () => {
    assert.equal(describeError({ kind: 'http', status: 400, code: 'YOU_CANNOT_BAN_YOURSELF' }), 'You cannot suspend your own account.');
    assert.equal(describeError({ kind: 'http', status: 400, code: 'CANNOT_DEMOTE_YOURSELF' }), 'You cannot remove your own administrator role.');
    assert.equal(describeError({ kind: 'http', status: 400, code: 'LAST_ADMINISTRATOR' }), 'At least one active administrator must remain.');
    assert.equal(describeError({ kind: 'http', status: 400, code: 'SOMETHING_NEW', data: { message: 'Server says no' } }), 'Server says no');
    assert.match(describeError({ kind: 'http', status: 500, code: null, data: { message: 'stack trace here' } }), /HTTP 500/);
  });
});

describe('account actions', () => {
  const confirmWith = (answer) => {
    const questions = [];
    return { questions, confirm: async (question) => { questions.push(question); return answer; } };
  };

  test('suspension asks for confirmation and sends nothing if cancelled', async () => {
    const { api, calls } = apiWith();
    const { confirm, questions } = confirmWith(false);
    const result = await createUserAdmin(api, confirm).suspend(TARGET);
    assert.deepEqual(result, { outcome: 'cancelled' });
    assert.equal(calls.length, 0);
    assert.match(questions[0].body, /lose access to protected ProxyMarket services/);
    assert.equal(questions[0].danger, true);
  });

  test('role changes ask for confirmation and send nothing if cancelled', async () => {
    const { api, calls } = apiWith();
    const { confirm, questions } = confirmWith(false);
    const admin = createUserAdmin(api, confirm);
    assert.equal((await admin.makeAdmin(TARGET)).outcome, 'cancelled');
    assert.equal((await admin.removeAdmin(TARGET)).outcome, 'cancelled');
    assert.equal(calls.length, 0);
    assert.equal(questions.length, 2);
  });

  test('confirmed actions report success', async () => {
    const { api, calls } = apiWith(() => json(200, { user: {} }));
    const admin = createUserAdmin(api, confirmWith(true).confirm);
    assert.deepEqual(await admin.suspend(TARGET), { outcome: 'done', message: 'The account was suspended.' });
    assert.deepEqual(await admin.reactivate(TARGET), { outcome: 'done', message: 'The account was reactivated.' });
    assert.equal((await admin.makeAdmin(TARGET)).outcome, 'done');
    assert.equal((await admin.removeAdmin(TARGET)).outcome, 'done');
    assert.equal(calls.length, 4);
  });

  test('refused actions show the server\'s reason and never claim success', async () => {
    const { api } = apiWith(() => json(400, { code: 'CANNOT_DEMOTE_YOURSELF', message: 'x' }));
    const result = await createUserAdmin(api, confirmWith(true).confirm).removeAdmin(TARGET);
    assert.deepEqual(result, { outcome: 'failed', message: 'You cannot remove your own administrator role.' });
  });

  test('network failures are failures, not successes', async () => {
    const { api } = apiWith(() => { throw new TypeError('fetch failed'); });
    const result = await createUserAdmin(api, confirmWith(true).confirm).suspend(TARGET);
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /Cannot reach/);
  });

  test('a lost session is reported as an authentication problem', async () => {
    for (const [status, body] of [[401, {}], [403, { error: { code: 'ACCOUNT_SUSPENDED' } }], [403, {}]]) {
      const { api } = apiWith(() => json(status, body));
      assert.equal((await createUserAdmin(api, confirmWith(true).confirm).suspend(TARGET)).outcome, 'auth', `${status} ${JSON.stringify(body)}`);
    }
  });
});

describe('isAuthLoss', () => {
  test('distinguishes a lost session from a refused action', () => {
    assert.equal(isAuthLoss({ ok: false, kind: 'http', status: 401, code: 'UNAUTHORIZED' }), true);
    assert.equal(isAuthLoss({ ok: false, kind: 'http', status: 403, code: 'FORBIDDEN' }), true);
    assert.equal(isAuthLoss({ ok: false, kind: 'http', status: 403, code: 'ACCOUNT_SUSPENDED' }), true);
    assert.equal(isAuthLoss({ ok: false, kind: 'http', status: 403, code: 'INVALID_ORIGIN' }), false);
    assert.equal(isAuthLoss({ ok: false, kind: 'http', status: 403, code: 'YOU_ARE_NOT_ALLOWED_TO_BAN_USERS' }), false);
    assert.equal(isAuthLoss({ ok: false, kind: 'network', status: 0, code: 'NETWORK' }), false);
    assert.equal(isAuthLoss({ ok: true, status: 200 }), false);
  });
});

describe('routes', () => {
  test('parses dashboard, users list and user details', () => {
    assert.deepEqual(parseRoute(''), { name: 'dashboard' });
    assert.deepEqual(parseRoute('#dashboard'), { name: 'dashboard' });
    assert.deepEqual(parseRoute('#users'), { name: 'users', search: '', page: 1 });
    assert.deepEqual(parseRoute('#users?search=jane%20doe&page=3'), { name: 'users', search: 'jane doe', page: 3 });
    assert.deepEqual(parseRoute('#users/user%2F1%3Fx'), { name: 'user', id: 'user/1?x' });
  });

  test('invalid page numbers fall back to page 1', () => {
    for (const page of ['0', '-2', 'abc', '']) assert.equal(parseRoute(`#users?page=${page}`).page, 1);
  });

  test('builds hashes that round-trip', () => {
    assert.equal(usersHash(), '#users');
    assert.equal(usersHash({ search: ' jane ', page: 1 }), '#users?search=jane');
    assert.deepEqual(parseRoute(usersHash({ search: 'a&b', page: 4 })), { name: 'users', search: 'a&b', page: 4 });
    assert.deepEqual(parseRoute(userHash(TARGET.id)), { name: 'user', id: TARGET.id });
  });
});
