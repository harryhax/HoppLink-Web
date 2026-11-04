import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assetPaths, findPageProblem, verifyDeployment } from '../scripts/verify-web-deployment.js';
import { createApi } from '../src/api.js';

// Static checks of the deployment files, plus behaviour tests that use fakes. Nothing contacts AWS or a
// server, and invalid arguments stop deploy-web.sh before it does anything.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const code = (text) => text.split('\n').filter((line) => line.trim() !== '' && !/^\s*#/.test(line));
const sources = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? sources(join(dir, e.name))
  : /\.js$/.test(e.name) ? [join(dir, e.name)] : []));

const SHA = 'a'.repeat(40);
const DEPLOY = 'deploy/central/deploy-web.sh';
const SSM = 'deploy/central/ssm-deploy.sh';

const workflow = read('.github/workflows/deploy.yml');
const [beforeDeployJob, deployJob] = workflow.split(/^ {2}deploy:$/m);
const testJob = beforeDeployJob.split(/^ {2}test:$/m)[1];
const script = read(DEPLOY);
const scriptCode = code(script);
const nginx = read('deploy/central/nginx-web-locations.conf');
const nginxCode = code(nginx);
const guide = read('docs/deployment.md');

function assertInOrder(text, parts) {
  let position = -1;
  for (const part of parts) {
    const next = text.indexOf(part, position + 1);
    assert.ok(next > position, `expected "${part}" after position ${position}`);
    position = next;
  }
}

describe('deployment workflow', () => {
  test('triggers only on pushes to main', () => {
    assert.match(workflow, /^on:\n {2}push:\n {4}branches:\n {6}- main\n\n/m);
    assert.doesNotMatch(workflow, /pull_request|workflow_dispatch|schedule:/);
  });

  test('uses minimum permissions, with no AWS access for the test job', () => {
    assert.match(workflow, /^permissions:\n {2}id-token: write\n {2}contents: read\n/m);
    assert.match(testJob, /permissions:\n {6}contents: read\n/);
    assert.doesNotMatch(testJob, /id-token|configure-aws-credentials/);
  });

  test('tests and builds before any deployment step', () => {
    assertInOrder(testJob, ['run: npm ci', 'run: npm test', 'run: npm run build']);
    assert.match(deployJob, /^ {4}needs: test$/m);
  });

  test('a failed test or build cannot be bypassed', () => {
    assert.doesNotMatch(workflow, /continue-on-error|always\(\)|failure\(\)|^\s+if:/m);
  });

  test('tests and deploys the exact pushed commit', () => {
    for (const job of [testJob, deployJob]) {
      assert.match(job, /ref: \$\{\{ github\.sha \}\}/);
    }
    assert.match(deployJob, /COMMIT_SHA: \$\{\{ github\.sha \}\}/);
    assert.doesNotMatch(workflow, /git pull/);
  });

  test('waits for the deployment, then verifies it, then reports the commit', () => {
    assertInOrder(deployJob, [
      'configure-aws-credentials',
      `run: bash ${SSM}`,
      'verify-web-deployment.js "$PUBLIC_WEB_URL" "$PUBLIC_API_URL" "$COMMIT_SHA"',
      'Deployed commit: $COMMIT_SHA',
    ]);
  });

  test('serializes deployments, separately from the API, and never cancels a running one', () => {
    assert.match(workflow, /^concurrency:\n {2}group: production-web-deploy\n {2}cancel-in-progress: false$/m);
  });

  test('stores no credentials or real infrastructure identifiers', () => {
    assert.doesNotMatch(workflow, /secrets\.|aws-access-key-id|aws-secret-access-key/);
    for (const text of [workflow, script, read(SSM), guide, nginx]) {
      assert.doesNotMatch(text, /\b\d{12}\b/, 'AWS account ID');
      assert.doesNotMatch(text, /\bi-[0-9a-f]{8,17}\b/, 'EC2 instance ID');
    }
    for (const name of ['EC2_INSTANCE_ID', 'AWS_DEPLOY_ROLE_ARN', 'AWS_REGION', 'PUBLIC_WEB_URL', 'PUBLIC_API_URL']) {
      assert.match(deployJob, new RegExp(`vars\\.${name}`));
    }
  });

  test('does not use a GitHub environment, which would change the OIDC subject the role trusts', () => {
    assert.doesNotMatch(workflow, /^\s+environment:/m);
  });
});

