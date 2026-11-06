# Deploying HoppLink Web

Every push to `main` is tested, built and published to the production server by
[.github/workflows/deploy.yml](../.github/workflows/deploy.yml). It uses GitHub Actions, AWS OIDC, AWS
Systems Manager (SSM), Git and Nginx.

The deployment touches only the website. It never restarts the API, changes the database or changes the
Nginx configuration, and it deploys independently of HoppLink Server.

## How API requests reach the server

The frontend only uses relative `/api/...` paths, so nothing about the API's address is built into it. The
development proxy in `vite.config.js` doesn't exist in a production build. In production, Nginx forwards the
website's `/api/` to `127.0.0.1:3000`, and the browser sees one origin, so no CORS is involved and the session
cookie belongs to the website.

**This needs one change to the server's authentication settings.** Better Auth checks the `Origin` of requests
that carry a cookie, such as signing out and administrator actions, and the website is a different origin from
the API's `BETTER_AUTH_URL`. Add it to `/opt/hopplink/server/.env`, keeping any entries already there, then
restart the API by hand:

```bash
BETTER_AUTH_TRUSTED_ORIGINS=https://www.example.com
```

```bash
sudo systemctl restart hopplink-server.service
```

Don't rewrite the `Origin` header in Nginx instead, because that would defeat the server's CSRF check. Until
the origin is trusted, the deployment's verification fails with a message naming this setting.

## How a deployment runs

1. **Test and build:** the `test` job checks out the pushed commit and runs `npm ci`, `npm test` and
   `npm run build`. It has no AWS access. If it fails, the `deploy` job doesn't run.
2. **Authenticate:** the `deploy` job assumes the deployment role through OIDC.
3. **Deploy:** [deploy/central/ssm-deploy.sh](../deploy/central/ssm-deploy.sh) asks SSM to run
   `/usr/local/sbin/hopplink-deploy-web <sha>`, waits for it, and fails the workflow unless it succeeds.
4. **Verify:** [scripts/verify-web-deployment.js](../scripts/verify-web-deployment.js) checks from outside
   that `/release.json` names this commit, the page is the built frontend, its assets are served as files,
   `/api/v1/health` reaches HoppLink Server through both the website and the public API, and the server trusts
   the website's origin.

Only one web deployment runs at a time, and a running one is never cancelled. If several commits are pushed
quickly, GitHub keeps only the newest waiting run, which includes the earlier commits.

The script on the server ([deploy/central/deploy-web.sh](../deploy/central/deploy-web.sh)) takes a lock, checks
the layout and checkout, fetches `main`, confirms the commit is part of `main`, checks it out, and builds it as
`hopplink`. It copies `dist/` into a root-owned staging directory, checks it, renames it to a release, and then
atomically switches the document root symlink. The live site isn't touched until all of that has succeeded.

```text
/var/www/hopplink                    symlink to the live release (the Nginx document root)
/var/www/hopplink-releases/<sha>/    a published release, with its release.json
/var/www/hopplink-releases/previous  symlink to the release before the live one
```

The newest five commit-named releases are kept, along with the live and previous ones.

## Setting it up

These steps are manual and need doing once. **Do them before pushing, because a push deploys straight away.**
Until they're done, a deployment fails without switching the website, or fails verification.

### IAM

The deployment role's trust policy must allow this repository's `main` branch, which is a separate entry from
HoppLink Server's: `repo:<owner>/HoppLink-Web:ref:refs/heads/main`. The role needs `ssm:SendCommand` for the
`AWS-RunShellScript` document and the instance, and `ssm:GetCommandInvocation`.

### GitHub repository variables

Set these on this repository under **Settings → Secrets and variables → Actions → Variables**. They aren't
secrets, but they stay out of Git. No secrets are stored in GitHub.

| Variable | Example |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<account-id>:role/<role-name>` |
| `AWS_REGION` | `<aws-region>` |
| `EC2_INSTANCE_ID` | `<instance-id>` |
| `PUBLIC_WEB_URL` | `https://www.example.com` |
| `PUBLIC_API_URL` | `https://api.example.com` |

### Read-only deploy key

GitHub allows a deploy key on only one repository, so this repository needs its own if the existing key belongs
to HoppLink Server. Generate one for the `hopplink` account:

```bash
sudo runuser -u hopplink -- ssh-keygen -t ed25519 -N '' -C hopplink-web-deploy -f /home/hopplink/.ssh/hopplink_web_deploy
```

Use the `hopplink` account's real home directory if it's a different one. Add the `.pub` file to this repository
under **Settings → Deploy keys**, with write access turned off. Then add this to that account's `~/.ssh/config`:

```text
Host github-hopplink-web
    HostName github.com
    User git
    IdentityFile ~/.ssh/hopplink_web_deploy
    IdentitiesOnly yes
```

### Checkout

`/opt/hopplink/web` must be owned by `hopplink`, have this repository as `origin`, and have no local changes to
tracked files. Point an existing checkout at the new key, then confirm it works:

