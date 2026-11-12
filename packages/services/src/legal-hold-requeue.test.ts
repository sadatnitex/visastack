import { randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { registerDocument } from './documents';
import { retryErasureJob } from './erasure';
import { placeLegalHold, releaseLegalHold, requeueUncoveredParkedJobs } from './legal-hold';

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
    reason?: 'DOCUMENT_REMOVAL' | 'RETENTION_PURGE';
  },
) {
  const [row] = await db
    .insert(schema.erasureJobs)
    .values({
      reason: input.reason ?? 'DOCUMENT_REMOVAL',
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
      applicantId: owner.applicantId,
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

  it('lets only one of two releases at the same moment through', async () => {
    const owner = await seedApplicant(db, 'h@example.com');
    const hold = await place(db, owner);
    await seedJob(db, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });

    const results = await Promise.all([
      release(db, owner.accountId, hold.id),
      release(db, owner.accountId, hold.id),
    ]);

    expect(results.filter((r) => isOk(r))).toHaveLength(1);
    expect(await retryEvents(db)).toHaveLength(1);
    const released = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'LEGAL_HOLD_RELEASED'));
    expect(released).toHaveLength(1);
  });

  it('rolls the release back when the re-queue fails, so the hold stays on', async () => {
    const owner = await seedApplicant(db, 'i@example.com');
    const hold = await place(db, owner);
    const job = await seedJob(db, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });
    await db.execute(sql`
      create function refuse_requeue() returns trigger language plpgsql as
      $$ begin raise exception 'simulated re-queue failure'; end $$`);
    await db.execute(sql`
      create trigger refuse_requeue before update on erasure_jobs
      for each row execute function refuse_requeue()`);

    await expect(release(db, owner.accountId, hold.id)).rejects.toThrow();

    const [row] = await db
      .select()
      .from(schema.legalHolds)
      .where(eq(schema.legalHolds.id, hold.id));
    expect(row?.active).toBe(true);
    expect(row?.releasedAt).toBeNull();
    expect(await statusOf(db, job.id)).toBe('BLOCKED_BY_HOLD');
    const released = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'LEGAL_HOLD_RELEASED'));
    expect(released).toHaveLength(0);
  });

  it('reports how many jobs a release put back', async () => {
    const owner = await seedApplicant(db, 'j@example.com');
    const hold = await place(db, owner);
    await seedJob(db, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });
    await seedJob(db, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });
    const released = await release(db, owner.accountId, hold.id);
    expect(isOk(released) && released.value.requeuedJobs).toBe(2);
    const none = await place(db, owner);
    const again = await release(db, owner.accountId, none.id);
    expect(isOk(again) && again.value.requeuedJobs).toBe(0);
  });
});

describe('a parked retention purge job is not put back by itself', () => {
  let db: Db;
  const scope = systemScopeForTest('process-erasure');
  beforeEach(async () => {
    db = (await createMigratedPglite().then((c) => drizzle(c, { schema }))) as unknown as Db;
  });

  it('stays parked when its hold is released, while a removal request is queued', async () => {
    // The retention rules may have been raised while the hold stood, so only the retention purge
    // pass (which re-checks that the document is still due) may queue it again.
    const owner = await seedApplicant(db, 'rp1@example.com');
    const hold = await place(db, owner);
    const purge = await seedJob(db, {
      applicantId: owner.applicantId,
      status: 'BLOCKED_BY_HOLD',
      reason: 'RETENTION_PURGE',
    });
    const removal = await seedJob(db, {
      applicantId: owner.applicantId,
      status: 'BLOCKED_BY_HOLD',
    });

    const released = await release(db, owner.accountId, hold.id);

    expect(isOk(released) && released.value.requeuedJobs).toBe(1);
    expect(await statusOf(db, purge.id)).toBe('BLOCKED_BY_HOLD');
    expect(await statusOf(db, removal.id)).toBe('PENDING');
    expect(await retryEvents(db)).toHaveLength(1);
  });

  it('stays parked in the daily sweep too', async () => {
    const onlyPurge = await seedApplicant(db, 'rp2@example.com');
    const purge = await seedJob(db, {
      applicantId: onlyPurge.applicantId,
      status: 'BLOCKED_BY_HOLD',
      reason: 'RETENTION_PURGE',
    });
    const free = await seedApplicant(db, 'rp3@example.com');
    const removal = await seedJob(db, { applicantId: free.applicantId, status: 'BLOCKED_BY_HOLD' });

    expect(await requeueUncoveredParkedJobs(db, scope)).toEqual({ requeued: 1, failed: 0 });
    expect(await statusOf(db, purge.id)).toBe('BLOCKED_BY_HOLD');
    expect(await statusOf(db, removal.id)).toBe('PENDING');
  });
});

