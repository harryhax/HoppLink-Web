// Tests for the public downloads page: the release manifest is untrusted, so everything in it is validated, and links
// can only point into /downloads/releases/. Uses a fake fetch (no browser, no server); the page, route and Nginx
// locations are checked statically. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  downloadUrl, formatDate, formatSize, isDownloadsPath, loadDownloads, MANIFEST_URL, MAX_MANIFEST_LENGTH, parseManifest,
  PLATFORMS, validDate, validFileName, validVersion,
} from '../src/downloads.js';
import { DISCORD_INVITE_URL } from '../src/community.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const SHA = 'ab'.repeat(32);

const manifest = (overrides = {}) => ({
  version: '0.1.0',
  releaseDate: '2026-11-05',
  downloads: {
    'windows-x64': { file: 'HoppLink-0.1.0-win-x64.zip' },
    'macos-arm64': { file: 'HoppLink-0.1.0-osx-arm64.zip' },
    'macos-x64': { file: 'HoppLink-0.1.0-osx-x64.zip' },
  },
  ...overrides,
});
const only = (key, entry, overrides = {}) => manifest({ downloads: { [key]: entry }, ...overrides });

describe('the manifest', () => {
  test('a complete manifest offers every platform, in order, with its version, date and link', () => {
    const result = parseManifest(manifest());
    assert.equal(result.state, 'ready');
    assert.equal(result.version, '0.1.0');
    assert.equal(result.releaseDate, '2026-11-05');
    assert.deepEqual(result.downloads.map((d) => d.key), ['windows-x64', 'macos-arm64', 'macos-x64']);
    assert.deepEqual(result.downloads.map((d) => d.arch), ['64-bit (x64)', 'Apple Silicon', 'Intel']);
    for (const build of result.downloads) {
      assert.equal(build.version, '0.1.0');
      assert.equal(build.releaseDate, '2026-11-05');
      assert.equal(build.url, `/downloads/releases/${build.file}`);
    }
  });

  test('only platforms the manifest provides are offered', () => {
    const result = parseManifest(only('macos-arm64', { file: 'HoppLink-0.1.0-osx-arm64.zip' }));
    assert.deepEqual(result.downloads.map((d) => d.key), ['macos-arm64']);
  });

  test('the order is the page\'s, whatever the manifest\'s', () => {
    const { downloads } = manifest();
    const reversed = Object.fromEntries(Object.entries(downloads).reverse());
    assert.deepEqual(parseManifest(manifest({ downloads: reversed })).downloads.map((d) => d.key), PLATFORMS.map((p) => p.key));
  });

  test('unknown platforms are ignored', () => {
    const result = parseManifest(manifest({ downloads: { 'linux-x64': { file: 'HoppLink-0.1.0-linux-x64.zip' }, 'windows-x64': { file: 'HoppLink-0.1.0-win-x64.zip' } } }));
    assert.deepEqual(result.downloads.map((d) => d.key), ['windows-x64']);
  });

  test('nothing to offer means "coming soon"', () => {
    for (const data of [null, undefined, 'x', 42, [], {}, { version: '0.1.0' }, manifest({ downloads: {} }), manifest({ downloads: [] }),
      manifest({ downloads: null }), only('windows-x64', null), only('windows-x64', 'HoppLink.zip'), only('windows-x64', {})]) {
      assert.deepEqual(parseManifest(data), { state: 'empty' }, JSON.stringify(data));
    }
  });

  test('a build without a valid version is not offered', () => {
    assert.equal(parseManifest(manifest({ version: undefined })).state, 'empty');
    assert.equal(parseManifest(manifest({ version: 'latest' })).state, 'empty');
  });

  test('a build may have its own version and date, and an invalid one of its own is not offered', () => {
    const result = parseManifest(manifest({ downloads: {
      'windows-x64': { file: 'HoppLink-0.1.1-win-x64.zip', version: '0.1.1', releaseDate: '2026-11-07' },
      'macos-arm64': { file: 'HoppLink-0.1.0-osx-arm64.zip', version: 'nope' },
      'macos-x64': { file: 'HoppLink-0.1.0-osx-x64.zip' },
    } }));
    assert.deepEqual(result.downloads.map((d) => [d.key, d.version, d.releaseDate]), [
      ['windows-x64', '0.1.1', '2026-11-07'],
      ['macos-x64', '0.1.0', '2026-11-05'],
    ]);
  });

  test('without a release version, builds with their own are still offered', () => {
    const result = parseManifest(only('windows-x64', { file: 'HoppLink-0.2.0-win-x64.zip', version: '0.2.0' }, { version: undefined }));
    assert.equal(result.state, 'ready');
    assert.equal(result.version, null);
    assert.equal(result.downloads[0].version, '0.2.0');
  });

  test('an invalid release date is left out, not shown', () => {
    for (const releaseDate of ['2026-02-30', '2026-13-01', '05/11/2026', '2026-11-5', 20261105, '2026-11-05T00:00:00Z']) {
      const result = parseManifest(manifest({ releaseDate }));
      assert.equal(result.state, 'ready');
      assert.equal(result.releaseDate, null, String(releaseDate));
      assert.equal(result.downloads[0].releaseDate, null);
    }
  });

  test('size and checksum are shown only when valid', () => {
    const valid = parseManifest(only('windows-x64', { file: 'HoppLink-0.1.0-win-x64.zip', size: 84213760, sha256: SHA.toUpperCase() })).downloads[0];
    assert.equal(valid.size, 84213760);
    assert.equal(valid.sha256, SHA);
    for (const [size, sha256] of [[-1, 'abc'], [0, SHA.slice(1)], [1.5, `${SHA}0`], ['84213760', 42], [2 ** 41, null], [null, `${'g'.repeat(64)}`]]) {
      const build = parseManifest(only('windows-x64', { file: 'HoppLink-0.1.0-win-x64.zip', size, sha256 })).downloads[0];
      assert.equal(build.size, null, String(size));
      assert.equal(build.sha256, null, String(sha256));
    }
  });

  test('release notes are plain strings, trimmed and limited', () => {
    assert.deepEqual(parseManifest(manifest({ notes: '  First beta. ' })).notes, ['First beta.']);
    assert.deepEqual(parseManifest(manifest({ notes: ['One', '  ', 2, null, { text: 'x' }, 'Two'] })).notes, ['One', 'Two']);
    assert.deepEqual(parseManifest(manifest({ notes: { a: 'b' } })).notes, []);
    assert.deepEqual(parseManifest(manifest()).notes, []);
    assert.equal(parseManifest(manifest({ notes: Array.from({ length: 20 }, (_, i) => `Note ${i}`) })).notes.length, 10);
    const [long] = parseManifest(manifest({ notes: ['x'.repeat(1000)] })).notes;
    assert.equal(long.length, 300);
  });

  test('a link in the manifest is ignored: links are always built from the file name', () => {
    const result = parseManifest(only('windows-x64', { file: 'HoppLink-0.1.0-win-x64.zip', url: 'https://attacker.example/evil.exe', href: 'javascript:alert(1)' }));
    assert.equal(result.downloads[0].url, '/downloads/releases/HoppLink-0.1.0-win-x64.zip');
    assert.equal(Object.hasOwn(result.downloads[0], 'href'), false);
  });

  test('inherited properties are not read as manifest fields', () => {
    const downloads = Object.create({ 'windows-x64': { file: 'HoppLink-0.1.0-win-x64.zip' } });
    assert.equal(parseManifest(manifest({ downloads })).state, 'empty');
    assert.equal(parseManifest(JSON.parse('{"version":"0.1.0","downloads":{"__proto__":{"file":"HoppLink.zip"}}}')).state, 'empty');
  });
});

