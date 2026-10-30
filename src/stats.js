import { describeError } from './api.js';

const SUMMARY_FIELDS = ['totalUsers', 'activeUsers', 'registeredDevices', 'proxyServers', 'enabledProxyServers', 'activeSessions'];

/**
 * Loads GET /api/v1/admin/dashboard. A request already in flight is reused (no duplicates).
 * Resolves to one of:
 *   { state: 'ready', summary, recentUsers }
 *   { state: 'auth', status }       401/403: the session ended or is no longer an active admin
 *   { state: 'error', message }     server unreachable, failed, or returned something unexpected
 * It never invents values: a malformed response is an error, not zeroes.
 */
export function createStatsLoader(api) {
  let inFlight = null;

  async function fetchStats() {
    const result = await api.adminDashboard();
    if (!result.ok) {
      if (result.kind === 'http' && (result.status === 401 || result.status === 403)) return { state: 'auth', status: result.status };
      return { state: 'error', message: describeError(result) };
    }
    const summary = result.data?.summary;
    const recentUsers = result.data?.recentUsers;
    const valid = summary && SUMMARY_FIELDS.every((key) => Number.isInteger(summary[key]) && summary[key] >= 0) && Array.isArray(recentUsers);
    if (!valid) return { state: 'error', message: 'The server returned unexpected dashboard data.' };
    return { state: 'ready', summary, recentUsers };
  }

  return {
    load() {
      inFlight ??= fetchStats().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