describe('the audit cause of a re-queued job', () => {
  it('names the released hold only for jobs it kept, and the sweep cause for the rest', async () => {
    const db = (await createMigratedPglite().then((c) => drizzle(c, { schema }))) as unknown as Db;
    const owner = await seedApplicant(db, 'cause@example.com');
    const doc = await registerDocument(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      originalName: 'c.pdf',
    });
    if (!isOk(doc)) throw new Error('doc');
    const otherDoc = await registerDocument(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      originalName: 'o.pdf',
    });
    if (!isOk(otherDoc)) throw new Error('doc');
    // A hold on one document only; the other document's job was parked with no hold behind it.
    const hold = await placeLegalHold(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      documentId: doc.value.id,
      reason: 'dispute',
      reviewAt: new Date(Date.now() + 86_400_000),
      stepUpSatisfied: true,
    });
    if (!isOk(hold)) throw new Error('hold');
    const covered = await seedJob(db, {
      applicantId: owner.applicantId,
      status: 'BLOCKED_BY_HOLD',
      documentId: doc.value.id,
    });
    const stranded = await seedJob(db, {
      applicantId: owner.applicantId,
      status: 'BLOCKED_BY_HOLD',
      documentId: otherDoc.value.id,
    });

    await release(db, owner.accountId, hold.value.id);

    const byJob = new Map((await retryEvents(db)).map((e) => [e.resourceId, e.metadata]));
    expect(byJob.get(covered.id)).toMatchObject({ cause: 'HOLD_RELEASED', holdId: hold.value.id });
    const strandedMeta = byJob.get(stranded.id) as Record<string, unknown>;
    expect(strandedMeta['cause']).toBe('HOLD_NO_LONGER_ACTIVE');
    expect(strandedMeta['holdId']).toBeUndefined();
  });
});

describe('release lock order', () => {
  it('locks the applicant and its parked jobs before any audit write', async () => {
    // PGlite runs one transaction at a time, so a real deadlock cannot be reproduced here. What
    // this proves is the statement order the deadlock fix depends on: every row lock comes before
    // the first audit write (the audit write takes the one global audit lock), and the parked
    // jobs are locked in id order. An admin retry locks a job row and only then the audit lock.
    const queries: string[] = [];
    const client = await createMigratedPglite();
    const logged = drizzle(client, {
      schema,
      logger: { logQuery: (query: string) => queries.push(query) },
    }) as unknown as Db;
    const owner = await seedApplicant(logged, 'k@example.com');
    const hold = await place(logged, owner);
    await seedJob(logged, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });

    queries.length = 0;
    expect(isOk(await release(logged, owner.accountId, hold.id))).toBe(true);

    const at = (matches: (q: string) => boolean) => queries.findIndex(matches);
    const lockApplicant = at((q) => /from "applicants".*for no key update/is.test(q));
    const lockJobs = at((q) => /from "erasure_jobs".*order by.*for update/is.test(q));
    const firstAudit = at((q) => q.includes('pg_advisory_xact_lock'));
    const updateHold = at((q) => /update "legal_holds"/i.test(q));
    const updateJob = at((q) => /update "erasure_jobs"/i.test(q));
    // Stored-file order, the order purge and document removal queue a document's files in.
    expect(
      queries.some((q) =>
        /from "erasure_jobs".*order by "erasure_jobs"."storage_object_id"/is.test(q),
      ),
    ).toBe(true);
    expect(lockApplicant).toBeGreaterThanOrEqual(0);
    expect(lockApplicant).toBeLessThan(lockJobs);
    expect(lockJobs).toBeLessThan(updateHold);
    expect(lockJobs).toBeLessThan(firstAudit);
    expect(firstAudit).toBeGreaterThan(updateHold);
    expect(updateJob).toBeGreaterThan(lockJobs);
  });
});

