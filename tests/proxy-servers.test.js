// Tests for proxy server administration: API requests, form checks and actions.
// Uses a fake fetch (no browser, no server). Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApi } from '../src/api.js';
import { createProxyAdmin, validateServerForm } from '../src/proxy-admin.js';
import { parseRoute } from '../src/router.js';

const json = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SERVER = { id: 'srv/1', name: 'Primary Proxy', host: 'proxy.example.com', port: 3128, enabled: true };
const FORM = { name: '  Primary Proxy ', host: ' proxy.example.com ', port: '3128', enabled: true };

function setup(respond = () => json(200, { server: SERVER })) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, credentials: init.credentials });
    return respond(url, init);
  };
  const questions = [];
  let answer = true;
  const confirm = async (question) => { questions.push(question); return answer; };
  const api = createApi({ fetch });
  return { api, calls, questions, admin: createProxyAdmin(api, confirm), answer: (value) => { answer = value; } };
}

describe('API client: proxy servers', () => {
  test('uses the existing admin proxy-server endpoints', async () => {
    const { api, calls } = setup();
    await api.listProxyServers();
    await api.createProxyServer({ name: 'A', host: 'h', port: 1, enabled: true });
    await api.updateProxyServer('srv/1', { enabled: false });
    await api.deleteProxyServer('srv/1');
    assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
      ['GET', '/api/v1/admin/proxy-servers', undefined],
      ['POST', '/api/v1/admin/proxy-servers', { name: 'A', host: 'h', port: 1, enabled: true }],
      ['PATCH', '/api/v1/admin/proxy-servers/srv%2F1', { enabled: false }],
      ['DELETE', '/api/v1/admin/proxy-servers/srv%2F1', undefined],
    ]);
    assert.ok(calls.every((c) => c.credentials === 'same-origin'));
  });

  test('the Proxy Servers page has a route', () => {
    assert.deepEqual(parseRoute('#servers'), { name: 'servers' });
  });
});

describe('validateServerForm', () => {
  test('trims and converts the port to an integer', () => {
    assert.deepEqual(validateServerForm(FORM), { errors: {}, server: { name: 'Primary Proxy', host: 'proxy.example.com', port: 3128, enabled: true } });
  });

  test('requires a name, a host and a port from 1 to 65535', () => {
    const { errors, server } = validateServerForm({ name: ' ', host: '', port: '70000', enabled: true });
    assert.equal(server, null);
    assert.deepEqual(Object.keys(errors).sort(), ['host', 'name', 'port']);
    for (const port of ['0', '-1', '3128.5', 'abc', '', '1e3']) {
      assert.ok(validateServerForm({ ...FORM, port }).errors.port, `port ${port}`);
    }
    assert.equal(validateServerForm({ ...FORM, port: '1' }).server.port, 1);
    assert.equal(validateServerForm({ ...FORM, port: '65535' }).server.port, 65535);
  });

  test('requires a boolean enabled flag', () => {
    assert.ok(validateServerForm({ ...FORM, enabled: 'true' }).errors.enabled);
  });

  test('does not second-guess hosts: the server validates them', () => {
    for (const host of ['10.0.0.5', '2001:db8::1', 'localhost', 'proxy-1.internal']) {
      assert.equal(validateServerForm({ ...FORM, host }).server.host, host);
    }
  });
});

describe('add and edit', () => {
  test('a valid form creates a server', async () => {
    const { admin, calls } = setup(() => json(201, { server: SERVER }));
    assert.deepEqual(await admin.save(FORM), { outcome: 'done', message: '"Primary Proxy" was added.' });
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body, { name: 'Primary Proxy', host: 'proxy.example.com', port: 3128, enabled: true });
  });

  test('an invalid form sends nothing', async () => {
    const { admin, calls } = setup();
    const result = await admin.save({ ...FORM, name: '' });
    assert.equal(result.outcome, 'invalid');
    assert.ok(result.errors.name);
    assert.equal(calls.length, 0);
  });

  test('a refused creation shows the server\'s message', async () => {
    const { admin } = setup(() => json(400, { error: { code: 'VALIDATION_ERROR', message: 'host must be a hostname or IP address, without scheme, port, path or credentials' } }));
    const result = await admin.save({ ...FORM, host: 'http://proxy.example.com' });
    assert.equal(result.outcome, 'failed');
    assert.equal(result.message, 'host must be a hostname or IP address, without scheme, port, path or credentials');
  });

  test('editing updates the existing server by id', async () => {
    const { admin, calls } = setup();
    const result = await admin.save({ ...FORM, name: 'Renamed', port: '8080' }, SERVER);
    assert.equal(result.outcome, 'done');
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].url, '/api/v1/admin/proxy-servers/srv%2F1');
    assert.deepEqual(calls[0].body, { name: 'Renamed', host: 'proxy.example.com', port: 8080, enabled: true });
  });

  test('a failed edit is reported, not claimed as success', async () => {
    const { admin } = setup(() => json(404, { error: { code: 'PROXY_SERVER_NOT_FOUND', message: 'Proxy server not found' } }));
    assert.deepEqual(await admin.save(FORM, SERVER), { outcome: 'failed', message: 'This proxy server no longer exists.' });
  });
});

