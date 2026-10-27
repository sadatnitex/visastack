import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  applyEmailDeliveryEvent,
  buildNotificationIdempotencyKey,
  cancelQueuedNotificationsForResource,
  enqueueNotification,
  enqueueNotificationBothChannels,
  listNotificationsForAccount,
  listNotificationsNeedingAttention,
  markNotificationRead,
  retryNotification,
  runNotificationWorker,
} from './notifications';
import { createOrganization } from './organizations';
import type { EmailPort, SendEmailInput, SendEmailResult } from './ports';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
  return db as unknown as Db;
}

async function seedOwner(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision failed');
  const account = provisioned.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant failed');
  return { account, applicantId: applicant.value.id };
}

/** Deterministic in-memory email port - records every call, never sends. */
class FakeEmailPort implements EmailPort {
  public readonly sent: SendEmailInput[] = [];
  private failNext = 0;
  private nextProviderMessageId = 0;

  failNextSends(count: number): void {
    this.failNext = count;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('simulated transient provider failure');
    }
    this.sent.push(input);
    this.nextProviderMessageId++;
    return { providerMessageId: `fake-message-${this.nextProviderMessageId}` };
  }
}

const PAYLOAD = { subject: 'Test subject', summary: 'Test summary', deepLinkPath: '/app/test' };

describe('buildNotificationIdempotencyKey', () => {
  it('composes event, recipient, channel, resource and an optional threshold deterministically', () => {
    const withoutThreshold = buildNotificationIdempotencyKey({
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'IN_APP',
      resourceId: 'req-1',
      recipientAccountId: 'acct-1',
    });
    expect(withoutThreshold).toBe('EVIDENCE_REQUEST_CREATED:acct-1:IN_APP:req-1:');

    const withThreshold = buildNotificationIdempotencyKey({
      eventType: 'EXPIRY_REMINDER',
      channel: 'EMAIL',
      resourceId: 'doc-1',
      recipientAccountId: 'acct-1',
      threshold: '30',
    });
    expect(withThreshold).toBe('EXPIRY_REMINDER:acct-1:EMAIL:doc-1:30');
  });

  it('distinguishes an account recipient from an email-only recipient with the same string', () => {
    const key = buildNotificationIdempotencyKey({
      eventType: 'X',
      channel: 'EMAIL',
      resourceId: 'r',
      recipientEmail: 'a@example.com',
    });
    expect(key).toBe('X:a@example.com:EMAIL:r:');
  });
});

