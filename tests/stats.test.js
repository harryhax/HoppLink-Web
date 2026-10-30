// Tests for the dashboard statistics loader, using a fake fetch. Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApi } from '../src/api.js';
import { createStatsLoader } from '../src/stats.js';

const SUMMARY = { totalUsers: 5, activeUsers: 4, registeredDevices: 3, proxyServers: 2, enabledProxyServers: 1, proxyAssignments: 2, activeSessions: 6 };
const USERS = [{ id: 'u1', name: 'Jane', email: 'jane@example.test', role: 'USER', status: 'ACTIVE', createdAt: '2026-10-29T14:30:00.000Z' }];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function loaderWith(respond) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init });
    return respond(calls.length);
  };
  return { loader: createStatsLoader(createApi({ fetch })), calls };
}

describe('dashboard statistics loader', () => {
  test('calls GET /api/v1/admin/dashboard with browser-managed cookies', async () => {
    const { loader, calls } = loaderWith(() => json(200, { summary: SUMMARY, recentUsers: USERS }));
    await loader.load();
    assert.equal(calls[0].url, '/api/v1/admin/dashboard');
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].credentials, 'same-origin');
  });

  test('returns the server\'s numbers and users unchanged', async () => {
    const { loader } = loaderWith(() => json(200, { summary: SUMMARY, recentUsers: USERS }));
    assert.deepEqual(await loader.load(), { state: 'ready', summary: SUMMARY, recentUsers: USERS });
  });

  test('an empty database gives zeroes and an empty list', async () => {
    const zero = Object.fromEntries(Object.keys(SUMMARY).map((k) => [k, 0]));
    const { loader } = loaderWith(() => json(200, { summary: zero, recentUsers: [] }));
    const result = await loader.load();
    assert.equal(result.state, 'ready');
    assert.deepEqual(result.summary, zero);
    assert.deepEqual(result.recentUsers, []);
  });

  test('stays pending while loading and produces no values until the response arrives', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { loader } = loaderWith(async () => { await gate; return json(200, { summary: SUMMARY, recentUsers: [] }); });
    let settled = null;
    const pending = loader.load().then((r) => { settled = r; });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(settled, null, 'nothing is shown before the server answers');
    release();
    await pending;
    assert.equal(settled.state, 'ready');
  });

  test('failures are errors with a message, never zeroes', async () => {
    for (const respond of [() => json(500, {}), () => json(503, {}), () => { throw new TypeError('fetch failed'); }]) {
      const { loader } = loaderWith(respond);
      const result = await loader.load();
      assert.equal(result.state, 'error');
      assert.ok(result.message.length > 0);
      assert.equal(result.summary, undefined);
    }
  });

  test('malformed responses are errors, not invented values', async () => {
    for (const body of [{}, { summary: { totalUsers: 1 }, recentUsers: [] }, { summary: { ...SUMMARY, activeUsers: null }, recentUsers: [] }, { summary: SUMMARY }]) {
      const { loader } = loaderWith(() => json(200, body));
      assert.equal((await loader.load()).state, 'error', JSON.stringify(body));
    }
  });

  test('401 and 403 are reported as authentication problems, not server failures', async () => {
    for (const status of [401, 403]) {
      const { loader } = loaderWith(() => json(status, { error: { code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN' } }));
      assert.deepEqual(await loader.load(), { state: 'auth', status });
    }
  });

  test('retry after a failure makes a new request and can succeed', async () => {
    const { loader, calls } = loaderWith((n) => (n === 1 ? json(500, {}) : json(200, { summary: SUMMARY, recentUsers: [] })));
    assert.equal((await loader.load()).state, 'error');
    assert.equal((await loader.load()).state, 'ready');
    assert.equal(calls.length, 2);
  });

  test('refresh while a load is running reuses it instead of sending a duplicate', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { loader, calls } = loaderWith(async () => { await gate; return json(200, { summary: SUMMARY, recentUsers: [] }); });
    const first = loader.load();
    const second = loader.load();
    release();
    assert.deepEqual(await first, await second);
    assert.equal(calls.length, 1);
    await loader.load(); // a later refresh does make a new request
    assert.equal(calls.length, 2);
  });
});
