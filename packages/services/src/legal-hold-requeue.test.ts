import { randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { registerDocument } from './documents';
import { retryErasureJob } from './erasure';
import { placeLegalHold, releaseLegalHold } from './legal-hold';

async function seedApplicant(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
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
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId: account.id, applicantId: applicant.value.id };
}

async function seedJob(
  db: Db,
  input: {
    applicantId: string;
    status: 'BLOCKED_BY_HOLD' | 'FAILED';
    documentId?: string;
  },
) {
  const [row] = await db
    .insert(schema.erasureJobs)
    .values({
      reason: 'RETENTION_PURGE',
      status: input.status,
      bucket: 'CLEAN',
      objectKey: `obj-${randomUUID()}`,
      storageObjectId: randomUUID(),
      applicantId: input.applicantId,
      documentId: input.documentId ?? null,
      attempts: 2,
      lastError: 'parked',
    })
    .returning();
  if (!row) throw new Error('job');
  return row;
}

async function place(db: Db, who: { accountId: string; applicantId: string }) {
  const placed = await placeLegalHold(db, {
    actorAccountId: who.accountId,
    applicantId: who.applicantId,
    reason: 'court order',
    reviewAt: new Date(Date.now() + 86_400_000),
    stepUpSatisfied: true,
  });
  if (!isOk(placed)) throw new Error('place');
  return placed.value;
}

const release = (db: Db, accountId: string, holdId: string) =>
  releaseLegalHold(db, { actorAccountId: accountId, holdId, stepUpSatisfied: true });

const statusOf = async (db: Db, jobId: string) =>
  (await db.select().from(schema.erasureJobs).where(eq(schema.erasureJobs.id, jobId)))[0]?.status;

const retryEvents = (db: Db) =>
  db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.eventType, 'ERASURE_JOB_RETRIED'));

describe('releasing a legal hold puts the jobs it parked back in the queue', () => {
  let db: Db;
  beforeEach(async () => {
    db = (await createMigratedPglite().then((c) => drizzle(c, { schema }))) as unknown as Db;
  });

  it('re-queues a parked job with a fresh attempt budget and writes an automatic audit event', async () => {
    const owner = await seedApplicant(db, 'a@example.com');
    const hold = await place(db, owner);
    const job = await seedJob(db, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });

    expect(isOk(await release(db, owner.accountId, hold.id))).toBe(true);

    const after = (await db.select().from(schema.erasureJobs))[0];
    expect(after).toMatchObject({ id: job.id, status: 'PENDING', attempts: 0, lastError: null });
    const events = await retryEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorAccountId: owner.accountId,
      method: 'SYSTEM',
      resourceType: 'erasure_job',
      resourceId: job.id,
      metadata: {
        outcome: 'REQUEUED',
        was: 'BLOCKED_BY_HOLD',
        cause: 'HOLD_RELEASED',
        holdId: hold.id,
      },
    });
  });

  it('keeps the job parked while another hold still covers it, then queues it once that one is released', async () => {
    const owner = await seedApplicant(db, 'b@example.com');
    const first = await place(db, owner);
    const second = await place(db, owner);
    const job = await seedJob(db, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });

    await release(db, owner.accountId, first.id);
    expect(await statusOf(db, job.id)).toBe('BLOCKED_BY_HOLD');
    expect(await retryEvents(db)).toHaveLength(0);

    await release(db, owner.accountId, second.id);
    expect(await statusOf(db, job.id)).toBe('PENDING');
    expect(await retryEvents(db)).toHaveLength(1);
  });

  it('keeps a document job parked while a hold on that document remains', async () => {
    const owner = await seedApplicant(db, 'c@example.com');
    const wide = await place(db, owner);
    const doc = await registerDocument(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      originalName: 'd.pdf',
    });
    if (!isOk(doc)) throw new Error('doc');
    const documentId = doc.value.id;
    await db.insert(schema.legalHolds).values({
      applicantId: owner.applicantId,
      documentId,
      reason: 'dispute',
      placedByAccountId: owner.accountId,
      reviewAt: new Date(Date.now() + 86_400_000),
    });
    const job = await seedJob(db, {
      applicantId: owner.applicantId,
      status: 'BLOCKED_BY_HOLD',
      documentId,
    });
    await release(db, owner.accountId, wide.id);
    expect(await statusOf(db, job.id)).toBe('BLOCKED_BY_HOLD');
  });

  it('queues the job once when the hold is released twice', async () => {
    const owner = await seedApplicant(db, 'd@example.com');
    const hold = await place(db, owner);
    const job = await seedJob(db, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });

    expect(isOk(await release(db, owner.accountId, hold.id))).toBe(true);
    expect(isErr(await release(db, owner.accountId, hold.id))).toBe(true);

    expect(await statusOf(db, job.id)).toBe('PENDING');
    expect(await retryEvents(db)).toHaveLength(1);
  });

  it('does not queue a job an admin already retried', async () => {
    const owner = await seedApplicant(db, 'e@example.com');
    const hold = await place(db, owner);
    const job = await seedJob(db, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });

    expect(await retryErasureJob(db, job.id, owner.accountId)).toBe(true);
    await release(db, owner.accountId, hold.id);

    const events = await retryEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0]?.method).toBe('MANUAL');
    expect(events[0]?.metadata).toEqual({ outcome: 'REQUEUED', was: 'BLOCKED_BY_HOLD' });
  });

  it("leaves other people's parked jobs and the same person's FAILED jobs alone", async () => {
    const owner = await seedApplicant(db, 'f@example.com');
    const other = await seedApplicant(db, 'g@example.com');
    const hold = await place(db, owner);
    await place(db, other);
    const otherJob = await seedJob(db, {
      applicantId: other.applicantId,
      status: 'BLOCKED_BY_HOLD',
    });
    const failedJob = await seedJob(db, { applicantId: owner.applicantId, status: 'FAILED' });
    const ownJob = await seedJob(db, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });

    await release(db, owner.accountId, hold.id);

    expect(await statusOf(db, ownJob.id)).toBe('PENDING');
    expect(await statusOf(db, otherJob.id)).toBe('BLOCKED_BY_HOLD');
    expect(await statusOf(db, failedJob.id)).toBe('FAILED');
    expect(await retryEvents(db)).toHaveLength(1);
  });
});
