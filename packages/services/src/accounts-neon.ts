import { type Result, err, ok } from '@visastack/core';
import { eq } from 'drizzle-orm';
import type { Account } from './accounts';
import { appendAuditEvent } from './audit';
import { type Db, first, isUniqueViolation, lockOnEmail, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { consumeAnyActiveInvitation } from './pilot-access';
import { recordProductEvent } from './product-events';
import { SIGN_IN_CONFLICT_BOUND_ELSEWHERE, SIGN_IN_CONFLICT_UNBOUND } from './sign-in-recovery';

/**
 * Provision verified Neon identities without transferring legacy accounts by email.
 * An immutable existing Neon binding is authoritative. A matching email without
 * that binding requires controlled identity recovery; it never grants access.
 * Canonical IDs, historical identities and account data remain unchanged.
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

/**
 * Record a refused sign-in. When the address belongs to an older account that no sign-in is bound
 * to yet, the verified identity that tried is kept, so staff can connect it after checking with the
 * person (sign-in-recovery.ts). Nothing here grants access.
 */
async function auditConflict(
  db: Db,
  account: Pick<Account, 'id' | 'neonUserId'> | undefined,
  neonUserId: string,
): Promise<void> {
  const unbound = account !== undefined && account.neonUserId === null;
  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'ACCOUNT_IDENTITY_CONFLICT',
      method: 'SYSTEM',
      result: 'DENIED',
      resourceType: 'account',
      resourceId: account?.id ?? null,
      metadata: unbound
        ? { kind: SIGN_IN_CONFLICT_UNBOUND, identity: neonUserId }
        : { kind: SIGN_IN_CONFLICT_BOUND_ELSEWHERE },
    });
  });
}

function identityRecoveryRequired(): Result<Account, ServiceError> {
  return err(
    serviceError('identity_recovery_required', 'Account access needs additional verification.'),
  );
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
      await auditConflict(db, byEmail, values.neonUserId);
      return identityRecoveryRequired();
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
    // Another request may have provisioned this exact identity since the first lookup.
    if (byEmail.neonUserId === neonUserId) return ok(byEmail);
    await auditConflict(db, byEmail, neonUserId);
    return identityRecoveryRequired();
  }

  return createNeonAccount(db, { email, neonUserId, emailVerifiedAt: new Date() });
}
