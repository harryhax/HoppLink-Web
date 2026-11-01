import { describeError } from './api.js';
import { isAuthLoss } from './user-admin.js';

/**
 * Data transfer reporting: formatting, validation and loading for the Data Transfer page and the
 * user details section. Everything comes from GET /api/v1/admin/usage/*; nothing is computed from
 * raw records here.
 *
 * The server returns byte and transaction figures as decimal strings (BIGINT sums can exceed
 * Number.MAX_SAFE_INTEGER), so they are handled with BigInt and never converted to Number for
 * arithmetic. Only chart bar heights (a ratio) become Numbers.
 */

export const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'month', label: 'This Month' },
  { id: 'all', label: 'All Time' },
];
export const DEFAULT_PERIOD = 'month';
export const USERS_PAGE_SIZE = 20;
export const ALL_TIME_CHART_DAYS = 90;
export const TODAY_CHART_DAYS = 30;

/** Labels used on every usage view, so the terminology stays consistent and accurate. */
export const TERMS = {
  total: 'Total Transferred',
  down: 'Downloaded',
  up: 'Uploaded',
  transactions: 'Completed Connections',
  transactionsShort: 'Connections',
  average: 'Average per Completed Connection',
  users: 'Users with Recorded Activity',
  lastActivity: 'Last Recorded Activity',
  // Shown beside the figures: what a "completed connection" is, and why open tunnels are missing.
  note: 'Completed connections are HTTPS tunnels (and any plain-HTTP requests) recorded by the proxy when they close. '
    + 'One tunnel can carry many requests, so this is not a request count. Tunnels that are still open are not in these totals yet. '
    + 'All periods use UTC.',
  averageNote: 'Total transferred ÷ completed connections for the period; not the size of any single connection.',
};

const COUNTER = /^(0|[1-9]\d*)$/;

/** A decimal counter string (or bigint, or safe integer) as a BigInt; null if it isn't one. */
export function toCounter(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value === 'string' && COUNTER.test(value) && value.length <= 40) return BigInt(value);
  return null;
}

/** numerator ÷ denominator, rounded half up (BigInt). */
const roundedRatio = (numerator, denominator) => (numerator * 2n + denominator) / (2n * denominator);

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

/**
 * Bytes in decimal units (1 KB = 1,000 bytes) with three significant digits: "0 B", "999 B",
 * "1.23 KB", "45.6 GB", "18.4 EB". Exact for any size (BigInt arithmetic). '—' for invalid input.
 */
export function formatBytes(value) {
  const bytes = toCounter(value);
  if (bytes === null) return '—';
  if (bytes < 1000n) return `${bytes} B`;
  let unit = 0;
  let scale = 1n;
  while (unit < UNITS.length - 1 && bytes >= scale * 1000n) {
    scale *= 1000n;
    unit++;
  }
  // Round at the precision that gives three significant digits; if rounding reaches 1000 of a unit
  // (e.g. 999,999 B), show 1.00 of the next one.
  for (;;) {
    const hundredths = roundedRatio(bytes * 100n, scale);
    if (hundredths < 1000n) return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')} ${UNITS[unit]}`;
    const tenths = roundedRatio(bytes * 10n, scale);
    if (tenths < 1000n) return `${tenths / 10n}.${tenths % 10n} ${UNITS[unit]}`;
    const whole = roundedRatio(bytes, scale);
    if (whole < 1000n || unit === UNITS.length - 1) return `${whole} ${UNITS[unit]}`;
    scale *= 1000n;
    unit++;
  }
}

/** Exact byte count with thousands separators, for tooltips: "1,234,567 bytes". */
export const formatExactBytes = (value) => {
  const bytes = toCounter(value);
  return bytes === null ? '—' : `${formatCount(bytes)} ${bytes === 1n ? 'byte' : 'bytes'}`;
};

