import { describeError } from './api.js';
import { isAuthLoss } from './user-admin.js';

export const PREVIEW_NOTICE_TITLE = 'Preview Only';
export const PREVIEW_NOTICE = 'This PAC script is not active. Clients keep using the fixed PAC rules until PAC routing is enabled in a future deployment stage.';
export const PREVIEW_SQUID_NOTE = 'This preview also doesn\'t check whether Squid currently allows these destinations. Sync to Squid controls that separately.';

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * Catches obvious mistakes before sending. The server is authoritative: it applies the full hostname
 * rules, and its message is shown if it disagrees. Returns { error } or { domain }.
 */
export function validateDomain(value) {
  const domain = String(value ?? '').trim().toLowerCase();
  if (!domain) return { error: 'Enter a hostname or wildcard.' };
  if (domain.includes('://')) return { error: 'Enter only the hostname, without http:// or https://.' };
  if (/[/?#]/.test(domain)) return { error: 'Enter only the hostname, without a path or query string.' };
  if (domain.includes(':')) return { error: 'Enter only the hostname, without a port.' };
  if (/\s/.test(domain)) return { error: 'A hostname can\'t contain spaces.' };
  const hostname = domain.startsWith('*.') ? domain.slice(2) : domain;
  if (hostname.includes('*')) return { error: 'A wildcard must be at the start, as in *.example.com.' };
  if (!hostname.includes('.')) return { error: 'Enter a full hostname, such as clob.example.com.' };
  return { domain };
}

/**
 * How to show a server's synchronization state: { label, tone, detail, warning }, where `warning` is a problem to
 * point out. Only the server's Synced is ever shown as Synced: it comes from what the node just confirmed.
 */
export function describeSync(sync) {
  const tones = { synced: 'success', pending: 'warning', failed: 'danger' };
  const labels = { synced: 'Synced', pending: 'Pending', failed: 'Failed' };
  const label = Object.hasOwn(labels, sync?.status ?? '') ? labels[sync.status] : null;
  if (!label) return { label: 'Unknown', tone: 'secondary', detail: '', warning: 'The server returned unexpected data.' };
  const rules = plural(sync.enabledDomainCount, 'enabled rule');
  const last = sync.lastSuccessAt ? `Last synchronized ${new Date(sync.lastSuccessAt).toLocaleString()}.` : 'Never synchronized.';
  const details = {
    synced: `The node confirms these ${rules} are applied (generation ${sync.node?.applied?.generation}). ${last}`,
    pending: `${rules}. These haven't been confirmed as applied on the node. ${last}`,
    failed: `${rules}. The last attempt failed. ${last}`,
  };
  let warning = null;
  if (sync.status === 'failed' && sync.lastError) warning = sync.lastError;
  if (sync.node?.reachable === false) warning = warning ? `${warning} ${sync.node.error ?? ''}`.trim() : (sync.node.error ?? 'The node couldn\'t be reached.');
  else if (sync.status !== 'synced' && sync.node?.allowlistVerified === false && sync.node.applied) {
    warning = warning ?? 'The allowlist on the node no longer matches what was last applied. It may have been edited by hand.';
  }
  return { label, tone: tones[sync.status], detail: details[sync.status], warning };
}

/** A click with no mouse behind it: Space on a focused switch, or assistive technology. */
export const isKeyboardActivation = (event) => event.detail === 0;

/**
 * The Enabled switch to give focus back to after the table is redrawn, or null. Redrawing drops focus to
 * the page body, so focus anywhere else means the user has moved on and it's left alone. A switch that's
 * still saving is disabled and can't take focus; the next redraw tries again.
 */
export function switchToRefocus({ switches, domainId, focusIsFree }) {
  if (domainId === null || !focusIsFree) return null;
  return switches.find((candidate) => candidate.dataset.domainId === domainId && !candidate.disabled) ?? null;
}

/**
 * The state and actions of the Routing Rules section for one selected proxy server. Everything goes
 * through the server API. An answer that arrives after the selection has changed is dropped, so one
 * server's rules can't appear under another.
 *
 * Action results: { outcome: 'done', message?, warning? } | { outcome: 'failed', message } | { outcome: 'invalid', errors }
 *               | { outcome: 'cancelled' } | { outcome: 'auth' } | { outcome: 'busy' } | { outcome: 'stale' }
 */
export function createRoutingRules({ api, confirm, onChange = () => {} }) {
  const state = { server: null, status: 'none', domains: [], error: null, pending: new Set(), sync: null, syncChecking: false, syncing: false, syncError: null };
  const NO_SYNC = { sync: null, syncChecking: false, syncing: false, syncError: null };
  let selection = 0;
  let latestSyncCheck = 0;
  let latestLoad = 0;
  let saving = false;

  const changed = () => onChange(state);
  const failure = (result) => (isAuthLoss(result) ? { outcome: 'auth' } : { outcome: 'failed', message: describeError(result) });
  const replaceRow = (row) => { state.domains = state.domains.map((domain) => (domain.id === row.id ? row : domain)); };

  /** Reads the list. The rows stay on screen during a refresh, and a row being toggled keeps its new state. */
  async function load() {
    const current = selection;
    const request = ++latestLoad;
    const { server } = state;
    if (state.status !== 'ready') {
      state.status = 'loading';
      changed();
    }
    const result = await api.listRoutingDomains(server.id);
    if (current !== selection || request !== latestLoad) return { outcome: 'stale' };
    if (!result.ok) {
      const failed = failure(result);
      state.error = failed.message ?? null;
      if (state.status !== 'ready') state.status = 'error';
      changed();
      return failed;
    }
    const domains = result.data?.domains;
    if (!Array.isArray(domains)) {
      state.error = 'The server returned unexpected data.';
      if (state.status !== 'ready') state.status = 'error';
      changed();
      return { outcome: 'failed', message: state.error };
    }
    const shown = new Map(state.domains.map((domain) => [domain.id, domain]));
    state.domains = domains.map((domain) => (state.pending.has(domain.id) && shown.has(domain.id) ? shown.get(domain.id) : domain));
    state.status = 'ready';
    state.error = null;
    changed();
    return { outcome: 'done' };
  }

  /** Refreshes the list after a change the server has accepted. A failed refresh doesn't undo that change. */
  async function refreshAfterChange(current, message) {
    const refreshed = await load();
    if (current !== selection) return { outcome: 'stale' };
    if (refreshed.outcome === 'auth') return refreshed;
    if (refreshed.outcome === 'failed') {
      return { outcome: 'done', warning: true, message: `The change was saved, but the list couldn't be refreshed. ${refreshed.message}` };
    }
    return message ? { outcome: 'done', message } : { outcome: 'done' }; // no message: the switch shows the result
  }

  return {
    state,

    select(server) {
      selection += 1;
      saving = false;
      Object.assign(state, { server, status: 'none', domains: [], error: null, pending: new Set() }, NO_SYNC);
      return load();
    },

    /** The selected server's own details changed (a rename, say): nothing needs reloading. */
    updateServer(server) {
      if (state.server?.id !== server.id) return;
      state.server = server;
      changed();
    },

    clear() {
      selection += 1;
      saving = false;
      Object.assign(state, { server: null, status: 'none', domains: [], error: null, pending: new Set() }, NO_SYNC);
      changed();
    },

    reload: () => load(),

    /** Adds a domain, or edits `existing` when given. */
    async save(form, existing = null) {
      if (saving) return { outcome: 'busy' };
      const { error, domain } = validateDomain(form.domain);
      if (error) return { outcome: 'invalid', errors: { domain: error } };
      const current = selection;
      const { server } = state;
      saving = true;
      const body = { domain, enabled: form.enabled === true };
      const result = existing
        ? await api.updateRoutingDomain(server.id, existing.id, body)
        : await api.createRoutingDomain(server.id, body);
      if (current !== selection) return { outcome: 'stale' };
      saving = false;
      if (!result.ok) return failure(result);
      return refreshAfterChange(current, existing ? `"${domain}" was updated.` : `"${domain}" was added.`);
    },

    /** Shows the change straight away, then the server's answer, or puts it back if the server refuses. */
    async toggle(row) {
      if (state.pending.has(row.id)) return { outcome: 'busy' };
      const current = selection;
      const { server } = state;
      state.pending.add(row.id);
      replaceRow({ ...row, enabled: !row.enabled });
      changed();

      const result = await api.updateRoutingDomain(server.id, row.id, { enabled: !row.enabled });
      if (current !== selection) return { outcome: 'stale' };
      state.pending.delete(row.id);
      if (!result.ok) {
        replaceRow(row);
        changed();
        const failed = failure(result);
        if (result.code === 'ROUTING_DOMAIN_NOT_FOUND') await load();
        return failed;
      }
      const confirmed = result.data?.domain;
      if (confirmed?.id === row.id) replaceRow(confirmed);
      changed();
      return refreshAfterChange(current);
    },

    async remove(row) {
      if (state.pending.has(row.id)) return { outcome: 'busy' };
      const current = selection;
      const { server } = state;
      const confirmed = await confirm({
        title: 'Delete routing rule?',
        body: `Delete "${row.domain}" from ${server.name}?`,
        confirm: 'Delete rule',
        danger: true,
      });
      if (!confirmed) return { outcome: 'cancelled' };
      if (current !== selection) return { outcome: 'stale' };
      state.pending.add(row.id);
      changed();
      const result = await api.deleteRoutingDomain(server.id, row.id);
      if (current !== selection) return { outcome: 'stale' };
      state.pending.delete(row.id);
      if (!result.ok) {
        changed();
        const failed = failure(result);
        if (result.code === 'ROUTING_DOMAIN_NOT_FOUND') await load();
        return failed;
      }
      return refreshAfterChange(current, `"${row.domain}" was deleted.`);
    },

    /** The servers rules can be copied from: every server but the selected one. */
    async copySources() {
      const current = selection;
      const { server } = state;
      const result = await api.listProxyServers();
      if (current !== selection) return { outcome: 'stale' };
      if (!result.ok) return failure(result);
      const servers = result.data?.servers;
      if (!Array.isArray(servers)) return { outcome: 'failed', message: 'The server returned unexpected data.' };
      return { outcome: 'ready', servers: servers.filter((candidate) => candidate.id !== server.id) };
    },

    /** Counts the source's rules, asks for confirmation with the figures, then replaces this server's rules. */
    async copyFrom(source) {
      if (saving) return { outcome: 'busy' };
      const current = selection;
      const { server } = state;
      saving = true;
      const finish = (result) => {
        if (current === selection) saving = false;
        return result;
      };

      const listed = await api.listRoutingDomains(source.id);
      if (current !== selection) return { outcome: 'stale' };
      if (!listed.ok) return finish(failure(listed));
      const sourceDomains = listed.data?.domains;
      if (!Array.isArray(sourceDomains)) return finish({ outcome: 'failed', message: 'The server returned unexpected data.' });

      const question = copyQuestion(source, server, sourceDomains, state.domains.length);
      if (!(await confirm(question))) return finish({ outcome: 'cancelled' });
      if (current !== selection) return { outcome: 'stale' };

      const result = await api.copyRoutingDomains(server.id, source.id);
      if (current !== selection) return { outcome: 'stale' };
      if (!result.ok) return finish(failure(result));
      finish();
      return refreshAfterChange(current, `${plural(sourceDomains.length, 'rule')} copied from "${source.name}" to "${server.name}".`);
    },

    /** Asks the server, which asks the node. What's on screen stays until the answer arrives. */
    async checkSync() {
      if (!state.server) return { outcome: 'stale' };
      const current = selection;
      const request = ++latestSyncCheck;
      state.syncChecking = true;
      changed();
      const result = await api.routingSyncStatus(state.server.id);
      if (current !== selection || request !== latestSyncCheck) return { outcome: 'stale' };
      state.syncChecking = false;
      if (!result.ok) {
        const failed = failure(result);
        state.syncError = failed.message ?? null;
        changed();
        return failed;
      }
      state.sync = result.data;
      state.syncError = null;
      changed();
      return { outcome: 'done' };
    },

    /**
     * Pushes the enabled rules to Squid after asking first. The server re-checks the list, so if the rules have
     * become empty since they were loaded, it asks for the stronger confirmation here.
     */
    async syncNow() {
      if (state.syncing || state.status !== 'ready') return { outcome: 'busy' };
      const current = selection;
      const { server } = state;
      const enabled = state.domains.filter((domain) => domain.enabled).length;
      if (!(await confirm(enabled === 0 ? emptySyncQuestion(server) : syncQuestion(server, enabled)))) return { outcome: 'cancelled' };
      if (current !== selection) return { outcome: 'stale' };

      state.syncing = true;
      changed();
      let result = await api.syncRoutingDomains(server.id, { confirmEmpty: enabled === 0 });
      if (current !== selection) return { outcome: 'stale' };
      if (!result.ok && result.code === 'EMPTY_CONFIRMATION_REQUIRED') {
        const confirmed = await confirm(emptySyncQuestion(server));
        if (current !== selection) return { outcome: 'stale' };
        if (!confirmed) {
          state.syncing = false;
          changed();
          return { outcome: 'cancelled' };
        }
        result = await api.syncRoutingDomains(server.id, { confirmEmpty: true });
        if (current !== selection) return { outcome: 'stale' };
      }
      state.syncing = false;

      if (result.ok) {
        state.sync = result.data;
        state.syncError = null;
        latestSyncCheck += 1;
        state.syncChecking = false;
        changed();
        if (result.data?.status === 'synced') return { outcome: 'done', message: `Squid on "${server.name}" now has these rules.` };
        return { outcome: 'done', warning: true, message: 'The node applied the rules it was sent, but they changed during the synchronization. Synchronize again.' };
      }
      changed();
      if (isAuthLoss(result)) return { outcome: 'auth' };
      // The attempt may have finished even though its answer didn't arrive, or its failure is now recorded.
      const failed = failure(result);
      const message = result.kind === 'network'
        ? 'No answer arrived, so the synchronization may still have finished. The status below shows what the node reports.'
        : failed.message;
      await this.checkSync();
      if (current !== selection) return { outcome: 'stale' };
      return { outcome: 'failed', message };
    },

    /** The current PAC preview for the selected server, fetched on every call. */
    async preview() {
      const current = selection;
      const result = await api.pacPreview(state.server.id);
      if (current !== selection) return { outcome: 'stale' };
      if (!result.ok) return failure(result);
      if (typeof result.data?.pac !== 'string') return { outcome: 'failed', message: 'The server returned unexpected data.' };
      return { outcome: 'done', pac: result.data.pac };
    },
  };
}

function syncQuestion(server, enabled) {
  return {
    title: 'Sync to Squid?',
    body: `Squid on "${server.name}" will allow only these ${plural(enabled, 'enabled rule')}, and refuse every other destination. Disabled rules aren't included. PAC routing doesn't change.`,
    confirm: 'Sync to Squid',
    danger: false,
  };
}

function emptySyncQuestion(server) {
  return {
    title: 'Deny all destinations?',
    body: `"${server.name}" has no enabled rules. Synchronizing will make its Squid refuse every destination, so all proxy traffic through this server will stop.`,
    confirm: 'Deny all destinations',
    danger: true,
  };
}

function copyQuestion(source, destination, sourceDomains, destinationCount) {
  const replaced = destinationCount === 0
    ? `"${destination.name}" has no rules now.`
    : `All ${plural(destinationCount, 'existing rule')} on "${destination.name}" will be replaced.`;
  if (sourceDomains.length === 0) {
    return {
      title: 'Copy an empty configuration?',
      body: `"${source.name}" has no routing rules, so copying from it will leave "${destination.name}" empty. ${replaced} "${source.name}" won't change.`,
      confirm: 'Empty destination',
      danger: true,
    };
  }
  const disabled = sourceDomains.filter((domain) => !domain.enabled).length;
  const including = disabled === 0 ? '' : `, including ${disabled} disabled,`;
  return {
    title: 'Replace routing rules?',
    body: `Copy ${plural(sourceDomains.length, 'rule')}${including} from "${source.name}" to "${destination.name}". ${replaced} "${source.name}" won't change.`,
    confirm: 'Replace rules',
    danger: true,
  };
}
