// Verifies a published website from the outside, with bounded retries. An HTTP 200 isn't enough, so it
// checks that this exact commit is live, its page and assets are served, and /api reaches the backend.
//
//   node scripts/verify-web-deployment.js <web-url> <api-url> <commit-sha>
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXPECTED_SERVICE = 'hopplink-server';
const REQUEST_TIMEOUT_MS = 8000;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const HTTPS_ORIGIN_PATTERN = /^https:\/\/[^/\s]+\/?$/;

/** The build's own files that a page refers to. */
export function assetPaths(html) {
  return [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]))];
}

/** Returns a reason when this isn't the built HoppLink frontend, for example the old landing page. */
export function findPageProblem(html) {
  if (!html.includes('<title>HoppLink</title>')) return 'the page title is not HoppLink';
  if (!html.includes('<div id="app">')) return 'the page has no application root';
  if (!/<script type="module"[^>]* src="\/assets\/[^"]+\.js"/.test(html)) return 'the page has no built module script';
  return null;
}

const isServerHealth = (body) => body?.status === 'ok' && body?.service === EXPECTED_SERVICE;

async function findProblems({ web, api, commit, fetchImpl }) {
  const request = (url, options = {}) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const problems = [];
  const check = async (name, run) => {
    try {
      const problem = await run();
      if (problem) problems.push(`${name}: ${problem}`);
    } catch (error) {
      problems.push(`${name}: ${error?.name ?? 'request failed'}`);
    }
  };
  const health = async (url) => {
    const response = await request(url);
    if (!response.ok) return `HTTP ${response.status}`;
    return isServerHealth(await response.json()) ? null : 'unexpected response values';
  };

  await check('page', async () => {
    const response = await request(`${web}/`);
    if (!response.ok) return `HTTP ${response.status}`;
    if (!(response.headers.get('content-type') ?? '').includes('text/html')) return 'not an HTML response';
    const html = await response.text();
    const problem = findPageProblem(html);
    if (problem) return problem;

    const assets = assetPaths(html);
    for (const path of assets) {
      const asset = await request(`${web}${path}`);
      const type = asset.headers.get('content-type') ?? '';
      if (!asset.ok) return `${path} returned HTTP ${asset.status}`;
      if (type.includes('text/html')) return `${path} returned a page instead of the file`;
      if (path.endsWith('.js') && !type.includes('javascript')) return `${path} is not served as JavaScript`;
      if (path.endsWith('.css') && !type.includes('text/css')) return `${path} is not served as CSS`;
    }
    return null;
  });

  await check('release', async () => {
    const response = await request(`${web}/release.json`);
    if (!response.ok) return `HTTP ${response.status}`;
    const release = await response.json();
    return release?.commit === commit ? null : `the live release is ${release?.commit ?? 'unknown'}`;
  });

  await check('website /api routing', () => health(`${web}/api/v1/health`));
  await check('public API', () => health(`${api}/api/v1/health`));

  // Better Auth checks the Origin of requests that carry a cookie. Without a session this changes
  // nothing, but a 403 means the server doesn't trust this website, so admin actions would be refused.
  await check('website origin', async () => {
    const response = await request(`${web}/api/v1/auth/sign-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: web, Cookie: 'hopplink-deploy-check=1' },
      body: '{}',
    });
    if (response.status === 403) return 'refused; add this website to BETTER_AUTH_TRUSTED_ORIGINS on the server';
    return response.status >= 500 ? `HTTP ${response.status}` : null;
  });

  return problems;
}

/** Resolves to true once every check passes in the same attempt, or false after `attempts`. */
export async function verifyDeployment({ webUrl, apiUrl, commit, attempts = 10, delayMs = 3000, fetchImpl = fetch, log = console.log }) {
  const web = webUrl.replace(/\/+$/, '');
  const api = apiUrl.replace(/\/+$/, '');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const problems = await findProblems({ web, api, commit, fetchImpl });
    if (problems.length === 0) {
      log(`Verification passed on attempt ${attempt}.`);
      return true;
    }
    log(`Attempt ${attempt} of ${attempts}: ${problems.join('; ')}`);
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

// Compares real paths, so that running it through a symlink can't skip the checks and exit successfully.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [webUrl, apiUrl, commit] = process.argv.slice(2);
  if (!HTTPS_ORIGIN_PATTERN.test(webUrl ?? '') || !HTTPS_ORIGIN_PATTERN.test(apiUrl ?? '') || !COMMIT_PATTERN.test(commit ?? '')) {
    console.error('usage: node scripts/verify-web-deployment.js <https-web-url> <https-api-url> <40-character-commit-sha>');
    process.exitCode = 2;
  } else if (!(await verifyDeployment({ webUrl, apiUrl, commit }))) {
    console.error('Verification failed.');
    process.exitCode = 1;
  }
}
