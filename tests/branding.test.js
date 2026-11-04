// The product is HoppLink. The old name survives only in internal identifiers (the API proxy variable,
// the package name), never in visible text.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { describeError, isHoppLinkServerHealth } from '../src/api.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const sources = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? sources(join(dir, e.name))
  : /\.(js|css)$/.test(e.name) ? [join(dir, e.name)] : []));

describe('HoppLink branding', () => {
  test('the browser tab is titled HoppLink', () => {
    assert.match(read('index.html'), /<title>HoppLink<\/title>/);
  });

  test('no page, dialog or message shows the old product name', () => {
    for (const file of ['index.html', ...sources('src')]) {
      assert.doesNotMatch(read(file), /ProxyMarket|Proxy Market/, file);
    }
  });

  test('connection errors name HoppLink Server', () => {
    assert.match(describeError({ kind: 'network', code: 'TIMEOUT' }), /^HoppLink Server did not respond/);
    assert.match(describeError({ kind: 'network', code: 'NETWORK' }), /^Cannot reach HoppLink Server\./);
    assert.match(describeError({ kind: 'http', status: 502, code: null }), /^HoppLink Server had a problem/);
  });

  test('the health check accepts only hopplink-server', () => {
    assert.equal(isHoppLinkServerHealth({ status: 'ok', service: 'hopplink-server', version: '0.1.0' }), true);
    for (const service of ['proxymarket-server', 'something-else', 'HoppLink-Server', 'hopplink-server ', '', null, undefined]) {
      assert.equal(isHoppLinkServerHealth({ status: 'ok', service, version: '0.1.0' }), false, String(service));
    }
  });

  test('the health check rejects a non-ok status or an unexpected body', () => {
    assert.equal(isHoppLinkServerHealth({ status: 'degraded', service: 'hopplink-server', version: '0.1.0' }), false);
    for (const data of [null, undefined, {}, [], 'ok']) {
      assert.equal(isHoppLinkServerHealth(data), false);
    }
  });

  test('the dashboard uses that check, and the old identifier is gone from source code', () => {
    assert.ok(read('src/pages/dashboard.js').includes('isHoppLinkServerHealth(result.data)'));
    for (const file of sources('src')) {
      assert.doesNotMatch(read(file), /proxymarket-server/, file);
    }
  });
});
