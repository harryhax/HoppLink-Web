# Changelog

## [Unreleased]

### Added
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
