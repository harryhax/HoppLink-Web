# Changelog

## [Unreleased]

### Removed
- **Proxy assignment administration.** Users will select an enabled proxy server themselves, so
  permanent assignments are gone (the Added entries below that mention them are historical):
  - the Proxy Assignments page, route (`#assignments`), sidebar item and Assign / Change Proxy dialog;
  - the user details "Assigned proxy" card and its Assign, Change and Remove actions;
  - the users list's Proxy Server column, the proxy server list's Assigned Users column, and the
    dashboard's Proxy Assignments card;
  - the assignment API client methods and error messages, including `SERVER_IN_USE`: any proxy
    server can now be deleted.

### Added
- **Proxy assignment management:**
  - the Proxy Assignments page: server-side search by user, email or proxy server; Assigned,
    Unassigned and All Users filters; pagination of 20; server status badges;
  - an Assign / Change Proxy dialog with a server-side user search and a server picker (enabled
    servers first, nothing pre-selected), shared with the user details page;
  - confirmed removal of an assignment only;
  - Assign, Change and Remove on the user details page, which reloads from the server afterwards.
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
