import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { type StaffScope, staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import {
  EMAIL_RESEND_REFUSED,
  listEmailDeliveryProblems,
  resendEmail,
} from './email-delivery-admin';
import { seedStaffAccount, staffScopeFor } from './platform-roles.test-support';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

const NOW = new Date();
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

type Insert = typeof schema.notifications.$inferInsert;

async function addEmail(db: Db, key: string, fields: Partial<Insert> = {}): Promise<string> {
  const [row] = await db
    .insert(schema.notifications)
    .values({
      eventType: 'CLIENT_INVITATION_CREATED',
      channel: 'EMAIL',
      idempotencyKey: key,
      recipientEmail: `Person.${key}@Example.ORG`,
      payload: { subject: 'secret subject', summary: 'secret summary', deepLinkPath: '/x' },
      ...fields,
    })
    .returning({ id: schema.notifications.id });
  if (!row) throw new Error('insert failed');
  return row.id;
}

async function rowOf(db: Db, id: string) {
  const [row] = await db.select().from(schema.notifications).where(eq(schema.notifications.id, id));
  if (!row) throw new Error('row missing');
  return row;
}

describe('email delivery admin', () => {
  let db: Db;
  let support: StaffScope<'PROCESSING_JOB_RETRY'>;

  beforeEach(async () => {
    db = await freshDb();
    const auth = await seedStaffAccount(db, 'SUPPORT_ADMIN', 'support@example.com');
    support = await staffScopeFor(db, auth, 'PROCESSING_JOB_RETRY');
  });

  it('lists failed and long-waiting emails with only the recipient domain', async () => {
    const failed = await addEmail(db, 'failed', {
      status: 'FAILED',
      attempts: 5,
      lastError: 'Email provider returned status 500',
      createdAt: minutesAgo(60),
    });
    const bounced = await addEmail(db, 'bounced', {
      status: 'BOUNCED',
      sentAt: minutesAgo(30),
      bouncedAt: minutesAgo(20),
      createdAt: minutesAgo(30),
    });
    const oldWaiting = await addEmail(db, 'old-waiting', { createdAt: minutesAgo(45) });
    const olderWaiting = await addEmail(db, 'older-waiting', { createdAt: minutesAgo(90) });
    await addEmail(db, 'fresh-waiting', { createdAt: minutesAgo(2) });
    await addEmail(db, 'delivered', {
      status: 'DELIVERED',
      sentAt: minutesAgo(10),
      deliveredAt: minutesAgo(9),
    });
    await addEmail(db, 'in-app-failed', { channel: 'IN_APP', status: 'FAILED' });
    await addEmail(db, 'no-address', {
      status: 'FAILED',
      recipientEmail: null,
      recipientAccountId: support.accountId,
      createdAt: minutesAgo(5),
    });

    const listed = await listEmailDeliveryProblems(db, support, NOW);
    if (!isOk(listed)) throw new Error('expected ok');
    const { failed: failedRows, waiting, counts } = listed.value;

    expect(failedRows.map((r) => r.id)).toEqual([expect.any(String), bounced, failed]);
    expect(failedRows[0]?.recipientDomain).toBeNull();
    expect(failedRows[2]).toMatchObject({
      status: 'FAILED',
      attempts: 5,
      lastError: 'Email provider returned status 500',
      recipientDomain: 'example.org',
    });
    expect(waiting.map((r) => r.id)).toEqual([olderWaiting, oldWaiting]);
    expect(counts).toEqual({ sentToday: 2, deliveredToday: 1, failedToday: 3, waitingNow: 3 });

    const serialized = JSON.stringify(listed.value);
    expect(serialized).not.toContain('@');
    expect(serialized.toLowerCase()).not.toContain('person.');
    expect(serialized).not.toContain('secret');
    for (const row of [...failedRows, ...waiting]) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'attempts',
          'createdAt',
          'eventType',
          'id',
          'lastError',
          'nextAttemptAt',
          'recipientDomain',
          'status',
        ].sort(),
      );
    }
  });

  it('puts a failed email back with fresh tries and records who asked', async () => {
    const id = await addEmail(db, 'retry-me', {
      eventType: 'TEAM_INVITATION_CREATED',
      status: 'FAILED',
      attempts: 5,
      lastError: 'Email provider unavailable or request timed out',
      nextAttemptAt: minutesAgo(600),
      leaseOwner: 'old-worker',
      leaseExpiresAt: minutesAgo(500),
    });

    const result = await resendEmail(db, support, { notificationId: id });
    if (!result.ok) throw new Error('expected ok');
    const copyId = result.value.id;
    expect(copyId).not.toBe(id);

    // The failed email is closed, and a fresh copy waits with a new send key, so the mail
    // service cannot mistake it for the earlier attempt.
    const original = await rowOf(db, id);
    const copy = await rowOf(db, copyId);
    expect(original.status).toBe('CANCELLED');
    expect(copy).toMatchObject({
      status: 'QUEUED',
      attempts: 0,
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      eventType: original.eventType,
      recipientEmail: original.recipientEmail,
      resourceId: original.resourceId,
      payload: original.payload,
    });
    expect(copy.idempotencyKey).not.toBe(original.idempotencyKey);
    expect(copy.nextAttemptAt.getTime()).toBeGreaterThan(minutesAgo(1).getTime());

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'EMAIL_RESEND_REQUESTED'));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorAccountId: support.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'notification',
      resourceId: copyId,
    });
    expect(Object.keys(audits[0]?.metadata as object).sort()).toEqual(['eventType', 'replaces']);
    expect(audits[0]?.metadata).toEqual({ eventType: 'TEAM_INVITATION_CREATED', replaces: id });

    // Already closed: a second press is refused and nothing more is recorded.
    const again = await resendEmail(db, support, { notificationId: id });
    expect(isErr(again) && again.error.message).toBe(EMAIL_RESEND_REFUSED.notFailed);
  });

  it('refuses a bounced, sent or in-app row and an unknown id, changing nothing', async () => {
    const bounced = await addEmail(db, 'bounced', { status: 'BOUNCED' });
    const sent = await addEmail(db, 'sent', { status: 'SENT' });
    const inApp = await addEmail(db, 'in-app', { channel: 'IN_APP', status: 'FAILED' });

    const cases: [string, string][] = [
      [bounced, EMAIL_RESEND_REFUSED.bounced],
      [sent, EMAIL_RESEND_REFUSED.notFailed],
      [inApp, EMAIL_RESEND_REFUSED.notEmail],
      ['3b85b469-4d6f-4d94-8eeb-bab0e47fde42', EMAIL_RESEND_REFUSED.notFound],
      ['not-an-id', EMAIL_RESEND_REFUSED.notFound],
    ];
    for (const [notificationId, message] of cases) {
      const result = await resendEmail(db, support, { notificationId });
      expect(isErr(result) && result.error.message).toBe(message);
    }
    expect((await rowOf(db, bounced)).status).toBe('BOUNCED');
    expect((await rowOf(db, sent)).status).toBe('SENT');
    expect((await rowOf(db, inApp)).status).toBe('FAILED');
    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'EMAIL_RESEND_REQUESTED'));
    expect(audits).toHaveLength(0);
  });

  it('refuses a forged scope and a scope made for another action', async () => {
    const id = await addEmail(db, 'forged', { status: 'FAILED' });
    const forged = {
      kind: 'staff',
      accountId: support.accountId,
      platformAction: 'PROCESSING_JOB_RETRY',
      verifiedAt: new Date(),
    } as unknown as StaffScope<'PROCESSING_JOB_RETRY'>;
    const ownerAuth = await seedStaffAccount(db, 'PLATFORM_OWNER', 'owner@example.com');
    const other = (await staffScopeFor(
      db,
      ownerAuth,
      'ACCOUNT_SIGN_IN_RECOVERY',
    )) as unknown as StaffScope<'PROCESSING_JOB_RETRY'>;

    for (const scope of [forged, other]) {
      const listed = await listEmailDeliveryProblems(db, scope, NOW);
      expect(isErr(listed) && listed.error.code).toBe('forbidden');
      const resent = await resendEmail(db, scope, { notificationId: id });
      expect(isErr(resent) && resent.error.code).toBe('forbidden');
    }
    expect((await rowOf(db, id)).status).toBe('FAILED');
  });

  it('lets a support admin, but not an account without a role, get the scope', async () => {
    expect(support.platformAction).toBe('PROCESSING_JOB_RETRY');
    const plain = await provisionAccount(db, { email: 'plain@example.com' });
    if (!isOk(plain)) throw new Error('provision failed');
    const refused = await staffPrincipal(
      db,
      { accountId: plain.value.id, email: 'plain@example.com', bootstrapEmails: [] },
      'PROCESSING_JOB_RETRY',
    );
    expect(isErr(refused)).toBe(true);
  });
});
