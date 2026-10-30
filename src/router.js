/**
 * Hash routes for the admin area, so Back/Forward and refresh behave predictably:
 *   #dashboard (default) · #users?search=…&page=… · #users/<id>
 */
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
