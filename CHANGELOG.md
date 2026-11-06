# Changelog

## [Unreleased]

### Fixed
- **Empty error banners.** The red banner with Retry on Dashboard, Data Transfer, Users and Proxy Servers no longer
  appears without text. The main cause was CSS: Bootstrap's `.d-flex` overrode the `hidden` attribute, so the banner
  was always on screen, empty until an error filled it. `styles.css` now makes `hidden` win over display utilities.
  Also, a server message that was empty or only whitespace used to be shown as is. Now HoppLink's own wording replaces
  it, and a failure with nothing else to say reads "Unable to load data. Please try again." The banner's look and
  Retry are unchanged.

### Added
- **Public downloads page** at `/downloads`, with no sign-in. It lists the Windows (x64) and macOS (Apple Silicon and
  Intel) builds of the desktop app from a release manifest, with version, release date, size, checksum and release
  notes, plus a beta notice, or "Downloads coming soon" when nothing is published. The manifest is validated as
  untrusted input, and links always stay in `/downloads/releases/`. Builds are uploaded by hand to
  `/srv/hopplink-downloads` on the server, which deployments never touch, and need the new Nginx locations in
  `deploy/central/nginx-web-locations.conf` (see `docs/deployment.md`).
- **Sync to Squid** in Routing Rules: push a server's enabled rules to its Squid allowlist after confirming, with a
  stronger warning for an empty list, and see Synced, Pending or Failed as confirmed by the node. PAC routing is unchanged.
  Needs a HoppLink Server with the domain sync endpoints.
- **Routing Rules** on the Proxy Servers page: list, add, edit, enable, disable and delete a server's routing domains,
  copy them from another server, and view a read-only PAC preview. PAC routing doesn't use these rules yet. Needs
  a HoppLink Server with the routing domain and PAC preview endpoints.
- **Public registration** (Step 26). A new Settings page lets administrators turn public registration on or
  off, showing only states the server has confirmed. The sign-in page links to a registration screen, which
  shows the form only while the server reports registration is open. Needs HoppLink Server from the same step.
- **Automatic deployment** (Step 25, see `docs/deployment.md`). Each push to `main` is tested and built, then
  that exact commit is built on the server, published as a new release with an atomic switch, and verified
  from outside. The frontend's relative `/api` requests go through Nginx on the same origin.

### Changed
- **Health check requires `hopplink-server`** (Step 22A): the dashboard shows Connected only when the server
  reports exactly this service identifier, so it needs a server from the same step.
- **Renamed to HoppLink** (Step 22): the browser title, sign-in page, navigation, dashboard, dialogs and
  error messages now say HoppLink and HoppLink Server. Entries below keep the name in use at the time.
  Layout, styling and API calls are unchanged, as are internal identifiers (`PROXYMARKET_API_TARGET`,
  the package name).

### Added
- **Data Transfer page** (`#transfer`, sidebar item), from ProxyMarket Server's
  `GET /api/v1/admin/usage/*`:
  - a Today / This Month / All Time (UTC) selector that reloads everything together;
  - Total Transferred, Downloaded, Uploaded and Completed Connections cards, plus users with recorded
    activity, the average per completed connection and the last recorded activity;
  - a daily stacked download/upload chart in plain HTML/CSS, with tooltips and a table view;
  - Usage by User (paginated, largest first, linked to user details) and Usage by Proxy Server
    (disabled servers included) tables, and a Connection Statistics section;
  - an explanation that connections are recorded when they close; no live or duration figures.
- **User details:** a Data Transfer section with Today, This Month and All Time totals, completed
  connections, the average per connection and the last recorded activity.
- Byte and count formatting with `BigInt`, so totals beyond 2^53 stay exact.

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
