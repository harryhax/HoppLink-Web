// Tests for public registration: the API calls, the admin control and the registration screen's logic.
// Uses a fake fetch (no browser, no server). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { createApi, describeError } from '../src/api.js';
import { createAuth } from '../src/auth.js';
import { checkRegistration, createRegistrationSetting, REGISTRATION_UNAVAILABLE, validateRegistrationForm } from '../src/registration.js';
import { parseRoute } from '../src/router.js';

const json = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SETTING = '/api/v1/admin/settings/public-registration';
const FORM = { name: 'New User', email: 'new@example.test', password: 'a-long-password' };

function setup(respond) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, credentials: init.credentials });
    return respond(url, init);
  };
  return { api: createApi({ fetch }), calls };
}
const refused = () => { throw new TypeError('fetch failed'); };

/** A control whose responses come from a list, recording every published state. */
function control(...responses) {
  const { api, calls } = setup(() => {
    const next = responses.shift();
    return typeof next === 'function' ? next() : next;
  });
  const states = [];
  return { setting: createRegistrationSetting(api, (state) => states.push(state)), states, calls, last: () => states.at(-1) };
}
const value = (publicRegistrationEnabled) => json(200, { publicRegistrationEnabled });

describe('API client', () => {
  test('uses relative URLs and the documented endpoints', async () => {
    const { api, calls } = setup(() => json(200, {}));
    await api.registrationAvailability();
    await api.getRegistrationSetting();
    await api.setRegistrationSetting(true);
    await api.signUp(FORM);
    assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
      ['GET', '/api/v1/registration', undefined],
      ['GET', SETTING, undefined],
      ['PUT', SETTING, { publicRegistrationEnabled: true }],
      ['POST', '/api/v1/auth/sign-up/email', FORM],
    ]);
    assert.ok(calls.every((c) => c.credentials === 'same-origin'));
  });

  test('sign-up sends only the name, email and password', async () => {
    const { api, calls } = setup(() => json(200, {}));
    await api.signUp({ ...FORM, role: 'admin', extra: 1 });
    assert.deepEqual(calls[0].body, FORM);
  });
});

describe('administrator control: loading', () => {
  test('shows the value from the server', async () => {
    for (const enabled of [true, false]) {
      const { setting, last, calls } = control(value(enabled));
      assert.equal(await setting.load(), 'done');
      assert.equal(last().enabled, enabled);
      assert.equal(last().loading, false);
      assert.equal(calls[0].url, SETTING);
    }
  });

  test('reports loading first, and has no value until the server answers', async () => {
    const { setting, states } = control(value(true));
    await setting.load();
    assert.deepEqual([states[0].loading, states[0].enabled], [true, null]);
  });

  test('a failed load shows an error and no value', async () => {
    for (const response of [refused, json(500), json(200, {}), json(200, { publicRegistrationEnabled: 'true' })]) {
      const { setting, last } = control(response);
      assert.equal(await setting.load(), 'failed');
      assert.equal(last().enabled, null);
      assert.equal(last().tone, 'danger');
      assert.match(last().message, /Could not load/);
    }
  });

  test('a refused session is reported as auth loss', async () => {
    for (const response of [json(401, { error: { code: 'UNAUTHORIZED' } }), json(403, { error: { code: 'FORBIDDEN' } })]) {
      assert.equal(await control(response).setting.load(), 'auth');
    }
  });

  test('nothing can be saved before a value has loaded', async () => {
    const { setting, calls } = control();
    assert.equal(await setting.save(true), 'ignored');
    assert.equal(calls.length, 0);
  });
});