describe('the daily sweep for jobs parked with no hold behind them', () => {
  let db: Db;
  const scope = systemScopeForTest('process-erasure');
  beforeEach(async () => {
    db = (await createMigratedPglite().then((c) => drizzle(c, { schema }))) as unknown as Db;
  });

  it('re-queues a job parked after its hold was already released, and says why', async () => {
    // The end state of the race: the worker parks a job from a check made just before a release
    // committed, so the job is parked and nothing holds it. Older parked jobs look the same.
    const owner = await seedApplicant(db, 'l@example.com');
    const job = await seedJob(db, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });

    expect(await requeueUncoveredParkedJobs(db, scope)).toEqual({ requeued: 1, failed: 0 });

    expect(await statusOf(db, job.id)).toBe('PENDING');
    const events = await retryEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorAccountId: null,
      applicantId: owner.applicantId,
      method: 'SYSTEM',
      resourceId: job.id,
      metadata: { outcome: 'REQUEUED', was: 'BLOCKED_BY_HOLD', cause: 'HOLD_NO_LONGER_ACTIVE' },
    });
  });

  it('is repeatable: a second run queues nothing and writes nothing', async () => {
    const owner = await seedApplicant(db, 'm@example.com');
    await seedJob(db, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });
    await requeueUncoveredParkedJobs(db, scope);
    expect(await requeueUncoveredParkedJobs(db, scope)).toEqual({ requeued: 0, failed: 0 });
    expect(await retryEvents(db)).toHaveLength(1);
  });

  it('leaves a job parked while a hold stands, and leaves FAILED jobs alone', async () => {
    const owner = await seedApplicant(db, 'n@example.com');
    const other = await seedApplicant(db, 'o@example.com');
    await place(db, owner);
    const held = await seedJob(db, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });
    const failed = await seedJob(db, { applicantId: other.applicantId, status: 'FAILED' });

    expect(await requeueUncoveredParkedJobs(db, scope)).toEqual({ requeued: 0, failed: 0 });

    expect(await statusOf(db, held.id)).toBe('BLOCKED_BY_HOLD');
    expect(await statusOf(db, failed.id)).toBe('FAILED');
    expect(await retryEvents(db)).toHaveLength(0);
  });

  it('logs why one applicant failed and keeps going with the others', async () => {
    const bad = await seedApplicant(db, 'bad@example.com');
    await seedJob(db, { applicantId: bad.applicantId, status: 'BLOCKED_BY_HOLD' });
    await db.execute(sql`
      create function refuse_requeue() returns trigger language plpgsql as
      $$ begin raise exception 'simulated re-queue failure'; end $$`);
    await db.execute(sql`
      create trigger refuse_requeue before update on erasure_jobs
      for each row execute function refuse_requeue()`);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await requeueUncoveredParkedJobs(db, scope)).toEqual({ requeued: 0, failed: 1 });
      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(logged.mock.calls[0]?.[1])).toContain('simulated re-queue failure');
    } finally {
      logged.mockRestore();
    }
  });

  it('starts no new applicant once its time budget has run out', async () => {
    const owner = await seedApplicant(db, 'late@example.com');
    const job = await seedJob(db, { applicantId: owner.applicantId, status: 'BLOCKED_BY_HOLD' });
    expect(await requeueUncoveredParkedJobs(db, scope, { stopAt: Date.now() - 1 })).toEqual({
      requeued: 0,
      failed: 0,
    });
    expect(await statusOf(db, job.id)).toBe('BLOCKED_BY_HOLD');
  });

  it('refuses a scope that is not the erasure job', async () => {
    await expect(requeueUncoveredParkedJobs(db, {} as unknown as typeof scope)).rejects.toThrow();
  });

  it('is not starved by applicants whose holds still stand', async () => {
    const standing = [];
    for (let i = 0; i < 3; i++) {
      const held = await seedApplicant(db, `held${i}@example.com`);
      await place(db, held);
      standing.push(
        await seedJob(db, { applicantId: held.applicantId, status: 'BLOCKED_BY_HOLD' }),
      );
    }
    const free = await seedApplicant(db, 'free@example.com');
    const stranded = await seedJob(db, {
      applicantId: free.applicantId,
      status: 'BLOCKED_BY_HOLD',
    });

    // Applicants under an applicant-wide hold are skipped in the query, so a limit of one still
    // reaches the only applicant that has anything to do.
    expect(await requeueUncoveredParkedJobs(db, scope, { limit: 1 })).toEqual({
      requeued: 1,
      failed: 0,
    });
    expect(await statusOf(db, stranded.id)).toBe('PENDING');
    for (const job of standing) expect(await statusOf(db, job.id)).toBe('BLOCKED_BY_HOLD');
  });
});

describe('a kept document removal', () => {
  it('reads Removing again once the release queues it', async () => {
    const db = (await createMigratedPglite().then((c) => drizzle(c, { schema }))) as unknown as Db;
    const owner = await seedApplicant(db, 'p@example.com');
    const hold = await place(db, owner);
    const doc = await registerDocument(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      originalName: 'r.pdf',
    });
    if (!isOk(doc)) throw new Error('doc');
    const [receipt] = await db
      .insert(schema.deletionReceipts)
      .values({
        applicantId: owner.applicantId,
        subjectKind: 'DOCUMENT',
        subjectCode: 'D-ABC234',
        path: 'REQUEST',
        requestedAt: new Date(),
        status: 'BLOCKED',
      })
      .returning();
    if (!receipt) throw new Error('receipt');
    await db.insert(schema.documentLifecycle).values({
      documentId: doc.value.id,
      applicantId: owner.applicantId,
      receiptId: receipt.id,
      deletedAt: new Date(),
      deletePath: 'REQUEST',
      purgeAfter: new Date(),
    } as never);
    const [job] = await db
      .insert(schema.erasureJobs)
      .values({
        reason: 'DOCUMENT_REMOVAL',
        status: 'BLOCKED_BY_HOLD',
        bucket: 'CLEAN',
        objectKey: `obj-${randomUUID()}`,
        storageObjectId: randomUUID(),
        applicantId: owner.applicantId,
        documentId: doc.value.id,
      })
      .returning();
    if (!job) throw new Error('job');

    await release(db, owner.accountId, hold.id);

    expect(await statusOf(db, job.id)).toBe('PENDING');
    const [after] = await db
      .select()
      .from(schema.deletionReceipts)
      .where(eq(schema.deletionReceipts.id, receipt.id));
    expect(after?.status).toBe('REMOVING');
  });
});