describe('download file names and links', () => {
  test('accepts plain build names', () => {
    for (const name of ['HoppLink-0.1.0-win-x64.zip', 'HoppLink-0.1.0-osx-arm64.zip', 'HoppLink_0.1.0.dmg', 'HoppLink-Setup.exe', 'h.msi', 'HoppLink.PKG']) {
      assert.equal(validFileName(name), name);
      assert.equal(downloadUrl(name), `/downloads/releases/${name}`);
    }
  });

  test('rejects anything that could leave the releases directory, or is not a build', () => {
    const rejected = [
      '../manifest.zip', '..\\secret.zip', '../../etc/passwd', 'a/../../b.zip', 'sub/HoppLink.zip', '/etc/HoppLink.zip', 'C:\\HoppLink.zip',
      '%2e%2e%2fHoppLink.zip', 'HoppLink%2Fx.zip', 'Hopp..Link.zip', '.htpasswd.zip', '.env', '.HoppLink.zip', '-HoppLink.zip',
      'https://attacker.example/HoppLink.zip', '//attacker.example/HoppLink.zip', 'javascript:alert(1).zip', 'data:text/html,x.zip',
      'Hopp Link.zip', 'HoppLink.zip?x=1', 'HoppLink.zip#x', 'HoppLink.zip\n', 'HoppLink\u0000.zip', 'HoppLink<script>.zip',
      'HoppLink.sh', 'HoppLink.html', 'HoppLink.js', 'HoppLink.php', 'manifest.json', 'HoppLink.zip.html', 'HoppLink', '.zip', 'zip',
      `${'a'.repeat(125)}.zip`, '', null, undefined, 42, {}, ['HoppLink.zip'],
    ];
    for (const name of rejected) {
      assert.equal(validFileName(name), null, JSON.stringify(name));
      assert.equal(downloadUrl(name), null, JSON.stringify(name));
      assert.equal(parseManifest(only('windows-x64', { file: name })).state, 'empty', JSON.stringify(name));
    }
  });

  test('every link is a same-site path inside /downloads/releases/', () => {
    for (const build of parseManifest(manifest()).downloads) {
      assert.match(build.url, /^\/downloads\/releases\/[A-Za-z0-9][A-Za-z0-9._-]*$/);
      assert.equal(new URL(build.url, 'https://www.example.com').origin, 'https://www.example.com');
    }
  });

  test('names allowed here are exactly what the Nginx build location serves', () => {
    const nginx = read('../deploy/central/nginx-web-locations.conf');
    const [, pattern] = nginx.match(/location ~ "\^\/downloads\/releases\/\(([^"]+)\)\$"/) ?? [];
    assert.ok(pattern, 'the build location is present');
    const served = new RegExp(`^${pattern}$`);
    for (const name of ['HoppLink-0.1.0-win-x64.zip', 'HoppLink.dmg', 'HoppLink.pkg', 'HoppLink.msi', 'HoppLink.exe']) {
      assert.ok(validFileName(name) && served.test(name), name);
    }
    for (const name of ['../x.zip', 'sub/x.zip', '.hidden.zip', 'manifest.json', 'x.html', 'x.sh']) {
      assert.equal(served.test(name), false, name);
    }
  });

  test('a new release needs only a new manifest: 0.1.2, with the names HoppLink-Apps packaging produces', () => {
    const nginx = read('../deploy/central/nginx-web-locations.conf');
    const served = new RegExp(`^${nginx.match(/location ~ "\^\/downloads\/releases\/\(([^"]+)\)\$"/)[1]}$`);
    const files = { 'windows-x64': 'HoppLink-0.1.2-win-x64.zip', 'macos-arm64': 'HoppLink-0.1.2-osx-arm64.zip', 'macos-x64': 'HoppLink-0.1.2-osx-x64.zip' };
    const result = parseManifest({
      version: '0.1.2',
      releaseDate: '2026-11-06',
      downloads: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, { file, size: 45022539, sha256: SHA }])),
    });
    assert.equal(result.state, 'ready');
    assert.equal(result.version, '0.1.2');
    assert.deepEqual(result.downloads.map((d) => [d.key, d.version, d.url]),
      Object.entries(files).map(([key, file]) => [key, '0.1.2', `/downloads/releases/${file}`]));
    for (const file of Object.values(files)) assert.ok(served.test(file), `${file} is served by Nginx`);
    for (const file of ['src/downloads.js', 'src/pages/downloads.js']) {
      assert.doesNotMatch(read(`../${file}`), /\b0\.\d+\.\d+\b|HoppLink-\d/, `${file} has no release version written into it`);
    }
  });
});