/** A count with thousands separators ("12,345"), exact at any size. */
export function formatCount(value) {
  const count = toCounter(value);
  return count === null ? '—' : count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The average per completed connection, or a dash when there were none. */
export const formatAverage = (value) => (value === null || value === undefined ? '—' : formatBytes(value));

export function formatDateTime(value) {
  if (!value) return 'No activity recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1 Nov 2026" for a UTC YYYY-MM-DD day (no local time-zone shift). */
export function formatDay(day) {
  const [year, month, date] = String(day).split('-').map(Number);
  return year && month && date ? `${date} ${MONTHS[month - 1]} ${year}` : '—';
}

/** The reporting period in words, e.g. "1 Nov 2026 – 18 Nov 2026 (UTC)". */
export function describePeriod(period) {
  if (!period) return '';
  if (period.name === 'all' || !period.from) return 'All recorded usage (UTC)';
  if (period.from === period.to) return `${formatDay(period.from)} (UTC)`;
  return `${formatDay(period.from)} – ${formatDay(period.to)} (UTC)`;
}

export const periodLabel = (id) => PERIODS.find((p) => p.id === id)?.label ?? id;

export function addDays(day, count) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/**
 * The chart's date range for a summary period, using the server's dates (not the browser's clock;
 * `generatedAt` supplies today for "all", which has no end date):
 *   today → the last 30 days; month → this month to date; all → the last 90 days (all-time totals
 *   above, a recent window in the chart, labelled as such).
 */
export function chartRange(period, generatedAt) {
  const to = period.to ?? String(generatedAt).slice(0, 10);
  if (period.name === 'month') return { from: period.from, to, label: 'This month (UTC)' };
  const days = period.name === 'all' ? ALL_TIME_CHART_DAYS : TODAY_CHART_DAYS;
  return { from: addDays(to, -(days - 1)), to, label: `Last ${days} days (UTC)` };
}

// ---- Response validation: a malformed response is an error, never zeroes ----

const isCounter = (v) => typeof v === 'string' && COUNTER.test(v);
const isAverage = (v) => v === null || isCounter(v);
const isDateOrNull = (v) => v === null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));
const isTotals = (t) => t && typeof t === 'object'
  && ['bytesDown', 'bytesUp', 'bytesTotal', 'transactions'].every((k) => isCounter(t[k])) && isAverage(t.avgBytesPerTransaction);
const isPeriod = (p) => p && PERIODS.some((x) => x.id === p.name) && (p.from === null || typeof p.from === 'string');

export function isValidSummary(data) {
  return Boolean(data && isPeriod(data.period) && isDateOrNull(data.generatedAt) && typeof data.generatedAt === 'string'
    && isTotals(data.total) && isDateOrNull(data.total.lastActivityAt)
    && isTotals(data.attributed) && Number.isInteger(data.attributed.users)
    && (data.unattributed === null || isTotals(data.unattributed)));
}

export function isValidUserPage(data) {
  return Boolean(data && isPeriod(data.period) && Number.isInteger(data.page) && Number.isInteger(data.pageSize) && data.pageSize > 0
    && Number.isInteger(data.total) && Number.isInteger(data.withUsage) && Array.isArray(data.users)
    && data.users.every((u) => typeof u.id === 'string' && typeof u.email === 'string' && isTotals(u) && isDateOrNull(u.lastActivityAt)));
}

export function isValidServerList(data) {
  return Boolean(data && isPeriod(data.period) && Array.isArray(data.servers)
    && data.servers.every((s) => typeof s.id === 'string' && typeof s.name === 'string' && typeof s.enabled === 'boolean'
      && isTotals(s) && Number.isInteger(s.users) && isTotals({ ...s.unattributed, avgBytesPerTransaction: null })));
}

export function isValidHistory(data) {
  return Boolean(data && typeof data.from === 'string' && typeof data.to === 'string' && Array.isArray(data.days)
    && data.days.every((d) => typeof d.date === 'string' && isTotals(d) && Number.isInteger(d.users)));
}

// ---- Chart ----

/**
 * Daily stacked bars (download + upload) for [from, to]. Every date in the range gets a bar; dates
 * the server didn't return are zero (never invented values). Heights are percentages of the largest
 * day, computed from BigInt ratios. `empty` is true when nothing was transferred in the range.
 */
