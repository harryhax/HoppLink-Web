import { describeError } from './api.js';
import { isAuthLoss } from './user-admin.js';

/**
 * Proxy assignment actions, shared by the Proxy Assignments page and the user details page. Both
 * pass the same shape, `{ user, assignment }`, where `assignment` is null or
 * `{ id, createdAt, server: { id, name, host, port, enabled } }`: the list's entries and the user
 * details response already look like this.
 *
 * Every change goes through the server API, which enforces one server per user, the existence of the
 * user and server, and the administrator role. Nothing is changed locally: callers reload afterwards.
 *
 * Results: { outcome: 'done', message } | { outcome: 'failed', message } | { outcome: 'invalid', errors }
 *        | { outcome: 'cancelled' } | { outcome: 'auth' }
 */
export function createAssignmentAdmin(api, confirm) {
  const outcome = (result, message) => {
    if (result.ok) return { outcome: 'done', message };
    if (isAuthLoss(result)) return { outcome: 'auth' };
    return { outcome: 'failed', message: describeError(result) };
  };

  return {
    /** A new assignment. `user` is the chosen account; `serverId` the chosen server's id. */
    async assign({ user, serverId }) {
      const errors = {};
      if (!user?.id) errors.user = 'Choose a user.';
      if (!serverId) errors.server = 'Choose a proxy server.';
      if (Object.keys(errors).length) return { outcome: 'invalid', errors };
      return outcome(await api.createAssignment(user.id, serverId), `A proxy server was assigned to ${user.email}.`);
    },

    /** Moves an existing assignment to `serverId` (the same record: never a second assignment). */
    async change({ assignment }, serverId) {
      if (!serverId) return { outcome: 'invalid', errors: { server: 'Choose a proxy server.' } };
      if (serverId === assignment.server.id) return { outcome: 'invalid', errors: { server: 'Choose a different proxy server.' } };
      return outcome(await api.updateAssignment(assignment.id, serverId), 'Proxy assignment updated.');
    },

    async remove({ user, assignment }) {
      const confirmed = await confirm({
        title: 'Remove proxy assignment?',
        body: `Remove the proxy assignment for ${user.email} (${assignment.server.name})? Their next proxy configuration request will no longer return an assigned proxy. The account, its devices and sessions, and the proxy server are not changed.`,
        confirm: 'Remove assignment',
        danger: true,
      });
      if (!confirmed) return { outcome: 'cancelled' };
      return outcome(await api.deleteAssignment(assignment.id), `The proxy assignment for ${user.email} was removed.`);
    },
  };
}

/** "host:port", with IPv6 addresses in brackets so the port can't be mistaken for part of the address. */
export const hostPort = ({ host, port }) => (host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`);

/** Which actions a row offers: Assign without an assignment, otherwise Change and Remove. */
export const assignmentActions = ({ assignment }) => (assignment ? ['change', 'remove'] : ['assign']);

/**
 * Options for the server picker: enabled servers first (by name), then disabled ones, which are
 * shown but not selectable because the server refuses them. The current server is marked and not
 * selectable either. Nothing is pre-selected.
 */
export function serverOptions(servers, currentId = null) {
  return [...servers]
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((server) => {
      const notes = [server.id === currentId && 'current', !server.enabled && 'disabled'].filter(Boolean);
      return {
        value: server.id,
        label: `${server.name} — ${hostPort(server)}${notes.length ? ` (${notes.join(', ')})` : ''}`,
        disabled: !server.enabled || server.id === currentId,
      };
    });
}
