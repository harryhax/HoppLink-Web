// Thin wrapper over fetch for HoppLink Server (same origin: /api is proxied in development and
// should be served by the same HTTPS origin in production).
//
// The browser manages Better Auth's HttpOnly session cookie. This code never reads or stores tokens.

/**
 * @typedef {{ ok: true, status: number, data: any }
 *         | { ok: false, status: number, kind: 'network'|'http', code: string|null, data: any }} ApiResult
 */

/** A query string from the defined values only ("" when there are none); values are encoded. */
function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function createApi({ fetch: fetchImpl = globalThis.fetch.bind(globalThis), baseUrl = '', timeoutMs = 8000 } = {}) {
  /** @returns {Promise<ApiResult>} */
  async function request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(baseUrl + path, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return { ok: false, status: 0, kind: 'network', code: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK', data: null };
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    try {
      const text = await response.text();
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (response.ok) return { ok: true, status: response.status, data };
    // Better Auth errors look like {code,message}; HoppLink's own like {error:{code,message}}.
    const code = data?.code ?? data?.error?.code ?? null;
    // 502/503/504 from the dev proxy or a gateway mean the server itself is unreachable.
    const kind = response.status >= 502 && response.status <= 504 ? 'network' : 'http';
    return { ok: false, status: response.status, kind, code, data };
  }

  return {
    request,
    health: () => request('/api/v1/health'),
    getSession: () => request('/api/v1/auth/get-session'),
    signIn: (email, password) => request('/api/v1/auth/sign-in/email', { method: 'POST', body: { email, password } }),
    signOut: () => request('/api/v1/auth/sign-out', { method: 'POST', body: {} }),
    signUp: ({ name, email, password }) => request('/api/v1/auth/sign-up/email', { method: 'POST', body: { name, email, password } }),
    registrationAvailability: () => request('/api/v1/registration'),
    getRegistrationSetting: () => request('/api/v1/admin/settings/public-registration'),
    setRegistrationSetting: (publicRegistrationEnabled) => request('/api/v1/admin/settings/public-registration', { method: 'PUT', body: { publicRegistrationEnabled } }),
    accountMe: () => request('/api/v1/account/me'),
    adminDashboard: () => request('/api/v1/admin/dashboard'),
    listUsers: ({ search = '', page = 1, pageSize = 20 } = {}) => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set('search', search.trim());
      return request(`/api/v1/admin/users?${params}`);
    },
    getUser: (id) => request(`/api/v1/admin/users/${encodeURIComponent(id)}`),
    // Account changes go to Better Auth's admin endpoints (the server enforces every rule).
    suspendUser: (userId) => request('/api/v1/auth/admin/ban-user', { method: 'POST', body: { userId } }),
    reactivateUser: (userId) => request('/api/v1/auth/admin/unban-user', { method: 'POST', body: { userId } }),
    setUserRole: (userId, role) => request('/api/v1/auth/admin/set-role', { method: 'POST', body: { userId, role } }),
    listProxyServers: () => request('/api/v1/admin/proxy-servers'),
    createProxyServer: (server) => request('/api/v1/admin/proxy-servers', { method: 'POST', body: server }),
    updateProxyServer: (id, changes) => request(`/api/v1/admin/proxy-servers/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes }),
    deleteProxyServer: (id) => request(`/api/v1/admin/proxy-servers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    // Data transfer reports (read-only). Byte and transaction figures come back as decimal strings.
    usageSummary: ({ period, userId, serverId } = {}) => request(`/api/v1/admin/usage/summary${query({ period, userId, serverId })}`),
    usageUsers: ({ period, page, pageSize } = {}) => request(`/api/v1/admin/usage/users${query({ period, page, pageSize })}`),
    usageServers: ({ period } = {}) => request(`/api/v1/admin/usage/servers${query({ period })}`),
    usageHistory: ({ from, to, userId, serverId } = {}) => request(`/api/v1/admin/usage/history${query({ from, to, userId, serverId })}`),
  };
}

/** True only for a healthy response from HoppLink Server itself, identified by its exact service name. */
export function isHoppLinkServerHealth(data) {
  return data?.status === 'ok' && data?.service === 'hopplink-server';
}

/** A short, user-facing explanation for a failed ApiResult. */
export function describeError(result) {
  if (result.kind === 'network') {
    return result.code === 'TIMEOUT'
      ? 'HoppLink Server did not respond in time. Try again in a moment.'
      : 'Cannot reach HoppLink Server. Check that it is running, then try again.';
  }
  switch (result.code) {
    case 'INVALID_EMAIL_OR_PASSWORD': return 'Incorrect email or password.';
    case 'BANNED_USER':
    case 'ACCOUNT_SUSPENDED': return 'This account is suspended. Contact an administrator.';
    case 'INVALID_EMAIL': return 'Enter a valid email address.';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL': return 'An account with this email already exists. Try signing in.';
    case 'PASSWORD_TOO_SHORT':
    case 'PASSWORD_TOO_LONG': return 'The password must be 8-128 characters.';
    // VALIDATION_ERROR falls through: the server's own message says which field is wrong.
    case 'YOU_CANNOT_BAN_YOURSELF': return 'You cannot suspend your own account.';
    case 'CANNOT_DEMOTE_YOURSELF': return 'You cannot remove your own administrator role.';
    case 'LAST_ADMINISTRATOR': return 'At least one active administrator must remain.';
    case 'USER_NOT_FOUND': return 'This user no longer exists.';
    case 'PROXY_SERVER_NOT_FOUND': return 'This proxy server no longer exists.';
    case 'MISSING_OR_NULL_ORIGIN':
    case 'INVALID_ORIGIN': return 'The server does not trust this website\'s address (check BETTER_AUTH_TRUSTED_ORIGINS on the server).';
    default:
      if (result.status === 429) return 'Too many attempts. Wait a few seconds and try again.';
      if (result.status >= 500) return `HoppLink Server had a problem (HTTP ${result.status}). Try again later.`;
      // Other refusals: show the server's own (safe, user-facing) message when it gives one.
      if (typeof (result.data?.message ?? result.data?.error?.message) === 'string') return result.data.message ?? result.data.error.message;
      return `The request failed (HTTP ${result.status}).`;
  }
}
