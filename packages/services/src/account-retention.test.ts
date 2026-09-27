import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  sweepInactiveAccountDeletionRequests,
  sweepInactiveAccountNotices,
} from './account-retention';
import { provisionAccount, touchAccountActivity } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { placeLegalHold } from './legal-hold';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seedAccount(db: Db, email: string): Promise<string> {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  return p.value.id;
}

async function backdateLastActive(db: Db, accountId: string, when: Date): Promise<void> {
  await db
    .update(schema.accounts)
    .set({ lastActiveAt: when })
    .where(eq(schema.accounts.id, accountId));
}

async function backdateInactivityNotice(db: Db, accountId: string, when: Date): Promise<void> {
  await db
    .update(schema.accounts)
    .set({ inactivityNoticeSentAt: when })
    .where(eq(schema.accounts.id, accountId));
}

/** Indexes by a runtime variable, never a literal -- satisfies both TS4111 and Biome's useLiteralKeys. */
function setEnv(name: string, value: string): void {
  process.env[name] = value;
}
function unsetEnv(name: string): void {
  delete process.env[name];
}

describe('sweepInactiveAccountNotices (PRV-02, Part 7 §11 inactive-account policy)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('sends a notice for an account inactive 12+ months, and records when', async () => {
    const accountId = await seedAccount(db, 'inactive@example.com');
    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 13);
    await backdateLastActive(db, accountId, thirteenMonthsAgo);

    const result = await sweepInactiveAccountNotices(db);
    expect(result).toEqual({ checked: 1, notified: 1 });

    const [account] = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId));
    expect(account?.inactivityNoticeSentAt).not.toBeNull();

    const notices = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.resourceId, accountId),
          eq(schema.notifications.eventType, 'INACTIVE_ACCOUNT_NOTICE'),
        ),
      );
    expect(notices).toHaveLength(2); // IN_APP + EMAIL
    expect(notices.every((n) => n.recipientAccountId === accountId)).toBe(true);
  });

  it('does not notify an account active within the configured threshold', async () => {
    await seedAccount(db, 'active@example.com'); // lastActiveAt defaults to now
    const result = await sweepInactiveAccountNotices(db);
    expect(result).toEqual({ checked: 0, notified: 0 });
  });

  it('is idempotent: re-running the sweep never sends a second notice for the same account', async () => {
    const accountId = await seedAccount(db, 'inactive2@example.com');
    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 13);
    await backdateLastActive(db, accountId, thirteenMonthsAgo);

    const first = await sweepInactiveAccountNotices(db);
    expect(first).toEqual({ checked: 1, notified: 1 });
    const second = await sweepInactiveAccountNotices(db);
    expect(second).toEqual({ checked: 0, notified: 0 });

    const notices = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.resourceId, accountId),
          eq(schema.notifications.eventType, 'INACTIVE_ACCOUNT_NOTICE'),
        ),
      );
    expect(notices).toHaveLength(2); // still just the one IN_APP + one EMAIL, never doubled
  });

  it('honors an INACTIVE_ACCOUNT_NOTICE_MONTHS override', async () => {
    setEnv('INACTIVE_ACCOUNT_NOTICE_MONTHS', '1');
    try {
      const accountId = await seedAccount(db, 'short-threshold@example.com');
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setUTCMonth(twoMonthsAgo.getUTCMonth() - 2);
      await backdateLastActive(db, accountId, twoMonthsAgo);

      const result = await sweepInactiveAccountNotices(db);
      expect(result).toEqual({ checked: 1, notified: 1 });
    } finally {
      unsetEnv('INACTIVE_ACCOUNT_NOTICE_MONTHS');
    }
  });
});

const DELETION_ENV_KEYS = [
  'INACTIVE_ACCOUNT_DELETION_ENABLED',
  'INACTIVE_ACCOUNT_DELETION_GRACE_DAYS',
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};

