/**
 * The public downloads page's data: the release manifest uploaded next to the builds, read as untrusted input.
 *
 * The manifest and the builds live in a persistent server directory published at /downloads/releases/ (see
 * docs/deployment.md), outside the website's releases, so deployments never replace them. A download link is
 * always built here from a validated file name, never taken from the manifest, so a manifest can only point at a
 * file in that one directory.
 */

export const RELEASES_PATH = '/downloads/releases/';
export const MANIFEST_URL = `${RELEASES_PATH}manifest.json`;
export const MAX_MANIFEST_LENGTH = 64 * 1024; // characters: a real manifest is a few hundred

/** The platforms the page offers, in display order. Manifest keys outside this list are ignored. */
export const PLATFORMS = [
  { key: 'windows-x64', os: 'Windows', arch: '64-bit (x64)', icon: 'bi-windows' },
  { key: 'macos-arm64', os: 'macOS', arch: 'Apple Silicon', icon: 'bi-apple' },
  { key: 'macos-x64', os: 'macOS', arch: 'Intel', icon: 'bi-apple' },
];

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// A plain file name: starts with a letter or digit, then letters, digits, dot, dash or underscore. No slash,
// backslash, percent sign, space or "..", so it can't leave the releases directory or need encoding.
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FILE_TYPES = ['.zip', '.dmg', '.pkg', '.msi', '.exe'];
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_SIZE = 2 ** 40; // 1 TiB: anything larger is a mistake
const MAX_NOTES = 10;
const MAX_NOTE_LENGTH = 300;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => (Object.hasOwn(object, key) ? object[key] : undefined);

/** "1.2.3" or "1.2.3-beta.1", otherwise null. */
export function validVersion(value) {
  return typeof value === 'string' && value.length <= 64 && VERSION.test(value) ? value : null;
}

/** A real calendar date written YYYY-MM-DD, otherwise null. */
export function validDate(value) {
  if (typeof value !== 'string') return null;
  const match = DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

/** A file name the page may link to, otherwise null. */
export function validFileName(value) {
  if (typeof value !== 'string' || !FILE_NAME.test(value) || value.includes('..')) return null;
  const lower = value.toLowerCase();
  return FILE_TYPES.some((type) => lower.endsWith(type) && lower.length > type.length) ? value : null;
}

/** The link for a validated file name: always inside the releases directory, on this site. */
export function downloadUrl(file) {
  const name = validFileName(file);
  return name === null ? null : `${RELEASES_PATH}${encodeURIComponent(name)}`;
}

/** A size in bytes, as a positive whole number, otherwise null. */
export function validSize(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_SIZE ? value : null;
}

/** "84.2 MB" style, in decimal units as operating systems show downloads. */
export function formatSize(bytes) {
  if (validSize(bytes) === null) return null;
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  if (unit === 0) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** "5 November 2026", in UTC, so the date never shifts with the visitor's time zone. */
export function formatDate(value) {
  if (validDate(value) === null) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`));
}

/** Release notes: a string or a list of strings, trimmed, blank ones dropped, length and count limited. */
function validNotes(value) {
  const items = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  return items
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .slice(0, MAX_NOTES)
    .map((item) => (item.length > MAX_NOTE_LENGTH ? `${item.slice(0, MAX_NOTE_LENGTH - 1)}…` : item));
}

/**
 * Turns a parsed manifest into what the page shows. Everything is checked, and anything invalid is left out:
 * a build with an unusable file name or version isn't offered at all. Returns
 *   { state: 'ready', version, releaseDate, notes, downloads: [{ key, os, arch, icon, file, url, version, releaseDate, size, sha256 }] }
 * or { state: 'empty' } when nothing can be offered.
 */
export function parseManifest(data) {
  if (!isObject(data)) return { state: 'empty' };
  const version = validVersion(own(data, 'version'));
  const releaseDate = validDate(own(data, 'releaseDate'));
  const entries = isObject(own(data, 'downloads')) ? own(data, 'downloads') : {};

  const downloads = [];
  for (const platform of PLATFORMS) {
    const entry = own(entries, platform.key);
    if (!isObject(entry)) continue;
    const file = validFileName(own(entry, 'file'));
    // A build may have its own version and date, for example when only one platform was rebuilt.
    const buildVersion = own(entry, 'version') === undefined ? version : validVersion(own(entry, 'version'));
    if (file === null || buildVersion === null) continue;
    const buildDate = own(entry, 'releaseDate') === undefined ? releaseDate : validDate(own(entry, 'releaseDate'));
    const sha256 = typeof own(entry, 'sha256') === 'string' ? own(entry, 'sha256').toLowerCase() : null;
    downloads.push({
      ...platform,
      file,
      url: downloadUrl(file),
      version: buildVersion,
      releaseDate: buildDate,
      size: validSize(own(entry, 'size')),
      sha256: sha256 !== null && SHA256.test(sha256) ? sha256 : null,
    });
  }

  if (downloads.length === 0) return { state: 'empty' };
  return { state: 'ready', version, releaseDate, notes: validNotes(own(data, 'notes')), downloads };
}

/**
 * Fetches and checks the manifest. No manifest (404), or one that isn't valid JSON, means nothing has been
 * published yet: { state: 'empty' }. That includes the website's own page, which Nginx serves for unknown
 * addresses until /downloads/releases/ is configured. Only an unreachable or failing server is an error.
 */
export async function loadDownloads({ fetch: fetchImpl = globalThis.fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(MANIFEST_URL, { cache: 'no-cache', credentials: 'omit', headers: { accept: 'application/json' } });
  } catch {
    return { state: 'error', message: 'Unable to load downloads. Check your connection and try again.' };
  }
  if (response.status === 404 || response.status === 403) return { state: 'empty' };
  if (!response.ok) return { state: 'error', message: 'Unable to load downloads. Please try again.' };

  let body;
  try {
    body = await response.text();
  } catch {
    return { state: 'error', message: 'Unable to load downloads. Please try again.' };
  }
  if (body.length > MAX_MANIFEST_LENGTH) return { state: 'empty' };
  try {
    return parseManifest(JSON.parse(body));
  } catch {
    return { state: 'empty' };
  }
}

/** The page's own address: /downloads, with or without a trailing slash. Only exact matches. */
export function isDownloadsPath(pathname) {
  return pathname === '/downloads' || pathname === '/downloads/';
}
