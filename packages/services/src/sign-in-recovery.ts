import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { type Db, first, isUniqueViolation, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { isPlatformOwner } from './platform-roles';

/**
 * Controlled sign-in recovery for older accounts.
 *
 * Accounts created before the move to the current sign-in service have no sign-in bound to them.
 * When the holder of that address creates a new sign-in and confirms the email, provisioning
 * refuses to attach it by email alone (accounts-neon.ts) and records the refused identity in an
 * `ACCOUNT_IDENTITY_CONFLICT` audit event. Staff then review that attempt here and, after checking
 * with the person, connect it. The audit chain is the evidence: the event is only written after
 * the sign-in service reported the address as confirmed, and audit rows cannot be edited.
 *
 * Rules a caller cannot get around:
 * - only an account with no sign-in bound to it can be connected;
 * - only an identity seen in a refused sign-in for that exact account within the last 14 days;
 * - never when two different identities tried within that window (ask the person to try again);
 * - an account that holds a platform role can only be connected by a platform owner;
 * - a reason and a fresh sign-in check are always required, and every connection is audited.
 */

/** Audit metadata `kind` for a refused sign-in whose address belongs to an unbound older account. */
export const SIGN_IN_CONFLICT_UNBOUND = 'unbound_account';
/** Audit metadata `kind` for a refused sign-in whose address is bound to a different identity. */
export const SIGN_IN_CONFLICT_BOUND_ELSEWHERE = 'bound_elsewhere';

/** How long a refused sign-in stays connectable. */
export const SIGN_IN_RECOVERY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export const SIGN_IN_RECOVERY_REASON_MAX = 500;

/** Refusal messages a screen can tell apart; every one leaves the account unchanged. */
export const SIGN_IN_RECOVERY_REFUSED = {
  alreadyConnected: 'this account already has a sign-in',
  noAttempt: 'no recent sign-in attempt for this account',
  ambiguous: 'more than one sign-in tried to reach this account',
  identityTaken: 'this sign-in already reaches an account',
  ownerOnly: 'only a platform owner can connect a staff account',
} as const;

/** Refused sign-ins read per listing: far above what a pilot sees in two weeks. */
const ATTEMPT_SCAN_LIMIT = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SignInRecoveryRequest {
  readonly accountId: string;
  readonly email: string;
  readonly joinedAt: Date;
  readonly lastActiveAt: Date;
  /** The latest refused sign-in for this account. */
  readonly requestedAt: Date;
  /** More than one different sign-in tried: connecting is refused until the person tries again. */
  readonly ambiguous: boolean;
  /** The account holds a platform role, so only a platform owner can connect it. */
  readonly holdsPlatformRole: boolean;
}

interface Attempt {
  readonly accountId: string;
  readonly identity: string;
  readonly at: Date;
}

function attemptFrom(row: {
  resourceId: string | null;
  occurredAt: Date;
  metadata: unknown;
}): Attempt | undefined {
  const meta = row.metadata as { kind?: unknown; identity?: unknown } | null;
  if (!row.resourceId || meta?.kind !== SIGN_IN_CONFLICT_UNBOUND) return undefined;
  if (typeof meta.identity !== 'string' || meta.identity.trim() === '') return undefined;
  return { accountId: row.resourceId, identity: meta.identity, at: row.occurredAt };
}

/** Refused sign-ins for unbound accounts within the window, newest first. */
async function recentAttempts(db: Db, now: Date, accountId?: string): Promise<Attempt[]> {
  const since = new Date(now.getTime() - SIGN_IN_RECOVERY_WINDOW_MS);
  const rows = await db
    .select({
      resourceId: schema.auditEvents.resourceId,
      occurredAt: schema.auditEvents.occurredAt,
      metadata: schema.auditEvents.metadata,
    })
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.eventType, 'ACCOUNT_IDENTITY_CONFLICT'),
        eq(schema.auditEvents.resourceType, 'account'),
        gte(schema.auditEvents.occurredAt, since),
        accountId ? eq(schema.auditEvents.resourceId, accountId) : undefined,
      ),
    )
    .orderBy(desc(schema.auditEvents.seq))
    .limit(ATTEMPT_SCAN_LIMIT);
  return rows.map(attemptFrom).filter((a): a is Attempt => a !== undefined);
}

async function accountsWithPlatformRoles(db: Db, accountIds: readonly string[]) {
  if (accountIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ accountId: schema.platformRoles.accountId })
    .from(schema.platformRoles)
    .where(
      and(
        inArray(schema.platformRoles.accountId, [...accountIds]),
        isNull(schema.platformRoles.revokedAt),
      ),
    );
  return new Set(rows.map((r) => r.accountId));
}

/**
 * Older accounts whose holder recently tried a new sign-in that could not be attached safely.
 * Only accounts that still have no sign-in bound appear; connected ones drop off.
 */
