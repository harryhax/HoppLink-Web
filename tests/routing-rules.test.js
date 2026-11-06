// Tests for the Routing Rules section: API requests, form checks, actions and stale answers.
// Uses a fake fetch (no browser, no server). The page itself is checked statically. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { createApi, describeError } from '../src/api.js';
import { createRoutingRules, describeSync, isKeyboardActivation, PREVIEW_NOTICE, PREVIEW_NOTICE_TITLE, PREVIEW_SQUID_NOTE, switchToRefocus, validateDomain } from '../src/routing-rules.js';

// No body at all when none is given: Node 24's Response refuses even an empty string with a 204.
const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failure = (status, code, message = code) => json(status, { error: { code, message } });

const A = { id: 'server-a', name: 'Sweden', host: 'a.example.com', port: 3128, enabled: true };
const B = { id: 'server-b', name: 'Norway', host: 'b.example.com', port: 3128, enabled: false };
const row = (id, domain, enabled = true, proxyServerId = A.id) => ({ id, proxyServerId, domain, enabled, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' });

/** A small in-memory server: per-server rows, with any request overridable or holdable. */
function setup({ domains = {}, servers = [A, B], respond = null } = {}) {
  const stored = { [A.id]: [], [B.id]: [], ...domains };
  const calls = [];
  const held = [];
  let hold = null;
  const handle = (url, method, body) => {
    const path = url.replace('/api/v1/admin/proxy-servers', '');
    if (path === '' && method === 'GET') return json(200, { servers });
    const preview = path.match(/^\/([^/]+)\/pac\/preview$/);
    if (preview) return json(200, { proxyServerId: preview[1], pac: `function FindProxyForURL() { return "${preview[1]}"; }\n` });
    const copy = path.match(/^\/([^/]+)\/domains\/copy$/);
    if (copy) {
      stored[copy[1]] = stored[body.sourceServerId].map((source, index) => ({ ...source, id: `copied-${index}`, proxyServerId: copy[1] }));
      return json(200, { domains: stored[copy[1]] });
    }
    const one = path.match(/^\/([^/]+)\/domains\/([^/]+)$/);
    if (one && method === 'PATCH') {
      const updated = { ...stored[one[1]].find((candidate) => candidate.id === one[2]), ...body };
      stored[one[1]] = stored[one[1]].map((candidate) => (candidate.id === one[2] ? updated : candidate));
      return json(200, { domain: updated });
    }
    if (one && method === 'DELETE') {
      stored[one[1]] = stored[one[1]].filter((candidate) => candidate.id !== one[2]);
      return json(204);
    }
    const list = path.match(/^\/([^/]+)\/domains$/);
    if (list && method === 'POST') {
      const created = row(`new-${stored[list[1]].length}`, body.domain, body.enabled, list[1]);
      stored[list[1]] = [...stored[list[1]], created];
      return json(201, { domain: created });
    }
    if (list) return json(200, { domains: stored[list[1]] });
    return failure(404, 'NOT_FOUND');
  };
  const fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method, body });
    if (hold?.(url, init.method)) await new Promise((resolve) => { held.push(resolve); });
    return respond?.(url, init.method, body) ?? handle(url, init.method, body);
  };
  const questions = [];
  let answer = true;
  const confirm = async (question) => { questions.push(question); return answer; };
  const renders = [];
  const rules = createRoutingRules({
    api: createApi({ fetch }),
    confirm,
    onChange: (state) => renders.push(state.domains.map((domain) => `${domain.domain}:${domain.enabled}`)),
  });
  return {
    rules,
    calls,
    questions,
    renders,
    stored,
    held,
    answer: (value) => { answer = value; },
    holdWhen: (test) => { hold = test; },
    writes: () => calls.filter((call) => call.method !== 'GET'),
  };
}

// Long enough for a request that's already been started to reach the point where it's held.
const flush = () => new Promise((resolve) => { setTimeout(resolve, 20); });

describe('API client: routing rules', () => {
  test('uses the backend routes, encoding every ID', async () => {
    const calls = [];
    const api = createApi({ fetch: async (url, init) => {
      calls.push([init.method, url, init.body ? JSON.parse(init.body) : undefined, init.credentials]);
      return json(200, {});
    } });
    await api.listRoutingDomains('s/1');
    await api.createRoutingDomain('s/1', { domain: 'a.example.com', enabled: true });
    await api.updateRoutingDomain('s/1', 'd/1', { enabled: false });
    await api.deleteRoutingDomain('s/1', 'd/1');
    await api.copyRoutingDomains('s/1', 's/2');
    await api.pacPreview('s/1');
    const base = '/api/v1/admin/proxy-servers/s%2F1';
    assert.deepEqual(calls, [
      ['GET', `${base}/domains`, undefined, 'same-origin'],
      ['POST', `${base}/domains`, { domain: 'a.example.com', enabled: true }, 'same-origin'],
      ['PATCH', `${base}/domains/d%2F1`, { enabled: false }, 'same-origin'],
      ['DELETE', `${base}/domains/d%2F1`, undefined, 'same-origin'],
      ['POST', `${base}/domains/copy`, { sourceServerId: 's/2' }, 'same-origin'],
      ['GET', `${base}/pac/preview`, undefined, 'same-origin'],
    ]);
  });

  test('explains the routing error codes', () => {
    for (const code of ['DUPLICATE_ROUTING_DOMAIN', 'ROUTING_DOMAIN_NOT_FOUND', 'SAME_PROXY_SERVER', 'PROXY_SERVER_INVALID']) {
      const message = describeError({ ok: false, status: 400, kind: 'http', code, data: null });
      assert.doesNotMatch(message, /HTTP/, code);
    }
  });
});

