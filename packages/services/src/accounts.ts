import { type Result, err, ok } from '@visastack/core';
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, isUniqueViolation, lockOnEmail, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { consumeAnyActiveInvitation } from './pilot-access';
import { recordProductEvent } from './product-events';

/**
 * Account provisioning (Build Spec §2, §13).
 *
 * WorkOS AuthKit owns authentication; this service materializes the local
 * account keyed by the **immutable WorkOS user id** — not the mutable email
 * (Milestone 0 identity binding). Resolution order on sign-in:
 *
 *   1. Bind-by-id: an account already bound to this WorkOS id is authoritative;
 *      its email is refreshed as mutable contact data. This prevents an email
 *      change from ever creating a duplicate account.
 *   2. One-time claim: a legacy account with the same email but no bound id is
 *      claimed and bound atomically — only when WorkOS reports the email
 *      verified, and only if no other account already holds this id. Audited.
 *   3. Fresh account: created and bound to the id.
 *
 * An email that already belongs to a *different* WorkOS id is refused
 * (account-takeover guard). Callers without a WorkOS id (tests, legacy paths)
 * keep the email-keyed behaviour and never bind.
 *
 * The same takeover guard applies to the concurrent-creation race inside
 * `createAccount`: when two sign-ins race and the loser's insert fails on
 * the email-uniqueness constraint (not its own id), the winner's row is
 * only ever returned if it is bound to the SAME identity. A same-email,
 * different-identity race is a genuine conflict, not a race to resolve —
 * it fails closed (master directive §7 "PR 5"), never silently handing one
 * identity's session the other identity's account.
 */

export type Account = typeof schema.accounts.$inferSelect;

export interface ProvisionAccountInput {
  readonly email: string;
  /** The immutable WorkOS user id from the authenticated server session. */
  readonly workosUserId?: string | null;
  /** Whether WorkOS reports the email verified — required to claim a legacy account. */
  readonly emailVerified?: boolean;
  /** When WorkOS reports the email as verified. */
  readonly emailVerifiedAt?: Date | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeWorkosUserId(id: string | null | undefined): string | null {
  const trimmed = id?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

async function findByEmail(db: Db, email: string): Promise<Account | undefined> {
  return first(
    await db.select().from(schema.accounts).where(eq(schema.accounts.email, email)).limit(1),
  );
}

async function findByWorkosUserId(db: Db, workosUserId: string): Promise<Account | undefined> {
  return first(
    await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.workosUserId, workosUserId))
      .limit(1),
  );
}

/** Look up an account by (case-insensitive) email. */
export async function getAccountByEmail(db: Db, email: string): Promise<Account | undefined> {
  return findByEmail(db, normalizeEmail(email));
}

/** Look up an account by its immutable WorkOS user id. */
export async function getAccountByWorkosUserId(
  db: Db,
  workosUserId: string,
): Promise<Account | undefined> {
  const id = normalizeWorkosUserId(workosUserId);
  return id ? findByWorkosUserId(db, id) : undefined;
}

/**
 * Create a fresh account (bound to `workosUserId` when present), audited.
 *
 * Takes the same per-email advisory lock `createInvitation` takes before
 * checking for an existing account (Codex review, PR #65) — this is the
 * other side of that race: without both operations serializing on the same
 * lock, a first-time sign-in's account creation here could commit in the
 * exact window between an admin's concurrent `createInvitation` call
 * checking "no account yet" and that call's own commit, leaving a
 * replayable invitation for an email that already has an account.
 *
 * The lock alone only serializes *timing* — it does not make this call
 * aware of what the other side did while this one was waiting for it
 * (Codex review, PR #65, finding #53). If `createInvitation` wins the lock
 * FIRST and commits a fresh invitation for this exact email, this call
 * would otherwise insert the account right after with no idea the
 * invitation now exists, leaving it dangling. `consumeAnyActiveInvitation`
 * closes that: any invitation still active for this email is claimed and
 * attributed to the new account atomically, in the same transaction, so
 * the two can never coexist once this call returns.
 */
