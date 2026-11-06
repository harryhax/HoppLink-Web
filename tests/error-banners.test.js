// Tests for the pages' error banners (the red alert with a warning icon and Retry): shown only with something to say,
// never blank for a real failure. Uses small stand-ins for the banner's elements and a fake fetch (no browser, no
// server); the pages themselves are checked statically. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { createApi, describeError, FALLBACK_ERROR, meaningfulMessage } from '../src/api.js';
import { setErrorBanner, showAlert } from '../src/dom.js';
import { createStatsLoader } from '../src/stats.js';
import { loadOverview } from '../src/usage.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const BLANKS = [null, undefined, '', ' ', '   ', '\n\t ', 42, {}, []];

/** The banner as the pages mark it up: hidden at first, with a [data-error-text] span inside. */
function banner() {
  const textElement = { textContent: '' };
  return {
    hidden: true,
    textElement,
    querySelector: (selector) => (selector === '[data-error-text]' ? textElement : null),
  };
}

describe('meaningfulMessage', () => {
  test('treats null, undefined, non-strings, empty and whitespace-only text as no message', () => {
    for (const value of BLANKS) assert.equal(meaningfulMessage(value), null, JSON.stringify(value));
  });

  test('keeps real text, trimmed', () => {
    assert.equal(meaningfulMessage('  Something went wrong. '), 'Something went wrong.');
  });
});

describe('setErrorBanner', () => {
  test('no banner when there is no warning', () => {
    const box = banner();
    assert.equal(setErrorBanner(box, null), null);
    assert.equal(box.hidden, true);
    assert.equal(box.textElement.textContent, '');
  });

  test('no banner for empty or whitespace-only messages', () => {
    for (const value of BLANKS) {
      const box = banner();
      box.hidden = false; // even one left showing is hidden
      setErrorBanner(box, value);
      assert.equal(box.hidden, true, JSON.stringify(value));
      assert.equal(box.textElement.textContent, '');
    }
  });

  test('a real warning is shown with its text', () => {
    const box = banner();
    assert.equal(setErrorBanner(box, 'The server returned unexpected data.', { failed: true }), 'The server returned unexpected data.');
    assert.equal(box.hidden, false);
    assert.equal(box.textElement.textContent, 'The server returned unexpected data.');
  });

  test('a real failure without a message is never hidden: it gets the fallback', () => {
    for (const value of BLANKS) {
      const box = banner();
      setErrorBanner(box, value, { failed: true });
      assert.equal(box.hidden, false, JSON.stringify(value));
      assert.equal(box.textElement.textContent, FALLBACK_ERROR);
    }
    assert.equal(FALLBACK_ERROR, 'Unable to load data. Please try again.');
  });

  test('hiding clears the old text, so it can never reappear on its own', () => {
    const box = banner();
    setErrorBanner(box, 'Cannot reach HoppLink Server.', { failed: true });
    setErrorBanner(box, null);
    assert.equal(box.hidden, true);
    assert.equal(box.textElement.textContent, '');
  });
});

describe('showAlert', () => {
  const alertBox = () => ({ hidden: true, className: '', textContent: '' });
  const root = (box) => ({ querySelector: (selector) => (selector === '[data-alert]' ? box : null) });

  test('stays hidden for blank messages', () => {
    for (const value of BLANKS) {
      const box = alertBox();
      showAlert(root(box), value);
      assert.equal(box.hidden, true, JSON.stringify(value));
      assert.equal(box.textContent, '');
    }
  });

  test('shows a real message with its tone', () => {
    const box = alertBox();
    showAlert(root(box), 'Saved.', 'success');
    assert.equal(box.hidden, false);
    assert.equal(box.textContent, 'Saved.');
    assert.match(box.className, /alert-success/);
  });
});

describe('describeError never returns a blank message', () => {
  test("a blank server message is replaced by HoppLink's own wording", () => {
    for (const data of [{ message: '' }, { message: '   ' }, { error: { code: 'X', message: '' } }, { error: { code: 'X', message: ' \n' } }, { message: null }, null]) {
      const message = describeError({ ok: false, kind: 'http', status: 400, code: null, data });
      assert.equal(message, 'The request failed (HTTP 400).', JSON.stringify(data));
    }
  });

  test("a server's real message is still shown", () => {
    assert.equal(describeError({ ok: false, kind: 'http', status: 400, code: 'VALIDATION_ERROR', data: { error: { code: 'VALIDATION_ERROR', message: 'Bad page' } } }), 'Bad page');
    assert.equal(describeError({ ok: false, kind: 'http', status: 400, code: null, data: { message: ' ', error: { message: 'From the error' } } }), 'From the error');
  });
});

