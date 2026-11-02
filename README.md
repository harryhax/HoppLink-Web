# HoppLink Web

The browser interface for HoppLink. It's built with plain HTML, Bootstrap 5 and Bootstrap Icons,
vanilla ES modules, and Vite. It talks to [HoppLink Server](../ProxyMarket-Server) and uses the
same accounts as the desktop app.

**Status (0.1.0):**
- **Done:** sign-in, session restore and sign-out; the administrator layout, dashboard (with live
  statistics), user management and **proxy server management**; and a simple page for regular users.
- **Not yet:** server selection for users (they will choose an enabled server when connecting).

## Requirements

- Node.js 24 (`nvm use`) and npm
- A running HoppLink Server (default `http://127.0.0.1:3000`)

## Setup

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # production bundle in dist/
```

### Backend configuration

In development, the site calls the API on its own origin. Vite forwards `/api/*` to
`PROXYMARKET_API_TARGET` (default `http://127.0.0.1:3000`; see `.env.example`). So the browser
handles cookies itself, and no CORS is needed.

The server must trust the site's origin. In `ProxyMarket-Server/.env`:

```env
BETTER_AUTH_TRUSTED_ORIGINS=http://127.0.0.1:5173
```

Then restart the server. Open the site at **`http://127.0.0.1:5173`**, not `localhost`, so it matches
that origin. The proxy deliberately forwards the browser's real `Origin`, because rewriting it would
defeat the server's CSRF check.

**In production,** serve the site and `/api` from the same HTTPS origin, for example behind a
reverse proxy, and set that origin on the server (`BETTER_AUTH_URL` / `BETTER_AUTH_TRUSTED_ORIGINS`).
No production address is built in, and no secrets belong in frontend environment variables.

## Authentication

- **Endpoints:** Better Auth's endpoints on HoppLink Server: `sign-in/email`, `get-session` and
  `sign-out`, plus `GET /api/v1/account/me` for the role and status.
- **Cookies:** the browser keeps Better Auth's **HttpOnly** session cookie. The page never reads,
  stores or receives a token, and doesn't use `localStorage` or `sessionStorage`.
- **On page load:** `get-session` restores the session. No session shows the sign-in page. A server
  that's unreachable shows a connection error with **Retry**, without signing you out.
- **Sign-out:** asks the server to end the session. If that fails, you stay signed in with a warning,
  because the page can't clear the HttpOnly cookie itself.
- **Roles:** the page uses the role from `/api/v1/account/me` only to choose which screen to show.
  The server enforces admin access on every admin endpoint.

## Pages

| Account | Page |
|---|---|
| Not signed in | Sign-in (email, password with show/hide) |
| `ADMIN` | Admin layout: sidebar (Dashboard, Users, Proxy Servers, Data Transfer), top bar, and the pages below |
| `USER` | Account page (name, email, "coming soon" note, sign out). No admin navigation. |
| Suspended | Access denied |
| Server unreachable | Connection error with Retry |

## Admin pages

Navigation uses the URL hash, so Back, Forward and refresh behave predictably:
- `#dashboard`
- `#users?search=…&page=…`
- `#users/<id>`
- `#servers`
- `#transfer?period=today|all&page=…` (This Month and page 1 are the defaults)

All data comes from HoppLink Server's API; the browser never touches the database.

### Users

- **List:** name, email, role, status, active devices, registration date and **View
  Details**. Newest first, 20 per page, with Previous and Next.
- **Search:** by name or email. The server does the search, with a 300 ms delay after typing.
- **Details page:**
  - account information;
  - devices, with revoked ones marked;
  - **Data Transfer:** downloaded, uploaded and total transferred, completed connections and the
    average per connection for Today, This Month and All Time, plus the last recorded activity. It
    loads separately, so a failure there never hides the account;
  - active sessions (an ID prefix, created and expiry times, and browser and IP; no tokens).
- **Actions:** **Suspend** / **Reactivate** and **Make Administrator** / **Remove Administrator
  Role**. Each needs confirmation, and the user is reloaded from the server afterwards; nothing changes
  optimistically.
- **Your own account:** the server refuses to suspend it or remove its admin role, and the page
  disables those buttons. The server also keeps at least one active administrator.

### Proxy Servers

- **List:** name, host, port, status (green Enabled / grey Disabled), created date,
  and Edit / Enable or Disable / Delete. "No proxy servers configured." when empty.
- **Add / Edit:** one form for name, host, port and enabled. It checks required fields and the port
  range (1–65535); the server validates the host and has the final say. If the server refuses, the
  form stays open with your values and shows its message. Save can't be sent twice.
- **Disable:** asks for confirmation first, because users can't select a disabled server.
  Enabling needs no confirmation.
- **Delete:** asks for confirmation, naming the server. Any server can be deleted.
- **Records only:** this manages HoppLink's records. It never stops, reconfigures or deletes an
  actual proxy, Squid or any other infrastructure.

### Data Transfer

Data transferred through the proxy network (the primary figure) and completed connections, from
`GET /api/v1/admin/usage/*`. Definitions are in HoppLink Server's `docs/usage-reporting.md`.
- **Period:** Today, This Month (default) or All Time, all in **UTC**. Changing it reloads the cards,
  chart and both tables together, and it's kept in the URL.
- **Cards:** Total Transferred, Downloaded, Uploaded and Completed Connections, then users with
  recorded activity, the average per completed connection and the last recorded activity.
- **Chart:** daily download and upload as stacked bars (plain HTML/CSS, no chart library), with a
  tooltip per day and a "Daily figures" table. It covers this month to date, the last 30 days (Today)
  or the last 90 days (All Time, labelled as such). Days without usage are zero.
- **Usage by User:** every user, largest total first, 20 per page; names link to the user's details.
  Users without usage show "No activity".
- **Usage by Proxy Server:** every server, disabled ones included and marked, largest total first,
  with the number of users with recorded activity. Server totals include unattributed usage
  (unknown proxy usernames).
- **Connection Statistics:** completed connections (attributed and unattributed) and the average per
  completed connection.
- **Terminology:** a completed connection is an HTTPS tunnel (or plain-HTTP request) recorded when it
  closes. One tunnel carries many requests, so this isn't a request count, and tunnels that are still
  open aren't in the totals yet. No live-connection or duration figures are shown, because none are
  measured yet.
- **Large numbers:** the server sends byte and transaction figures as decimal strings, and the page
  formats them with `BigInt` (decimal units: 1 KB = 1,000 bytes). Hover a value for the exact byte
  count.
- **Empty, error and session states:** zeroes and a "no usage reported" note when nothing has been
  collected; an error with **Retry** (figures hidden rather than shown as zeroes) when the server
  fails or returns malformed data; on 401/403 the session is re-checked as on the dashboard.

## Admin dashboard statistics

The dashboard loads `GET /api/v1/admin/dashboard` when it opens, and again when you press **Refresh**.
There's no polling, and a refresh while a load is running doesn't send a second request.

- **Five cards:**
  - Total Users and Active Users (not suspended);
  - Registered Devices (not revoked);
  - Proxy Servers, with the enabled count shown underneath;
  - Active Sessions. These are unexpired sessions, which is **not** the same as users online.
- **Recently Registered Users:** the 10 newest users, with role and status badges and the date in
  your local time zone.
- **Loading:** shows placeholders, never numbers.
- **Errors:** an error message with **Retry**. The figures are hidden rather than shown as zeroes.
- **401 / 403:** the page re-checks the session and shows the right screen (sign-in, account page or
  suspended).

The definitions of each figure are in HoppLink Server's README. Nothing is cached or stored in
the browser.

## Tests

```bash
npm test
```

They use the Node.js test runner with a fake `fetch`, so no browser or server is needed. They cover:
- sign-in, error handling, session restore, sign-out, and routing by role and status
  (`tests/auth.test.js`);
- the dashboard statistics loader (`tests/stats.test.js`);
- the user administration API calls, account actions and routes (`tests/admin-users.test.js`);
- proxy server API calls, form checks and actions, and that the removed assignment API and route
  are gone (`tests/proxy-servers.test.js`);
- data transfer reports: API calls, byte and large-number formatting, periods, chart mapping,
  response validation, loading, error and session states, user details totals, routes and
  terminology (`tests/data-transfer.test.js`).