async function createAccount(
  db: Db,
  values: { email: string; workosUserId: string | null; emailVerifiedAt: Date | null },
): Promise<Result<Account, ServiceError>> {
  try {
    return await db.transaction(async (tx) => {
      await lockOnEmail(tx, values.email);
      const account = required(
        first(await tx.insert(schema.accounts).values(values).returning()),
        'account',
      );
      await consumeAnyActiveInvitation(tx, values.email, account.id);
      await appendAuditEvent(tx, {
        eventType: 'ACCOUNT_PROVISIONED',
        actorAccountId: account.id,
        method: 'SYSTEM',
        result: 'ALLOWED',
        resourceType: 'account',
        resourceId: account.id,
      });
      await recordProductEvent(tx, { eventType: 'ACCOUNT_CREATED', accountId: account.id });
      return ok(account);
    });
  } catch (error) {
    // Concurrent creation: the email- or id-unique constraint fired.
    if (isUniqueViolation(error)) {
      if (values.workosUserId) {
        // Our own id won the race — re-read and return it (idempotent).
        const byId = await findByWorkosUserId(db, values.workosUserId);
        if (byId) return ok(byId);
        // Not our id: the violation must be the email constraint — a
        // concurrent request already claimed this email. Only trust it when
        // that account is bound to the SAME identity we're provisioning;
        // never hand back an account bound to a different WorkOS identity
        // just because the email matches (fail closed on a genuine conflict,
        // mirroring provisionAccount's own synchronous takeover guard).
        const byEmail = await findByEmail(db, values.email);
        if (byEmail?.workosUserId === values.workosUserId) return ok(byEmail);
        await db.transaction(async (tx) => {
          await appendAuditEvent(tx, {
            eventType: 'ACCOUNT_IDENTITY_CONFLICT',
            method: 'SYSTEM',
            result: 'DENIED',
            resourceType: 'account',
            resourceId: byEmail?.id ?? null,
          });
        });
        return err(serviceError('forbidden', 'this email is bound to a different identity'));
      }
      // No identity on this attempt (legacy/no-id caller): email-keyed,
      // matching provisionAccount's own legacy-caller path.
      const byEmail = await findByEmail(db, values.email);
      if (byEmail) return ok(byEmail);
    }
    throw error;
  }
}

/** Atomically bind `workosUserId` to an existing unbound account, audited. */
async function bindAccount(
  db: Db,
  account: Account,
  workosUserId: string,
): Promise<Result<Account, ServiceError>> {
  try {
    return await db.transaction(async (tx) => {
      // Conditional update: only binds while still unbound, so a concurrent
      // binder cannot be overwritten.
      const bound = first(
        await tx
          .update(schema.accounts)
          .set({ workosUserId, updatedAt: new Date() })
          .where(and(eq(schema.accounts.id, account.id), isNull(schema.accounts.workosUserId)))
          .returning(),
      );
      if (!bound) {
        const current = first(
          await tx
            .select()
            .from(schema.accounts)
            .where(eq(schema.accounts.id, account.id))
            .limit(1),
        );
        if (current?.workosUserId === workosUserId) return ok(current);
        return err(serviceError('forbidden', 'account was bound to a different identity'));
      }
      await appendAuditEvent(tx, {
        eventType: 'ACCOUNT_IDENTITY_BOUND',
        actorAccountId: bound.id,
        method: 'SYSTEM',
        result: 'ALLOWED',
        resourceType: 'account',
        resourceId: bound.id,
      });
      return ok(bound);
    });
  } catch (error) {
    // The id-unique constraint fired: this id is already bound to another
    // account. Refuse — never merge or steal a second account's identity.
    if (isUniqueViolation(error)) {
      return err(serviceError('forbidden', 'this identity is already bound to another account'));
    }
    throw error;
  }
}

/**
 * Refresh the (mutable) contact email on the id-bound account, best-effort.
 *
 * Takes the same per-email advisory lock `createAccount`/`createInvitation`
 * take, scoped to the NEW email being adopted, and consumes any invitation
 * that wins the lock first for it (Codex review, PR #65, finding #53) —
 * the same dangling-invitation gap `createAccount` closes, reachable here
 * too: from the invitation system's point of view, an existing account
 * adopting a new email is that email being newly claimed by an account,
 * same as a fresh creation. The OLD email needs no lock — this account no
 * longer holds it once the update below commits, so a fresh invitation for
 * it afterward is a legitimate, unrelated grant.
 */
async function refreshEmail(db: Db, account: Account, email: string): Promise<Account> {
  if (account.email === email) return account;
  try {
    return await db.transaction(async (tx) => {
      await lockOnEmail(tx, email);
      const updated = first(
        await tx
          .update(schema.accounts)
          .set({ email, updatedAt: new Date() })
          .where(eq(schema.accounts.id, account.id))
          .returning(),
      );
      if (!updated) return account;
      await consumeAnyActiveInvitation(tx, email, updated.id);
      return updated;
    });
  } catch (error) {
    // The new email is already taken by another account — keep the current one
    // rather than failing the sign-in.
    if (isUniqueViolation(error)) return account;
    throw error;
  }
}

/**
 * Return the account for this WorkOS identity, provisioning or binding it as
 * needed. Idempotent and race-safe; fails closed on an identity conflict.
 */
