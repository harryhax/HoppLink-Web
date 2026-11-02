import { describeError } from './api.js';

/**
 * Account actions for the user details page: suspend, reactivate, promote and demote. Every action
 * asks for confirmation first, then goes through the server API, which enforces the rules (self-
 * suspension, self-demotion, last administrator). Nothing is changed locally: callers reload the user.
 *
 * Results: { outcome: 'cancelled' } | { outcome: 'done', message } | { outcome: 'failed', message }
 *        | { outcome: 'auth' } (the session ended or is no longer an active admin)
 */
export function createUserAdmin(api, confirm) {
  async function perform(question, request, successMessage) {
    if (!(await confirm(question))) return { outcome: 'cancelled' };
    const result = await request();
    if (result.ok) return { outcome: 'done', message: successMessage };
    if (isAuthLoss(result)) return { outcome: 'auth' };
    return { outcome: 'failed', message: describeError(result) };
  }

  return {
    suspend: (user) => perform(
      { title: 'Suspend account?', body: `Are you sure you want to suspend ${user.email}? The user will lose access to protected HoppLink services and be signed out.`, confirm: 'Suspend account', danger: true },
      () => api.suspendUser(user.id),
      'The account was suspended.',
    ),
    reactivate: (user) => perform(
      { title: 'Reactivate account?', body: `Reactivate ${user.email}? The user will be able to sign in again.`, confirm: 'Reactivate account' },
      () => api.reactivateUser(user.id),
      'The account was reactivated.',
    ),
    makeAdmin: (user) => perform(
      { title: 'Make administrator?', body: `Give ${user.email} administrator access? Administrators can manage all users and settings.`, confirm: 'Make administrator', danger: true },
      () => api.setUserRole(user.id, 'admin'),
      'The user is now an administrator.',
    ),
    removeAdmin: (user) => perform(
      { title: 'Remove administrator role?', body: `Change ${user.email} to a regular user? They will lose administrator access.`, confirm: 'Remove administrator role' },
      () => api.setUserRole(user.id, 'user'),
      'The user is now a regular user.',
    ),
  };
}

/**
 * True when a failure means "you are no longer an active administrator" (re-check the session)
 * rather than "this action was refused" (show the message): 401, or 403 for a suspended or non-admin
 * caller. Other 403s, such as INVALID_ORIGIN or Better Auth's YOU_* rules, are refusals.
 */
export function isAuthLoss(result) {
  if (result.ok || result.kind !== 'http') return false;
  if (result.status === 401) return true;
  return result.status === 403 && (result.code == null || result.code === 'ACCOUNT_SUSPENDED' || result.code === 'FORBIDDEN');
}