describe('enqueueNotification / enqueueNotificationBothChannels', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('throws when neither recipientAccountId nor recipientEmail is given - a programmer error, never silently dropped', async () => {
    await expect(
      enqueueNotification(db, {
        eventType: 'X',
        channel: 'IN_APP',
        resourceId: 'r',
        payload: PAYLOAD,
      }),
    ).rejects.toThrow();
  });

  it('enqueues a QUEUED row with the composed idempotency key', async () => {
    const { account } = await seedOwner(db, 'enqueue-owner@example.com');
    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'IN_APP',
      resourceId: 'req-1',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    const rows = await db.select().from(schema.notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('QUEUED');
    expect(rows[0]?.idempotencyKey).toBe(`EVIDENCE_REQUEST_CREATED:${account.id}:IN_APP:req-1:`);
    // resourceId is its own queryable column, not just folded into the
    // idempotency key string (Part 5 §4's cancellation mechanism needs it).
    expect(rows[0]?.resourceId).toBe('req-1');
  });

  it('is idempotent - a duplicate (event, recipient, channel, resource, threshold) tuple is silently skipped, never double-enqueued', async () => {
    const { account } = await seedOwner(db, 'idempotent-owner@example.com');
    const input = {
      eventType: 'EVIDENCE_REQUEST_CREATED' as const,
      channel: 'IN_APP' as const,
      resourceId: 'req-1',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    };
    await enqueueNotification(db, input);
    await enqueueNotification(db, input);
    await enqueueNotification(db, input);
    const rows = await db.select().from(schema.notifications);
    expect(rows).toHaveLength(1);
  });

  it('enqueues BOTH channels for the same event ("implement in-app + email")', async () => {
    const { account } = await seedOwner(db, 'both-channels-owner@example.com');
    await enqueueNotificationBothChannels(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      resourceId: 'req-1',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    const rows = await db.select().from(schema.notifications);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
  });

  it('a different resourceId for the same event/recipient/channel is a DIFFERENT notification, not a collision', async () => {
    const { account } = await seedOwner(db, 'distinct-resource-owner@example.com');
    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'IN_APP',
      resourceId: 'req-1',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'IN_APP',
      resourceId: 'req-2',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    const rows = await db.select().from(schema.notifications);
    expect(rows).toHaveLength(2);
  });
});

describe('cancelQueuedNotificationsForResource (Part 5 §4 / A17)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('cancels every still-QUEUED row for the resource, both channels', async () => {
    const { account } = await seedOwner(db, 'cancel-owner@example.com');
    await enqueueNotificationBothChannels(db, {
      eventType: 'TASK_DEADLINE',
      resourceId: 'task-1',
      recipientAccountId: account.id,
      threshold: 'due_7d',
      payload: PAYLOAD,
    });
    const result = await cancelQueuedNotificationsForResource(db, 'task-1');
    expect(result.cancelled).toBe(2);
    const rows = await db.select().from(schema.notifications);
    for (const row of rows) expect(row.status).toBe('CANCELLED');
  });

  it('never touches a different resourceId', async () => {
    const { account } = await seedOwner(db, 'cancel-scope-owner@example.com');
    await enqueueNotificationBothChannels(db, {
      eventType: 'TASK_DEADLINE',
      resourceId: 'task-a',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    await enqueueNotificationBothChannels(db, {
      eventType: 'TASK_DEADLINE',
      resourceId: 'task-b',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    const result = await cancelQueuedNotificationsForResource(db, 'task-a');
    expect(result.cancelled).toBe(2);
    const rows = await db.select().from(schema.notifications);
    for (const row of rows) {
      expect(row.status).toBe(row.resourceId === 'task-a' ? 'CANCELLED' : 'QUEUED');
    }
  });

  it('never un-sends an already-SENT notification', async () => {
    const { account } = await seedOwner(db, 'cancel-sent-owner@example.com');
    await enqueueNotification(db, {
      eventType: 'TASK_DEADLINE',
      channel: 'IN_APP',
      resourceId: 'task-1',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    const sentResult = await runNotificationWorker(db, new FakeEmailPort(), 'https://example.test');
    expect(sentResult.sent).toBe(1);

    const result = await cancelQueuedNotificationsForResource(db, 'task-1');
    expect(result.cancelled).toBe(0);
    const rows = await db.select().from(schema.notifications);
    expect(rows[0]?.status).toBe('SENT');
  });

  it('is a harmless no-op for a resourceId with no notifications at all', async () => {
    const result = await cancelQueuedNotificationsForResource(db, 'no-such-resource');
    expect(result.cancelled).toBe(0);
  });
});

describe('runNotificationWorker', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('marks an IN_APP notification SENT immediately, with no email port call', async () => {
    const { account } = await seedOwner(db, 'inapp-owner@example.com');
    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'IN_APP',
      resourceId: 'req-1',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    const emailPort = new FakeEmailPort();
    const result = await runNotificationWorker(db, emailPort, 'https://app.example.com');
    expect(result).toEqual({ sent: 1, retrying: 0, failed: 0 });
    expect(emailPort.sent).toHaveLength(0);
    const row = (await db.select().from(schema.notifications))[0];
    expect(row?.status).toBe('SENT');
    expect(row?.sentAt).not.toBeNull();
  });

  it('sends an EMAIL notification via the injected port, composing subject/body/deep link', async () => {
    const { account } = await seedOwner(db, 'email-owner@example.com');
    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'EMAIL',
      resourceId: 'req-1',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    const emailPort = new FakeEmailPort();
    const result = await runNotificationWorker(db, emailPort, 'https://app.example.com');
    expect(result).toEqual({ sent: 1, retrying: 0, failed: 0 });
    expect(emailPort.sent).toHaveLength(1);
    expect(emailPort.sent[0]?.to).toBe('email-owner@example.com');
    expect(emailPort.sent[0]?.subject).toBe(PAYLOAD.subject);
    expect(emailPort.sent[0]?.body).toContain(PAYLOAD.summary);
    expect(emailPort.sent[0]?.body).toContain('https://app.example.com/app/test');

    const row = (await db.select().from(schema.notifications))[0];
    expect(row?.providerMessageId).toBe('fake-message-1');
    expect(emailPort.sent[0]?.idempotencyKey).toBe(`notification-${row?.id}`);
  });

  it('sends only the named record when asked, ahead of an older backlog', async () => {
    const { account } = await seedOwner(db, 'targeted-owner@example.com');
    for (const resourceId of ['older-1', 'older-2', 'mine']) {
      await enqueueNotification(db, {
        eventType: 'EVIDENCE_REQUEST_CREATED',
        channel: 'EMAIL',
        resourceId,
        recipientAccountId: account.id,
        payload: PAYLOAD,
      });
    }
    const emailPort = new FakeEmailPort();
    const result = await runNotificationWorker(db, emailPort, 'https://app.example.com', {
      resourceId: 'mine',
      limit: 1,
    });
    expect(result).toEqual({ sent: 1, retrying: 0, failed: 0 });
    const rows = await db.select().from(schema.notifications);
    expect(rows.filter((r) => r.status === 'SENT').map((r) => r.resourceId)).toEqual(['mine']);
    expect(rows.filter((r) => r.status === 'QUEUED')).toHaveLength(2);
  });

  it('reuses the same opaque provider key when retrying a failed send', async () => {
    const { account } = await seedOwner(db, 'stable-retry@example.com');
    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'EMAIL',
      resourceId: 'stable-retry',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    const attempts: SendEmailInput[] = [];
    const port: EmailPort = {
      async send(input) {
        attempts.push(input);
        if (attempts.length === 1) throw new Error('temporary failure');
        return { providerMessageId: 'stable-provider-message' };
      },
    };
    expect(await runNotificationWorker(db, port, 'https://app.example.com')).toEqual({
      sent: 0,
      retrying: 1,
      failed: 0,
    });
    const row = (await db.select().from(schema.notifications))[0];
    if (!row) throw new Error('missing row');
    expect(
      await runNotificationWorker(db, port, 'https://app.example.com', { now: row.nextAttemptAt }),
    ).toEqual({ sent: 1, retrying: 0, failed: 0 });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.idempotencyKey).toBe(`notification-${row.id}`);
    expect(attempts[1]?.idempotencyKey).toBe(attempts[0]?.idempotencyKey);
  });

  it('keeps unconfigured email queued and removes private provider exception text', async () => {
    const { account } = await seedOwner(db, 'not-sent@example.com');
    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'EMAIL',
      resourceId: 'not-sent',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    const port: EmailPort = {
      async send() {
        throw new Error('Email provider returned status 401; private@example.com; private-body');
      },
    };
    expect(await runNotificationWorker(db, port, 'https://app.example.com')).toEqual({
      sent: 0,
      retrying: 1,
      failed: 0,
    });
    const row = (await db.select().from(schema.notifications))[0];
    expect(row?.status).toBe('QUEUED');
    expect(row?.sentAt).toBeNull();
    expect(row?.providerMessageId).toBeNull();
    expect(row?.lastError).toBe('Email delivery failed; provider acceptance was not confirmed');
  });

  it('releases unattempted jobs without consuming attempts when its time budget expires', async () => {
    const { account } = await seedOwner(db, 'budget@example.com');
    for (const resourceId of ['budget-1', 'budget-2'])
      await enqueueNotification(db, {
        eventType: 'EVIDENCE_REQUEST_CREATED',
        channel: 'EMAIL',
        resourceId,
        recipientAccountId: account.id,
        payload: PAYLOAD,
      });
    let clock = 1000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const port: EmailPort = {
      async send() {
        clock += 100;
        return { providerMessageId: 'budget-provider' };
      },
    };
    try {
      expect(
        await runNotificationWorker(db, port, 'https://app.example.com', { timeBudgetMs: 50 }),
      ).toEqual({ sent: 1, retrying: 0, failed: 0, deferred: 1 });
      const remaining = (await db.select().from(schema.notifications)).find(
        (row) => row.status === 'QUEUED',
      );
      expect(remaining?.attempts).toBe(0);
      expect(remaining?.leaseOwner).toBeNull();
      expect(remaining?.leaseExpiresAt).toBeNull();
      expect(
        await runNotificationWorker(db, new FakeEmailPort(), 'https://app.example.com'),
      ).toEqual({ sent: 1, retrying: 0, failed: 0 });
    } finally {
      spy.mockRestore();
    }
  });

  it('never labels provider acceptance as delivered - SENT stays SENT until a real webhook would confirm DELIVERED (not modeled here)', async () => {
    const { account } = await seedOwner(db, 'no-fake-delivered-owner@example.com');
    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'EMAIL',
      resourceId: 'req-1',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    await runNotificationWorker(db, new FakeEmailPort(), 'https://app.example.com');
    const row = (await db.select().from(schema.notifications))[0];
    expect(row?.status).toBe('SENT');
    expect(row?.deliveredAt).toBeNull();
  });

  it('retries a transient email failure with backoff, never immediately, and FAILS permanently after 5 attempts', async () => {
    const { account } = await seedOwner(db, 'retry-owner@example.com');
    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'EMAIL',
      resourceId: 'req-1',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    const emailPort = new FakeEmailPort();
    emailPort.failNextSends(5);

    for (let i = 0; i < 4; i++) {
      const row = (await db.select().from(schema.notifications))[0];
      if (!row) throw new Error('row missing');
      const result = await runNotificationWorker(db, emailPort, 'https://app.example.com', {
        now: row.nextAttemptAt,
      });
      expect(result).toEqual({ sent: 0, retrying: 1, failed: 0 });
      const updated = (await db.select().from(schema.notifications))[0];
      expect(updated?.status).toBe('QUEUED');
      expect(updated?.attempts).toBe(i + 1);
      expect(updated?.nextAttemptAt.getTime()).toBeGreaterThan(row.nextAttemptAt.getTime());
    }

    // 5th and final attempt exhausts retries.
    const lastRow = (await db.select().from(schema.notifications))[0];
    if (!lastRow) throw new Error('row missing');
    const finalResult = await runNotificationWorker(db, emailPort, 'https://app.example.com', {
      now: lastRow.nextAttemptAt,
    });
    expect(finalResult).toEqual({ sent: 0, retrying: 0, failed: 1 });
    const finalRow = (await db.select().from(schema.notifications))[0];
    expect(finalRow?.status).toBe('FAILED');
    expect(finalRow?.attempts).toBe(5);
    expect(finalRow?.lastError).toBe(
      'Email delivery failed; provider acceptance was not confirmed',
    );
  });

  it('re-verifies authorization at SEND time, not merely at enqueue time - a removed org member never receives an org-scoped notification', async () => {
    const requester = await provisionAccount(db, { email: 'reauth-requester@example.com' });
    if (!isOk(requester)) throw new Error('provision failed');
    await setConsent(db, {
      actorAccountId: requester.value.id,
      accountId: requester.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: requester.value.id,
      ownerAccountId: requester.value.id,
      displayName: 'Applicant',
    });
    if (!isOk(applicant)) throw new Error('applicant failed');
    const org = await createOrganization(db, { actorAccountId: requester.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org failed');

    const stranger = await seedOwner(db, 'removed-org-member@example.com');
    // Enqueue an org-scoped notification for an account with NO membership in that org at all.
    await enqueueNotification(db, {
      eventType: 'MISSION_STATUS_CHANGED',
      channel: 'IN_APP',
      resourceId: 'decision-1',
      recipientAccountId: stranger.account.id,
      applicantId: applicant.value.id,
      organizationId: org.value.id,
      payload: PAYLOAD,
    });
    const result = await runNotificationWorker(db, new FakeEmailPort(), 'https://app.example.com');
    expect(result).toEqual({ sent: 0, retrying: 0, failed: 1 });
    const row = (await db.select().from(schema.notifications))[0];
    expect(row?.status).toBe('FAILED');
    expect(row?.lastError).toBe('recipient no longer authorized');
  });

  it('an applicant-scoped notification succeeds for the current owner and fails once ownership no longer matches', async () => {
    const { account, applicantId } = await seedOwner(db, 'applicant-scoped-owner@example.com');
    const stranger = await provisionAccount(db, { email: 'applicant-scoped-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision failed');

    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'IN_APP',
      resourceId: 'req-owner',
      recipientAccountId: account.id,
      applicantId,
      payload: PAYLOAD,
    });
    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'IN_APP',
      resourceId: 'req-stranger',
      recipientAccountId: stranger.value.id,
      applicantId,
      payload: PAYLOAD,
    });

    const result = await runNotificationWorker(db, new FakeEmailPort(), 'https://app.example.com');
    expect(result).toEqual({ sent: 1, retrying: 0, failed: 1 });
  });

  it('delivers traveller case notices with organization metadata to the current applicant owner', async () => {
    const { account, applicantId } = await seedOwner(db, 'case-notice-owner@example.com');
    const org = await createOrganization(db, { actorAccountId: account.id, name: 'Case agency' });
    if (!isOk(org)) throw new Error('org failed');
    await enqueueNotificationBothChannels(db, {
      eventType: 'EVIDENCE_REVIEW_ACCEPTED',
      resourceId: 'owner-case-update',
      recipientAccountId: account.id,
      applicantId,
      organizationId: org.value.id,
      payload: PAYLOAD,
    });
    const email = new FakeEmailPort();
    expect(await runNotificationWorker(db, email, 'https://app.example.com')).toEqual({
      sent: 2,
      retrying: 0,
      failed: 0,
    });
    expect(email.sent).toHaveLength(1);
  });

  it('requires a current accepted grant for agency recipients even when membership remains active', async () => {
    const owner = await seedOwner(db, 'grant-owner@example.com');
    const member = await seedOwner(db, 'grant-recipient@example.com');
    const org = await createOrganization(db, {
      actorAccountId: member.account.id,
      name: 'Granted agency',
    });
    if (!isOk(org)) throw new Error('org failed');
    await db
      .update(schema.organizations)
      .set({ status: 'ACTIVE' })
      .where(eq(schema.organizations.id, org.value.id));
    await db
      .insert(schema.memberships)
      .values({ accountId: member.account.id, organizationId: org.value.id, role: 'ADMIN' })
      .onConflictDoNothing();
    const grant = (
      await db
        .insert(schema.grants)
        .values({
          applicantId: owner.applicantId,
          recipientOrganizationId: org.value.id,
          actions: ['VIEW_METADATA'],
          purpose: 'Synthetic case notice',
          startAt: new Date(Date.now() - 60_000),
          status: 'ACTIVE',
          acceptedAt: new Date(),
        })
        .returning()
    )[0];
    if (!grant) throw new Error('grant failed');
    const enqueue = (resourceId: string) =>
      enqueueNotification(db, {
        eventType: 'CASE_UPDATE',
        channel: 'EMAIL',
        resourceId,
        recipientAccountId: member.account.id,
        applicantId: owner.applicantId,
        organizationId: org.value.id,
        payload: PAYLOAD,
      });
    await enqueue('active-grant');
    expect(await runNotificationWorker(db, new FakeEmailPort(), 'https://app.example.com')).toEqual(
      { sent: 1, retrying: 0, failed: 0 },
    );
    await db.update(schema.grants).set({ status: 'REVOKED' }).where(eq(schema.grants.id, grant.id));
    await enqueue('revoked-grant');
    const email = new FakeEmailPort();
    expect(await runNotificationWorker(db, email, 'https://app.example.com')).toEqual({
      sent: 0,
      retrying: 0,
      failed: 1,
    });
    expect(email.sent).toHaveLength(0);
  });

  it('never overwrites cancellation or another worker lease after provider acceptance', async () => {
    const { account } = await seedOwner(db, 'lease-race@example.com');
    for (const kind of ['cancel', 'lease']) {
      await enqueueNotification(db, {
        eventType: 'CASE_UPDATE',
        channel: 'EMAIL',
        resourceId: kind,
        recipientAccountId: account.id,
        payload: PAYLOAD,
      });
      const port: EmailPort = {
        async send() {
          const row = (
            await db
              .select()
              .from(schema.notifications)
              .where(eq(schema.notifications.resourceId, kind))
          )[0];
          if (!row) throw new Error('row missing');
          await db
            .update(schema.notifications)
            .set(kind === 'cancel' ? { status: 'CANCELLED' } : { leaseOwner: 'new-worker-owner' })
            .where(eq(schema.notifications.id, row.id));
          return { providerMessageId: 'race-provider-message' };
        },
      };
      expect(await runNotificationWorker(db, port, 'https://app.example.com')).toEqual({
        sent: 0,
        retrying: 0,
        failed: 0,
        deferred: 1,
      });
      const row = (
        await db
          .select()
          .from(schema.notifications)
          .where(eq(schema.notifications.resourceId, kind))
      )[0];
      if (kind === 'cancel') expect(row?.status).toBe('CANCELLED');
      else {
        expect(row?.status).toBe('QUEUED');
        expect(row?.leaseOwner).toBe('new-worker-owner');
      }
    }
  });

  it('claims at most `limit` due rows per pass', async () => {
    const { account } = await seedOwner(db, 'limit-owner@example.com');
    for (let i = 0; i < 5; i++) {
      await enqueueNotification(db, {
        eventType: 'EVIDENCE_REQUEST_CREATED',
        channel: 'IN_APP',
        resourceId: `req-${i}`,
        recipientAccountId: account.id,
        payload: PAYLOAD,
      });
    }
    const result = await runNotificationWorker(db, new FakeEmailPort(), 'https://app.example.com', {
      limit: 2,
    });
    expect(result.sent).toBe(2);
    const remainingQueued = (await db.select().from(schema.notifications)).filter(
      (r) => r.status === 'QUEUED',
    );
    expect(remainingQueued).toHaveLength(3);
  });
});

describe('listNotificationsForAccount / markNotificationRead', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('lists only SENT/READ IN_APP rows for the given account, newest first, never a still-QUEUED or FAILED row', async () => {
    const { account } = await seedOwner(db, 'list-owner@example.com');
    await enqueueNotification(db, {
      eventType: 'A',
      channel: 'IN_APP',
      resourceId: '1',
      recipientAccountId: account.id,
      payload: { subject: 'First', summary: 's', deepLinkPath: '/1' },
    });
    await enqueueNotification(db, {
      eventType: 'B',
      channel: 'EMAIL', // never listed in-app
      resourceId: '2',
      recipientAccountId: account.id,
      payload: { subject: 'EmailOnly', summary: 's', deepLinkPath: '/2' },
    });
    await enqueueNotification(db, {
      eventType: 'C',
      channel: 'IN_APP',
      resourceId: '3',
      recipientAccountId: account.id,
      payload: { subject: 'StillQueued', summary: 's', deepLinkPath: '/3' },
    });
    await runNotificationWorker(db, new FakeEmailPort(), 'https://app.example.com', { limit: 1 });

    const list = await listNotificationsForAccount(db, account.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.subject).toBe('First');
    expect(list[0]?.read).toBe(false);
  });

  it('never lists a different account notifications (tenant isolation)', async () => {
    const { account: owner } = await seedOwner(db, 'isolation-owner@example.com');
    const { account: stranger } = await seedOwner(db, 'isolation-stranger@example.com');
    await enqueueNotification(db, {
      eventType: 'A',
      channel: 'IN_APP',
      resourceId: '1',
      recipientAccountId: owner.id,
      payload: PAYLOAD,
    });
    await runNotificationWorker(db, new FakeEmailPort(), 'https://app.example.com');
    expect(await listNotificationsForAccount(db, stranger.id)).toHaveLength(0);
    expect(await listNotificationsForAccount(db, owner.id)).toHaveLength(1);
  });

  it('marks the account own notification read; refuses a different account notification', async () => {
    const { account: owner } = await seedOwner(db, 'read-owner@example.com');
    const { account: stranger } = await seedOwner(db, 'read-stranger@example.com');
    await enqueueNotification(db, {
      eventType: 'A',
      channel: 'IN_APP',
      resourceId: '1',
      recipientAccountId: owner.id,
      payload: PAYLOAD,
    });
    await runNotificationWorker(db, new FakeEmailPort(), 'https://app.example.com');
    const notificationId = (await db.select().from(schema.notifications))[0]?.id;
    if (!notificationId) throw new Error('missing notification');

    const denied = await markNotificationRead(db, {
      actorAccountId: stranger.id,
      notificationId,
    });
    expect(denied.ok).toBe(false);

    const allowed = await markNotificationRead(db, {
      actorAccountId: owner.id,
      notificationId,
    });
    expect(allowed.ok).toBe(true);
    const list = await listNotificationsForAccount(db, owner.id);
    expect(list[0]?.read).toBe(true);
  });
});

