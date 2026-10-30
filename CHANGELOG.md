# Changelog

## [Unreleased]

### Added
- **Proxy server management:**
  - a list with assigned-user counts;
  - an add/edit form, with server-side validation messages kept in the open form;
  - confirmed disable and delete (deleting an assigned server is refused by the server and
    explained), all through the existing admin API.
- **User management:**
  - the Users page: server-side search by name or email, pagination of 20, and View Details;
  - user details: account, devices, assigned proxy and active sessions;
  - confirmed suspend and reactivate, promote and demote, through the server API;
  - hash-based navigation, so Back, Forward and refresh work.
- **Admin dashboard statistics:**
  - six summary cards and a Recently Registered Users table, from `GET /api/v1/admin/dashboard`;
  - loading placeholders, an empty state, and an error state with Retry (no invented values);
  - Refresh, without polling or duplicate requests;
  - on 401/403, the existing session handling decides what to show.

### Fixed
- A server `VALIDATION_ERROR` now shows the server's specific message (for example, an invalid host).
  It no longer shows the login-only "Enter a valid email address and password", which is kept for
  sign-in only.

## [0.1.0] - Initial web frontend

### Added
- A Vite + Bootstrap 5 + vanilla JavaScript project, with a same-origin `/api` development proxy to
  ProxyMarket Server.
- Sign-in with existing ProxyMarket accounts through Better Auth. It uses browser-managed HttpOnly
  cookies and stores no tokens.
- Session restore on load, with a connection error and Retry when the server is unreachable.
- Sign-out that never claims success unless the server confirms it.
- Routing by the server-reported role and status: administrator dashboard layout, regular-user
  account page, and access denied for suspended accounts.
- Tests for the API client and auth logic, using a fake `fetch`.