describe('versions, dates and sizes', () => {
  test('versions', () => {
    for (const v of ['0.1.0', '1.20.300', '0.1.0-beta', '0.1.0-beta.1', '1.0.0-rc.2']) assert.equal(validVersion(v), v);
    for (const v of ['1', '1.0', 'v1.0.0', '1.0.0-', '1.0.0+build', '1.0.0 ', '<b>1.0.0</b>', '', null, 1, {}]) assert.equal(validVersion(v), null, String(v));
  });

  test('dates', () => {
    assert.equal(validDate('2028-02-29'), '2028-02-29');
    assert.equal(validDate('2026-02-29'), null);
    assert.equal(formatDate('2026-11-05'), '5 November 2026');
    assert.equal(formatDate('2026-01-01'), '1 January 2026', 'in UTC, never the day before');
    assert.equal(formatDate('nope'), null);
  });

  test('sizes, in decimal units', () => {
    assert.equal(formatSize(1), '1 byte');
    assert.equal(formatSize(999), '999 bytes');
    assert.equal(formatSize(1500), '1.5 KB');
    assert.equal(formatSize(84_213_760), '84 MB');
    assert.equal(formatSize(1_200_000_000), '1.2 GB');
    for (const size of [0, -5, 1.5, '100', null, undefined, NaN, Infinity]) assert.equal(formatSize(size), null, String(size));
  });
});

