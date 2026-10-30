/**
 * Hash routes for the admin area, so Back/Forward and refresh behave predictably:
 *   #dashboard (default) · #users?search=…&page=… · #users/<id> · #servers
 *   #assignments?filter=…&search=…&page=…
 */
export function parseRoute(hash) {
  const raw = (hash ?? '').replace(/^#/, '');
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  if (path === 'users') return { name: 'users', ...readListParams(params) };
  if (path.startsWith('users/') && path.length > 'users/'.length) {
    try {
      return { name: 'user', id: decodeURIComponent(path.slice('users/'.length)) };
    } catch {
      return { name: 'users', search: '', page: 1 };
    }
  }
  if (path === 'servers') return { name: 'servers' };
  if (path === 'assignments') {
    const filter = params.get('filter');
    return { name: 'assignments', ...readListParams(params), filter: ASSIGNMENT_FILTERS.includes(filter) ? filter : 'assigned' };
  }
  return { name: 'dashboard' };
}

export const ASSIGNMENT_FILTERS = ['all', 'assigned', 'unassigned'];

function readListParams(params) {
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  return { search: params.get('search') ?? '', page: Number.isInteger(page) && page > 0 ? page : 1 };
}

export function usersHash({ search = '', page = 1 } = {}) {
  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `#users?${query}` : '#users';
}

export const userHash = (id) => `#users/${encodeURIComponent(id)}`;

/** The default filter ('assigned') is left out, so #assignments is the plain assignments list. */
export function assignmentsHash({ filter = 'assigned', search = '', page = 1 } = {}) {
  const params = new URLSearchParams();
  if (filter !== 'assigned') params.set('filter', filter);
  if (search.trim()) params.set('search', search.trim());
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `#assignments?${query}` : '#assignments';
}