describe('deploy-web.sh arguments', () => {
  const run = (...args) => spawnSync('bash', [join(ROOT, DEPLOY), ...args], { encoding: 'utf8', timeout: 10_000 });

  const invalid = {
    'a short SHA': 'abc1234',
    'a 39-character SHA': 'a'.repeat(39),
    'a 41-character SHA': 'a'.repeat(41),
    'uppercase hex': 'A'.repeat(40),
    'a non-hex character': `${'a'.repeat(39)}g`,
    'a branch name': 'main',
    'an empty value': '',
    'a shell injection': `${SHA}; reboot`,
    'a path traversal': '../../etc',
    'a trailing newline': `${SHA}\n`,
  };

  for (const [name, value] of Object.entries(invalid)) {
    test(`rejects ${name}`, () => {
      const result = run(value);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /complete 40-character lowercase Git SHA/);
    });
  }

  test('requires exactly one argument', () => {
    assert.match(run().stderr, /usage:/);
    assert.equal(run().status, 1);
    assert.equal(run(SHA, SHA).status, 1);
  });
});

describe('deploy-web.sh contents', () => {
  test('uses strict error handling', () => {
    assert.ok(scriptCode.includes('set -euo pipefail'));
  });

  test('runs in the documented order', () => {
    assertInOrder(script, [
      'flock -n 9',
      'as_app timeout 120 git fetch',
      'merge-base --is-ancestor "$COMMIT_SHA" refs/remotes/origin/main',
      'git checkout --quiet --detach "$COMMIT_SHA"',
      'as_app timeout 300 npm ci',
      'as_app timeout 300 npm run build',
      'mkdir "$STAGING_DIR"',
      'cp -R --no-dereference',
      'release.json',
      'mv -T "$STAGING_DIR" "$RELEASE_DIR"',
      'mv -T "$DOCUMENT_ROOT.next" "$DOCUMENT_ROOT"',
      'log "Deployment succeeded: $COMMIT_SHA"',
    ]);
  });

  test('verifies the exact commit is on main, and never deploys whatever is newest', () => {
    assert.match(script, /git cat-file -e "\$COMMIT_SHA\^\{commit\}"/);
    assert.match(script, /refs\/heads\/main:refs\/remotes\/origin\/main/);
    assert.doesNotMatch(script, /git pull|reset --hard/);
  });

  test('runs every git and npm command as the application account', () => {
    assert.ok(scriptCode.includes('readonly APP_USER=hopplink'));
    assert.match(script, /runuser -u "\$APP_USER" -- env -i /);
    const direct = /(^|[;&|(]\s*|\bif\s+!?\s*|\$\(\s*)(timeout\s+\d+\s+)?(git|npm)\s/;
    for (const line of scriptCode) {
      const withoutMessages = line.replace(/'[^']*'|"[^"]*"/g, "''").trim();
      assert.doesNotMatch(withoutMessages, direct, line);
    }
  });

  test('never publishes directly into the document root', () => {
    for (const line of scriptCode) {
      assert.doesNotMatch(line, /\b(cp|rsync|rm)\b.*\$DOCUMENT_ROOT(?!\.next)/, line);
    }
    assert.doesNotMatch(script, /ln -sfn/, 'ln -sf replaces a symlink in two steps, so it is not atomic');
  });

  test('a failed install or build stops before anything is published', () => {
    assert.match(script, /as_app timeout 300 npm ci \|\| fail 'dependency installation failed'/);
    assert.match(script, /as_app timeout 300 npm run build \|\| fail 'the build failed'/);
  });

  test('checks the release on a root-owned copy before it can go live', () => {
    assertInOrder(script, [
      'cp -R --no-dereference --no-preserve=all dist/. "$STAGING_DIR/"',
      '! -type f ! -type d',
      '<title>HoppLink</title>',
      'src="/assets/',
      'missing asset',
      '127.0.0.1:3000',
      'chown -R root:root "$STAGING_DIR"',
      'mv -T "$STAGING_DIR" "$RELEASE_DIR"',
    ]);
  });

  test('records this commit in the release, for verification from outside', () => {
    assert.ok(scriptCode.includes(`  printf '{"commit":"%s"}\\n' "$COMMIT_SHA" > "$STAGING_DIR/release.json"`));
  });

  test('keeps the previous release and removes staging on every exit', () => {
    assertInOrder(script, ['ln -s "$CURRENT_RELEASE" "$RELEASES_DIR/previous.next"', 'mv -T "$RELEASES_DIR/previous.next" "$RELEASES_DIR/previous"', 'mv -T "$DOCUMENT_ROOT.next"']);
    assert.match(script, /on_exit\(\) \{\n {2}local status=\$\?\n {2}rm -rf "\$STAGING_DIR"/);
    assert.ok(scriptCode.includes('trap on_exit EXIT'));
  });

  test('cleanup only removes commit-named releases, never the live or previous one', () => {
    assert.match(script, /-regex '\.\*\/\[0-9a-f\]\{40\}'/);
    assert.match(script, /if \[\[ \$old != "\$RELEASE_DIR" && \$old != "\$CURRENT_RELEASE" \]\]; then/);
  });

  test('refuses a document root that is not yet a symlink, before changing anything', () => {
    assertInOrder(script, ['[[ -L $DOCUMENT_ROOT ]] || fail', 'git fetch']);
  });

  test('verifies the checkout before changing it', () => {
    assertInOrder(script, ['.git ]]', '--show-toplevel', 'git remote get-url origin', 'git status --porcelain', 'git fetch']);
  });

  test('takes a non-blocking lock of its own, and keeps it from child processes', () => {
    assert.ok(scriptCode.includes('readonly LOCK_FILE=/run/hopplink-deploy-web.lock'));
    assert.match(script, /if ! flock -n 9; then\n {2}fail 'another web deployment is already running'/);
    assert.match(script, /"\$@" <\/dev\/null 9>&-/);
  });

  test('never touches the backend, database, Squid or Nginx configuration', () => {
    for (const line of [...scriptCode, ...code(read(SSM)), ...code(workflow)]) {
      assert.doesNotMatch(line, /systemctl|service\b|\bsudo\b|nginx|squid|db:|auth:|migrat|seed|psql|pg_dump|pg_restore|dropdb|createdb|\/opt\/hopplink\/server/i, line);
    }
  });

  test('deployment scripts are executable in Git', () => {
    for (const path of [DEPLOY, SSM]) {
      const result = spawnSync('git', ['ls-files', '--stage', path], { cwd: ROOT, encoding: 'utf8' });
      assert.match(result.stdout, /^100755 /, path);
    }
  });
});

describe('production API routing', () => {
  test('the frontend calls relative /api paths', async () => {
    const urls = [];
    const fetch = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const api = createApi({ fetch });

    await api.health();
    await api.getSession();
    await api.signIn('user@example.com', 'password');
    await api.signOut();

    assert.deepEqual(urls, ['/api/v1/health', '/api/v1/auth/get-session', '/api/v1/auth/sign-in/email', '/api/v1/auth/sign-out']);
  });

  test('the application creates its client with no base URL', () => {
    assert.match(read('src/main.js'), /createApi\(\)/);
  });

  test('no API address or build-time setting is in the source', () => {
    for (const file of sources('src')) {
      assert.doesNotMatch(read(file), /127\.0\.0\.1|localhost|PROXYMARKET_API_TARGET|import\.meta\.env/, file);
    }
  });

  test('the development proxy applies only to the dev server', () => {
    assert.match(read('vite.config.js'), /server: \{[\s\S]*proxy: \{/);
    assert.doesNotMatch(read('vite.config.js'), /preview:|define:/);
  });
});

describe('Nginx locations', () => {
  test('forward /api to the local server with the path unchanged', () => {
    assert.match(nginx, /location \/api\/ \{\n {4}proxy_pass http:\/\/127\.0\.0\.1:3000;/);
  });

  test('leave the browser Origin header alone, which keeps the CSRF check working', () => {
    assert.doesNotMatch(nginx, /proxy_set_header Origin/i);
  });

  test('serve the frontend for page refreshes, but never for a missing asset', () => {
    assert.match(nginx, /location \/ \{\n {4}try_files \$uri \/index\.html;/);
    assert.match(nginx, /location \/assets\/ \{\n {4}try_files \$uri =404;/);
    assert.match(nginx, /location = \/release\.json \{\n {4}try_files \$uri =404;/);
  });

  test('contain no certificates, server names or server blocks', () => {
    for (const line of nginxCode) {
      assert.doesNotMatch(line, /^\s*(server|server_name|listen|ssl_\w+|root)\b/, line);
    }
  });
});

describe('deployment verification', () => {
  const WEB = 'https://www.example.com';
  const API = 'https://api.example.com';
  const PAGE = `<!doctype html><html><head><title>HoppLink</title>
    <script type="module" crossorigin src="/assets/index-a1.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-b2.css"></head>
    <body><div id="app"></div></body></html>`;
  const HEALTH = { status: 'ok', service: 'hopplink-server', version: '0.1.0' };

  const json = (body, status = 200) => ({ status, type: 'application/json', body: JSON.stringify(body) });
  const healthy = () => ({
    [`${WEB}/`]: { status: 200, type: 'text/html', body: PAGE },
    [`${WEB}/assets/index-a1.js`]: { status: 200, type: 'text/javascript', body: 'x' },
    [`${WEB}/assets/index-b2.css`]: { status: 200, type: 'text/css', body: 'x' },
    [`${WEB}/release.json`]: json({ commit: SHA }),
    [`${WEB}/api/v1/health`]: json(HEALTH),
    [`${API}/api/v1/health`]: json(HEALTH),
    [`${WEB}/api/v1/auth/sign-out`]: json({ success: true }),
  });

  function fakeFetch(routes) {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, ...options });
      const route = routes[url];
      if (route instanceof Error) throw route;
      const { status, type, body } = route ?? { status: 404, type: 'text/plain', body: 'not found' };
      return {
        ok: status < 400,
        status,
        headers: { get: (name) => (name === 'content-type' ? type : null) },
        text: async () => body,
        json: async () => JSON.parse(body),
      };
    };
    return { fetchImpl, calls };
  }

  async function verify(overrides = {}, { attempts = 2 } = {}) {
    const { fetchImpl, calls } = fakeFetch({ ...healthy(), ...overrides });
    const logs = [];
    const passed = await verifyDeployment({ webUrl: `${WEB}/`, apiUrl: API, commit: SHA, attempts, delayMs: 0, fetchImpl, log: (l) => logs.push(l) });
    return { passed, calls, logs: logs.join('\n') };
  }

  test('passes for the built frontend of this commit', async () => {
    assert.equal((await verify()).passed, true);
  });

  const failures = {
    'the temporary landing page': { [`${WEB}/`]: { status: 200, type: 'text/html', body: '<html><title>Coming soon</title></html>' } },
    'a page with no built script': { [`${WEB}/`]: { status: 200, type: 'text/html', body: '<title>HoppLink</title><div id="app">' } },
    'a failing page': { [`${WEB}/`]: { status: 502, type: 'text/html', body: '' } },
    'a missing asset': { [`${WEB}/assets/index-a1.js`]: { status: 404, type: 'text/html', body: '' } },
    'an asset answered by the page fallback': { [`${WEB}/assets/index-a1.js`]: { status: 200, type: 'text/html', body: PAGE } },
    'a stylesheet of the wrong type': { [`${WEB}/assets/index-b2.css`]: { status: 200, type: 'text/plain', body: 'x' } },
    'another commit being live': { [`${WEB}/release.json`]: json({ commit: 'b'.repeat(40) }) },
    'no release marker': { [`${WEB}/release.json`]: { status: 404, type: 'text/plain', body: '' } },
    'a release marker answered by the page fallback': { [`${WEB}/release.json`]: { status: 200, type: 'text/html', body: PAGE } },
    '/api on the website not reaching the server': { [`${WEB}/api/v1/health`]: { status: 404, type: 'text/html', body: '' } },
    '/api on the website answered by the page fallback': { [`${WEB}/api/v1/health`]: { status: 200, type: 'text/html', body: PAGE } },
    'another service behind /api': { [`${WEB}/api/v1/health`]: json({ status: 'ok', service: 'something-else' }) },
    'an unhealthy public API': { [`${API}/api/v1/health`]: json({ status: 'error', service: 'hopplink-server' }) },
    'an unreachable public API': { [`${API}/api/v1/health`]: new TypeError('fetch failed') },
    'a server error for the origin check': { [`${WEB}/api/v1/auth/sign-out`]: json({}, 500) },
  };

  for (const [name, override] of Object.entries(failures)) {
    test(`fails on ${name}`, async () => {
      assert.equal((await verify(override)).passed, false);
    });
  }

  test('names the setting when the server does not trust the website', async () => {
    const result = await verify({ [`${WEB}/api/v1/auth/sign-out`]: json({ code: 'INVALID_ORIGIN' }, 403) });
    assert.equal(result.passed, false);
    assert.match(result.logs, /BETTER_AUTH_TRUSTED_ORIGINS/);
  });

  test('the origin check carries the website origin and no session', async () => {
    const { calls } = await verify();
    const probe = calls.find((c) => c.url === `${WEB}/api/v1/auth/sign-out`);
    assert.equal(probe.method, 'POST');
    assert.equal(probe.headers.Origin, WEB);
    assert.equal(probe.headers.Cookie, 'hopplink-deploy-check=1');
    assert.doesNotMatch(probe.headers.Cookie, /session/);
  });

  test('stops after the allowed number of attempts', async () => {
    const { calls } = await verify({ [`${WEB}/`]: { status: 502, type: 'text/html', body: '' } }, { attempts: 3 });
    assert.equal(calls.filter((c) => c.url === `${WEB}/`).length, 3);
  });

  test('retries until the release is live', async () => {
    const routes = healthy();
    const { fetchImpl: base } = fakeFetch(routes);
    let remaining = 2;
    const fetchImpl = async (url, options) => {
      if (url === `${WEB}/release.json` && remaining-- > 0) throw new TypeError('fetch failed');
      return base(url, options);
    };
    assert.equal(await verifyDeployment({ webUrl: WEB, apiUrl: API, commit: SHA, attempts: 3, delayMs: 0, fetchImpl, log: () => {} }), true);
  });

  test('finds each asset once', () => {
    assert.deepEqual(assetPaths(`${PAGE}${PAGE}`), ['/assets/index-a1.js', '/assets/index-b2.css']);
  });

  test('recognizes the built page', () => {
    assert.equal(findPageProblem(PAGE), null);
    assert.ok(findPageProblem(read('index.html')), 'the unbuilt page has no /assets script');
  });

  for (const args of [[], ['http://www.example.com', API, SHA], [WEB, 'http://api.example.com', SHA], [WEB, API, 'main'], [`${WEB}/path`, API, SHA]]) {
    test(`exits with a usage error for: ${args.join(' ') || 'no arguments'}`, () => {
      const result = spawnSync(process.execPath, [join(ROOT, 'scripts/verify-web-deployment.js'), ...args], { encoding: 'utf8', timeout: 10_000 });
      assert.equal(result.status, 2);
    });
  }
});

describe('ssm-deploy.sh, with a fake AWS CLI', () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'hopplink-web-ssm-'));
    writeFileSync(join(dir, 'aws'), `#!/bin/bash
echo "$*" >> "$FAKE_DIR/calls"
case "$*" in
  *send-command*)
    [ -z "$FAKE_SEND_FAILS" ] || { echo 'AccessDenied' >&2; exit 254; }
    echo command-1
    ;;
  *'--query Status'*)
    echo poll >> "$FAKE_DIR/polls"
    sed -n "$(($(wc -l < "$FAKE_DIR/polls")))p" "$FAKE_DIR/statuses"
    ;;
  *StandardOutputContent*) echo 'remote stdout marker' ;;
  *StandardErrorContent*) echo 'remote stderr marker' ;;
esac
`);
    chmodSync(join(dir, 'aws'), 0o755);
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  function deploy({ statuses = [], commit = SHA, env = {} } = {}) {
    writeFileSync(join(dir, 'statuses'), statuses.map((s) => `${s}\n`).join(''));
    rmSync(join(dir, 'polls'), { force: true });
    writeFileSync(join(dir, 'calls'), '');
    const result = spawnSync('bash', [join(ROOT, SSM)], {
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        FAKE_DIR: dir,
        COMMIT_SHA: commit,
        INSTANCE_ID: 'instance-under-test',
        POLL_INTERVAL_SECONDS: '0',
        ...env,
      },
    });
    return { ...result, calls: readFileSync(join(dir, 'calls'), 'utf8') };
  }

  test('sends the exact commit to the installed web script and succeeds on Success', () => {
    const result = deploy({ statuses: ['Success'] });
    assert.equal(result.status, 0);
    assert.ok(result.calls.includes(`/usr/local/sbin/hopplink-deploy-web ${SHA}`));
    assert.match(result.stdout, /remote stdout marker/);
  });

  test('keeps waiting while the command is in progress', () => {
    assert.equal(deploy({ statuses: ['Pending', 'InProgress', 'Success'] }).status, 0);
  });

  for (const status of ['Failed', 'TimedOut', 'Cancelled']) {
    test(`fails and shows the remote output when the status is ${status}`, () => {
      const result = deploy({ statuses: ['InProgress', status] });
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`remote deployment ended with status: ${status}`));
      assert.match(result.stdout, /remote stderr marker/);
    });
  }

  test('fails when the command cannot be sent', () => {
    const result = deploy({ env: { FAKE_SEND_FAILS: '1' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /could not send the SSM deployment command/);
  });

  test('fails when it gives up waiting', () => {
    const result = deploy({ env: { MAX_WAIT_SECONDS: '0' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /gave up waiting/);
  });

  test('rejects an invalid commit without calling AWS', () => {
    const result = deploy({ commit: 'main' });
    assert.equal(result.status, 1);
    assert.equal(result.calls, '');
  });
});

describe('deployment guide', () => {
  test('covers the variables, key, server preparation, script and rollback', () => {
    for (const text of ['AWS_DEPLOY_ROLE_ARN', 'PUBLIC_WEB_URL', 'PUBLIC_API_URL', 'Deploy keys', 'write access turned off', '/var/www/hopplink-releases/landing',
      'install -o root -g root -m 0755 deploy/central/deploy-web.sh /usr/local/sbin/hopplink-deploy-web', 'nginx -t', '## Manual rollback', '## Troubleshooting']) {
      assert.ok(guide.includes(text), text);
    }
  });

  test('documents the server authentication change', () => {
    assert.match(guide, /BETTER_AUTH_TRUSTED_ORIGINS=https:\/\//);
  });

  test('has an atomic rollback', () => {
    assertInOrder(guide, ['## Manual rollback', '/var/www/hopplink.next', 'mv -T /var/www/hopplink.next /var/www/hopplink']);
  });
});