describe('administrator control: saving', () => {
  test('confirms success from the server response', async () => {
    const { setting, last, calls } = control(value(false), value(true));
    await setting.load();
    assert.equal(await setting.save(true), 'done');
    assert.deepEqual(calls[1].body, { publicRegistrationEnabled: true });
    assert.equal(last().enabled, true);
    assert.equal(last().tone, 'success');
    assert.match(last().message, /now enabled/);
  });

  test('shows what the server stored, even if it differs from the request', async () => {
    const { setting, last } = control(value(false), value(false));
    await setting.load();
    await setting.save(true);
    assert.equal(last().enabled, false);
    assert.match(last().message, /now disabled/);
  });

  test('does not show the change until the server confirms it, and is busy meanwhile', async () => {
    let answer;
    const { setting, states, last } = control(value(false), () => new Promise((resolve) => { answer = resolve; }));
    await setting.load();
    const saving = setting.save(true);
    assert.equal(last().saving, true);
    assert.equal(last().enabled, false);
    assert.equal(await setting.save(true), 'ignored');
    assert.equal(await setting.load(), 'ignored');
    answer(value(true));
    await saving;
    assert.equal(last().saving, false);
    assert.ok(states.filter((s) => s.saving).every((s) => s.enabled === false));
  });

  test('a failed save keeps the last confirmed state and says so', async () => {
    const failures = [refused, json(500), json(403, { error: { code: 'INVALID_ORIGIN' } }), json(200, {})];
    for (const failure of failures) {
      const { setting, last } = control(value(true), failure);
      await setting.load();
      assert.equal(await setting.save(false), 'failed');
      assert.equal(last().enabled, true);
      assert.equal(last().saving, false);
      assert.equal(last().tone, 'danger');
      assert.match(last().message, /last confirmed state is enabled/);
    }
  });

  test('can be retried after a failure', async () => {
    const { setting, last } = control(value(false), refused, value(true));
    await setting.load();
    await setting.save(true);
    assert.equal(await setting.save(true), 'done');
    assert.equal(last().enabled, true);
  });

  test('a save refused for a lost session keeps the state and reports auth', async () => {
    const { setting, last } = control(value(false), json(401, { error: { code: 'UNAUTHORIZED' } }));
    await setting.load();
    assert.equal(await setting.save(true), 'auth');
    assert.equal(last().enabled, false);
  });

  test('saving the current value sends nothing', async () => {
    const { setting, calls } = control(value(true));
    await setting.load();
    assert.equal(await setting.save(true), 'ignored');
    assert.equal(calls.length, 1);
  });
});

describe('registration screen', () => {
  const check = (response) => checkRegistration(setup(typeof response === 'function' ? response : () => response).api);

  test('shows the form only when the server says registration is open', async () => {
    assert.deepEqual(await check(json(200, { enabled: true })), { screen: 'form' });
    assert.deepEqual(await check(json(200, { enabled: false })), { screen: 'unavailable', message: REGISTRATION_UNAVAILABLE });
  });

  test('an unavailable message keeps sign-in in view', () => {
    assert.match(REGISTRATION_UNAVAILABLE, /currently unavailable/);
    assert.match(REGISTRATION_UNAVAILABLE, /sign in/);
  });

  test('never shows the form if availability is unknown', async () => {
    for (const response of [refused, json(500), json(200, {}), json(200, { enabled: 'true' })]) {
      assert.equal((await check(response)).screen, 'error');
    }
  });
});

describe('registration form checks', () => {
  test('returns exactly the fields to send, trimmed except for the password', () => {
    const { error, values } = validateRegistrationForm({ name: ' New User ', email: ' new@example.test ', password: ' spaced password ', role: 'admin' });
    assert.equal(error, null);
    assert.deepEqual(values, { name: 'New User', email: 'new@example.test', password: ' spaced password ' });
  });

  test('rejects obvious mistakes', () => {
    for (const [changes, pattern] of [
      [{ name: '  ' }, /name/],
      [{ email: 'nope' }, /email/],
      [{ email: '' }, /email/],
      [{ password: 'short' }, /8-128/],
      [{ password: 'x'.repeat(129) }, /8-128/],
    ]) {
      const { error, values } = validateRegistrationForm({ ...FORM, ...changes });
      assert.match(error, pattern);
      assert.equal(values, null);
    }
  });
});

