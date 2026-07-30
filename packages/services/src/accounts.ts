import { type Result, err, ok } from '@visastack/core';
import { and, eq, isNull } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, isUniqueViolation, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
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

/** Create a fresh account (bound to `workosUserId` when present), audited. */
async function createAccount(
  db: Db,
  values: { email: string; workosUserId: string | null; emailVerifiedAt: Date | null },
): Promise<Result<Account, ServiceError>> {
  try {
    return await db.transaction(async (tx) => {
      const account = required(
        first(await tx.insert(schema.accounts).values(values).returning()),
        'account',
      );
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
    // Concurrent creation: the email- or id-unique constraint fired. Re-read the
    // winner rather than failing (idempotent under races).
    if (isUniqueViolation(error)) {
      if (values.workosUserId) {
        const byId = await findByWorkosUserId(db, values.workosUserId);
        if (byId) return ok(byId);
      }
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

/** Refresh the (mutable) contact email on the id-bound account, best-effort. */
async function refreshEmail(db: Db, account: Account, email: string): Promise<Account> {
  if (account.email === email) return account;
  try {
    const updated = first(
      await db
        .update(schema.accounts)
        .set({ email, updatedAt: new Date() })
        .where(eq(schema.accounts.id, account.id))
        .returning(),
    );
    return updated ?? account;
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