describe('listNotificationsNeedingAttention / retryNotification', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('surfaces a FAILED row for admin attention, without exposing its message payload in that shape', async () => {
    const { account } = await seedOwner(db, 'attention-owner@example.com');
    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'EMAIL',
      resourceId: 'req-1',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    const emailPort = new FakeEmailPort();
    emailPort.failNextSends(5);
    for (let i = 0; i < 5; i++) {
      const row = (await db.select().from(schema.notifications))[0];
      if (!row) throw new Error('row missing');
      await runNotificationWorker(db, emailPort, 'https://app.example.com', {
        now: row.nextAttemptAt,
      });
    }

    const attention = await listNotificationsNeedingAttention(db);
    expect(attention).toHaveLength(1);
    expect(attention[0]?.status).toBe('FAILED');
    expect(attention[0]).not.toHaveProperty('payload');
  });

  it('retryNotification requeues a FAILED row; refuses anything else', async () => {
    const { account } = await seedOwner(db, 'retry-action-owner@example.com');
    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'IN_APP',
      resourceId: 'req-1',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    const queuedRow = (await db.select().from(schema.notifications))[0];
    if (!queuedRow) throw new Error('missing row');

    const refused = await retryNotification(db, { notificationId: queuedRow.id });
    expect(refused.ok).toBe(false);

    await db
      .update(schema.notifications)
      .set({ status: 'FAILED', lastError: 'boom' })
      .where(eq(schema.notifications.id, queuedRow.id));
    const retried = await retryNotification(db, { notificationId: queuedRow.id });
    expect(retried.ok).toBe(true);
    const row = (await db.select().from(schema.notifications))[0];
    expect(row?.status).toBe('QUEUED');
  });
});

