// Tests for data transfer reporting: API client, formatting, chart mapping and loading.
// Uses a fake fetch (no browser, no server). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { createApi } from '../src/api.js';
import { parseRoute, transferHash } from '../src/router.js';
import {
  ALL_TIME_CHART_DAYS, PERIODS, TERMS, TODAY_CHART_DAYS, USERS_PAGE_SIZE, barLabel, chartBars, chartRange, describePeriod,
  formatAverage, formatBytes, formatCount, formatDay, formatExactBytes, isValidHistory, isValidServerList, isValidSummary,
  isValidUserPage, loadOverview, loadUserUsage, toCounter,
} from '../src/usage.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const BIG = '18446744073709551614'; // twice BIGINT max: far beyond Number.MAX_SAFE_INTEGER

const totals = (down = '0', up = '0', tx = '0', avg = null) => ({
  bytesDown: down, bytesUp: up, bytesTotal: (BigInt(down) + BigInt(up)).toString(), transactions: tx, avgBytesPerTransaction: avg,
});
const PERIOD = { name: 'month', from: '2026-11-01', to: '2026-11-03', timezone: 'UTC' };
const SUMMARY = {
  period: PERIOD,
  filter: { userId: null, serverId: null },
  generatedAt: '2026-11-03T12:00:00.000Z',
  total: { ...totals('1500', '500', '4', '500'), lastActivityAt: '2026-11-03T11:00:00.000Z' },
  attributed: { ...totals('1400', '500', '3', '633'), users: 2, lastActivityAt: '2026-11-03T11:00:00.000Z' },
  unattributed: { ...totals('100', '0', '1', '100'), lastActivityAt: '2026-11-02T10:00:00.000Z' },
};
const USERS = {
  period: PERIOD, generatedAt: SUMMARY.generatedAt, page: 1, pageSize: 20, total: 2, withUsage: 1,
  users: [
    { id: 'u1', name: 'Jane', email: 'jane@example.test', ...totals('1400', '500', '3', '633'), lastActivityAt: '2026-11-03T11:00:00.000Z' },
    { id: 'u2', name: 'Idle', email: 'idle@example.test', ...totals(), lastActivityAt: null },
  ],
};
const SERVERS = {
  period: PERIOD, generatedAt: SUMMARY.generatedAt,
  servers: [{
    id: 's1', name: 'Frankfurt', enabled: false, ...totals('1500', '500', '4', '500'), users: 2, lastActivityAt: null,
    unattributed: { bytesDown: '100', bytesUp: '0', bytesTotal: '100', transactions: '1' },
  }],
};
const HISTORY = {
  from: '2026-11-01', to: '2026-11-03', timezone: 'UTC', filter: { userId: null, serverId: null }, generatedAt: SUMMARY.generatedAt,
  days: [
    { date: '2026-11-01', ...totals(), users: 0, unattributedBytes: '0', unattributedTransactions: '0' },
    { date: '2026-11-02', ...totals('500', '0', '1', '500'), users: 1, unattributedBytes: '100', unattributedTransactions: '1' },
    { date: '2026-11-03', ...totals('1000', '500', '3', '500'), users: 2, unattributedBytes: '0', unattributedTransactions: '0' },
  ],
};

function apiWith(routes = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, credentials: init.credentials });
    const path = new URL(url, 'http://x').pathname.replace('/api/v1/admin/usage/', '');
    const handler = routes[path];
    if (typeof handler === 'function') return handler(url, calls.length);
    if (handler) return handler.clone(); // a fresh body for every request
    return json(200, { summary: SUMMARY, users: USERS, servers: SERVERS, history: HISTORY }[path]);
  };
  return { api: createApi({ fetch }), calls };
}
const params = (url) => Object.fromEntries(new URL(url, 'http://x').searchParams);

