// The temporary homepage redirect: / goes to /downloads (an HTTP 302 from Nginx, and the browser-side equivalent in
// main.js), every other address keeps working, and nothing loops. Checked without a browser: the decision is a pure
// function, and main.js and the Nginx locations are read as text. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { isDownloadsPath } from '../src/downloads.js';
import { APP_PATH, HOME_TARGET, homeRedirect } from '../src/home-redirect.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const nginx = read('../deploy/central/nginx-web-locations.conf');

/** Follows redirects the way main.js does, failing on a loop. Returns the address finally shown. */
function follow(pathname, hash = '') {
  const seen = new Set();
  let address = `${pathname}${hash}`;
  for (;;) {
    assert.ok(!seen.has(address), `redirect loop at ${address}`);
    seen.add(address);
    const url = new URL(address, 'https://www.example.com');
    const next = homeRedirect(url.pathname, url.hash);
    if (next === null) return address;
    address = next;
  }
}

describe('the homepage', () => {
  test('/ redirects to /downloads', () => {
    assert.equal(HOME_TARGET, '/downloads');
    assert.equal(homeRedirect('/', ''), '/downloads');
    assert.equal(homeRedirect('/index.html', ''), '/downloads');
    assert.equal(follow('/'), '/downloads');
  });

  test('/downloads, and every other address, is shown as it is, so nothing loops', () => {
    for (const path of ['/downloads', '/downloads/', '/login', '/register', '/account', '/admin', '/anything']) {
      assert.equal(homeRedirect(path, ''), null, path);
      assert.equal(follow(path), path);
    }
    assert.equal(isDownloadsPath(HOME_TARGET), true, 'the target is the downloads page itself');
    assert.equal(homeRedirect(HOME_TARGET, ''), null);
  });

  test('the signed-in application starts at /login, which is not redirected', () => {
    assert.equal(APP_PATH, '/login');
    assert.equal(homeRedirect(APP_PATH, ''), null);
    assert.match(read('../src/pages/downloads.js'), /<a class="btn btn-outline-secondary btn-sm" href="\/login">Sign in<\/a>/);
    assert.doesNotMatch(read('../src/pages/downloads.js'), /href="\/"/, 'nothing on the downloads page links back to /');
  });

  test('admin # addresses at / still reach the application, including after Nginx sends them to /downloads', () => {
    for (const hash of ['#dashboard', '#users', '#users?search=a&page=2', '#users/abc', '#servers', '#settings', '#transfer?period=day']) {
      assert.equal(homeRedirect('/', hash), `/login${hash}`, hash);
      // A 302 has no fragment, so the browser keeps it: /#users arrives as /downloads#users.
      assert.equal(homeRedirect('/downloads', hash), `/login${hash}`, hash);
      assert.equal(follow('/', hash), `/login${hash}`);
      assert.equal(homeRedirect('/login', hash), null, 'the application handles its own # addresses');
    }
    for (const hash of ['#', '#top', '#usersx', '#windows']) {
      assert.equal(homeRedirect('/downloads', hash), null, `${hash} is not an application address`);
      assert.equal(homeRedirect('/', hash), '/downloads', hash);
    }
  });
});

describe('main.js', () => {
  const main = read('../src/main.js');

  test('redirects before anything renders, replacing the address so Back does not loop', () => {
    assert.match(main, /const redirect = homeRedirect\(window\.location\.pathname, window\.location\.hash\);\nif \(redirect\) \{\n {2}window\.location\.replace\(redirect\);\n\} else if \(isDownloadsPath/);
    assert.doesNotMatch(main, /location\.(?:href|assign)\b|pushState/);
  });

  test('is only a browser-side redirect, not an HTTP 302', () => {
    assert.match(read('../src/home-redirect.js'), /It's not an HTTP 302\./);
  });
});

describe('Nginx', () => {
  const [block] = nginx.match(/location = \/ \{[^}]*\}/) ?? [];

  test('answers exactly / with a temporary 302 to /downloads, keeping any query string', () => {
    assert.ok(block, 'the "location = /" block');
    assert.match(block, /^location = \/ \{\n {4}return 302 \/downloads\$is_args\$args;\n\}$/);
    assert.equal(nginx.match(/return 30[1278]/g)?.length, 1, 'no other redirect, and never a permanent one');
  });

  test('leaves every other address to the existing locations', () => {
    // The fallback still serves the page for /downloads, /login and the rest, and redirects internally to
    // /index.html, never to /, so it can't reach the 302.
    assert.match(nginx, /location \/ \{\n {4}try_files \$uri \/index\.html;/);
    assert.match(nginx, /location = \/downloads\/releases\/manifest\.json \{/);
    assert.match(nginx, /location \/api\/ \{/);
    assert.doesNotMatch(nginx, /location = \/downloads\b[^/]/, 'the downloads page is not redirected');
  });
});