describe('sweepInactiveAccountDeletionRequests (PRV-02, Part 7 §11 inactive-account policy)', () => {
  let db: Db;

  beforeEach(async () => {
    db = await freshDb();
    for (const key of DELETION_ENV_KEYS) ORIGINAL_ENV[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of DELETION_ENV_KEYS) {
      if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL_ENV[key];
    }
  });

  async function seedAccountDueForDeletionRequest(email: string): Promise<string> {
    const accountId = await seedAccount(db, email);
    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 13);
    await backdateLastActive(db, accountId, thirteenMonthsAgo);
    const thirtyOneDaysAgo = new Date();
    thirtyOneDaysAgo.setUTCDate(thirtyOneDaysAgo.getUTCDate() - 31);
    await backdateInactivityNotice(db, accountId, thirtyOneDaysAgo);
    return accountId;
  }

  it('is a no-op by default -- INACTIVE_ACCOUNT_DELETION_ENABLED unset never touches anything', async () => {
    const accountId = await seedAccountDueForDeletionRequest('due-disabled@example.com');
    unsetEnv('INACTIVE_ACCOUNT_DELETION_ENABLED');

    const result = await sweepInactiveAccountDeletionRequests(db);
    expect(result).toEqual({ enabled: false, checked: 0, requested: 0, skipped: 0 });

    const requests = await db
      .select()
      .from(schema.accountDeletionRequests)
      .where(eq(schema.accountDeletionRequests.accountId, accountId));
    expect(requests).toHaveLength(0);
  });

  it('opens a cancellable, SYSTEM-attributed deletion request once enabled and due', async () => {
    setEnv('INACTIVE_ACCOUNT_DELETION_ENABLED', 'true');
    const accountId = await seedAccountDueForDeletionRequest('due-enabled@example.com');

    const result = await sweepInactiveAccountDeletionRequests(db);
    expect(result).toEqual({ enabled: true, checked: 1, requested: 1, skipped: 0 });

    const [request] = await db
      .select()
      .from(schema.accountDeletionRequests)
      .where(eq(schema.accountDeletionRequests.accountId, accountId));
    expect(request?.status).toBe('PENDING');

    const [auditRow] = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.eventType, 'ACCOUNT_DELETION_REQUESTED'),
          eq(schema.auditEvents.resourceId, accountId),
        ),
      );
    expect(auditRow?.method).toBe('SYSTEM');
  });

  it('is idempotent: a second run never opens a duplicate request', async () => {
    setEnv('INACTIVE_ACCOUNT_DELETION_ENABLED', 'true');
    const accountId = await seedAccountDueForDeletionRequest('due-twice@example.com');

    const first = await sweepInactiveAccountDeletionRequests(db);
    expect(first).toEqual({ enabled: true, checked: 1, requested: 1, skipped: 0 });
    // Still "checked" -- the query's own WHERE clause does not look at
    // pending requests at all -- but requestAccountDeletion's own
    // pending-request precondition refuses cleanly the second time, counted
    // here as skipped, never a thrown error or a duplicate row.
    const second = await sweepInactiveAccountDeletionRequests(db);
    expect(second).toEqual({ enabled: true, checked: 1, requested: 0, skipped: 1 });

    const requests = await db
      .select()
      .from(schema.accountDeletionRequests)
      .where(eq(schema.accountDeletionRequests.accountId, accountId));
    expect(requests).toHaveLength(1);
  });

  it('never opens a request for an account not yet past the notice-to-deletion grace period', async () => {
    setEnv('INACTIVE_ACCOUNT_DELETION_ENABLED', 'true');
    const accountId = await seedAccount(db, 'too-soon@example.com');
    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 13);
    await backdateLastActive(db, accountId, thirteenMonthsAgo);
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await backdateInactivityNotice(db, accountId, yesterday);

    const result = await sweepInactiveAccountDeletionRequests(db);
    expect(result).toEqual({ enabled: true, checked: 0, requested: 0, skipped: 0 });
  });

  it('never opens a request once the account has been active again since the notice, even mid-grace-window', async () => {
    setEnv('INACTIVE_ACCOUNT_DELETION_ENABLED', 'true');
    const accountId = await seedAccountDueForDeletionRequest('returned@example.com');

    // A real sign-in clears inactivityNoticeSentAt and refreshes lastActiveAt
    // -- exactly what withSession's own touchAccountActivity call does.
    await touchAccountActivity(db, accountId);

    const result = await sweepInactiveAccountDeletionRequests(db);
    expect(result).toEqual({ enabled: true, checked: 0, requested: 0, skipped: 0 });

    const requests = await db
      .select()
      .from(schema.accountDeletionRequests)
      .where(eq(schema.accountDeletionRequests.accountId, accountId));
    expect(requests).toHaveLength(0);
  });

  it("skips (never opens a request for) an account with an active legal hold, via requestAccountDeletion's own pre-check", async () => {
    setEnv('INACTIVE_ACCOUNT_DELETION_ENABLED', 'true');
    const accountId = await seedAccountDueForDeletionRequest('held@example.com');
    await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: accountId,
      ownerAccountId: accountId,
      displayName: 'Traveller',
    });
    if (!isOk(applicant)) throw new Error('setup failed');
    const reviewAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const hold = await placeLegalHold(db, {
      actorAccountId: accountId,
      applicantId: applicant.value.id,
      reason: 'pending investigation',
      reviewAt,
      stepUpSatisfied: true,
    });
    expect(isOk(hold)).toBe(true);

    const result = await sweepInactiveAccountDeletionRequests(db);
    expect(result).toEqual({ enabled: true, checked: 1, requested: 0, skipped: 1 });

    const requests = await db
      .select()
      .from(schema.accountDeletionRequests)
      .where(eq(schema.accountDeletionRequests.accountId, accountId));
    expect(requests).toHaveLength(0);
  });

  it('honors an INACTIVE_ACCOUNT_DELETION_GRACE_DAYS override', async () => {
    setEnv('INACTIVE_ACCOUNT_DELETION_ENABLED', 'true');
    setEnv('INACTIVE_ACCOUNT_DELETION_GRACE_DAYS', '5');
    const accountId = await seedAccount(db, 'short-grace@example.com');
    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 13);
    await backdateLastActive(db, accountId, thirteenMonthsAgo);
    const sixDaysAgo = new Date();
    sixDaysAgo.setUTCDate(sixDaysAgo.getUTCDate() - 6);
    await backdateInactivityNotice(db, accountId, sixDaysAgo);

    const result = await sweepInactiveAccountDeletionRequests(db);
    expect(result).toEqual({ enabled: true, checked: 1, requested: 1, skipped: 0 });
  });
});
