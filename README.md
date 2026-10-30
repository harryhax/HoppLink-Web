# ProxyMarket Web

The browser interface for ProxyMarket. It's built with plain HTML, Bootstrap 5 and Bootstrap Icons,
vanilla ES modules, and Vite. It talks to [ProxyMarket Server](../ProxyMarket-Server) and uses the
same accounts as the desktop app.

**Status (0.1.0):**
- **Done:** sign-in, session restore and sign-out; the administrator layout and welcome dashboard;
  and a simple page for regular users.
- **Not yet:** user, proxy-server and assignment management, and dashboard statistics.

## Requirements

- Node.js 24 (`nvm use`) and npm
- A running ProxyMarket Server (default `http://127.0.0.1:3000`)

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

- **Endpoints:** Better Auth's endpoints on ProxyMarket Server: `sign-in/email`, `get-session` and
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
| `ADMIN` | Admin layout: sidebar (Dashboard; Users, Proxy Servers and Assignments marked "Soon"), top bar, welcome card, account details and server status |
| `USER` | Account page (name, email, "coming soon" note, sign out). No admin navigation. |
| Suspended | Access denied |
| Server unreachable | Connection error with Retry |

## Tests

```bash
npm test
```

They use the Node.js test runner with a fake `fetch`, so no browser or server is needed. They cover
sign-in, error handling, session restore, sign-out, and routing by role and status.
