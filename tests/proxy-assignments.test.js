// Tests for proxy assignment administration: API requests, routes, the server picker and actions.
// Uses a fake fetch (no browser, no server). Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApi, describeError } from '../src/api.js';
import { assignmentActions, createAssignmentAdmin, hostPort, serverOptions } from '../src/assignment-admin.js';
import { assignmentsHash, parseRoute } from '../src/router.js';

const json = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SERVER = { id: 'srv-1', name: 'Primary Proxy', host: 'proxy.example.com', port: 3128, enabled: true };
const OTHER = { id: 'srv-2', name: 'Backup Proxy', host: '192.0.2.20', port: 8080, enabled: true };
const USER = { id: 'user/1', name: 'Jane Doe', email: 'jane@example.test', status: 'ACTIVE' };
// A list entry; the user details response has the same { user, assignment } shape.
const ENTRY = { user: USER, assignment: { id: 'asg/1', createdAt: '2026-10-30T10:00:00.000Z', server: SERVER } };
const UNASSIGNED = { user: USER, assignment: null };

function setup(respond = () => json(200, {})) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, credentials: init.credentials });
    return respond(url, init);
  };
  const questions = [];
  let answer = true;
  const confirm = async (question) => { questions.push(question); return answer; };
  const api = createApi({ fetch });
  return { api, calls, questions, admin: createAssignmentAdmin(api, confirm), answer: (value) => { answer = value; } };
}

describe('API client: proxy assignments', () => {
  test('lists with filter, search and pagination as query parameters', async () => {
    const { api, calls } = setup();
    await api.listAssignments({ filter: 'unassigned', search: '  jane doe ', page: 3, pageSize: 20 });
    const url = new URL(calls[0].url, 'http://x');
    assert.equal(url.pathname, '/api/v1/admin/proxy-assignments');
    assert.equal(url.searchParams.get('filter'), 'unassigned');
    assert.equal(url.searchParams.get('search'), 'jane doe');
    assert.equal(url.searchParams.get('page'), '3');
    assert.equal(url.searchParams.get('pageSize'), '20');
    assert.equal(calls[0].credentials, 'same-origin');
  });

  test('defaults to assigned, page 1 and 20 per page, and omits an empty search', async () => {
    const { api, calls } = setup();
    await api.listAssignments({ search: '   ' });
    const url = new URL(calls[0].url, 'http://x');
    assert.deepEqual(Object.fromEntries(url.searchParams), { filter: 'assigned', page: '1', pageSize: '20' });
  });

  test('search text is encoded, not interpolated raw', async () => {
    const { api, calls } = setup();
    await api.listAssignments({ search: 'a&filter=all#x' });
    const url = new URL(calls[0].url, 'http://x');
    assert.equal(url.searchParams.get('search'), 'a&filter=all#x');
    assert.equal(url.searchParams.get('filter'), 'assigned');
  });

  test('create, change and remove use the admin assignment endpoints with encoded ids', async () => {
    const { api, calls } = setup();
    await api.createAssignment('user/1', 'srv-1');
    await api.updateAssignment('asg/1', 'srv-2');
    await api.deleteAssignment('asg/1');
    assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
      ['POST', '/api/v1/admin/proxy-assignments', { userId: 'user/1', proxyServerId: 'srv-1' }],
      ['PATCH', '/api/v1/admin/proxy-assignments/asg%2F1', { proxyServerId: 'srv-2' }],
      ['DELETE', '/api/v1/admin/proxy-assignments/asg%2F1', undefined],
    ]);
  });

  test('assignment refusals get clear messages', () => {
    assert.match(describeError({ kind: 'http', status: 409, code: 'ASSIGNMENT_EXISTS' }), /already has a proxy assignment.*Change/);
    assert.match(describeError({ kind: 'http', status: 409, code: 'SERVER_DISABLED' }), /disabled/);
    assert.match(describeError({ kind: 'http', status: 409, code: 'USER_SUSPENDED' }), /Suspended/);
    assert.match(describeError({ kind: 'http', status: 404, code: 'ASSIGNMENT_NOT_FOUND' }), /no longer exists/);
  });
});