describe('API client: usage reports', () => {
  test('each report uses its admin endpoint with browser-managed cookies', async () => {
    const { api, calls } = apiWith();
    await api.usageSummary();
    await api.usageUsers();
    await api.usageServers();
    await api.usageHistory();
    assert.deepEqual(calls.map((c) => c.url), [
      '/api/v1/admin/usage/summary', '/api/v1/admin/usage/users', '/api/v1/admin/usage/servers', '/api/v1/admin/usage/history',
    ]);
    for (const call of calls) {
      assert.equal(call.method, 'GET');
      assert.equal(call.credentials, 'same-origin');
    }
  });

  test('parameters are sent only when given, and encoded', async () => {
    const { api, calls } = apiWith();
    await api.usageSummary({ period: 'today', userId: 'user/1?x&y' });
    await api.usageUsers({ period: 'all', page: 3, pageSize: 20 });
    await api.usageServers({ period: 'month' });
    await api.usageHistory({ from: '2026-10-01', to: '2026-10-31', serverId: 's1', userId: undefined });
    assert.deepEqual(params(calls[0].url), { period: 'today', userId: 'user/1?x&y' });
    assert.deepEqual(params(calls[1].url), { period: 'all', page: '3', pageSize: '20' });
    assert.deepEqual(params(calls[2].url), { period: 'month' });
    assert.deepEqual(params(calls[3].url), { from: '2026-10-01', to: '2026-10-31', serverId: 's1' });
  });
});

describe('formatting', () => {
  test('bytes use decimal units with three significant digits', () => {
    const cases = [
      ['0', '0 B'], ['1', '1 B'], ['999', '999 B'], ['1000', '1.00 KB'], ['1234', '1.23 KB'], ['1235', '1.24 KB'],
      ['9994', '9.99 KB'], ['9995', '10.0 KB'], ['99949', '99.9 KB'], ['99950', '100 KB'], ['999499', '999 KB'],
      ['999500', '1.00 MB'], ['999999', '1.00 MB'], ['45600000000', '45.6 GB'], ['1000000000000', '1.00 TB'],
    ];
    for (const [input, expected] of cases) assert.equal(formatBytes(input), expected, input);
  });

  test('very large byte counts are formatted exactly, without Number precision loss', () => {
    assert.equal(formatBytes('9223372036854775807'), '9.22 EB');
    assert.equal(formatBytes(BIG), '18.4 EB');
    assert.equal(formatBytes('999999999999999999999999999'), '1000 YB'); // the largest unit doesn't overflow
    assert.equal(formatCount('9007199254740993'), '9,007,199,254,740,993');
    assert.equal(formatCount(BIG), '18,446,744,073,709,551,614');
    assert.equal(formatExactBytes(BIG), '18,446,744,073,709,551,614 bytes');
    assert.equal(formatExactBytes('1'), '1 byte');
    assert.equal(toCounter(BIG), 18446744073709551614n);
  });

  test('invalid values show a dash, never a number', () => {
    for (const bad of ['abc', '-1', '01', '1.5', '', null, undefined, 1.5, -2, Number.MAX_SAFE_INTEGER + 2, {}]) {
      assert.equal(formatBytes(bad), '—', String(bad));
      assert.equal(formatCount(bad), '—', String(bad));
    }
    assert.equal(formatAverage(null), '—');
    assert.equal(formatAverage('2500'), '2.50 KB');
  });

  test('periods are described in UTC days', () => {
    assert.equal(formatDay('2026-11-01'), '1 Nov 2026');
    assert.equal(describePeriod({ name: 'today', from: '2026-11-01', to: '2026-11-01' }), '1 Nov 2026 (UTC)');
    assert.equal(describePeriod(PERIOD), '1 Nov 2026 – 3 Nov 2026 (UTC)');
    assert.equal(describePeriod({ name: 'all', from: null, to: null }), 'All recorded usage (UTC)');
    assert.deepEqual(PERIODS.map((p) => p.label), ['Today', 'This Month', 'All Time']);
  });
});