describe('loading the manifest', () => {
  const respond = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => body });

  test('fetches the manifest from the releases directory, uncached and without cookies', async () => {
    const calls = [];
    await loadDownloads({ fetch: async (url, options) => { calls.push({ url, options }); return respond(200, JSON.stringify(manifest()))(); } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/downloads/releases/manifest.json');
    assert.equal(MANIFEST_URL, '/downloads/releases/manifest.json');
    assert.equal(calls[0].options.cache, 'no-cache');
    assert.equal(calls[0].options.credentials, 'omit');
  });

  test('a published manifest is shown', async () => {
    const result = await loadDownloads({ fetch: respond(200, JSON.stringify(manifest({ notes: ['First beta.'] }))) });
    assert.equal(result.state, 'ready');
    assert.equal(result.downloads.length, 3);
    assert.deepEqual(result.notes, ['First beta.']);
  });

  test('no releases uploaded yet: "coming soon"', async () => {
    for (const status of [404, 403]) assert.deepEqual(await loadDownloads({ fetch: respond(status, 'Not Found') }), { state: 'empty' });
  });

  test('the page fallback, broken JSON or an oversized manifest is not an error, just nothing to offer', async () => {
    for (const body of ['<!doctype html><title>HoppLink</title>', '{"version":', '', 'null', JSON.stringify(manifest()).padEnd(MAX_MANIFEST_LENGTH + 1)]) {
      assert.deepEqual(await loadDownloads({ fetch: respond(200, body) }), { state: 'empty' }, body.slice(0, 40));
    }
  });

  test('an unreachable or failing server is an error with a message, so the page can offer Retry', async () => {
    const offline = await loadDownloads({ fetch: async () => { throw new TypeError('fetch failed'); } });
    assert.equal(offline.state, 'error');
    assert.match(offline.message, /Unable to load downloads/);
    for (const status of [500, 502, 503]) {
      const result = await loadDownloads({ fetch: respond(status, '') });
      assert.equal(result.state, 'error');
      assert.match(result.message, /Unable to load downloads\. Please try again\./);
    }
  });
});

