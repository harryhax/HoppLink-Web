#!/bin/bash
# Builds and publishes one exact, already tested HoppLink Web commit. Run as root, by AWS Systems Manager
# or by hand for recovery:
#
#   /usr/local/sbin/hopplink-deploy-web <40-character-commit-sha>
#
# Install it root-owned, outside the application checkout, so the hopplink account can't change what
# root runs. See docs/deployment.md:
#
#   install -o root -g root -m 0755 deploy/central/deploy-web.sh /usr/local/sbin/hopplink-deploy-web
#
# Git and npm run as hopplink. Each release is a root-owned directory, and the Nginx document root is a
# symlink to the live one, switched atomically only after the release is complete. This script touches
# only the website: never the API service, the database, Squid or the Nginx configuration.
set -euo pipefail
umask 022
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

readonly APP_DIR=/opt/hopplink/web
readonly APP_USER=hopplink
readonly DOCUMENT_ROOT=/var/www/hopplink
readonly RELEASES_DIR=/var/www/hopplink-releases
readonly KEEP_RELEASES=5
readonly LOCK_FILE=/run/hopplink-deploy-web.lock

log() { printf '[deploy-web] %s\n' "$*"; }
fail() { printf '[deploy-web] ERROR: %s\n' "$*" >&2; exit 1; }