```bash
sudo runuser -u hopplink -- git -C /opt/hopplink/web remote set-url origin git@github-hopplink-web:<owner>/HoppLink-Web.git
sudo runuser -u hopplink -- git -C /opt/hopplink/web fetch origin main
```

Node.js 24 must be installed system-wide, because the script uses a fixed `PATH`.

### Document root

Turn the document root into a symlink. The current landing page becomes a release you can return to:

```bash
sudo mkdir -p /var/www/hopplink-releases
sudo chown root:root /var/www/hopplink-releases
sudo mv /var/www/hopplink /var/www/hopplink-releases/landing
sudo ln -s /var/www/hopplink-releases/landing /var/www/hopplink
```

### Nginx

Add [deploy/central/nginx-web-locations.conf](../deploy/central/nginx-web-locations.conf) to the website's HTTPS
`server` block, replacing any `location /` it has. Leave its `listen`, `server_name`, `root` and certificate
lines alone, and don't change the API's `server` block. Then test and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The `location /` fallback serves the frontend for any address, while a missing file under `/assets/` stays a 404.

**Temporary homepage redirect.** `location = /` answers the homepage with an HTTP **302** to `/downloads`. This is
an Nginx change: it takes effect only once this file is installed again on the server and Nginx is reloaded, as
above. Deploying the website doesn't do it. Until then, the browser-side redirect in `src/home-redirect.js` sends
visitors on, but the server still answers `/` with the page and HTTP 200. Only `/` is redirected. The signed-in
application loads from `/login`, which the downloads page's **Sign in** links to, and its `#` addresses go there
too. To remove the redirect, delete the `location = /` block, `src/home-redirect.js` and its use in `src/main.js`, and
set **Sign in** back to `/`. Check it with:

```bash
curl -sI https://www.example.com/ | grep -iE '^(HTTP|location)'   # HTTP/2 302, location: …/downloads
curl -sI https://www.example.com/downloads | head -1                  # HTTP/2 200
curl -sI https://www.example.com/login | head -1                      # HTTP/2 200
```

### Deployment script

Install it from a checkout of the commit you've reviewed:

```bash
sudo install -o root -g root -m 0755 deploy/central/deploy-web.sh /usr/local/sbin/hopplink-deploy-web
```

It's installed outside the checkout because SSM runs it as root, and root must not run a file that `hopplink`
can edit. **Reinstall it the same way whenever `deploy-web.sh` changes.** Deployments print a warning if the
installed copy differs from the commit being built.

## Desktop app downloads

The public page at `/downloads` lists the desktop app builds described by a release manifest. The page is part of
the frontend, so every deployment updates it. The builds and the manifest are uploaded by hand over SSH, never
through Git, GitHub Actions or the website, and live in their own directory:

```text
/srv/hopplink-downloads/                 builds and manifest.json, root-owned; served at /downloads/releases/
```

It's outside `/var/www/hopplink` and `/var/www/hopplink-releases`, which deployments replace and prune, and outside
the checkout in `/opt/hopplink/web`, so a deployment never changes or deletes an upload. `deploy-web.sh` doesn't
refer to it.

### One-time setup

Create the directory. It must be a real directory, not a symlink, because Nginx refuses to follow symlinks there:

```bash
sudo install -d -o root -g root -m 0755 /srv/hopplink-downloads
```

Then install the updated [deploy/central/nginx-web-locations.conf](../deploy/central/nginx-web-locations.conf) in the
website's HTTPS `server` block as described under [Nginx](#nginx), and test and reload. It adds three locations:

- `= /downloads/releases/manifest.json`: the manifest, as JSON, never cached;
- a regex location for builds: only one plain file name ending in `.zip`, `.dmg`, `.pkg`, `.msi` or `.exe`. It
  starts with a letter or digit and has no slash, so there's no subdirectory, `..` or hidden file. Each build is
  sent as an attachment of type `application/octet-stream`;
- `/downloads/releases/`: everything else there is a 404, so there's no directory listing and never the page fallback.

All three allow only `GET` and `HEAD` and refuse symlinks. Nginx only sends these files: nothing there is run, and
visitors can't upload anything. The locations belong in the HTTPS server block only, so downloads are served over
HTTPS like the site. If the server block has other regex locations that could match these extensions, put the build
location before them. Until the locations are installed, `/downloads` shows "Downloads coming soon".

### Publishing a release

Build names should include the version, for example `HoppLink-0.1.0-win-x64.zip`, and a name should never be reused
for different content, because builds may be cached for an hour.

1. Copy the builds to your home directory on the server:

   ```bash
   scp HoppLink-0.1.0-win-x64.zip HoppLink-0.1.0-osx-arm64.zip HoppLink-0.1.0-osx-x64.zip <user>@<central-host>:~/
   ```