describe('the public route', () => {
  test('only /downloads is the downloads page', () => {
    for (const path of ['/downloads', '/downloads/']) assert.equal(isDownloadsPath(path), true, path);
    for (const path of ['/', '/index.html', '/download', '/downloadsx', '/downloads/releases/', '/downloads/releases/manifest.json', '/Downloads', '', null]) {
      assert.equal(isDownloadsPath(path), false, String(path));
    }
  });

  test('main.js renders it without restoring a session, and starts the app for everything else', () => {
    const main = read('../src/main.js');
    assert.match(main, /\} else if \(isDownloadsPath\(window\.location\.pathname\)\) \{\n {2}show\(renderDownloads\(\)\);\n\} else \{\n {2}start\(\);\n\}\n$/);
    assert.equal(main.match(/^start\(\);$/m), null, 'start() is not also called unconditionally');
  });

  test('the page never calls the API or uses an auth session', () => {
    for (const file of ['../src/pages/downloads.js', '../src/downloads.js']) {
      const source = read(file);
      assert.doesNotMatch(source, /\/api\/|createApi|auth\.js|signIn|getSession|credentials: 'include'/, file);
    }
  });
});

describe('the page', () => {
  const source = read('../src/pages/downloads.js');

  test('has the HoppLink branding, a beta notice, "coming soon", an error banner with Retry, and no upload', () => {
    assert.match(source, /<a class="d-flex align-items-center text-decoration-none" href="\/downloads">\s*<img class="pm-logo pm-logo-md" src="\/brand\/hopplink-logo-on-light\.png" alt="HoppLink" width="678" height="120">/);
    assert.match(source, /Download HoppLink/);
    assert.match(source, />Beta</);
    assert.match(source, /HoppLink is beta software\./);
    assert.match(source, /Downloads coming soon/);
    assert.match(source, /data-error-text/);
    assert.match(source, /setErrorBanner\(errorBox, result\.message, \{ failed: true \}\)/);
    assert.match(source, /querySelector\('\[data-retry\]'\)\.addEventListener\('click', load\)/);
    assert.doesNotMatch(source, /<form|<input|type="file"|method=/i);
  });

  test('shows version, release date, size, checksum and release notes', () => {
    for (const marker of ['data-version', 'data-date', 'data-size', 'data-checksum', 'data-notes', 'data-summary']) assert.ok(source.includes(marker), marker);
    assert.match(source, /formatSize\(build\.size\)/);
    assert.match(source, /formatDate\(build\.releaseDate\)/);
  });

  test('manifest values go in as text, and links only come from the validated build', () => {
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
    // Markup may only interpolate trusted application constants, never anything from the manifest. The one allowed is
    // the Discord invitation from src/community.js: a fixed https URL with nothing that could break out of an attribute.
    const TRUSTED = ['DISCORD_INVITE_URL'];
    const templates = [...source.matchAll(/html\(`([^`]*)`\)/g)].map(([, markup]) => markup);
    assert.ok(templates.length >= 2, 'the page and its download card are built from markup');
    for (const [, expression] of templates.flatMap((markup) => [...markup.matchAll(/\$\{([^}]*)\}/g)])) {
      assert.ok(TRUSTED.includes(expression.trim()), `only trusted constants are interpolated into markup, not \${${expression}}`);
    }
    assert.match(source, /import \{ DISCORD_INVITE_URL \} from '\.\.\/community\.js';/);
    assert.match(DISCORD_INVITE_URL, /^https:\/\/discord\.gg\/[A-Za-z0-9]+$/);

    // Every manifest value goes in as text, or as the validated download link.
    for (const insertion of [
      "text(page, '[data-summary]', parts.filter(Boolean).join(', '))", 'item.textContent = note;',
      "text(card, '[data-os]', build.os)", "text(card, '[data-arch]', build.arch)", "text(card, '[data-version]', build.version)",
      "text(card, '[data-date]', date)", "text(card, '[data-size]', size)", "text(card, '[data-checksum]', build.sha256)",
      "link.setAttribute('download', build.file)",
    ]) assert.ok(source.includes(insertion), insertion);
    assert.match(source, /link\.href = build\.url;/);
    assert.equal(source.match(/\.href = /g).length, 1);
  });

  test('nothing switched with hidden carries a display utility, so hidden always hides it', () => {
    const toggled = [...source.matchAll(/querySelector\('\[(data-[a-z-]+)\]'\)\.hidden =|(\w+)\.hidden = /g)];
    assert.ok(toggled.length > 0);
    for (const tag of source.match(/<[a-z]+[^>]*\b(?:data-loading|data-error|data-empty|data-ready|data-notes-section|data-date-row|data-size-row|data-checksum-row)\b[^>]*>/g)) {
      assert.doesNotMatch(tag, /\bd-(?:flex|block|inline|inline-block|grid|table)\b/, tag);
    }
  });
});

describe('server layout', () => {
  const nginx = read('../deploy/central/nginx-web-locations.conf');
  const block = (start) => nginx.slice(nginx.indexOf(start), nginx.indexOf('\n}\n', nginx.indexOf(start)) + 2);

  test('the manifest and builds are served from the persistent directory, outside every release', () => {
    assert.match(block('location = /downloads/releases/manifest.json'), /alias \/srv\/hopplink-downloads\/manifest\.json;/);
    assert.match(block('location ~ "^/downloads/releases/'), /alias \/srv\/hopplink-downloads\/\$1;/);
  });

  test('anything else under /downloads/releases/ is a 404, never a listing or the page', () => {
    assert.match(nginx, /location \/downloads\/releases\/ \{\n {4}return 404;\n\}/);
    assert.doesNotMatch(nginx, /autoindex on/);
  });

  test('downloads are read-only, never follow symlinks, and are sent as files', () => {
    for (const start of ['location = /downloads/releases/manifest.json', 'location ~ "^/downloads/releases/']) {
      const location = block(start);
      assert.match(location, /limit_except GET \{ deny all; \}/, start);
      assert.match(location, /disable_symlinks on;/, start);
      assert.match(location, /types \{ \}/, start);
      assert.match(location, /X-Content-Type-Options "nosniff" always/, start);
      assert.doesNotMatch(location, /proxy_pass|fastcgi|uwsgi|scgi|try_files .*index\.html/, start);
    }
    assert.match(block('location = /downloads/releases/manifest.json'), /default_type application\/json;[\s\S]*Cache-Control "no-cache"/);
    assert.match(block('location ~ "^/downloads/releases/'), /default_type application\/octet-stream;[\s\S]*Content-Disposition "attachment"/);
  });

  test('the downloads locations come before the page fallback', () => {
    assert.ok(nginx.indexOf('location /downloads/releases/') < nginx.indexOf('location / {'));
  });

  test('deployments never touch the uploads', () => {
    for (const file of ['../deploy/central/deploy-web.sh', '../deploy/central/ssm-deploy.sh', '../.github/workflows/deploy.yml']) {
      assert.doesNotMatch(read(file), /hopplink-downloads|\/srv\//, file);
    }
  });

  test('the guide documents the directory, the upload and an atomic manifest switch', () => {
    const guide = read('../docs/deployment.md');
    for (const text of ['## Desktop app downloads', 'sudo install -d -o root -g root -m 0755 /srv/hopplink-downloads',
      'sudo install -o root -g root -m 0644', '.manifest.json.new', 'mv -T /srv/hopplink-downloads/.manifest.json.new /srv/hopplink-downloads/manifest.json']) {
      assert.ok(guide.includes(text), text);
    }
  });
});