describe('terminology', () => {
  test('activity is described as completed connections, not requests or live connections', () => {
    assert.equal(TERMS.transactions, 'Completed Connections');
    assert.equal(TERMS.total, 'Total Transferred');
    assert.match(TERMS.note, /when they close/);
    assert.match(TERMS.note, /not a request count/);
    assert.match(TERMS.note, /still open are not in these totals/);
    assert.match(TERMS.averageNote, /not the size of any single connection/);
    for (const label of [TERMS.transactions, TERMS.transactionsShort, TERMS.average, TERMS.users]) {
      assert.doesNotMatch(label, /request|api call|live|active connection/i, label);
    }
  });

  test('the pages show no live-connection, duration or request-count figures', () => {
    for (const file of ['../src/pages/data-transfer.js', '../src/pages/user-details.js']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /Active Connections|Live Connections|Open Connections|Duration<|>Requests</, file);
    }
  });

  test('bar tooltips name completed connections', () => {
    const [bar] = chartBars({ ...HISTORY, days: [HISTORY.days[1]] }, { from: '2026-11-02', to: '2026-11-02' }).bars;
    assert.equal(barLabel(bar), '2 Nov 2026: 500 B transferred (downloaded 500 B, uploaded 0 B), 1 completed connection');
  });
});

describe('chart', () => {
  test('chart ranges: this month to date; the last 30 days for today; the last 90 days for all time', () => {
    assert.deepEqual(chartRange(PERIOD, SUMMARY.generatedAt), { from: '2026-11-01', to: '2026-11-03', label: 'This month (UTC)' });
    assert.deepEqual(chartRange({ name: 'today', from: '2026-11-03', to: '2026-11-03' }, SUMMARY.generatedAt),
      { from: '2026-10-05', to: '2026-11-03', label: `Last ${TODAY_CHART_DAYS} days (UTC)` });
    // All time has no end date: today comes from the server's generatedAt, not the browser clock.
    assert.deepEqual(chartRange({ name: 'all', from: null, to: null }, '2026-11-03T23:59:59.000Z'),
      { from: '2026-08-06', to: '2026-11-03', label: `Last ${ALL_TIME_CHART_DAYS} days (UTC)` });
  });

  test('every day gets a bar; days the server omitted are zero', () => {
    const chart = chartBars({ ...HISTORY, days: [HISTORY.days[2]] }, { from: '2026-11-01', to: '2026-11-03' });
    assert.deepEqual(chart.bars.map((b) => [b.date, b.bytesTotal]), [['2026-11-01', '0'], ['2026-11-02', '0'], ['2026-11-03', '1500']]);
    assert.equal(chart.empty, false);
  });

  test('download and upload are separate segments scaled to the largest day', () => {
    const chart = chartBars(HISTORY);
    assert.deepEqual(chart.bars.map((b) => [b.downPercent, b.upPercent]), [[0, 0], [33.33, 0], [66.66, 33.33]]);
    assert.equal(chart.max, 1500n);
    assert.deepEqual(chart.bars[2], {
      date: '2026-11-03', bytesDown: '1000', bytesUp: '500', bytesTotal: '1500', transactions: '3', downPercent: 66.66, upPercent: 33.33,
    });
  });

  test('huge values keep exact strings and sensible heights', () => {
    const days = [
      { date: '2026-11-01', ...totals(BIG, '0', '1'), users: 1 },
      { date: '2026-11-02', ...totals('9223372036854775807', '0', '1'), users: 1 }, // exactly half of BIG
      { date: '2026-11-03', ...totals('9223372036854775806', '0', '1'), users: 1 }, // 2 bytes less than half
    ];
    const chart = chartBars({ from: '2026-11-01', to: '2026-11-03', days });
    assert.equal(chart.bars[0].bytesTotal, BIG);
    assert.equal(chart.bars[2].bytesTotal, '9223372036854775806');
    assert.equal(chart.bars[0].downPercent, 100);
    assert.equal(chart.bars[1].downPercent, 50);
    // Just under half truncates to 49.99. Number arithmetic would round both values to the same
    // double and give 50, so this checks that the ratio really is computed with BigInt.
    assert.equal(chart.bars[2].downPercent, 49.99);
    for (const bar of chart.bars) assert.ok(bar.downPercent >= 0 && bar.downPercent <= 100);
  });

  test('no usage gives an empty chart with zero bars, not sample values', () => {
    const chart = chartBars({ from: '2026-11-01', to: '2026-11-03', days: [] });
    assert.equal(chart.empty, true);
    assert.equal(chart.bars.length, 3);
    for (const bar of chart.bars) assert.deepEqual([bar.bytesTotal, bar.downPercent, bar.upPercent], ['0', 0, 0]);
  });
});