export async function listSignInRecoveryRequests(
  db: Db,
  staff: StaffScope<'ACCOUNT_SIGN_IN_RECOVERY'>,
  now: Date = new Date(),
): Promise<Result<readonly SignInRecoveryRequest[], ServiceError>> {
  const problem = staffScopeProblem(staff, 'ACCOUNT_SIGN_IN_RECOVERY');
  if (problem) return err(problem);
  const attempts = await recentAttempts(db, now);
  const byAccount = new Map<string, Attempt[]>();
  for (const attempt of attempts) {
    const list = byAccount.get(attempt.accountId) ?? [];
    list.push(attempt);
    byAccount.set(attempt.accountId, list);
  }
  const ids = [...byAccount.keys()].filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return ok([]);
  const accounts = await db
    .select({
      id: schema.accounts.id,
      email: schema.accounts.email,
      createdAt: schema.accounts.createdAt,
      lastActiveAt: schema.accounts.lastActiveAt,
    })
    .from(schema.accounts)
    .where(and(inArray(schema.accounts.id, ids), isNull(schema.accounts.neonUserId)));
  const roles = await accountsWithPlatformRoles(
    db,
    accounts.map((a) => a.id),
  );
  const requests = accounts.map((account): SignInRecoveryRequest => {
    const tries = byAccount.get(account.id) ?? [];
    return {
      accountId: account.id,
      email: account.email,
      joinedAt: account.createdAt,
      lastActiveAt: account.lastActiveAt,
      requestedAt: tries[0]?.at ?? now,
      ambiguous: new Set(tries.map((t) => t.identity)).size > 1,
      holdsPlatformRole: roles.has(account.id),
    };
  });
  return ok(requests.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime()));
}

export interface ConnectSignInInput {
  readonly accountId: string;
  readonly reason: string;
  /** A fresh sign-in check was completed for this change. */
  readonly stepUpSatisfied: boolean;
  /** The platform-owner check input, re-run when the account holds a platform role. */
  readonly owner: Parameters<typeof isPlatformOwner>[1];
  readonly now?: Date;
}

/**
 * Connect the sign-in that recently tried to reach an older account to that account. The person
 * then signs in with it and reaches their existing records. Refused unless every rule in this
 * module's header holds, checked again inside one transaction with the account row locked.
 */
export async function connectSignInToAccount(
  db: Db,
  staff: StaffScope<'ACCOUNT_SIGN_IN_RECOVERY'>,
  input: ConnectSignInInput,
): Promise<Result<{ readonly accountId: string }, ServiceError>> {
  const problem = staffScopeProblem(staff, 'ACCOUNT_SIGN_IN_RECOVERY');
  if (problem) return err(problem);
  if (input.owner.accountId !== staff.accountId) {
    return err(serviceError('forbidden', 'this account does not hold the platform role required'));
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'a reason is required'));
  if (reason.length > SIGN_IN_RECOVERY_REASON_MAX) {
    return err(serviceError('invalid', 'the reason is too long'));
  }
  if (!UUID_RE.test(input.accountId)) return err(serviceError('not_found', 'account not found'));
  if (input.accountId === staff.accountId) {
    return err(serviceError('invalid', 'staff cannot connect a sign-in to their own account'));
  }
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'connecting a sign-in needs a fresh sign-in'));
  }
  const now = input.now ?? new Date();

  try {
    return await db.transaction(async (tx) => {
      const account = first(
        await tx
          .select({ id: schema.accounts.id, neonUserId: schema.accounts.neonUserId })
          .from(schema.accounts)
          .where(eq(schema.accounts.id, input.accountId))
          .limit(1)
          .for('update'),
      );
      if (!account) return err(serviceError('not_found', 'account not found'));
      if (account.neonUserId !== null) {
        return err(serviceError('invalid', SIGN_IN_RECOVERY_REFUSED.alreadyConnected));
      }
      const tries = await recentAttempts(tx, now, account.id);
      const latest = tries[0];
      if (!latest) {
        return err(serviceError('not_found', SIGN_IN_RECOVERY_REFUSED.noAttempt));
      }
      if (new Set(tries.map((t) => t.identity)).size > 1) {
        return err(serviceError('invalid', SIGN_IN_RECOVERY_REFUSED.ambiguous));
      }
      const roles = await accountsWithPlatformRoles(tx, [account.id]);
      if (roles.size > 0 && !(await isPlatformOwner(tx, input.owner))) {
        return err(serviceError('forbidden', SIGN_IN_RECOVERY_REFUSED.ownerOnly));
      }
      const taken = first(
        await tx
          .select({ id: schema.accounts.id })
          .from(schema.accounts)
          .where(eq(schema.accounts.neonUserId, latest.identity))
          .limit(1),
      );
      if (taken) return err(serviceError('invalid', SIGN_IN_RECOVERY_REFUSED.identityTaken));

      await tx
        .update(schema.accounts)
        .set({ neonUserId: latest.identity, updatedAt: now })
        .where(and(eq(schema.accounts.id, account.id), isNull(schema.accounts.neonUserId)));
      await appendAuditEvent(tx, {
        eventType: 'ACCOUNT_SIGN_IN_CONNECTED',
        actorAccountId: staff.accountId,
        actorRole: 'staff',
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'account',
        resourceId: account.id,
        reason,
        metadata: {
          attemptedAt: latest.at.toISOString(),
          staffAccount: roles.size > 0,
          stepUp: true,
        },
      });
      return ok({ accountId: account.id });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return err(serviceError('invalid', SIGN_IN_RECOVERY_REFUSED.identityTaken));
    }
    throw error;
  }
}
