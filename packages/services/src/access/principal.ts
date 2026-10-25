import { type Result, err, ok } from '@visastack/core';
import type { Db } from '../db';
import { type ServiceError, serviceError } from '../errors';
import {
  type PlatformAction,
  type PlatformAuthInput,
  canPerformPlatformAction,
} from '../platform-roles';
import { STAFF_SCOPE, SYSTEM_SCOPE } from './brand';

/**
 * Who is asking. Identity only, never authorization: a `Principal` says who
 * the caller is, and `requireAccess` decides, server side and against live
 * state, what that caller may do with a given applicant record.
 *
 * - `account`: a signed-in person. `asSupport` marks an explicit, just-in-time
 *   support session (it only ever unlocks an approved support grant, never a
 *   role permission; policy law 8).
 * - `system`: a scheduled job. Only `systemPrincipal()` can make one.
 * - `staff`: a platform staff member whose platform role was re-checked live
 *   for one platform action. Only `staffPrincipal()` can make one.
 */

/** The scheduled jobs that run without a signed-in person (apps/web/src/app/api/jobs). */
export const SYSTEM_JOBS = [
  'process-abandoned-invitations',
  'process-abandoned-uploads',
  'process-account-export-expiry',
  'process-account-exports',
  'process-case-retention-notices',
  'process-case-retention-purge',
  'process-database-backup',
  'process-deletions',
  'process-downgrades',
  'process-erasure',
  'process-inactive-account-deletions',
  'process-inactive-account-notices',
  'process-intake',
  'process-legal-hold-reminders',
  'process-notification-sweeps',
  'process-notifications',
  'process-rate-limit-prune',
] as const;

export type SystemJob = (typeof SYSTEM_JOBS)[number];

export interface AccountPrincipal {
  readonly kind: 'account';
  readonly accountId: string;
  readonly asSupport?: true;
}

export interface SystemScope {
  readonly kind: 'system';
  readonly job: SystemJob;
  readonly [SYSTEM_SCOPE]: true;
}

export interface StaffScope {
  readonly kind: 'staff';
  readonly accountId: string;
  /** The one platform action the live role check covered. */
  readonly platformAction: PlatformAction;
  readonly verifiedAt: Date;
  readonly [STAFF_SCOPE]: true;
}

export type Principal = AccountPrincipal | SystemScope | StaffScope;

/** A signed-in person. Identity only: `requireAccess` still decides every request. */
export function accountPrincipal(
  accountId: string,
  options: { readonly asSupport?: true } = {},
): AccountPrincipal {
  return Object.freeze(
    options.asSupport === true
      ? { kind: 'account' as const, accountId, asSupport: true as const }
      : { kind: 'account' as const, accountId },
  );
}

/** The scope a scheduled job runs under. Throws on a job name outside `SYSTEM_JOBS` (a programmer fault). */
export function systemPrincipal(job: SystemJob): SystemScope {
  if (!(SYSTEM_JOBS as readonly string[]).includes(job)) {
    throw new Error(`unknown system job: ${String(job)}`);
  }
  return Object.freeze({ kind: 'system' as const, job, [SYSTEM_SCOPE]: true as const });
}

/**
 * The scope a platform staff member acts under for one platform action.
 * The role is re-checked live through `canPerformPlatformAction` on every
 * call, so a revoked role fails the next request; nothing here is cached.
 */
export async function staffPrincipal(
  db: Db,
  input: PlatformAuthInput,
  action: PlatformAction,
): Promise<Result<StaffScope, ServiceError>> {
  if (!(await canPerformPlatformAction(db, input, action))) {
    return err(serviceError('forbidden', 'this account does not hold the platform role required'));
  }
  return ok(
    Object.freeze({
      kind: 'staff' as const,
      accountId: input.accountId,
      platformAction: action,
      verifiedAt: new Date(),
      [STAFF_SCOPE]: true as const,
    }),
  );
}