if [[ $# -ne 1 ]]; then
  fail "usage: $(basename "$0") <40-character-commit-sha>"
fi
if [[ ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  fail 'the commit must be a complete 40-character lowercase Git SHA'
fi
readonly COMMIT_SHA=$1

if [[ $EUID -ne 0 ]]; then
  fail 'must run as root so it can drop to the application account'
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  fail 'another web deployment is already running'
fi

readonly RELEASE_DIR=$RELEASES_DIR/$COMMIT_SHA
readonly STAGING_DIR=$RELEASES_DIR/.staging-$COMMIT_SHA

on_exit() {
  local status=$?
  rm -rf "$STAGING_DIR"
  if [[ $status -ne 0 ]]; then
    log "Deployment of $COMMIT_SHA failed. The published website was not switched."
  fi
}
trap on_exit EXIT

log "Deploying commit $COMMIT_SHA"

APP_HOME=$(getent passwd "$APP_USER" | cut -d: -f6) || fail "account $APP_USER does not exist"
[[ -n $APP_HOME ]] || fail "account $APP_USER has no home directory"

# Runs a command as the application account, with a minimal environment and without the lock.
as_app() {
  runuser -u "$APP_USER" -- env -i HOME="$APP_HOME" PATH="$PATH" LANG=C.UTF-8 GIT_TERMINAL_PROMPT=0 "$@" </dev/null 9>&-
}

log 'Checking the server layout'
[[ -L $DOCUMENT_ROOT ]] || fail "$DOCUMENT_ROOT must be a symlink to the live release; see docs/deployment.md"
[[ -d $RELEASES_DIR && $(stat -c %U "$RELEASES_DIR") == root ]] || fail "$RELEASES_DIR must be a directory owned by root"
[[ -d $APP_DIR/.git ]] || fail "$APP_DIR is not a Git checkout"
[[ $(stat -c %U "$APP_DIR") == "$APP_USER" ]] || fail "$APP_DIR is not owned by $APP_USER"
cd "$APP_DIR"
[[ $(as_app git rev-parse --show-toplevel) == "$APP_DIR" ]] || fail "$APP_DIR is not the repository root"
[[ $(as_app git remote get-url origin) =~ HoppLink-Web(\.git)?$ ]] || fail 'origin is not the HoppLink-Web repository'
[[ -z $(as_app git status --porcelain --untracked-files=no) ]] || fail 'tracked files have local changes; deployment stopped'

CURRENT_RELEASE=$(readlink -f "$DOCUMENT_ROOT") || fail "could not read $DOCUMENT_ROOT"
log "Current release: $CURRENT_RELEASE"

log 'Fetching main'
as_app timeout 120 git fetch --no-tags --prune origin '+refs/heads/main:refs/remotes/origin/main' \
  || fail 'git fetch failed'
as_app git cat-file -e "$COMMIT_SHA^{commit}" 2>/dev/null || fail 'the commit was not found on main'
as_app git merge-base --is-ancestor "$COMMIT_SHA" refs/remotes/origin/main || fail 'the commit is not part of main'

if [[ $CURRENT_RELEASE == "$RELEASE_DIR" ]]; then
  log "Deployment succeeded: $COMMIT_SHA is already live."
  exit 0
fi

if [[ -d $RELEASE_DIR ]]; then
  log 'This commit was built earlier; reusing its release.'
else
  log 'Checking out the commit'
  as_app git checkout --quiet --detach "$COMMIT_SHA" || fail 'git checkout failed'
  [[ $(as_app git rev-parse HEAD) == "$COMMIT_SHA" ]] || fail 'the checkout is not on the requested commit'

  if ! cmp -s "${BASH_SOURCE[0]}" deploy/central/deploy-web.sh; then
    log 'WARNING: the installed deployment script differs from this commit; reinstall it (docs/deployment.md).'
  fi

  log 'Installing dependencies'
  as_app timeout 300 npm ci || fail 'dependency installation failed'

  log 'Building the frontend'
  as_app rm -rf dist
  as_app timeout 300 npm run build || fail 'the build failed'
  [[ -f dist/index.html ]] || fail 'the build did not produce dist/index.html'

  log 'Staging the release'
  rm -rf "$STAGING_DIR"
  mkdir "$STAGING_DIR"
  cp -R --no-dereference --no-preserve=all dist/. "$STAGING_DIR/"

  # Checked on the root-owned copy, which the application account can no longer change.
  if [[ -n $(find "$STAGING_DIR" ! -type f ! -type d -print -quit) ]]; then
    fail 'the build contains something other than files and directories'
  fi
  grep -q '<title>HoppLink</title>' "$STAGING_DIR/index.html" || fail 'the built page is not the HoppLink frontend'
  grep -Eq '<script type="module"[^>]* src="/assets/[^"]+\.js"' "$STAGING_DIR/index.html" || fail 'the built page has no module script'
  while read -r asset; do
    [[ -s $STAGING_DIR$asset ]] || fail "the built page refers to a missing asset: $asset"
  done < <(grep -Eo '(src|href)="/assets/[^"]+"' "$STAGING_DIR/index.html" | sed -E 's/^[a-z]+="//; s/"$//')
  if grep -rqF '127.0.0.1:3000' "$STAGING_DIR/assets"; then
    fail 'the build refers to the local development API'
  fi

  printf '{"commit":"%s"}\n' "$COMMIT_SHA" > "$STAGING_DIR/release.json"
  chown -R root:root "$STAGING_DIR"
  find "$STAGING_DIR" -type d -exec chmod 755 {} +
  find "$STAGING_DIR" -type f -exec chmod 644 {} +
  mv -T "$STAGING_DIR" "$RELEASE_DIR"
fi

log 'Switching the live release'
rm -f "$RELEASES_DIR/previous.next" "$DOCUMENT_ROOT.next"
ln -s "$CURRENT_RELEASE" "$RELEASES_DIR/previous.next"
mv -T "$RELEASES_DIR/previous.next" "$RELEASES_DIR/previous"
ln -s "$RELEASE_DIR" "$DOCUMENT_ROOT.next"
mv -T "$DOCUMENT_ROOT.next" "$DOCUMENT_ROOT"
log "Previous release kept for rollback: $CURRENT_RELEASE"

# Only commit-named builds are removed, never the live or previous release, or the original landing page.
find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '.*/[0-9a-f]{40}' -printf '%T@ %p\n' \
  | sort -rn | tail -n "+$((KEEP_RELEASES + 1))" | cut -d' ' -f2 \
  | while read -r old; do
      if [[ $old != "$RELEASE_DIR" && $old != "$CURRENT_RELEASE" ]]; then
        rm -rf "$old"
      fi
    done

log "Deployment succeeded: $COMMIT_SHA"
