import { describeError } from './api.js';
import { isAuthLoss } from './user-admin.js';

/**
 * Checks the add/edit form for obvious mistakes before sending. The server is authoritative: it
 * validates the host (hostname, IPv4 or IPv6), the name length and the port again, and its message
 * is shown if it disagrees. Returns { errors, server }; `errors` maps field names to messages.
 */
export function validateServerForm({ name, host, port, enabled }) {
  const errors = {};
  const cleanName = String(name ?? '').trim();
  const cleanHost = String(host ?? '').trim();
  const portText = String(port ?? '').trim();
  const portNumber = Number(portText);

  if (!cleanName) errors.name = 'Enter a name.';
  else if (cleanName.length > 100) errors.name = 'The name must be at most 100 characters.';
  if (!cleanHost) errors.host = 'Enter a hostname or IP address.';
  if (!/^\d+$/.test(portText) || portNumber < 1 || portNumber > 65535) errors.port = 'Enter a port from 1 to 65535.';
  if (typeof enabled !== 'boolean') errors.enabled = 'Choose whether the server is enabled.';

  return Object.keys(errors).length
    ? { errors, server: null }
    : { errors, server: { name: cleanName, host: cleanHost, port: portNumber, enabled } };
}

/**
 * Proxy server actions. Each goes through the server API; nothing is changed locally.
 * Results: { outcome: 'done', message } | { outcome: 'failed', message } | { outcome: 'invalid', errors }
 *        | { outcome: 'cancelled' } | { outcome: 'auth' }
 */
export function createProxyAdmin(api, confirm) {
  const outcome = (result, message) => {
    if (result.ok) return { outcome: 'done', message };
    if (isAuthLoss(result)) return { outcome: 'auth' };
    return { outcome: 'failed', message: describeError(result) };
  };

  return {
    /** Adds a server, or edits `existing` when given. */
    async save(form, existing = null) {
      const { errors, server } = validateServerForm(form);
      if (!server) return { outcome: 'invalid', errors };
      return existing
        ? outcome(await api.updateProxyServer(existing.id, server), `"${server.name}" was updated.`)
        : outcome(await api.createProxyServer(server), `"${server.name}" was added.`);
    },

    /** Enables directly; disabling asks for confirmation first. */
    async toggle(server) {
      if (server.enabled) {
        const confirmed = await confirm({
          title: 'Disable proxy server?',
          body: `Disable "${server.name}"? Users assigned to it may no longer receive a usable proxy configuration. This only changes ProxyMarket's record; it does not stop the proxy itself.`,
          confirm: 'Disable server',
          danger: true,
        });
        if (!confirmed) return { outcome: 'cancelled' };
      }
      const enabled = !server.enabled;
      return outcome(await api.updateProxyServer(server.id, { enabled }), `"${server.name}" was ${enabled ? 'enabled' : 'disabled'}.`);
    },

    async remove(server) {
      const confirmed = await confirm({
        title: 'Delete proxy server?',
        body: `Delete "${server.name}" (${server.host}:${server.port}) from ProxyMarket? This removes the configuration record only. It does not stop or delete the proxy itself.`,
        confirm: 'Delete server',
        danger: true,
      });
      if (!confirmed) return { outcome: 'cancelled' };
      return outcome(await api.deleteProxyServer(server.id), `"${server.name}" was deleted.`);
    },
  };
}
