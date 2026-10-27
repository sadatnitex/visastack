import { type Result, err, ok } from '@visastack/core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from './access/principal';
import { SIGN_IN_CONFLICT_UNBOUND } from './accounts-neon';
import { appendAuditEvent, lockAuditChain } from './audit';
import { type Db, first, isUniqueViolation, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { type PlatformAuthInput, isPlatformOwner } from './platform-roles';

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
 * - only an identity seen in a refused sign-in for that exact account within the window;
 * - never when two different identities tried within the window (every attempt is counted, with
 *   no cap, so repeated tries by one cannot hide another);
 * - an account that holds a platform role can only be connected by a platform owner;
 * - a reason and a fresh sign-in check are always required, and every connection is audited.
 */

/** How long a refused sign-in stays connectable. */
export const SIGN_IN_RECOVERY_WINDOW_DAYS = 14;
export const SIGN_IN_RECOVERY_WINDOW_MS = SIGN_IN_RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const SIGN_IN_RECOVERY_REASON_MAX = 500;

/** Refusal messages a screen can tell apart; every one leaves the account unchanged. */
export const SIGN_IN_RECOVERY_REFUSED = {
  alreadyConnected: 'this account already has a sign-in',
  noAttempt: 'no recent sign-in attempt for this account',
  ambiguous: 'more than one sign-in tried to reach this account',
  identityTaken: 'this sign-in already reaches an account',
  ownerOnly: 'only a platform owner can connect a staff account',
} as const;

/** Accounts listed at once: far above what a pilot sees in two weeks. */
const LIST_LIMIT = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SignInRecoveryRequest {
  readonly accountId: string;
  readonly email: string;
  readonly joinedAt: Date;
  readonly lastActiveAt: Date;
  /** The latest refused sign-in for this account. */
  readonly requestedAt: Date;
  /** More than one different sign-in tried: connecting is refused while both are in the window. */
  readonly ambiguous: boolean;
  /** The account holds a platform role, so only a platform owner can connect it. */
  readonly holdsPlatformRole: boolean;
}

interface AttemptSummary {
  readonly accountId: string;
  /** The identity of the newest attempt. */
  readonly identity: string;
  readonly identities: number;
  readonly at: Date;
}

/**
 * Refused sign-ins for unbound accounts within the window, one summary per account, counted in
 * the database over every matching event (never a capped sample).
 */
async function attemptSummaries(db: Db, now: Date, accountId?: string): Promise<AttemptSummary[]> {
  const since = new Date(now.getTime() - SIGN_IN_RECOVERY_WINDOW_MS);
  const e = schema.auditEvents;
  const identity = sql<string>`${e.metadata}->>'identity'`;
  const rows = await db
    .select({
      accountId: e.resourceId,
      identity: sql<string>`(array_agg(${identity} order by ${e.seq} desc))[1]`,
      identities: sql<number>`count(distinct ${identity})::int`,
      at: sql<Date>`max(${e.occurredAt})`,
    })
    .from(e)
    .where(
      and(
        eq(e.eventType, 'ACCOUNT_IDENTITY_CONFLICT'),
        eq(e.resourceType, 'account'),
        sql`${e.occurredAt} >= ${since.toISOString()}::timestamptz`,
        sql`${e.metadata}->>'kind' = ${SIGN_IN_CONFLICT_UNBOUND}`,
        sql`coalesce(${e.metadata}->>'identity', '') <> ''`,
        accountId ? eq(e.resourceId, accountId) : undefined,
      ),
    )
    .groupBy(e.resourceId)
    .orderBy(sql`max(${e.occurredAt}) desc`)
    .limit(LIST_LIMIT);
  return rows.flatMap((row) =>
    row.accountId && UUID_RE.test(row.accountId)
      ? [
          {
            accountId: row.accountId,
            identity: row.identity,
            identities: Number(row.identities),
            at: new Date(row.at),
          },
        ]
      : [],
  );
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
  const summaries = await attemptSummaries(db, now);
  if (summaries.length === 0) return ok([]);
  const byAccount = new Map(summaries.map((s) => [s.accountId, s]));
  const accounts = await db
    .select({
      id: schema.accounts.id,
      email: schema.accounts.email,
      createdAt: schema.accounts.createdAt,
      lastActiveAt: schema.accounts.lastActiveAt,
    })
    .from(schema.accounts)
    .where(
      and(inArray(schema.accounts.id, [...byAccount.keys()]), isNull(schema.accounts.neonUserId)),
    );
  const roles = await accountsWithPlatformRoles(
    db,
    accounts.map((a) => a.id),
  );
  const requests = accounts.flatMap((account): SignInRecoveryRequest[] => {
    const summary = byAccount.get(account.id);
    if (!summary) return [];
    return [
      {
        accountId: account.id,
        email: account.email,
        joinedAt: account.createdAt,
        lastActiveAt: account.lastActiveAt,
        requestedAt: summary.at,
        ambiguous: summary.identities > 1,
        holdsPlatformRole: roles.has(account.id),
      },
    ];
  });
  return ok(requests.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime()));
}

