import { type Result, err, ok } from '@visastack/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { Account } from './accounts';
import { appendAuditEvent } from './audit';
import { type Db, first, isUniqueViolation, lockOnEmail, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { consumeAnyActiveInvitation } from './pilot-access';
import { recordProductEvent } from './product-events';

/**
 * Account provisioning for Neon Auth sign-in (docs/commercial-v1/neon-auth-migration-plan.md,
 * phase 2). Same rules as the WorkOS path in `accounts.ts`, keyed by the immutable Neon user id:
 *
 *   1. An account already bound to this Neon id is authoritative.
 *   2. An account with the same email and no Neon id is linked only when the sign-in system
 *      reports the email VERIFIED, atomically, audited. An unverified address never links, so
 *      nobody can take over an existing account by merely registering its address.
 *   3. An account whose email is bound to a DIFFERENT Neon id is refused and audited.
 *   4. Otherwise a fresh account is created and bound, only for a verified email.
 *
 * Unlike the WorkOS path, a missing id is an error: there is no legacy caller to keep working.
 */

export interface ProvisionNeonAccountInput {
  readonly email: string;
  /** The immutable Neon user id from the authenticated server session, never client input. */
  readonly neonUserId: string;
  /** Whether Neon Auth reports this email as verified. */
  readonly emailVerified: boolean;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function findByNeonUserId(db: Db, neonUserId: string): Promise<Account | undefined> {
  return first(
    await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.neonUserId, neonUserId))
      .limit(1),
  );
}

async function findByEmail(db: Db, email: string): Promise<Account | undefined> {
  return first(
    await db.select().from(schema.accounts).where(eq(schema.accounts.email, email)).limit(1),
  );
}

/** Look up an account by its immutable Neon user id. */
export async function getAccountByNeonUserId(
  db: Db,
  neonUserId: string,
): Promise<Account | undefined> {
  const id = neonUserId.trim();
  return id ? findByNeonUserId(db, id) : undefined;
}

async function auditConflict(db: Db, accountId: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'ACCOUNT_IDENTITY_CONFLICT',
      method: 'SYSTEM',
      result: 'DENIED',
      resourceType: 'account',
      resourceId: accountId,
    });
  });
}

async function bindNeonAccount(
  db: Db,
  account: Account,
  neonUserId: string,
  emailVerifiedAt: Date,
): Promise<Result<Account, ServiceError>> {
  try {
    return await db.transaction(async (tx) => {
      const bound = first(
        await tx
          .update(schema.accounts)
          .set({
            neonUserId,
            emailVerifiedAt: account.emailVerifiedAt ?? emailVerifiedAt,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.accounts.id, account.id), isNull(schema.accounts.neonUserId)))
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
        if (current?.neonUserId === neonUserId) return ok(current);
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
    if (isUniqueViolation(error)) {
      return err(serviceError('forbidden', 'this identity is already bound to another account'));
    }
    throw error;
  }
}

async function createNeonAccount(
  db: Db,
  values: { email: string; neonUserId: string; emailVerifiedAt: Date },
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
    if (isUniqueViolation(error)) {
      // Two sign-ins raced. Hand back the winner's row only if it is bound to THIS identity.
      const byId = await findByNeonUserId(db, values.neonUserId);
      if (byId) return ok(byId);
      const byEmail = await findByEmail(db, values.email);
      if (byEmail?.neonUserId === values.neonUserId) return ok(byEmail);
      await auditConflict(db, byEmail?.id ?? null);
      return err(serviceError('forbidden', 'this email is bound to a different identity'));
    }
    throw error;
  }
}

export async function provisionNeonAccount(
  db: Db,
  input: ProvisionNeonAccountInput,
): Promise<Result<Account, ServiceError>> {
  const email = normalizeEmail(input.email);
  const neonUserId = input.neonUserId.trim();
  if (email.length === 0 || !email.includes('@')) {
    return err(serviceError('invalid', 'a valid email is required to provision an account'));
  }
  if (neonUserId.length === 0) {
    return err(serviceError('invalid', 'an identity is required to provision an account'));
  }
  if (!input.emailVerified) {
    return err(serviceError('forbidden', 'a verified email is required to sign in'));
  }

  const byId = await findByNeonUserId(db, neonUserId);
  if (byId) return ok(byId);

  const byEmail = await findByEmail(db, email);
  if (byEmail) {
    if (byEmail.neonUserId && byEmail.neonUserId !== neonUserId) {
      await auditConflict(db, byEmail.id);
      return err(serviceError('forbidden', 'this email is bound to a different identity'));
    }
    return bindNeonAccount(db, byEmail, neonUserId, new Date());
  }

  return createNeonAccount(db, { email, neonUserId, emailVerifiedAt: new Date() });
}