export function chartBars(history, { from = history.from, to = history.to } = {}) {
  const byDate = new Map(history.days.map((d) => [d.date, d]));
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const d = byDate.get(day);
    days.push({
      date: day,
      down: toCounter(d?.bytesDown) ?? 0n,
      up: toCounter(d?.bytesUp) ?? 0n,
      transactions: toCounter(d?.transactions) ?? 0n,
    });
    if (days.length > 400) break; // the server allows at most 366 days
  }
  const max = days.reduce((m, d) => (d.down + d.up > m ? d.down + d.up : m), 0n);
  const percent = (part) => (max === 0n ? 0 : Number((part * 10000n) / max) / 100);
  return {
    empty: max === 0n,
    max,
    bars: days.map((d) => ({
      date: d.date,
      bytesDown: d.down.toString(),
      bytesUp: d.up.toString(),
      bytesTotal: (d.down + d.up).toString(),
      transactions: d.transactions.toString(),
      downPercent: percent(d.down),
      upPercent: percent(d.up),
    })),
  };
}

/** The hover/tooltip text for one bar. */
export const barLabel = (bar) => `${formatDay(bar.date)}: ${formatBytes(bar.bytesTotal)} transferred `
  + `(${TERMS.down.toLowerCase()} ${formatBytes(bar.bytesDown)}, ${TERMS.up.toLowerCase()} ${formatBytes(bar.bytesUp)}), `
  + `${formatCount(bar.transactions)} completed ${bar.transactions === '1' ? 'connection' : 'connections'}`;

// ---- Loading ----

const failure = (result) => (isAuthLoss(result) ? { state: 'auth', status: result.status } : { state: 'error', message: describeError(result) });
const unexpected = { state: 'error', message: 'The server returned unexpected data transfer figures.' };

/**
 * Loads one period of the Data Transfer page: summary, a page of users, servers and the chart's
 * history, together, so the cards and tables always show the same period. Resolves to
 *   { state: 'ready', period, summary, users, servers, history, chart }
 *   { state: 'auth', status }   the session ended or is no longer an active admin
 *   { state: 'error', message } unreachable, failed, or malformed (no partial figures)
 */
export async function loadOverview(api, { period = DEFAULT_PERIOD, page = 1 } = {}) {
  const [summary, users, servers] = await Promise.all([
    api.usageSummary({ period }),
    api.usageUsers({ period, page, pageSize: USERS_PAGE_SIZE }),
    api.usageServers({ period }),
  ]);
  for (const result of [summary, users, servers]) if (!result.ok) return failure(result);
  if (!isValidSummary(summary.data) || !isValidUserPage(users.data) || !isValidServerList(servers.data)) return unexpected;

  const range = chartRange(summary.data.period, summary.data.generatedAt);
  const history = await api.usageHistory({ from: range.from, to: range.to });
  if (!history.ok) return failure(history);
  if (!isValidHistory(history.data)) return unexpected;

  return {
    state: 'ready',
    period: summary.data.period,
    summary: summary.data,
    users: users.data,
    servers: servers.data.servers,
    history: history.data,
    chart: { ...chartBars(history.data, range), label: range.label },
  };
}

/**
 * One user's totals for today, this month and all time (three summary requests with userId), for
 * the user details page. Resolves to { state: 'ready', periods: { today, month, all } } or the same
 * auth / error states as loadOverview(); a deleted user is { state: 'missing' }.
 */
export async function loadUserUsage(api, userId) {
  const results = await Promise.all(PERIODS.map((p) => api.usageSummary({ period: p.id, userId })));
  for (const result of results) {
    if (!result.ok) return result.status === 404 && result.code === 'USER_NOT_FOUND' ? { state: 'missing' } : failure(result);
  }
  if (!results.every((r) => isValidSummary(r.data))) return unexpected;
  return { state: 'ready', periods: Object.fromEntries(PERIODS.map((p, i) => [p.id, results[i].data.total])) };
}