describe('applyEmailDeliveryEvent (NTF-03 delivery/bounce webhook)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function seedSentEmail(db: Db) {
    const { account } = await seedOwner(db, `webhook-owner-${Math.random()}@example.com`);
    await enqueueNotification(db, {
      eventType: 'EVIDENCE_REQUEST_CREATED',
      channel: 'EMAIL',
      resourceId: 'req-1',
      recipientAccountId: account.id,
      payload: PAYLOAD,
    });
    await runNotificationWorker(db, new FakeEmailPort(), 'https://app.example.com');
    const row = (await db.select().from(schema.notifications))[0];
    if (!row?.providerMessageId) throw new Error('missing providerMessageId');
    return row;
  }

  it('records provider rejection as failed and refuses replay or a later delivered event', async () => {
    const row = await seedSentEmail(db);
    const input = {
      providerMessageId: row.providerMessageId as string,
      outcome: 'failed' as const,
    };
    expect((await applyEmailDeliveryEvent(db, input)).applied).toBe(true);
    expect((await db.select().from(schema.notifications))[0]?.status).toBe('FAILED');
    expect((await applyEmailDeliveryEvent(db, input)).applied).toBe(false);
    expect((await applyEmailDeliveryEvent(db, { ...input, outcome: 'delivered' })).applied).toBe(
      false,
    );
  });

  it.each(['bounced', 'complained'] as const)(
    'records a late %s after delivery without permitting replay or re-delivery',
    async (outcome) => {
      const row = await seedSentEmail(db);
      const providerMessageId = row.providerMessageId as string;
      await applyEmailDeliveryEvent(db, { providerMessageId, outcome: 'delivered' });
      expect((await applyEmailDeliveryEvent(db, { providerMessageId, outcome })).applied).toBe(
        true,
      );
      expect((await db.select().from(schema.notifications))[0]?.status).toBe('BOUNCED');
      expect((await applyEmailDeliveryEvent(db, { providerMessageId, outcome })).applied).toBe(
        false,
      );
      expect(
        (await applyEmailDeliveryEvent(db, { providerMessageId, outcome: 'delivered' })).applied,
      ).toBe(false);
    },
  );

  it('marks a SENT row DELIVERED on a delivered event', async () => {
    const row = await seedSentEmail(db);
    const result = await applyEmailDeliveryEvent(db, {
      providerMessageId: row.providerMessageId as string,
      outcome: 'delivered',
    });
    expect(result.applied).toBe(true);
    const updated = (await db.select().from(schema.notifications))[0];
    expect(updated?.status).toBe('DELIVERED');
    expect(updated?.deliveredAt).not.toBeNull();
  });

  it('marks a SENT row BOUNCED on a bounced event', async () => {
    const row = await seedSentEmail(db);
    const result = await applyEmailDeliveryEvent(db, {
      providerMessageId: row.providerMessageId as string,
      outcome: 'bounced',
    });
    expect(result.applied).toBe(true);
    const updated = (await db.select().from(schema.notifications))[0];
    expect(updated?.status).toBe('BOUNCED');
    expect(updated?.bouncedAt).not.toBeNull();
  });

  it('is idempotent: replaying the same event twice applies once, the second time is a harmless no-op', async () => {
    const row = await seedSentEmail(db);
    const first = await applyEmailDeliveryEvent(db, {
      providerMessageId: row.providerMessageId as string,
      outcome: 'delivered',
    });
    const second = await applyEmailDeliveryEvent(db, {
      providerMessageId: row.providerMessageId as string,
      outcome: 'delivered',
    });
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    const rows = await db.select().from(schema.notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('DELIVERED');
  });

  it('never un-bounces an already-BOUNCED row from a late out-of-order delivered event', async () => {
    const row = await seedSentEmail(db);
    await applyEmailDeliveryEvent(db, {
      providerMessageId: row.providerMessageId as string,
      outcome: 'bounced',
    });
    const lateDelivered = await applyEmailDeliveryEvent(db, {
      providerMessageId: row.providerMessageId as string,
      outcome: 'delivered',
    });
    expect(lateDelivered.applied).toBe(false);
    const updated = (await db.select().from(schema.notifications))[0];
    expect(updated?.status).toBe('BOUNCED');
  });

  it('does nothing for an unknown providerMessageId', async () => {
    const result = await applyEmailDeliveryEvent(db, {
      providerMessageId: 'unknown-id',
      outcome: 'delivered',
    });
    expect(result.applied).toBe(false);
  });
});