export async function provisionAccount(
  db: Db,
  input: ProvisionAccountInput,
): Promise<Result<Account, ServiceError>> {
  const email = normalizeEmail(input.email);
  if (email.length === 0 || !email.includes('@')) {
    return err(serviceError('invalid', 'a valid email is required to provision an account'));
  }
  const workosUserId = normalizeWorkosUserId(input.workosUserId);
  const emailVerifiedAt = input.emailVerifiedAt ?? (input.emailVerified ? new Date() : null);

  // 1. Authoritative: an account already bound to this immutable identity.
  if (workosUserId) {
    const byId = await findByWorkosUserId(db, workosUserId);
    if (byId) return ok(await refreshEmail(db, byId, email));
  }

  // 2. An account with this email.
  const byEmail = await findByEmail(db, email);
  if (byEmail) {
    if (!workosUserId) return ok(byEmail); // legacy/no-id caller: never binds.
    if (byEmail.workosUserId === workosUserId) return ok(byEmail);
    if (byEmail.workosUserId && byEmail.workosUserId !== workosUserId) {
      // This email is bound to a different WorkOS identity — refuse (takeover).
      return err(serviceError('forbidden', 'this email is bound to a different identity'));
    }
    // Legacy unbound account: one-time claim requires a WorkOS-verified email.
    if (!input.emailVerified) {
      return err(serviceError('forbidden', 'a verified email is required to bind this account'));
    }
    return bindAccount(db, byEmail, workosUserId);
  }

  // 3. Fresh account, bound to the identity when present.
  return createAccount(db, { email, workosUserId, emailVerifiedAt });
}

export interface UnboundAccountSummary {
  readonly id: string;
  readonly email: string;
  readonly emailVerifiedAt: string | null;
  readonly createdAt: string;
  /** Applicants owned by this account — a signal for "still relevant" vs. dead weight. */
  readonly applicantCount: number;
}

/**
 * Read-only report of accounts with no bound WorkOS identity (master
 * directive §7 "PR 5" — WorkOS ID migration). `workos_user_id` cannot become
 * `NOT NULL` (migration `0010` deliberately left it nullable for exactly this
 * staged rollout) until every legitimate account is confirmed bound; this is
 * the confirmation tool, not a migration. An unbound account resolves itself
 * safely the moment its owner next signs in (`provisionAccount`'s existing
 * legacy-claim path) — nothing here mutates anything.
 */
export async function reportUnboundAccounts(db: Db): Promise<readonly UnboundAccountSummary[]> {
  const accounts = await db
    .select()
    .from(schema.accounts)
    .where(isNull(schema.accounts.workosUserId))
    .orderBy(desc(schema.accounts.createdAt));
  if (accounts.length === 0) return [];

  const counts = await db
    .select({ ownerAccountId: schema.applicants.ownerAccountId, n: count() })
    .from(schema.applicants)
    .where(
      inArray(
        schema.applicants.ownerAccountId,
        accounts.map((a) => a.id),
      ),
    )
    .groupBy(schema.applicants.ownerAccountId);
  const byOwner = new Map(counts.map((c) => [c.ownerAccountId, c.n]));

  return accounts.map((a) => ({
    id: a.id,
    email: a.email,
    emailVerifiedAt: a.emailVerifiedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    applicantCount: byOwner.get(a.id) ?? 0,
  }));
}

/** Only re-touch a genuinely stale timestamp -- bounds write volume to roughly one per hour per account. The web session layer skips the call entirely inside the same window (it imports this value), so the two can never drift apart. */
export const ACTIVITY_TOUCH_THROTTLE_MS = 60 * 60 * 1000;

/**
 * Records that this account is still active (Part 7 §11 inactive-account
 * policy). Called from `withSession`: inline when an inactivity notice is
 * pending, otherwise after the response and only once the stored timestamp
 * is older than ACTIVITY_TOUCH_THROTTLE_MS. Either way the WHERE clause makes the actual write conditional and race-free (no
 * separate read-then-write): a request lands as a no-op unless either the
 * last touch is over an hour old, or an inactivity notice is currently
 * pending -- clearing that flag immediately on return, even mid-throttle-
 * window, so a user who signs back in during the 30-day notice period is
 * taken out of the at-risk state on their very first request, not up to an
 * hour later. Never throws or blocks the request on failure to update --
 * this is retention bookkeeping, not an auth gate.
 */
export async function touchAccountActivity(
  db: Db,
  accountId: string,
  now: Date = new Date(),
): Promise<void> {
  const throttleThreshold = new Date(now.getTime() - ACTIVITY_TOUCH_THROTTLE_MS);
  await db
    .update(schema.accounts)
    .set({ lastActiveAt: now, inactivityNoticeSentAt: null })
    .where(
      and(
        eq(schema.accounts.id, accountId),
        or(
          lt(schema.accounts.lastActiveAt, throttleThreshold),
          isNotNull(schema.accounts.inactivityNoticeSentAt),
        ),
      ),
    );
}