describe('routes', () => {
  test('parses filter, search and page, defaulting to assigned and page 1', () => {
    assert.deepEqual(parseRoute('#assignments'), { name: 'assignments', filter: 'assigned', search: '', page: 1 });
    assert.deepEqual(parseRoute('#assignments?filter=unassigned&search=jane%20doe&page=2'), { name: 'assignments', filter: 'unassigned', search: 'jane doe', page: 2 });
    assert.equal(parseRoute('#assignments?filter=all').filter, 'all');
    assert.equal(parseRoute('#assignments?filter=bogus').filter, 'assigned');
    assert.equal(parseRoute('#assignments?page=-3').page, 1);
  });

  test('builds hashes that round-trip', () => {
    assert.equal(assignmentsHash(), '#assignments');
    assert.equal(assignmentsHash({ filter: 'assigned', search: ' ', page: 1 }), '#assignments');
    for (const route of [{ filter: 'all', search: 'a&b', page: 4 }, { filter: 'unassigned', search: '', page: 1 }, { filter: 'assigned', search: 'x', page: 2 }]) {
      assert.deepEqual(parseRoute(assignmentsHash(route)), { name: 'assignments', ...route });
    }
  });
});

describe('server picker', () => {
  const disabled = { id: 'srv-0', name: 'Archive', host: '2001:db8::7', port: 3128, enabled: false };

  test('lists enabled servers first; disabled ones are shown but not selectable', () => {
    const options = serverOptions([disabled, SERVER, OTHER]);
    assert.deepEqual(options.map((o) => [o.value, o.disabled]), [['srv-2', false], ['srv-1', false], ['srv-0', true]]);
    assert.equal(options[0].label, 'Backup Proxy — 192.0.2.20:8080');
    assert.equal(options[2].label, 'Archive — [2001:db8::7]:3128 (disabled)');
  });

  test('marks the current server and makes it unselectable', () => {
    const current = serverOptions([SERVER, OTHER], 'srv-1').find((o) => o.value === 'srv-1');
    assert.equal(current.disabled, true);
    assert.match(current.label, /\(current\)$/);
  });

  test('does not change the list it was given', () => {
    const servers = [SERVER, OTHER];
    serverOptions(servers);
    assert.deepEqual(servers.map((s) => s.id), ['srv-1', 'srv-2']);
  });

  test('host:port brackets IPv6 addresses', () => {
    assert.equal(hostPort(SERVER), 'proxy.example.com:3128');
    assert.equal(hostPort({ host: '2001:db8::1', port: 80 }), '[2001:db8::1]:80');
  });
});

describe('row actions (Proxy Assignments page and user details)', () => {
  test('Assign without an assignment; Change and Remove with one', () => {
    assert.deepEqual(assignmentActions(UNASSIGNED), ['assign']);
    assert.deepEqual(assignmentActions(ENTRY), ['change', 'remove']);
  });

  test('a user details response works with the same actions', async () => {
    const details = { user: { ...USER, role: 'USER', createdAt: 'x', updatedAt: null }, devices: [], sessions: [], assignment: ENTRY.assignment };
    const { admin, calls } = setup(() => json(200, { assignment: {} }));
    assert.deepEqual(assignmentActions(details), ['change', 'remove']);
    assert.equal((await admin.change(details, 'srv-2')).outcome, 'done');
    assert.equal(calls[0].url, '/api/v1/admin/proxy-assignments/asg%2F1');
  });
});

describe('assign', () => {
  test('requires a chosen user and server, and sends nothing otherwise', async () => {
    const { admin, calls } = setup();
    assert.deepEqual(await admin.assign({ user: null, serverId: '' }), { outcome: 'invalid', errors: { user: 'Choose a user.', server: 'Choose a proxy server.' } });
    assert.deepEqual((await admin.assign({ user: USER, serverId: '' })).errors, { server: 'Choose a proxy server.' });
    assert.deepEqual((await admin.assign({ user: null, serverId: 'srv-1' })).errors, { user: 'Choose a user.' });
    assert.equal(calls.length, 0);
  });

  test('creates the assignment for the chosen user and server', async () => {
    const { admin, calls } = setup(() => json(201, { assignment: {} }));
    assert.deepEqual(await admin.assign({ user: USER, serverId: 'srv-1' }), { outcome: 'done', message: 'A proxy server was assigned to jane@example.test.' });
    assert.deepEqual(calls.map((c) => [c.method, c.body]), [['POST', { userId: 'user/1', proxyServerId: 'srv-1' }]]);
  });

  test('a user who already has an assignment is refused by the server, with a pointer to Change', async () => {
    const { admin } = setup(() => json(409, { error: { code: 'ASSIGNMENT_EXISTS', message: 'User already has a proxy assignment' } }));
    const result = await admin.assign({ user: USER, serverId: 'srv-2' });
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /Use Change/);
  });

  test('unknown users, unknown or disabled servers, and suspended users are reported', async () => {
    for (const [status, code, pattern] of [[404, 'USER_NOT_FOUND', /no longer exists/], [404, 'PROXY_SERVER_NOT_FOUND', /no longer exists/], [409, 'SERVER_DISABLED', /disabled/], [409, 'USER_SUSPENDED', /Suspended/]]) {
      const { admin } = setup(() => json(status, { error: { code, message: 'x' } }));
      const result = await admin.assign({ user: USER, serverId: 'srv-1' });
      assert.equal(result.outcome, 'failed', code);
      assert.match(result.message, pattern, code);
    }
  });
});