export interface ConnectSignInInput {
  readonly accountId: string;
  readonly reason: string;
  /** A fresh sign-in check was completed for this change. */
  readonly stepUpSatisfied: boolean;
  /** The platform-owner check input, re-run when the account holds a platform role. */
  readonly owner: PlatformAuthInput;
  readonly now?: Date;
}

/** Carries a refusal out of the transaction so nothing it did is kept. */
class Refused extends Error {
  constructor(readonly refusal: ServiceError) {
    super(refusal.message);
  }
}

/**
 * Connect the sign-in that recently tried to reach an older account to that account. The person
 * then signs in with it and reaches their existing records. Every rule in this module's header is
 * checked inside one transaction, with the account row and the audit chain locked so no new
 * attempt can land unseen; the fresh sign-in check is asked for only once everything else passes.
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
  const now = input.now ?? new Date();
  const refuse = (code: ServiceError['code'], message: string): never => {
    throw new Refused(serviceError(code, message));
  };

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
      if (!account) return refuse('not_found', 'account not found');
      if (account.neonUserId !== null) {
        return refuse('invalid', SIGN_IN_RECOVERY_REFUSED.alreadyConnected);
      }
      // No refused sign-in can be recorded from here until this transaction ends.
      await lockAuditChain(tx);
      const [attempt] = await attemptSummaries(tx, now, account.id);
      if (!attempt) return refuse('not_found', SIGN_IN_RECOVERY_REFUSED.noAttempt);
      if (attempt.identities > 1) return refuse('invalid', SIGN_IN_RECOVERY_REFUSED.ambiguous);
      const roles = await accountsWithPlatformRoles(tx, [account.id]);
      if (roles.size > 0 && !(await isPlatformOwner(tx, input.owner))) {
        return refuse('forbidden', SIGN_IN_RECOVERY_REFUSED.ownerOnly);
      }
      const taken = first(
        await tx
          .select({ id: schema.accounts.id })
          .from(schema.accounts)
          .where(eq(schema.accounts.neonUserId, attempt.identity))
          .limit(1),
      );
      if (taken) return refuse('invalid', SIGN_IN_RECOVERY_REFUSED.identityTaken);
      if (!input.stepUpSatisfied) {
        return refuse('step_up_required', 'connecting a sign-in needs a fresh sign-in');
      }

      await tx
        .update(schema.accounts)
        .set({ neonUserId: attempt.identity, updatedAt: now })
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
          attemptedAt: attempt.at.toISOString(),
          staffAccount: roles.size > 0,
          stepUp: true,
        },
      });
      return ok({ accountId: account.id });
    });
  } catch (error) {
    if (error instanceof Refused) return err(error.refusal);
    if (isUniqueViolation(error)) {
      return err(serviceError('invalid', SIGN_IN_RECOVERY_REFUSED.identityTaken));
    }
    throw error;
  }
}