describe('signing up', () => {
  const USER = { id: 'u1', email: FORM.email, name: FORM.name, role: 'USER', status: 'ACTIVE' };
  const signUp = (signUpResponse, routes = {}) => {
    const { api, calls } = setup((url) => {
      if (url === '/api/v1/auth/sign-up/email') return typeof signUpResponse === 'function' ? signUpResponse() : signUpResponse;
      if (routes[url]) return routes[url];
      return json(404);
    });
    return { result: createAuth(api).signUp(FORM), calls };
  };

  test('success shows the account returned by the server', async () => {
    const { result } = signUp(json(200, { user: { id: 'u1' } }), { '/api/v1/account/me': json(200, { user: USER }) });
    assert.deepEqual(await result, { view: 'user', user: USER });
  });

  test('a refusal from the server switches to the unavailable message', async () => {
    const { result } = signUp(json(403, { code: 'REGISTRATION_DISABLED', message: 'Public registration is disabled.' }));
    assert.deepEqual(await result, { refused: { screen: 'unavailable', message: REGISTRATION_UNAVAILABLE } });
  });

  test('other refusals stay on the form with a readable message', async () => {
    for (const [response, pattern] of [
      [json(422, { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' }), /already exists/],
      [json(400, { code: 'PASSWORD_TOO_SHORT' }), /8-128/],
      [json(400, { code: 'INVALID_EMAIL' }), /valid email/],
      [json(429), /Too many attempts/],
    ]) {
      const { result } = signUp(response);
      const { refused: outcome } = await result;
      assert.equal(outcome.screen, undefined);
      assert.match(outcome.message, pattern);
    }
  });

  test('an unreachable server shows the connection error', async () => {
    assert.equal((await signUp(refused).result).view, 'offline');
  });

  test('sign-in does not depend on registration availability', async () => {
    const { api, calls } = setup((url) => {
      if (url === '/api/v1/auth/sign-in/email') return json(200, {});
      if (url === '/api/v1/account/me') return json(200, { user: USER });
      return json(500);
    });
    assert.equal((await createAuth(api).signIn(FORM.email, FORM.password)).view, 'user');
    assert.ok(calls.every((c) => c.url !== '/api/v1/registration'));
  });

  test('describes refusals without exposing a code', () => {
    assert.doesNotMatch(describeError({ kind: 'http', status: 422, code: 'USER_ALREADY_EXISTS' }), /USER_ALREADY/);
  });
});

describe('pages and routes', () => {
  const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

  test('#settings is an admin route', () => {
    assert.deepEqual(parseRoute('#settings'), { name: 'settings' });
    assert.match(source('pages/admin-shell.js'), /href: '#settings'/);
    assert.match(source('pages/admin-shell.js'), /renderSettings\(context\)/);
  });

  test('the settings switch returns to the confirmed value until the server answers', () => {
    const page = source('pages/settings.js');
    assert.match(page, /toggle\.checked = confirmed === true;\n\s+run\(\(\) => setting\.save\(wanted\)\)/);
    assert.match(page, /toggle\.disabled = working \|\| state\.enabled === null/);
  });

  test('the registration form starts hidden, has no role field, and sign-in stays reachable', () => {
    const page = source('pages/register.js');
    assert.match(page, /<form novalidate hidden>/);
    assert.match(page, /form\.hidden = screen !== 'form'/);
    assert.doesNotMatch(page, /role"|name="role|admin/i);
    assert.match(page, /data-back>Back to sign in/);
    assert.match(source('pages/login.js'), /data-create-account/);
  });

  test('the new code talks only to relative API URLs', () => {
    assert.doesNotMatch(source('registration.js') + source('pages/register.js') + source('pages/settings.js'), /https?:\/\/|fetch\(/);
  });
});
