// The product is HoppLink. The old name survives only in internal identifiers the server and other
// clients rely on (the health check's service name, the API proxy variable), never in visible text.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { describeError } from '../src/api.js';

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

  test('the health check still expects the server\'s unchanged service identifier', () => {
    assert.ok(read('src/pages/dashboard.js').includes("result.data?.service === 'proxymarket-server'"));
  });
});