describe('validateDomain', () => {
  test('accepts hostnames and leading wildcards, trimmed and lowercased', () => {
    assert.deepEqual(validateDomain(' CLOB.Polymarket.com '), { domain: 'clob.polymarket.com' });
    assert.deepEqual(validateDomain('*.Polymarket.com'), { domain: '*.polymarket.com' });
    assert.deepEqual(validateDomain('gamma-api.polymarket.com'), { domain: 'gamma-api.polymarket.com' });
  });

  for (const value of ['', '   ', 'https://polymarket.com', 'polymarket.com/markets', 'polymarket.com?a=1', 'polymarket.com#a', 'polymarket.com:443', 'poly market.com', 'localhost', '*', '*polymarket.com', 'a.*.example.com', '*.*.example.com', 'polymarket.*', '*.com']) {
    test(`catches ${JSON.stringify(value)}`, () => {
      assert.ok(validateDomain(value).error, value);
    });
  }
});

describe('the domain list', () => {
  test('selecting a server loads its rows', async () => {
    const { rules, calls } = setup({ domains: { [A.id]: [row('1', 'a.example.com'), row('2', '*.b.example.com', false)] } });
    const load = rules.select(A);
    assert.equal(rules.state.status, 'loading');
    assert.deepEqual(await load, { outcome: 'done' });
    assert.equal(rules.state.status, 'ready');
    assert.equal(rules.state.server, A);
    assert.deepEqual(rules.state.domains.map((domain) => [domain.domain, domain.enabled]), [['a.example.com', true], ['*.b.example.com', false]]);
    assert.equal(calls[0].url, `/api/v1/admin/proxy-servers/${A.id}/domains`);
  });

  test('an empty configuration is ready and empty, and nothing is added for it', async () => {
    const { rules, writes } = setup();
    await rules.select(A);
    assert.equal(rules.state.status, 'ready');
    assert.deepEqual(rules.state.domains, []);
    assert.deepEqual(writes(), []);
  });

  test('a failed load shows an error without any rows', async () => {
    const { rules } = setup({ respond: () => failure(500, 'INTERNAL_SERVER_ERROR') });
    const result = await rules.select(A);
    assert.equal(result.outcome, 'failed');
    assert.equal(rules.state.status, 'error');
    assert.ok(rules.state.error);
  });

  test('a malformed answer is an error, not an empty list', async () => {
    const { rules } = setup({ respond: () => json(200, { domains: 'nope' }) });
    assert.equal((await rules.select(A)).outcome, 'failed');
    assert.equal(rules.state.status, 'error');
  });

  test('a failed refresh keeps the rows on screen', async () => {
    let fail = false;
    const { rules } = setup({ domains: { [A.id]: [row('1', 'a.example.com')] }, respond: () => (fail ? failure(500, 'X') : null) });
    await rules.select(A);
    fail = true;
    assert.equal((await rules.reload()).outcome, 'failed');
    assert.equal(rules.state.status, 'ready');
    assert.equal(rules.state.domains.length, 1);
  });

  test('a lost session is reported as such', async () => {
    for (const status of [401, 403]) {
      const { rules } = setup({ respond: () => failure(status, status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN') });
      assert.deepEqual(await rules.select(A), { outcome: 'auth' }, String(status));
    }
  });
});

describe('add and edit', () => {
  test('adding sends the normalized domain and enabled state, then refreshes', async () => {
    const { rules, calls, writes } = setup();
    await rules.select(A);
    const result = await rules.save({ domain: ' *.Example.com ', enabled: false });
    assert.deepEqual(result, { outcome: 'done', message: '"*.example.com" was added.' });
    assert.deepEqual(writes()[0].body, { domain: '*.example.com', enabled: false });
    assert.equal(calls.at(-1).method, 'GET');
    assert.deepEqual(rules.state.domains.map((domain) => domain.domain), ['*.example.com']);
  });

  test('editing changes the domain and enabled state of that row', async () => {
    const { rules, writes } = setup({ domains: { [A.id]: [row('1', 'a.example.com')] } });
    await rules.select(A);
    const result = await rules.save({ domain: 'b.example.com', enabled: false }, rules.state.domains[0]);
    assert.deepEqual(result, { outcome: 'done', message: '"b.example.com" was updated.' });
    assert.equal(writes()[0].method, 'PATCH');
    assert.equal(writes()[0].url, `/api/v1/admin/proxy-servers/${A.id}/domains/1`);
    assert.deepEqual(writes()[0].body, { domain: 'b.example.com', enabled: false });
    assert.deepEqual(rules.state.domains.map((domain) => [domain.domain, domain.enabled]), [['b.example.com', false]]);
  });

  test('an invalid form sends nothing', async () => {
    const { rules, writes } = setup();
    await rules.select(A);
    const result = await rules.save({ domain: 'https://a.example.com', enabled: true });
    assert.equal(result.outcome, 'invalid');
    assert.ok(result.errors.domain);
    assert.deepEqual(writes(), []);
  });

  test('shows the API\'s validation message and keeps the list', async () => {
    const { rules } = setup({
      domains: { [A.id]: [row('1', 'a.example.com')] },
      respond: (_, method) => (method === 'POST' ? failure(400, 'VALIDATION_ERROR', 'domain must be a hostname or a leading wildcard such as *.example.com') : null),
    });
    await rules.select(A);
    assert.deepEqual(await rules.save({ domain: 'a_b.example.com', enabled: true }), { outcome: 'failed', message: 'domain must be a hostname or a leading wildcard such as *.example.com' });
    assert.equal(rules.state.domains.length, 1);
  });

  test('explains a duplicate', async () => {
    const { rules } = setup({ respond: (_, method) => (method === 'POST' ? failure(409, 'DUPLICATE_ROUTING_DOMAIN') : null) });
    await rules.select(A);
    assert.deepEqual(await rules.save({ domain: 'a.example.com', enabled: true }), { outcome: 'failed', message: 'This proxy server already has that domain.' });
  });

  test('a second submission while one is running sends nothing', async () => {
    const { rules, writes, holdWhen, held } = setup();
    await rules.select(A);
    holdWhen((_, method) => method === 'POST');
    const first = rules.save({ domain: 'a.example.com', enabled: true });
    await flush();
    assert.deepEqual(await rules.save({ domain: 'a.example.com', enabled: true }), { outcome: 'busy' });
    held[0]();
    assert.equal((await first).outcome, 'done');
    assert.equal(writes().length, 1);
  });
});

describe('enable and disable', () => {
  test('shows the change at once, sends only enabled, then shows the server\'s answer', async () => {
    const { rules, writes, renders, holdWhen, held } = setup({ domains: { [A.id]: [row('1', 'a.example.com')] } });
    await rules.select(A);
    holdWhen((_, method) => method === 'PATCH');
    const toggling = rules.toggle(rules.state.domains[0]);
    await flush();
    assert.deepEqual(renders.at(-1), ['a.example.com:false']);
    assert.equal(rules.state.pending.has('1'), true);

    held[0]();
    assert.deepEqual(await toggling, { outcome: 'done' }, 'no success message: the switch shows the result');
    assert.deepEqual(writes()[0].body, { enabled: false });
    assert.equal(rules.state.domains[0].enabled, false);
    assert.equal(rules.state.pending.size, 0);
  });

  test('enables a disabled row', async () => {
    const { rules } = setup({ domains: { [A.id]: [row('1', 'a.example.com', false)] } });
    await rules.select(A);
    assert.deepEqual(await rules.toggle(rules.state.domains[0]), { outcome: 'done' });
    assert.equal(rules.state.domains[0].enabled, true);
  });

  test('the server\'s answer wins over what was shown', async () => {
    const { rules } = setup({
      domains: { [A.id]: [row('1', 'a.example.com')] },
      respond: (_, method) => (method === 'PATCH' ? json(200, { domain: row('1', 'a.example.com', true) }) : null),
    });
    await rules.select(A);
    await rules.toggle(rules.state.domains[0]);
    assert.equal(rules.state.domains[0].enabled, true);
  });

  test('goes back if the request fails', async () => {
    const { rules, renders } = setup({
      domains: { [A.id]: [row('1', 'a.example.com')] },
      respond: (_, method) => (method === 'PATCH' ? failure(500, 'INTERNAL_SERVER_ERROR') : null),
    });
    await rules.select(A);
    const result = await rules.toggle(rules.state.domains[0]);
    assert.equal(result.outcome, 'failed');
    assert.ok(result.message, 'a failure is still explained');
    assert.equal(rules.state.domains[0].enabled, true);
    assert.equal(rules.state.pending.size, 0);
    assert.deepEqual(renders.at(-1), ['a.example.com:true']);
  });

  test('goes back when the session is lost', async () => {
    const { rules } = setup({
      domains: { [A.id]: [row('1', 'a.example.com')] },
      respond: (_, method) => (method === 'PATCH' ? failure(401, 'UNAUTHORIZED') : null),
    });
    await rules.select(A);
    assert.deepEqual(await rules.toggle(rules.state.domains[0]), { outcome: 'auth' });
    assert.equal(rules.state.domains[0].enabled, true);
  });

  test('a row removed elsewhere refreshes the list', async () => {
    let removed = false;
    const { rules } = setup({
      domains: { [A.id]: [row('1', 'a.example.com')] },
      respond: (_, method) => {
        if (method === 'PATCH') return failure(404, 'ROUTING_DOMAIN_NOT_FOUND');
        return removed ? json(200, { domains: [] }) : null;
      },
    });
    await rules.select(A);
    removed = true;
    const result = await rules.toggle(rules.state.domains[0]);
    assert.equal(result.message, 'This routing rule no longer exists.');
    assert.deepEqual(rules.state.domains, []);
  });

  test('a second toggle of the same row while one is running sends nothing', async () => {
    const { rules, writes, holdWhen, held } = setup({ domains: { [A.id]: [row('1', 'a.example.com')] } });
    await rules.select(A);
    holdWhen((_, method) => method === 'PATCH');
    const original = rules.state.domains[0];
    const first = rules.toggle(original);
    await flush();
    assert.deepEqual(await rules.toggle(original), { outcome: 'busy' });
    held[0]();
    await first;
    assert.equal(writes().length, 1);
  });

  test('a refresh during a toggle doesn\'t undo what is shown', async () => {
    const { rules, holdWhen, held } = setup({ domains: { [A.id]: [row('1', 'a.example.com')] } });
    await rules.select(A);
    holdWhen((_, method) => method === 'PATCH');
    const toggling = rules.toggle(rules.state.domains[0]);
    await flush();
    await rules.reload();
    assert.equal(rules.state.domains[0].enabled, false);
    held[0]();
    await toggling;
  });
});

describe('a refresh that fails after a change', () => {
  const failingRefresh = () => {
    let fail = false;
    const context = setup({
      domains: { [A.id]: [row('1', 'a.example.com')], [B.id]: [row('b1', 'b.example.com', true, B.id)] },
      respond: (url, method) => (fail && method === 'GET' && url.includes(A.id) ? failure(500, 'INTERNAL_SERVER_ERROR') : null),
    });
    return { ...context, startFailing: () => { fail = true; } };
  };
  const actions = {
    add: (rules) => rules.save({ domain: 'new.example.com', enabled: true }),
    toggle: (rules) => rules.toggle(rules.state.domains[0]),
    delete: (rules) => rules.remove(rules.state.domains[0]),
    copy: (rules) => rules.copyFrom(B),
  };

  for (const [name, act] of Object.entries(actions)) {
    test(`${name}: says the change was saved, and that the list may be out of date`, async () => {
      const { rules, startFailing } = failingRefresh();
      await rules.select(A);
      startFailing();
      const result = await act(rules);
      assert.equal(result.outcome, 'done', 'a saved change must not read as a failure, or the form would stay open');
      assert.equal(result.warning, true);
      assert.match(result.message, /was saved, but the list couldn't be refreshed/);
    });
  }

  test('a lost session during the refresh is reported', async () => {
    let lost = false;
    const { rules } = setup({ respond: (_, method) => (lost && method === 'GET' ? failure(401, 'UNAUTHORIZED') : null) });
    await rules.select(A);
    lost = true;
    assert.deepEqual(await rules.save({ domain: 'new.example.com', enabled: true }), { outcome: 'auth' });
  });

  test('switching servers during the refresh shows no message on the new server', async () => {
    const { rules, holdWhen, held } = setup({ domains: { [B.id]: [row('b1', 'b.example.com', true, B.id)] } });
    await rules.select(A);
    holdWhen((url, method) => method === 'GET' && url.includes(A.id));
    const saving = rules.save({ domain: 'new.example.com', enabled: true });
    await flush();
    holdWhen(() => false);
    await rules.select(B);
    held[0]();
    assert.deepEqual(await saving, { outcome: 'stale' });
    assert.deepEqual(rules.state.domains.map((domain) => domain.domain), ['b.example.com']);
  });
});

describe('keyboard focus on the Enabled switch', () => {
  const toggleSwitch = (domainId, disabled = false) => ({ dataset: { domainId }, disabled });

  test('only a click with no mouse behind it counts as the keyboard', () => {
    assert.equal(isKeyboardActivation({ detail: 0 }), true);
    assert.equal(isKeyboardActivation({ detail: 1 }), false);
    assert.equal(isKeyboardActivation({ detail: 2 }), false);
  });

  test('returns to the same domain\'s switch after a redraw', () => {
    const wanted = toggleSwitch('2');
    assert.equal(switchToRefocus({ switches: [toggleSwitch('1'), wanted, toggleSwitch('3')], domainId: '2', focusIsFree: true }), wanted);
  });

  test('does nothing if the domain has gone', () => {
    assert.equal(switchToRefocus({ switches: [toggleSwitch('1')], domainId: '2', focusIsFree: true }), null);
  });

  test('takes no focus for a mouse toggle, or when none is running', () => {
    assert.equal(switchToRefocus({ switches: [toggleSwitch('1')], domainId: null, focusIsFree: true }), null);
  });

  test('leaves focus alone if the user has moved on', () => {
    assert.equal(switchToRefocus({ switches: [toggleSwitch('1')], domainId: '1', focusIsFree: false }), null);
  });

  test('waits while the switch is still saving', () => {
    assert.equal(switchToRefocus({ switches: [toggleSwitch('1', true)], domainId: '1', focusIsFree: true }), null);
  });
});

describe('delete', () => {
  test('asks first, naming the domain and the server', async () => {
    const { rules, questions, writes } = setup({ domains: { [A.id]: [row('1', 'a.example.com')] } });
    await rules.select(A);
    assert.deepEqual(await rules.remove(rules.state.domains[0]), { outcome: 'done', message: '"a.example.com" was deleted.' });
    assert.equal(questions.length, 1);
    assert.match(questions[0].body, /a\.example\.com/);
    assert.match(questions[0].body, /Sweden/);
    assert.equal(questions[0].danger, true);
    assert.equal(writes()[0].method, 'DELETE');
    assert.deepEqual(rules.state.domains, []);
  });

  test('sends nothing if cancelled', async () => {
    const { rules, writes, answer } = setup({ domains: { [A.id]: [row('1', 'a.example.com')] } });
    await rules.select(A);
    answer(false);
    assert.deepEqual(await rules.remove(rules.state.domains[0]), { outcome: 'cancelled' });
    assert.deepEqual(writes(), []);
    assert.equal(rules.state.domains.length, 1);
  });

  test('a failure keeps the row and says why', async () => {
    const { rules } = setup({
      domains: { [A.id]: [row('1', 'a.example.com')] },
      respond: (_, method) => (method === 'DELETE' ? failure(500, 'INTERNAL_SERVER_ERROR') : null),
    });
    await rules.select(A);
    assert.equal((await rules.remove(rules.state.domains[0])).outcome, 'failed');
    assert.equal(rules.state.domains.length, 1);
    assert.equal(rules.state.pending.size, 0);
  });
});

describe('copy from server', () => {
  const copyable = () => ({ domains: {
    [A.id]: [row('1', 'old.example.com'), row('2', 'old2.example.com')],
    [B.id]: [row('b1', 'a.example.com', true, B.id), row('b2', 'b.example.com', false, B.id), row('b3', 'c.example.com', true, B.id)],
  } });

  test('offers every server but the selected one, including disabled servers', async () => {
    const { rules } = setup();
    await rules.select(A);
    assert.deepEqual(await rules.copySources(), { outcome: 'ready', servers: [B] });
    await rules.select(B);
    assert.deepEqual(await rules.copySources(), { outcome: 'ready', servers: [A] });
  });

  test('a failed server list is reported', async () => {
    let fail = false;
    const { rules } = setup({ respond: (url) => (fail && url === '/api/v1/admin/proxy-servers' ? failure(500, 'X') : null) });
    await rules.select(A);
    fail = true;
    assert.equal((await rules.copySources()).outcome, 'failed');
  });

  test('confirms with both names, the count including disabled rules, and the replacement', async () => {
    const { rules, questions } = setup(copyable());
    await rules.select(A);
    await rules.copyFrom(B);
    const { body, danger } = questions[0];
    assert.match(body, /Norway/);
    assert.match(body, /Sweden/);
    assert.match(body, /3 rules/);
    assert.match(body, /including 1 disabled/);
    assert.match(body, /All 2 existing rules on "Sweden" will be replaced/);
    assert.equal(danger, true);
  });

  test('copies after confirmation and shows the refreshed destination', async () => {
    const { rules, writes, stored } = setup(copyable());
    await rules.select(A);
    const before = JSON.stringify(stored[B.id]);
    const result = await rules.copyFrom(B);
    assert.deepEqual(result, { outcome: 'done', message: '3 rules copied from "Norway" to "Sweden".' });
    assert.deepEqual(writes().map((write) => [write.method, write.url, write.body]), [
      ['POST', `/api/v1/admin/proxy-servers/${A.id}/domains/copy`, { sourceServerId: B.id }],
    ]);
    assert.deepEqual(rules.state.domains.map((domain) => [domain.domain, domain.enabled]), [['a.example.com', true], ['b.example.com', false], ['c.example.com', true]]);
    assert.equal(JSON.stringify(stored[B.id]), before, 'the source is unchanged');
  });

  test('sends nothing if cancelled', async () => {
    const { rules, writes, answer } = setup(copyable());
    await rules.select(A);
    answer(false);
    assert.deepEqual(await rules.copyFrom(B), { outcome: 'cancelled' });
    assert.deepEqual(writes(), []);
    assert.equal(rules.state.domains.length, 2);
  });

  test('warns that an empty source leaves the destination empty', async () => {
    const { rules, questions } = setup({ domains: { [A.id]: [row('1', 'old.example.com')] } });
    await rules.select(A);
    const result = await rules.copyFrom(B);
    assert.match(questions[0].body, /"Norway" has no routing rules/);
    assert.match(questions[0].body, /leave "Sweden" empty/);
    assert.match(questions[0].confirm, /Empty/);
    assert.equal(result.message, '0 rules copied from "Norway" to "Sweden".');
    assert.deepEqual(rules.state.domains, []);
  });

  test('says when the destination has nothing to replace', async () => {
    const { rules, questions } = setup({ domains: { [B.id]: [row('b1', 'a.example.com', true, B.id)] } });
    await rules.select(A);
    await rules.copyFrom(B);
    assert.match(questions[0].body, /"Sweden" has no rules now/);
    assert.match(questions[0].body, /1 rule from/);
  });

  test('a failure keeps the destination\'s rows and can be tried again', async () => {
    let fail = true;
    const { rules } = setup({ ...copyable(), respond: (url) => (fail && url.endsWith('/copy') ? failure(500, 'INTERNAL_SERVER_ERROR') : null) });
    await rules.select(A);
    assert.equal((await rules.copyFrom(B)).outcome, 'failed');
    assert.deepEqual(rules.state.domains.map((domain) => domain.domain), ['old.example.com', 'old2.example.com']);
    fail = false;
    assert.equal((await rules.copyFrom(B)).outcome, 'done');
  });

  test('a source that can\'t be read asks nothing and copies nothing', async () => {
    const { rules, questions, writes } = setup({ ...copyable(), respond: (url) => (url.includes(`/${B.id}/domains`) ? failure(500, 'X') : null) });
    await rules.select(A);
    assert.equal((await rules.copyFrom(B)).outcome, 'failed');
    assert.deepEqual(questions, []);
    assert.deepEqual(writes(), []);
  });

  test('a second copy while one is running sends nothing', async () => {
    const { rules, writes, holdWhen, held } = setup(copyable());
    await rules.select(A);
    holdWhen((url) => url.endsWith('/copy'));
    const first = rules.copyFrom(B);
    await flush();
    await flush();
    assert.deepEqual(await rules.copyFrom(B), { outcome: 'busy' });
    held[0]();
    await first;
    assert.equal(writes().length, 1);
  });
});

describe('PAC preview', () => {
  test('fetches the selected server\'s script, every time', async () => {
    const { rules, calls } = setup();
    await rules.select(A);
    const preview = await rules.preview();
    assert.equal(preview.outcome, 'done');
    assert.match(preview.pac, /^function FindProxyForURL/);
    assert.match(preview.pac, /server-a/);
    await rules.preview();
    assert.equal(calls.filter((call) => call.url.endsWith('/pac/preview')).length, 2);
  });

  test('explains a server with an invalid endpoint', async () => {
    const { rules } = setup({ respond: (url) => (url.endsWith('/pac/preview') ? failure(409, 'PROXY_SERVER_INVALID') : null) });
    await rules.select(A);
    const result = await rules.preview();
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /host or port/);
  });

  test('a malformed answer is an error', async () => {
    const { rules } = setup({ respond: (url) => (url.endsWith('/pac/preview') ? json(200, { pac: 1 }) : null) });
    await rules.select(A);
    assert.equal((await rules.preview()).outcome, 'failed');
  });

  test('a lost session is reported', async () => {
    const { rules } = setup({ respond: (url) => (url.endsWith('/pac/preview') ? failure(401, 'UNAUTHORIZED') : null) });
    await rules.select(A);
    assert.deepEqual(await rules.preview(), { outcome: 'auth' });
  });

  test('the notices say what was asked', () => {
    assert.equal(PREVIEW_NOTICE_TITLE, 'Preview Only');
    assert.equal(PREVIEW_NOTICE, 'This PAC script is not active. Clients keep using the fixed PAC rules until PAC routing is enabled in a future deployment stage.');
    assert.match(PREVIEW_SQUID_NOTE, /Squid/);
  });
});

describe('switching servers', () => {
  const both = () => ({ domains: { [A.id]: [row('1', 'a.example.com')], [B.id]: [row('2', 'b.example.com', true, B.id)] } });
  const names = (rules) => rules.state.domains.map((domain) => domain.domain);

  test('the previous rows disappear straight away', async () => {
    const { rules, holdWhen, held } = setup(both());
    await rules.select(A);
    holdWhen((url) => url.includes(B.id));
    const loading = rules.select(B);
    assert.deepEqual(rules.state.domains, []);
    assert.equal(rules.state.status, 'loading');
    await flush();
    held[0]();
    await loading;
    assert.deepEqual(names(rules), ['b.example.com']);
  });

  test('a late list answer for the previous server is dropped', async () => {
    const { rules, holdWhen, held } = setup(both());
    holdWhen((url) => url.includes(A.id));
    const first = rules.select(A);
    await flush();
    holdWhen(() => false);
    await rules.select(B);
    held[0]();
    assert.deepEqual(await first, { outcome: 'stale' });
    assert.deepEqual(names(rules), ['b.example.com']);
    assert.equal(rules.state.server, B);
  });

  test('a late toggle answer touches nothing on the new server', async () => {
    const { rules, holdWhen, held } = setup(both());
    await rules.select(A);
    holdWhen((_, method) => method === 'PATCH');
    const toggling = rules.toggle(rules.state.domains[0]);
    await flush();
    holdWhen(() => false);
    await rules.select(B);
    held[0]();
    assert.deepEqual(await toggling, { outcome: 'stale' });
    assert.deepEqual(names(rules), ['b.example.com']);
    assert.equal(rules.state.pending.size, 0);
  });

  test('a late save, delete or copy answer touches nothing on the new server, and it can be used at once', async () => {
    for (const start of [
      (rules) => rules.save({ domain: 'late.example.com', enabled: true }),
      (rules) => rules.remove(rules.state.domains[0]),
      (rules) => rules.copyFrom(B),
    ]) {
      const { rules, holdWhen, held } = setup(both());
      await rules.select(A);
      holdWhen((_, method) => method !== 'GET');
      const running = start(rules);
      await flush();
      await flush();
      await flush();
      holdWhen(() => false);
      await rules.select(B);
      assert.equal((await rules.save({ domain: 'new.example.com', enabled: true })).outcome, 'done');
      held[0]();
      assert.equal((await running).outcome, 'stale');
      assert.deepEqual(names(rules), ['b.example.com', 'new.example.com']);
    }
  });

  test('a late preview answer is dropped', async () => {
    const { rules, holdWhen, held } = setup(both());
    await rules.select(A);
    holdWhen((url) => url.endsWith('/pac/preview'));
    const previewing = rules.preview();
    await flush();
    holdWhen(() => false);
    await rules.select(B);
    held[0]();
    assert.deepEqual(await previewing, { outcome: 'stale' });
  });

  test('confirming after the selection has changed sends nothing', async () => {
    const { rules, writes } = setup(both());
    await rules.select(A);
    const running = rules.remove(rules.state.domains[0]);
    rules.clear();
    assert.deepEqual(await running, { outcome: 'stale' });
    assert.deepEqual(writes(), []);
  });

  test('a rename updates the name without reloading, and only for the selected server', async () => {
    const { rules, calls } = setup(both());
    await rules.select(A);
    const requests = calls.length;
    rules.updateServer({ ...B, name: 'Other' });
    assert.equal(rules.state.server.name, 'Sweden');
    rules.updateServer({ ...A, name: 'Sverige' });
    assert.equal(rules.state.server.name, 'Sverige');
    assert.equal(calls.length, requests);
  });

  test('clearing removes everything', async () => {
    const { rules } = setup(both());
    await rules.select(A);
    rules.clear();
    assert.equal(rules.state.server, null);
    assert.deepEqual(rules.state.domains, []);
  });
});

describe('the page', () => {
  const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const panel = read('pages/routing-rules.js');
  const servers = read('pages/proxy-servers.js');

  test('offers every action', () => {
    for (const label of ['Add Domain', 'Copy From Server', 'View PAC Preview', 'Edit', 'Delete', 'Copy to Clipboard', 'No routing rules for this server.']) {
      assert.ok(panel.includes(label), label);
    }
    assert.ok(panel.includes('role="switch"'));
    assert.ok(panel.includes('<th scope="col">Domain</th>'));
    assert.ok(panel.includes('<th scope="col">Enabled</th>'));
  });

  test('shows server data only as text', () => {
    assert.equal(/innerHTML/.test(panel), false);
    assert.ok(panel.includes(".textContent = result.pac"));
  });

  test('gives focus back only for keyboard toggles, and clears old alerts when toggling', () => {
    assert.ok(panel.includes('if (isKeyboardActivation(event)) keyboardToggle = domain.id;'));
    assert.ok(panel.includes('switchToRefocus('));
    assert.ok(panel.includes(`if (keyboardToggle === domain.id) keyboardToggle = null;`));
  });

  test('shows the preview notices and doesn\'t offer to activate anything', () => {
    assert.ok(panel.includes('PREVIEW_NOTICE_TITLE'));
    assert.ok(panel.includes('PREVIEW_NOTICE)'));
    assert.ok(panel.includes('PREVIEW_SQUID_NOTE'));
    assert.equal(/activate|deploy/i.test(panel.replaceAll('PREVIEW_NOTICE', '')), false);
  });

  test('the Proxy Servers page opens it, and keeps its existing actions', () => {
    assert.ok(servers.includes('createRoutingPanel'));
    assert.ok(servers.includes('data-routing'));
    for (const label of ['Add Proxy Server', 'data-edit', 'data-toggle', 'data-delete']) assert.ok(servers.includes(label), label);
  });

  test('only the administrator layout reaches it', () => {
    const shell = read('pages/admin-shell.js');
    const main = read('main.js');
    assert.ok(shell.includes("from './proxy-servers.js'"));
    assert.equal(main.includes('proxy-servers'), false);
    assert.equal(main.includes('routing-rules'), false);
    assert.equal(read('pages/account.js').includes('routing'), false);
    assert.ok(/view === 'admin'|case 'admin'/.test(main));
  });

  test('talks only to HoppLink Server, through the API client', () => {
    for (const source of [panel, read('routing-rules.js')]) {
      assert.equal(/\bfetch\(/.test(source), false);
      assert.equal(/https?:\/\/(?!www\.w3)/.test(source.replace('http:// or https://', '')), false);
    }
  });
});

describe('synchronization', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const syncState = (overrides = {}) => ({
    proxyServerId: A.id,
    status: 'synced',
    enabledDomainCount: 1,
    desiredDigest: digest,
    appliedGeneration: 3,
    appliedDigest: digest,
    firstSyncCompleted: true,
    lastSuccessAt: '2026-11-01T00:00:00.000Z',
    lastAttemptAt: '2026-11-01T00:00:00.000Z',
    lastError: null,
    node: { reachable: true, error: null, desired: { generation: 3, digest, domainCount: 1 }, applied: { generation: 3, digest, domainCount: 1 }, allowlistVerified: true, pending: false },
    ...overrides,
  });
  const IS_SYNC = /\/domains\/sync$/;
  const IS_STATUS = /\/domains\/sync\/status$/;

  /** Rules with a selected server, a fake server for the sync routes, and a record of the questions asked. */
  async function prepared({ domains = [row('r1', 'a.example.com')], answer = () => true, onSync, onStatus } = {}) {
    const questions = [];
    const requests = [];
    let holdSync = null;
    const fetchImpl = async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      requests.push({ url, method: init.method, body, signal: init.signal });
      if (IS_STATUS.test(url)) return onStatus ? onStatus(url) : json(200, syncState());
      if (IS_SYNC.test(url)) {
        if (holdSync) await holdSync;
        return onSync ? onSync(body, url) : json(200, { ...syncState(), changed: true });
      }
      if (url.endsWith('/domains')) return json(200, { domains: url.includes(B.id) ? [] : domains });
      return json(404, {});
    };
    const rules = createRoutingRules({
      api: createApi({ fetch: fetchImpl }),
      confirm: async (question) => {
        questions.push(question);
        return answer(question);
      },
    });
    await rules.select(A);
    return { rules, questions, requests, hold: (promise) => { holdSync = promise; } };
  }
  const syncCalls = (requests) => requests.filter((request) => IS_SYNC.test(request.url));

  test('the status and sync requests go to the selected server', async () => {
    const { rules, requests } = await prepared();
    await rules.checkSync();
    assert.equal(rules.state.sync.status, 'synced');
    const result = await rules.syncNow();
    assert.equal(result.outcome, 'done');
    assert.ok(requests.some((request) => request.url === `/api/v1/admin/proxy-servers/${A.id}/domains/sync/status`));
    const [call] = syncCalls(requests);
    assert.equal(call.url, `/api/v1/admin/proxy-servers/${A.id}/domains/sync`);
    assert.equal(call.method, 'POST');
    assert.deepEqual(call.body, {});
  });

  test('it asks first, counting only enabled rules, and cancelling sends nothing', async () => {
    const { rules, questions, requests } = await prepared({ domains: [row('r1', 'a.example.com'), row('r2', 'b.example.com'), row('r3', 'c.example.com', false)], answer: () => false });
    assert.equal((await rules.syncNow()).outcome, 'cancelled');
    assert.equal(syncCalls(requests).length, 0);
    assert.match(questions[0].body, /2 enabled rules/);
    assert.match(questions[0].body, /Sweden/);
    assert.match(questions[0].body, /PAC routing doesn't change/);
    assert.equal(questions[0].danger, false);
  });

  test('an empty list gets the deny-all warning, and only then the confirmation is sent', async () => {
    const { rules, questions, requests } = await prepared({ domains: [row('r1', 'a.example.com', false)] });
    assert.equal((await rules.syncNow()).outcome, 'done');
    assert.equal(questions[0].title, 'Deny all destinations?');
    assert.equal(questions[0].danger, true);
    assert.match(questions[0].body, /refuse every destination/);
    assert.deepEqual(syncCalls(requests)[0].body, { confirmEmpty: true });
  });

  test('cancelling the deny-all warning sends nothing', async () => {
    const { rules, requests } = await prepared({ domains: [], answer: () => false });
    assert.equal((await rules.syncNow()).outcome, 'cancelled');
    assert.equal(syncCalls(requests).length, 0);
  });

  test('rules that became empty on the server get the deny-all warning before being sent', async () => {
    const { rules, questions, requests } = await prepared({
      onSync: (body) => (body.confirmEmpty ? json(200, { ...syncState(), changed: true }) : failure(409, 'EMPTY_CONFIRMATION_REQUIRED', 'Confirm')),
    });
    assert.equal((await rules.syncNow()).outcome, 'done');
    assert.deepEqual(questions.map((question) => question.title), ['Sync to Squid?', 'Deny all destinations?']);
    assert.deepEqual(syncCalls(requests).map((request) => request.body), [{}, { confirmEmpty: true }]);
  });

  test('refusing that warning stops, and the page isn\'t left busy', async () => {
    let asked = 0;
    const { rules, requests } = await prepared({
      answer: () => { asked += 1; return asked === 1; },
      onSync: () => failure(409, 'EMPTY_CONFIRMATION_REQUIRED', 'Confirm'),
    });
    assert.equal((await rules.syncNow()).outcome, 'cancelled');
    assert.equal(syncCalls(requests).length, 1);
    assert.equal(rules.state.syncing, false);
  });

  test('a second press while one is running does nothing', async () => {
    const { rules, requests, hold } = await prepared();
    let release;
    hold(new Promise((resolve) => { release = resolve; }));
    const first = rules.syncNow();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    assert.equal(rules.state.syncing, true);
    assert.equal((await rules.syncNow()).outcome, 'busy');
    release();
    assert.equal((await first).outcome, 'done');
    assert.equal(rules.state.syncing, false);
    assert.equal(syncCalls(requests).length, 1);
  });

  test('a success shows the state the server returned', async () => {
    const { rules } = await prepared();
    const result = await rules.syncNow();
    assert.match(result.message, /Sweden/);
    assert.equal(result.warning, undefined);
    assert.equal(rules.state.sync.status, 'synced');
  });

  test('rules changed during the synchronization are a warning, not a success', async () => {
    const { rules } = await prepared({ onSync: () => json(200, { ...syncState({ status: 'pending' }), changed: true }) });
    const result = await rules.syncNow();
    assert.equal(result.outcome, 'done');
    assert.equal(result.warning, true);
    assert.equal(rules.state.sync.status, 'pending');
  });

  test('a node failure shows the server\'s message, and the status is read again', async () => {
    const { rules, requests } = await prepared({
      onSync: () => failure(424, 'NODE_SYNC_FAILED', 'Synchronization failed: Squid is not running on the node.'),
      onStatus: () => json(200, syncState({ status: 'failed', lastError: 'Synchronization failed: Squid is not running on the node.' })),
    });
    const result = await rules.syncNow();
    assert.deepEqual(result, { outcome: 'failed', message: 'Synchronization failed: Squid is not running on the node.' });
    assert.equal(rules.state.sync.status, 'failed');
    assert.ok(requests.some((request) => IS_STATUS.test(request.url)));
    assert.equal(rules.state.syncing, false);
  });

  test('no answer never claims failure or success, and the status is read again', async () => {
    const { rules } = await prepared({ onSync: () => { throw new TypeError('network'); } });
    const result = await rules.syncNow();
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /may still have finished/);
    assert.equal(rules.state.sync.status, 'synced', 'whatever the node reports');
  });

  test('a gateway error during a synchronization is treated as no answer', async () => {
    const { rules } = await prepared({ onSync: () => json(504) });
    assert.match((await rules.syncNow()).message, /may still have finished/);
  });

  test('losing the session is reported as that', async () => {
    const { rules } = await prepared({ onSync: () => failure(401, 'UNAUTHORIZED') });
    assert.equal((await rules.syncNow()).outcome, 'auth');
    assert.equal(rules.state.syncing, false);
  });

  test('a failed status check keeps what was shown and says why', async () => {
    let healthy = true;
    const { rules } = await prepared({ onStatus: () => (healthy ? json(200, syncState()) : failure(404, 'PROXY_SERVER_NOT_FOUND')) });
    await rules.checkSync();
    healthy = false;
    const result = await rules.checkSync();
    assert.equal(result.outcome, 'failed');
    assert.equal(rules.state.sync.status, 'synced');
    assert.equal(rules.state.syncError, 'This proxy server no longer exists.');
    assert.equal(rules.state.syncChecking, false);
  });

  test('an answer for another server is dropped', async () => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const { rules } = await prepared({
      onStatus: async (url) => {
        if (url.includes(A.id)) {
          await held;
          return json(200, syncState());
        }
        return json(200, syncState({ proxyServerId: B.id, status: 'pending' }));
      },
    });
    const old = rules.checkSync();
    await rules.select(B);
    await rules.checkSync();
    release();
    assert.equal((await old).outcome, 'stale');
    assert.equal(rules.state.sync.proxyServerId, B.id);
  });

  test('selecting another server clears the status straight away', async () => {
    const { rules } = await prepared();
    await rules.checkSync();
    await rules.select(B);
    assert.equal(rules.state.sync, null);
  });

  test('a sync finishing after the selection changed is dropped', async () => {
    const { rules, hold } = await prepared();
    let release;
    hold(new Promise((resolve) => { release = resolve; }));
    const first = rules.syncNow();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    await rules.select(B);
    release();
    assert.equal((await first).outcome, 'stale');
    assert.equal(rules.state.syncing, false);
    assert.equal(rules.state.sync, null);
  });

  test('it can\'t start before the rules have loaded', async () => {
    const rules = createRoutingRules({ api: createApi({ fetch: async () => json(500) }), confirm: async () => true });
    await rules.select(A);
    assert.equal((await rules.syncNow()).outcome, 'busy');
  });

  describe('describeSync', () => {
    test('Synced', () => {
      const view = describeSync(syncState());
      assert.equal(view.label, 'Synced');
      assert.equal(view.tone, 'success');
      assert.match(view.detail, /generation 3/);
      assert.equal(view.warning, null);
    });

    test('Pending, never synchronized', () => {
      const view = describeSync(syncState({ status: 'pending', lastSuccessAt: null, appliedGeneration: null, firstSyncCompleted: false }));
      assert.equal(view.label, 'Pending');
      assert.equal(view.tone, 'warning');
      assert.match(view.detail, /Never synchronized/);
    });

    test('Failed, with the reason', () => {
      const view = describeSync(syncState({ status: 'failed', lastError: 'Synchronization failed: no reload.' }));
      assert.equal(view.label, 'Failed');
      assert.equal(view.tone, 'danger');
      assert.equal(view.warning, 'Synchronization failed: no reload.');
    });

    test('an unreachable node says so, and keeps the failure', () => {
      const node = { reachable: false, error: 'The node\'s state couldn\'t be checked.', desired: null, applied: null, allowlistVerified: null, pending: null };
      assert.equal(describeSync(syncState({ status: 'pending', node })).warning, node.error);
      assert.match(describeSync(syncState({ status: 'failed', lastError: 'Earlier failure.', node })).warning, /Earlier failure\..*couldn't be checked/);
    });

    test('a changed allowlist on the node is pointed out', () => {
      const node = { ...syncState().node, allowlistVerified: false, pending: true };
      assert.match(describeSync(syncState({ status: 'pending', node })).warning, /edited by hand/);
    });

    test('anything unexpected is never shown as Synced', () => {
      for (const value of [null, {}, { status: 'applied' }, { status: 'constructor' }]) {
        const view = describeSync(value);
        assert.equal(view.label, 'Unknown', JSON.stringify(value));
        assert.equal(view.tone, 'secondary');
      }
    });
  });

  test('the panel has the controls, and renders server text safely', () => {
    const panel = readFileSync(new URL('../src/pages/routing-rules.js', import.meta.url), 'utf8');
    for (const marker of ['data-sync-badge', 'data-sync-now', 'data-sync-check', 'data-sync-warning', 'rules.syncNow()', 'rules.checkSync()']) {
      assert.ok(panel.includes(marker), marker);
    }
    assert.ok(panel.includes('warning.textContent = message'));
    assert.ok(!/data-sync-[a-z]+[^\n]*innerHTML/.test(panel));
  });
});
