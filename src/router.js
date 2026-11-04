/**
 * Hash routes for the admin area, so Back/Forward and refresh behave predictably:
 *   #dashboard (default) · #users?search=…&page=… · #users/<id> · #servers · #transfer?period=…&page=… · #settings
 */
const TRANSFER_PERIODS = ['today', 'month', 'all'];

export function parseRoute(hash) {
  const raw = (hash ?? '').replace(/^#/, '');
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  if (path === 'users') {
    const page = Number.parseInt(params.get('page') ?? '1', 10);
    return { name: 'users', search: params.get('search') ?? '', page: Number.isInteger(page) && page > 0 ? page : 1 };
  }
  if (path.startsWith('users/') && path.length > 'users/'.length) {
    try {
      return { name: 'user', id: decodeURIComponent(path.slice('users/'.length)) };
    } catch {
      return { name: 'users', search: '', page: 1 };
    }
  }
  if (path === 'servers') return { name: 'servers' };
  if (path === 'settings') return { name: 'settings' };
  if (path === 'transfer') {
    const page = Number.parseInt(params.get('page') ?? '1', 10);
    const period = TRANSFER_PERIODS.includes(params.get('period')) ? params.get('period') : 'month';
    return { name: 'transfer', period, page: Number.isInteger(page) && page > 0 ? page : 1 };
  }
  return { name: 'dashboard' };
}

export function usersHash({ search = '', page = 1 } = {}) {
  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `#users?${query}` : '#users';
}

export const userHash = (id) => `#users/${encodeURIComponent(id)}`;

/** The Data Transfer page's hash: the default period (month) and page 1 are left out. */
export function transferHash({ period = 'month', page = 1 } = {}) {
  const params = new URLSearchParams();
  if (period !== 'month') params.set('period', period);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `#transfer?${query}` : '#transfer';
}
