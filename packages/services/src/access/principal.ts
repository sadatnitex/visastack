import { type Result, err, ok } from '@visastack/core';
import type { Db } from '../db';
import { type ServiceError, serviceError } from '../errors';
import {
  type PlatformAction,
  type PlatformAuthInput,
  canPerformPlatformAction,
} from '../platform-roles';

/**
 * Who is asking. Identity only, never authorization: a `Principal` says who
 * the caller is, and `requireAccess` decides, server side and against live
 * state, what that caller may do with a given applicant record.
 *
 * - `account`: a signed-in person. `asSupport` marks an explicit, just-in-time
 *   support session (it only ever unlocks an approved support grant, never a
 *   role permission; policy law 8).
 * - `system`: a scheduled job, as a `SystemScope<J>` for exactly one job.
 *   Only `systemPrincipal()` can make one, and `enforcement.test.ts` allows
 *   `systemPrincipal` to be referenced only by the job routes in
 *   apps/web/src/app/api/jobs (and inside access/).
 * - `staff`: a platform staff member, as a `StaffScope<A>` for exactly one
 *   platform action whose role was re-checked live. Only `staffPrincipal()`
 *   can make one.
 *
 * `SystemScope` and `StaffScope` are classes with a private constructor and a
 * `#private` brand: an object literal or a spread copy (`{ ...scope }`) is
 * not one, at compile time or at run time.
 */

/** The scheduled jobs that run without a signed-in person: the folders of apps/web/src/app/api/jobs (a test keeps the two in step). */
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

// Module-private minting. The constructors below refuse to run unless the
// matching flag is set, and only the functions assigned in each class's
// static block (never exported) set it.
let mintingSystemScope = false;
let mintSystemScope: <J extends SystemJob>(job: J) => SystemScope<J>;
let mintingStaffScope = false;
let mintStaffScope: <A extends PlatformAction>(
  accountId: string,
  action: A,
  verifiedAt: Date,
) => StaffScope<A>;

export class SystemScope<J extends SystemJob> {
  readonly #brand = 'SystemScope';
  readonly kind = 'system' as const;
  readonly job: J;

  private constructor(job: J) {
    if (!mintingSystemScope) throw new Error('a SystemScope can only be made by systemPrincipal()');
    this.job = job;
    Object.freeze(this);
  }

  /** Run-time check that `value` is a genuine scope, not a copy. */
  static isGenuine(value: unknown): value is SystemScope<SystemJob> {
    return typeof value === 'object' && value !== null && #brand in value;
  }

  static {
    mintSystemScope = <K extends SystemJob>(job: K): SystemScope<K> => {
      mintingSystemScope = true;
      try {
        return new SystemScope(job);
      } finally {
        mintingSystemScope = false;
      }
    };
  }
}

export class StaffScope<A extends PlatformAction> {
  readonly #brand = 'StaffScope';
  readonly kind = 'staff' as const;
  readonly accountId: string;
  /** The one platform action the live role check covered. */
  readonly platformAction: A;
  readonly verifiedAt: Date;

  private constructor(accountId: string, platformAction: A, verifiedAt: Date) {
    if (!mintingStaffScope) throw new Error('a StaffScope can only be made by staffPrincipal()');
    this.accountId = accountId;
    this.platformAction = platformAction;
    this.verifiedAt = verifiedAt;
    Object.freeze(this);
  }

  /** Run-time check that `value` is a genuine scope, not a copy. */
  static isGenuine(value: unknown): value is StaffScope<PlatformAction> {
    return typeof value === 'object' && value !== null && #brand in value;
  }

  static {
    mintStaffScope = <B extends PlatformAction>(
      accountId: string,
      action: B,
      verifiedAt: Date,
    ): StaffScope<B> => {
      mintingStaffScope = true;
      try {
        return new StaffScope(accountId, action, verifiedAt);
      } finally {
        mintingStaffScope = false;
      }
    };
  }
}

export type Principal = AccountPrincipal | SystemScope<SystemJob> | StaffScope<PlatformAction>;

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

/** The scope one scheduled job runs under. Throws on a job name outside `SYSTEM_JOBS` (a programmer fault). */
export function systemPrincipal<J extends SystemJob>(job: J): SystemScope<J> {
  if (!(SYSTEM_JOBS as readonly string[]).includes(job)) {
    throw new Error(`unknown system job: ${String(job)}`);
  }
  return mintSystemScope(job);
}

/**
 * The scope a platform staff member acts under for exactly one platform
 * action. The role is re-checked live through `canPerformPlatformAction` on
 * every call, so a revoked role fails the next request; nothing is cached.
 */
export async function staffPrincipal<A extends PlatformAction>(
  db: Db,
  input: PlatformAuthInput,
  action: A,
): Promise<Result<StaffScope<A>, ServiceError>> {
  if (!(await canPerformPlatformAction(db, input, action))) {
    return err(serviceError('forbidden', 'this account does not hold the platform role required'));
  }
  return ok(mintStaffScope(input.accountId, action, new Date()));
}