describe('response validation', () => {
  test('valid responses pass', () => {
    assert.ok(isValidSummary(SUMMARY));
    assert.ok(isValidSummary({ ...SUMMARY, unattributed: null }));
    assert.ok(isValidUserPage(USERS));
    assert.ok(isValidServerList(SERVERS));
    assert.ok(isValidHistory(HISTORY));
  });

  test('numbers in place of decimal strings, missing fields and wrong shapes are rejected', () => {
    assert.equal(isValidSummary({ ...SUMMARY, total: { ...SUMMARY.total, bytesTotal: 2000 } }), false);
    assert.equal(isValidSummary({ ...SUMMARY, attributed: { ...SUMMARY.attributed, users: '2' } }), false);
    assert.equal(isValidSummary({ ...SUMMARY, period: { ...PERIOD, name: 'week' } }), false);
    assert.equal(isValidSummary({ ...SUMMARY, total: { ...SUMMARY.total, transactions: '-1' } }), false);
    assert.equal(isValidSummary(null), false);
    assert.equal(isValidUserPage({ ...USERS, users: [{ ...USERS.users[0], bytesDown: undefined }] }), false);
    assert.equal(isValidUserPage({ ...USERS, pageSize: 0 }), false);
    assert.equal(isValidServerList({ ...SERVERS, servers: [{ ...SERVERS.servers[0], unattributed: undefined }] }), false);
    assert.equal(isValidHistory({ ...HISTORY, days: 'none' }), false);
  });
});

