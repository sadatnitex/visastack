import { type Result, err, ok } from '@visastack/core';
import { eq } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, isUniqueViolation, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Account provisioning (Build Spec §2, §13).
 *
 * WorkOS AuthKit owns authentication; this service materializes the local
 * account row keyed by the verified email. Provisioning is idempotent so that
 * repeated logins never create duplicates and never race.
 */

export type Account = typeof schema.accounts.$inferSelect;

export interface ProvisionAccountInput {
  readonly email: string;
  /** When WorkOS reports the email as verified. */
  readonly emailVerifiedAt?: Date | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function findByEmail(db: Db, email: string): Promise<Account | undefined> {
  return first(
    await db.select().from(schema.accounts).where(eq(schema.accounts.email, email)).limit(1),
  );
}

/** Look up an account by (case-insensitive) email. */
export async function getAccountByEmail(db: Db, email: string): Promise<Account | undefined> {
  return findByEmail(db, normalizeEmail(email));
}

/**
 * Return the existing account for `email`, or create it. Idempotent under
 * concurrency: a lost insert race re-reads the winner rather than failing.
 */
export async function provisionAccount(
  db: Db,
  input: ProvisionAccountInput,
): Promise<Result<Account, ServiceError>> {
  const email = normalizeEmail(input.email);
  if (email.length === 0 || !email.includes('@')) {
    return err(serviceError('invalid', 'a valid email is required to provision an account'));
  }

  const existing = await findByEmail(db, email);
  if (existing) return ok(existing);

  try {
    return await db.transaction(async (tx) => {
      const account = required(
        first(
          await tx
            .insert(schema.accounts)
            .values({ email, emailVerifiedAt: input.emailVerifiedAt ?? null })
            .returning(),
        ),
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
      return ok(account);
    });
  } catch (error) {
    // Concurrent provisioning of the same email: the unique constraint fired;
    // the winning row now exists, so return it.
    if (isUniqueViolation(error)) {
      const winner = await findByEmail(db, email);
      if (winner) return ok(winner);
    }
    throw error;
  }
}