describe('enable and disable', () => {
  test('disabling asks for confirmation and sends nothing if cancelled', async () => {
    const { admin, calls, questions, answer } = setup();
    answer(false);
    assert.deepEqual(await admin.toggle(SERVER), { outcome: 'cancelled' });
    assert.equal(calls.length, 0);
    assert.match(questions[0].body, /won't be able to select it/);
  });

  test('confirmed disabling sends enabled: false', async () => {
    const { admin, calls } = setup();
    assert.deepEqual(await admin.toggle(SERVER), { outcome: 'done', message: '"Primary Proxy" was disabled.' });
    assert.deepEqual(calls[0].body, { enabled: false });
  });

  test('enabling needs no confirmation', async () => {
    const { admin, calls, questions } = setup();
    assert.equal((await admin.toggle({ ...SERVER, enabled: false })).outcome, 'done');
    assert.equal(questions.length, 0);
    assert.deepEqual(calls[0].body, { enabled: true });
  });
});

describe('delete', () => {
  test('asks for confirmation naming the server, and sends nothing if cancelled', async () => {
    const { admin, calls, questions, answer } = setup();
    answer(false);
    assert.deepEqual(await admin.remove(SERVER), { outcome: 'cancelled' });
    assert.equal(calls.length, 0);
    assert.match(questions[0].body, /"Primary Proxy"/);
    assert.equal(questions[0].danger, true);
  });

  test('confirmed deletion succeeds on 204', async () => {
    const { admin, calls } = setup(() => new Response(null, { status: 204 }));
    assert.deepEqual(await admin.remove(SERVER), { outcome: 'done', message: '"Primary Proxy" was deleted.' });
    assert.equal(calls[0].method, 'DELETE');
  });

  test('a failed deletion is reported, not claimed as success', async () => {
    const { admin } = setup(() => json(404, { error: { code: 'PROXY_SERVER_NOT_FOUND', message: 'Proxy server not found' } }));
    assert.deepEqual(await admin.remove(SERVER), { outcome: 'failed', message: 'This proxy server no longer exists.' });
  });
});

describe('authentication errors', () => {
  test('a lost session is reported as auth, not as a failure', async () => {
    for (const [status, body] of [[401, { error: { code: 'UNAUTHORIZED' } }], [403, { error: { code: 'FORBIDDEN' } }], [403, { error: { code: 'ACCOUNT_SUSPENDED' } }]]) {
      const { admin } = setup(() => json(status, body));
      assert.equal((await admin.save(FORM)).outcome, 'auth');
      assert.equal((await admin.remove(SERVER)).outcome, 'auth');
    }
  });

  test('a refused origin is a failure with a message, not a sign-out', async () => {
    const { admin } = setup(() => json(403, { error: { code: 'INVALID_ORIGIN', message: 'Request origin is not allowed' } }));
    const result = await admin.toggle({ ...SERVER, enabled: false });
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /TRUSTED_ORIGINS/);
  });
});

describe('removed proxy assignment administration', () => {
  test('the API client has no assignment methods', () => {
    const { api } = setup();
    for (const method of ['listAssignments', 'createAssignment', 'updateAssignment', 'deleteAssignment']) {
      assert.equal(api[method], undefined, method);
    }
    assert.equal(Object.keys(api).some((key) => /assign/i.test(key)), false);
  });

  test('#assignments is not a route (it falls back to the dashboard)', () => {
    assert.deepEqual(parseRoute('#assignments'), { name: 'dashboard' });
    assert.deepEqual(parseRoute('#assignments?filter=unassigned'), { name: 'dashboard' });
  });
});
