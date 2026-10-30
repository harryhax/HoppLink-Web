# Changelog

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
