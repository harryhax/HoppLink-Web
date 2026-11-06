/**
 * Temporary, until there's a marketing homepage: the homepage / sends visitors to /downloads.
 *
 * In production, Nginx answers / with an HTTP 302 (deploy/central/nginx-web-locations.conf, "location = /"). This is
 * the browser-side equivalent, for the Vite dev server and for any server without that location. It replaces the
 * address rather than adding one, so Back doesn't return to / and redirect again. It's not an HTTP 302.
 *
 * The signed-in application (sign-in, registration, account and admin) loads from any other address, so it starts at
 * /login. Its admin pages use # addresses (#users, #transfer?period=day…), so an old /#users bookmark, which Nginx's
 * 302 turns into /downloads#users, goes to /login#users instead.
 *
 * To remove the redirect: delete this file and its use in main.js, the "location = /" block in Nginx, and set the
 * downloads page's Sign in link back to /.
 */
import { isDownloadsPath } from './downloads.js';

/** Where the signed-in application starts while / redirects. */
export const APP_PATH = '/login';
export const HOME_TARGET = '/downloads';

/** The admin pages' # addresses: see router.js. */
const APP_HASH = /^#(?:dashboard|users|servers|settings|transfer)(?:$|[/?])/;

/** Where to send the browser instead of `pathname` + `hash`, or null to show that address as it is. */
export function homeRedirect(pathname, hash = '') {
  const home = pathname === '/' || pathname === '/index.html';
  if ((home || isDownloadsPath(pathname)) && APP_HASH.test(hash ?? '')) return `${APP_PATH}${hash}`;
  return home ? HOME_TARGET : null;
}
