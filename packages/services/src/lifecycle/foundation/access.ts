import type { PermissionAction } from '@visastack/core';
import { StaffScope, type SystemJob, SystemScope, staffScopeProblem } from '../../access/principal';
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
 * The scheduled jobs that may change lifecycle records: the purge of Recently Deleted documents
 * (lane C, `process-erasure`), removal-request alerts (lane D, `process-notification-sweeps`) and
 * the traveller purge (lane E, `process-deletions`). PROGRAMME section 5.1.
 */
export const LIFECYCLE_SYSTEM_JOBS: readonly SystemJob[] = [
  'process-erasure',
  'process-notification-sweeps',
  'process-deletions',
];

/**
 * The platform actions that may change lifecycle records as staff: deciding what is destroyed is
 * the compliance administrator's concern, the same authority as the retention purge.
 */
export const LIFECYCLE_STAFF_ACTIONS: readonly PlatformAction[] = ['RETENTION_PURGE'];

function freshStaff(access: StaffScope<PlatformAction>): boolean {
  return staffScopeProblem(access, access.platformAction) === undefined;
}

/**
 * The applicant a proof may read lifecycle state for, `null` for a job or a fresh staff scope
 * (any applicant), or `undefined` when the value is not a genuine, current gate.
 */
export function lifecycleScope(access: LifecycleAccess): string | null | undefined {
  if (access instanceof AuthorizedApplicant) {
    return AuthorizedApplicant.isGenuine(access, access.action) ? access.applicant.id : undefined;
  }
  if (SystemScope.isGenuine(access)) return null;
  if (StaffScope.isGenuine(access) && freshStaff(access)) return null;
  return undefined;
}

/** True when `access` is genuine and may read lifecycle state of `applicantId`. */
export function lifecycleAccessCovers(access: LifecycleAccess, applicantId: string): boolean {
  const scope = lifecycleScope(access);
  return scope === null || (scope !== undefined && scope === applicantId);
}

/**
 * True when `access` may change lifecycle records (receipts, removal) of `applicantId`: the
 * record owner's own MANAGE proof for that applicant, one of `LIFECYCLE_SYSTEM_JOBS`, or a fresh
 * staff scope for one of `LIFECYCLE_STAFF_ACTIONS`. A read-level proof, an agency's grant, a
 * contributor, any other job and a stale or other staff scope are refused.
 */
export function lifecycleCommandCovers(access: LifecycleAccess, applicantId: string): boolean {
  if (access instanceof AuthorizedApplicant) {
    return (
      AuthorizedApplicant.isGenuine(access, 'MANAGE') &&
      access.actor.kind === 'applicant_owner' &&
      access.applicant.id === applicantId
    );
  }
  if (SystemScope.isGenuine(access)) return LIFECYCLE_SYSTEM_JOBS.includes(access.job);
  if (StaffScope.isGenuine(access)) {
    return LIFECYCLE_STAFF_ACTIONS.includes(access.platformAction) && freshStaff(access);
  }
  return false;
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