describe('loadOverview', () => {
  test('loads summary, users and servers for the period, then the chart history', async () => {
    const { api, calls } = apiWith();
    const result = await loadOverview(api, { period: 'month', page: 2 });
    assert.equal(result.state, 'ready');
    assert.deepEqual(calls.map((c) => new URL(c.url, 'http://x').pathname.split('/').pop()), ['summary', 'users', 'servers', 'history']);
    assert.deepEqual(params(calls[0].url), { period: 'month' });
    assert.deepEqual(params(calls[1].url), { period: 'month', page: '2', pageSize: String(USERS_PAGE_SIZE) });
    assert.deepEqual(params(calls[2].url), { period: 'month' });
    assert.deepEqual(params(calls[3].url), { from: '2026-11-01', to: '2026-11-03' });
    assert.equal(result.summary.total.bytesTotal, '2000');
    assert.deepEqual(result.users.users.map((u) => u.id), ['u1', 'u2']);
    assert.equal(result.servers[0].enabled, false);
    assert.equal(result.chart.bars.length, 3);
    assert.equal(result.chart.label, 'This month (UTC)');
  });

  test('defaults to this month and page 1', async () => {
    const { api, calls } = apiWith();
    await loadOverview(api);
    assert.equal(params(calls[0].url).period, 'month');
    assert.equal(params(calls[1].url).page, '1');
  });

  test('an empty database is ready with zeroes', async () => {
    const zero = { ...totals(), lastActivityAt: null };
    const { api } = apiWith({
      summary: json(200, { ...SUMMARY, total: zero, attributed: { ...zero, users: 0 }, unattributed: zero }),
      users: json(200, { ...USERS, total: 0, withUsage: 0, users: [] }),
      servers: json(200, { ...SERVERS, servers: [] }),
      history: json(200, { ...HISTORY, days: HISTORY.days.map((d) => ({ ...d, ...totals(), users: 0 })) }),
    });
    const result = await loadOverview(api);
    assert.equal(result.state, 'ready');
    assert.equal(result.summary.total.bytesTotal, '0');
    assert.equal(result.chart.empty, true);
  });

  test('server failures and network errors are errors with a message, never zeroes', async () => {
    for (const routes of [{ summary: json(500, {}) }, { servers: json(503, {}) }, { history: json(500, {}) }, { users: () => { throw new TypeError('fetch failed'); } }]) {
      const { api } = apiWith(routes);
      const result = await loadOverview(api);
      assert.equal(result.state, 'error', JSON.stringify(Object.keys(routes)));
      assert.ok(result.message.length > 0);
      assert.equal(result.summary, undefined);
    }
  });

  test('malformed responses are errors, not invented values', async () => {
    for (const routes of [
      { summary: json(200, { ...SUMMARY, total: { ...SUMMARY.total, bytesTotal: 2000 } }) },
      { users: json(200, {}) },
      { servers: json(200, { servers: 'none' }) },
      { history: json(200, { ...HISTORY, days: null }) },
    ]) {
      const { api } = apiWith(routes);
      assert.equal((await loadOverview(api)).state, 'error');
    }
  });

  test('401, or 403 for a suspended or non-admin session, is an authentication problem', async () => {
    for (const [status, code] of [[401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [403, 'ACCOUNT_SUSPENDED']]) {
      const { api } = apiWith({ summary: json(status, { error: { code, message: 'x' } }) });
      assert.deepEqual(await loadOverview(api), { state: 'auth', status });
    }
    // Other refusals are shown as errors rather than signing the administrator out.
    const { api } = apiWith({ users: json(400, { error: { code: 'VALIDATION_ERROR', message: 'querystring/period must be equal to one of the allowed values' } }) });
    const result = await loadOverview(api);
    assert.equal(result.state, 'error');
    assert.match(result.message, /period/);
  });
});

describe('loadUserUsage (user details)', () => {
  test('requests today, this month and all time for the user and returns each total', async () => {
    const { api, calls } = apiWith({
      summary: (url) => {
        const { period } = params(url);
        const bytes = { today: '10', month: '200', all: BIG }[period];
        return json(200, { ...SUMMARY, period: { ...PERIOD, name: period }, unattributed: null, total: { ...totals(bytes, '0', '1'), lastActivityAt: null } });
      },
    });
    const result = await loadUserUsage(api, 'user/1');
    assert.equal(result.state, 'ready');
    assert.deepEqual(calls.map((c) => params(c.url)), [
      { period: 'today', userId: 'user/1' }, { period: 'month', userId: 'user/1' }, { period: 'all', userId: 'user/1' },
    ]);
    assert.deepEqual([result.periods.today.bytesTotal, result.periods.month.bytesTotal, result.periods.all.bytesTotal], ['10', '200', BIG]);
  });

  test('a deleted user, an expired session and a failure are distinguished', async () => {
    let { api } = apiWith({ summary: json(404, { error: { code: 'USER_NOT_FOUND', message: 'User not found' } }) });
    assert.deepEqual(await loadUserUsage(api, 'gone'), { state: 'missing' });
    ({ api } = apiWith({ summary: json(401, { error: { code: 'UNAUTHORIZED' } }) }));
    assert.deepEqual(await loadUserUsage(api, 'u1'), { state: 'auth', status: 401 });
    ({ api } = apiWith({ summary: json(500, {}) }));
    assert.equal((await loadUserUsage(api, 'u1')).state, 'error');
    ({ api } = apiWith({ summary: json(200, { nope: true }) }));
    assert.equal((await loadUserUsage(api, 'u1')).state, 'error');
  });
});

describe('routes', () => {
  test('#transfer keeps the period and page in the URL', () => {
    assert.deepEqual(parseRoute('#transfer'), { name: 'transfer', period: 'month', page: 1 });
    assert.deepEqual(parseRoute('#transfer?period=all&page=3'), { name: 'transfer', period: 'all', page: 3 });
    assert.deepEqual(parseRoute('#transfer?period=week&page=-2'), { name: 'transfer', period: 'month', page: 1 });
    assert.equal(transferHash(), '#transfer');
    assert.equal(transferHash({ period: 'today', page: 1 }), '#transfer?period=today');
    assert.equal(transferHash({ period: 'month', page: 2 }), '#transfer?page=2');
    assert.deepEqual(parseRoute(transferHash({ period: 'all', page: 4 })), { name: 'transfer', period: 'all', page: 4 });
  });
});