describe('change', () => {
  test('updates the existing assignment by id (never a second POST)', async () => {
    const { admin, calls } = setup(() => json(200, { assignment: {} }));
    assert.deepEqual(await admin.change(ENTRY, 'srv-2'), { outcome: 'done', message: 'Proxy assignment updated.' });
    assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [['PATCH', '/api/v1/admin/proxy-assignments/asg%2F1', { proxyServerId: 'srv-2' }]]);
  });

  test('requires a different server, and sends nothing otherwise', async () => {
    const { admin, calls } = setup();
    assert.deepEqual((await admin.change(ENTRY, '')).errors, { server: 'Choose a proxy server.' });
    assert.deepEqual((await admin.change(ENTRY, 'srv-1')).errors, { server: 'Choose a different proxy server.' });
    assert.equal(calls.length, 0);
  });

  test('a refused change is a failure with the server\'s reason, not a success', async () => {
    const { admin } = setup(() => json(404, { error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found' } }));
    const result = await admin.change(ENTRY, 'srv-2');
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /no longer exists/);
  });

  test('a server validation error shows the server\'s message', async () => {
    const { admin } = setup(() => json(400, { error: { code: 'VALIDATION_ERROR', message: 'body must have required property \'proxyServerId\'' } }));
    assert.equal((await admin.change(ENTRY, 'srv-2')).message, 'body must have required property \'proxyServerId\'');
  });
});

describe('remove', () => {
  test('asks for confirmation naming the user, and sends nothing if cancelled', async () => {
    const { admin, calls, questions, answer } = setup();
    answer(false);
    assert.deepEqual(await admin.remove(ENTRY), { outcome: 'cancelled' });
    assert.equal(calls.length, 0);
    assert.match(questions[0].body, /jane@example\.test/);
    assert.match(questions[0].body, /next proxy configuration request will no longer return an assigned proxy/);
    assert.match(questions[0].body, /not changed/);
    assert.equal(questions[0].danger, true);
  });

  test('confirmed removal deletes only the assignment', async () => {
    const { admin, calls } = setup(() => new Response(null, { status: 204 }));
    assert.deepEqual(await admin.remove(ENTRY), { outcome: 'done', message: 'The proxy assignment for jane@example.test was removed.' });
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [['DELETE', '/api/v1/admin/proxy-assignments/asg%2F1']]);
  });
});

describe('failures', () => {
  test('network failures and timeouts are failures, never successes', async () => {
    const { admin } = setup(() => { throw new TypeError('fetch failed'); });
    for (const pending of [admin.assign({ user: USER, serverId: 'srv-1' }), admin.change(ENTRY, 'srv-2'), admin.remove(ENTRY)]) {
      const result = await pending;
      assert.equal(result.outcome, 'failed');
      assert.match(result.message, /Cannot reach/);
    }
  });

  test('server errors are explained without exposing details', async () => {
    const { admin } = setup(() => json(500, { error: { code: 'INTERNAL', message: 'stack trace here' } }));
    assert.match((await admin.change(ENTRY, 'srv-2')).message, /HTTP 500/);
  });

  test('an expired session or lost admin role is reported as auth', async () => {
    for (const [status, body] of [[401, { error: { code: 'UNAUTHORIZED' } }], [403, { error: { code: 'FORBIDDEN' } }], [403, { error: { code: 'ACCOUNT_SUSPENDED' } }]]) {
      const { admin } = setup(() => json(status, body));
      assert.equal((await admin.assign({ user: USER, serverId: 'srv-1' })).outcome, 'auth');
      assert.equal((await admin.change(ENTRY, 'srv-2')).outcome, 'auth');
      assert.equal((await admin.remove(ENTRY)).outcome, 'auth');
    }
  });

  test('a refused origin is a failure with a message, not a sign-out', async () => {
    const { admin } = setup(() => json(403, { error: { code: 'INVALID_ORIGIN', message: 'Request origin is not allowed' } }));
    const result = await admin.remove(ENTRY);
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /TRUSTED_ORIGINS/);
  });
});