describe('failed requests still show an error', () => {
  const failingFetch = (response) => async () => response();

  test('Dashboard: an API failure with a blank message has a meaningful one', async () => {
    const loader = createStatsLoader(createApi({ fetch: failingFetch(() => json(400, { error: { code: 'BAD', message: '  ' } })) }));
    const result = await loader.load();
    assert.equal(result.state, 'error');
    assert.notEqual(meaningfulMessage(result.message), null);
  });

  test('Dashboard: an unreachable server is reported', async () => {
    const loader = createStatsLoader(createApi({ fetch: async () => { throw new TypeError('fetch failed'); } }));
    assert.match((await loader.load()).message, /Cannot reach HoppLink Server/);
  });

  test('Data Transfer: an API failure with a blank message has a meaningful one', async () => {
    const api = createApi({ fetch: failingFetch(() => json(400, { message: '' })) });
    const result = await loadOverview(api, { period: 'month', page: 1 });
    assert.equal(result.state, 'error');
    assert.notEqual(meaningfulMessage(result.message), null);
  });

  test('Data Transfer: a server error is reported', async () => {
    const result = await loadOverview(createApi({ fetch: failingFetch(() => json(500, {})) }), { period: 'month', page: 1 });
    assert.match(result.message, /HTTP 500/);
  });
});

describe('Retry', () => {
  test('a failed load shows the banner, and Retry loads again and hides it on success', async () => {
    let fail = true;
    let requests = 0;
    const DASHBOARD = {
      summary: { totalUsers: 1, activeUsers: 1, registeredDevices: 0, proxyServers: 1, enabledProxyServers: 1, activeSessions: 1 },
      recentUsers: [],
    };
    const loader = createStatsLoader(createApi({
      fetch: async () => { requests += 1; return fail ? json(500, {}) : json(200, DASHBOARD); },
    }));
    const box = banner();
    // The page's loadStats(), reduced to the banner: hidden while loading, shown for any failure.
    const loadStats = async () => {
      setErrorBanner(box, null);
      const result = await loader.load();
      if (result.state !== 'ready') setErrorBanner(box, result.message, { failed: true });
      return result;
    };

    await loadStats();
    assert.equal(box.hidden, false);
    assert.match(box.textElement.textContent, /HTTP 500/);

    fail = false;
    assert.equal((await loadStats()).state, 'ready'); // Retry
    assert.equal(requests, 2, 'Retry asks the server again');
    assert.equal(box.hidden, true);
    assert.equal(box.textElement.textContent, '');
  });

  for (const file of ['dashboard', 'data-transfer', 'users', 'proxy-servers']) {
    test(`${file}: the banner keeps its look, is hidden at first, goes through setErrorBanner, and Retry reloads`, () => {
      const source = readFileSync(new URL(`../src/pages/${file}.js`, import.meta.url), 'utf8');
      const [markup] = source.match(/<div class="alert alert-danger d-flex align-items-center gap-2[^"]*" data-(?:stats-)?error hidden role="alert">[\s\S]*?<\/div>/) ?? [];
      assert.ok(markup, 'the banner markup is unchanged and starts hidden');
      assert.match(markup, /bi-exclamation-triangle/);
      assert.match(markup, /data-error-text/);
      assert.match(markup, /data-retry>Retry<\/button>/);
      assert.doesNotMatch(source, /errorBox\.hidden\s*=/, 'never shown or hidden directly, so it can never be shown blank');
      assert.match(source, /setErrorBanner\(errorBox, null\)/, 'hidden before every load');
      assert.match(source, /setErrorBanner\(errorBox, [^;]*\{ failed: true \}\)/, 'failures always show something');
      assert.match(source, /querySelector\('\[data-retry\]'\)\.addEventListener\('click', load\w*\)/);
    });
  }

  test('user details: its failure banners fall back instead of showing blank', () => {
    const source = readFileSync(new URL('../src/pages/user-details.js', import.meta.url), 'utf8');
    assert.equal(source.match(/meaningfulMessage\([^)]*\) \?\? FALLBACK_ERROR/g)?.length, 2);
  });
});

describe('a hidden banner is really hidden', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const bootstrap = read('../node_modules/bootstrap/dist/css/bootstrap.min.css');
  const styles = read('../src/styles.css');

  test("the cause: Bootstrap's .d-flex comes after its [hidden] rule, with the same weight, so on its own it wins", () => {
    const hiddenRule = bootstrap.indexOf('[hidden]{display:none!important}');
    const flexRule = bootstrap.indexOf('.d-flex{display:flex!important}');
    assert.ok(hiddenRule >= 0 && flexRule > hiddenRule, 'if this changes, the override below may no longer be needed');
  });

  test('styles.css makes hidden win over any single display utility, with no other effect', () => {
    const rule = styles.match(/\[class\]\[hidden\]\s*\{([^}]*)\}/);
    assert.ok(rule, 'the override is present');
    assert.equal(rule[1].trim(), 'display: none !important;');
  });

  test('styles.css is loaded after Bootstrap', () => {
    const main = read('../src/main.js');
    assert.ok(main.indexOf("import './styles.css';") > main.indexOf("import 'bootstrap/dist/css/bootstrap.min.css';"));
  });

  test('every page banner that relies on it starts hidden and uses a display utility the override beats', () => {
    for (const file of ['dashboard', 'data-transfer', 'users', 'proxy-servers']) {
      const source = read(`../src/pages/${file}.js`);
      const [opening] = source.match(/<div class="alert alert-danger[^"]*"[^>]*role="alert">/) ?? [];
      assert.ok(opening, file);
      assert.match(opening, / hidden /, `${file}: hidden until there is something to say`);
      assert.match(opening, /class="[^"]*\bd-flex\b/, `${file}: the look is unchanged`);
    }
  });
});
