import type { PermissionAction } from '@visastack/core';
import { StaffScope, type SystemJob, SystemScope } from '../../access/principal';
import { AuthorizedApplicant } from '../../access/require-access';
import type { PlatformAction } from '../../platform-roles';

/**
 * Who may use a lifecycle read or command: a genuine access proof for the record's applicant, a
 * scheduled job's scope, or a staff scope. Taken as a parameter by every exported lifecycle
 * function that touches a person's records, so the access ratchet (access/enforcement.test.ts)
 * holds with nothing added to its baseline.
 */
export type LifecycleAccess =
  | AuthorizedApplicant<PermissionAction>
  | SystemScope<SystemJob>
  | StaffScope<PlatformAction>;

/**
 * The applicant a proof is limited to, `null` for a job or staff scope (any applicant), or
 * `undefined` when the value is not a genuine gate at all (a copy or a forgery).
 */
export function lifecycleScope(access: LifecycleAccess): string | null | undefined {
  if (access instanceof AuthorizedApplicant) {
    return AuthorizedApplicant.isGenuine(access, access.action) ? access.applicant.id : undefined;
  }
  if (SystemScope.isGenuine(access) || StaffScope.isGenuine(access)) return null;
  return undefined;
}

/** True when `access` is genuine and may act on `applicantId`. */
export function lifecycleAccessCovers(access: LifecycleAccess, applicantId: string): boolean {
  const scope = lifecycleScope(access);
  return scope === null || (scope !== undefined && scope === applicantId);
}

/** The account a lifecycle change is recorded against, or null for a scheduled job. */
export function lifecycleActorAccountId(access: LifecycleAccess): string | null {
  if (access instanceof AuthorizedApplicant) {
    if (access.actor.kind === 'applicant_owner') return access.applicant.ownerAccountId;
    return 'accountId' in access.actor ? String(access.actor.accountId) : null;
  }
  if (StaffScope.isGenuine(access)) return access.accountId;
  return null;
}