2. On the server, install each build root-owned and read-only, then note its size and checksum for the manifest:

   ```bash
   sudo install -o root -g root -m 0644 ~/HoppLink-0.1.0-win-x64.zip /srv/hopplink-downloads/
   stat -c '%s %n' /srv/hopplink-downloads/HoppLink-0.1.0-*.zip
   sha256sum /srv/hopplink-downloads/HoppLink-0.1.0-*.zip
   ```

3. Write `manifest.json` in your home directory, check that it's valid JSON, and install it **last**, through a
   temporary name and an atomic rename, so the page never lists a build that isn't there yet:

   ```bash
   python3 -m json.tool ~/manifest.json > /dev/null
   sudo install -o root -g root -m 0644 ~/manifest.json /srv/hopplink-downloads/.manifest.json.new
   sudo mv -T /srv/hopplink-downloads/.manifest.json.new /srv/hopplink-downloads/manifest.json
   ```

4. Check from outside:

   ```bash
   curl -fsS https://www.example.com/downloads/releases/manifest.json
   curl -fsSI https://www.example.com/downloads/releases/HoppLink-0.1.0-win-x64.zip
   ```

Remove old builds only after a manifest that no longer lists them is live. To withdraw every download, remove
`manifest.json`, and the page shows "Downloads coming soon" again.

### The manifest

```json
{
  "version": "0.1.0",
  "releaseDate": "2026-11-05",
  "notes": ["First public beta."],
  "downloads": {
    "windows-x64": { "file": "HoppLink-0.1.0-win-x64.zip", "size": 84213760, "sha256": "<64 hex characters>" },
    "macos-arm64": { "file": "HoppLink-0.1.0-osx-arm64.zip" },
    "macos-x64": { "file": "HoppLink-0.1.0-osx-x64.zip" }
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `version` | yes, unless every build has its own | `1.2.3` or `1.2.3-beta.1` |
| `releaseDate` | no | `YYYY-MM-DD`, shown in UTC |
| `notes` | no | release notes: a string or up to 10 strings, shown as plain text |
| `downloads` | yes | builds by platform: `windows-x64`, `macos-arm64` (Apple Silicon) and `macos-x64` (Intel) |
| `downloads.*.file` | yes | the build's file name in `/srv/hopplink-downloads`, as allowed by the Nginx location above |
| `downloads.*.size` | no | size in bytes, shown on the page |
| `downloads.*.sha256` | no | SHA-256 checksum, shown on the page |
| `downloads.*.version`, `releaseDate` | no | overrides the release's, for a platform rebuilt on its own |

The page treats the manifest as untrusted. Only the platforms above are offered, and only when they have a valid
file name and version. Anything invalid is left out, and with nothing left the page shows "Downloads coming soon".
Links are always `/downloads/releases/<file>` on the same site: any URL in the manifest is ignored. Everything else
is shown as text, never as HTML.

## Troubleshooting

**GitHub Actions:** open the repository's **Actions** tab, then **Deploy Web**, then the run.

**SSM:** the workflow prints the command ID. These show recent commands and their output:

```bash
aws ssm list-command-invocations --instance-id <instance-id> --details --max-items 5
aws ssm get-command-invocation --command-id <command-id> --instance-id <instance-id>
```

**On the server:**

```bash
readlink -f /var/www/hopplink
cat /var/www/hopplink/release.json
sudo tail -n 50 /var/log/nginx/error.log
```

| What happened | What to check |
| --- | --- |
| Authentication to AWS failed | The role's trust policy allows this repository, and the repository variables are right. |
| `must be a symlink` | The document root step above. |
| `git fetch failed` | The deploy key and SSH config. The website wasn't switched. |
| `another web deployment is already running` | Nothing changed. Wait for it, or check for a stuck run. |
| The dependency install or build failed | The output in the SSM step. The website wasn't switched. |
| `release`: the live release is something else | Nginx's `root` is the document root, and the `release.json` location exists. |
| `page`: an asset returned a page | The `/assets/` location from the Nginx file is missing. |
| `website /api routing` failed | The `/api/` location from the Nginx file, and whether HoppLink Server is running. |
| `website origin` refused | `BETTER_AUTH_TRUSTED_ORIGINS`, and that the API was restarted after changing it. |
| The workflow gave up waiting | The command may still be running. Check SSM before retrying. |

Verification runs after the switch, so if it fails the new release is live. Fix the cause and re-run the
workflow, or roll back.

## Manual rollback

To return to the release before the live one, switch the symlink atomically:

```bash
sudo ln -sfn "$(readlink -f /var/www/hopplink-releases/previous)" /var/www/hopplink.next
sudo mv -T /var/www/hopplink.next /var/www/hopplink
```

To go to a specific commit on `main`, run the script. It reuses that commit's release if it's still there, and
otherwise builds it again:

```bash
sudo /usr/local/sbin/hopplink-deploy-web <full-40-character-sha>
```

Rollback needs no Nginx reload and doesn't affect the API or database. To stop the next push from replacing the
recovered release, revert the bad commit on `main`.
