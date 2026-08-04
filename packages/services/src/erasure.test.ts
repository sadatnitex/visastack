import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import {
  enqueueErasureJob,
  listErasureJobsNeedingAttention,
  retryErasureJob,
  runErasureWorker,
} from './erasure';
import { placeLegalHold } from './legal-hold';
import type {
  BlobStore,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from './storage';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

/** Deterministic in-memory blob store with configurable failure injection. */
class FakeBlobStore implements BlobStore {
  private readonly objects = new Map<string, StoredBytes>();
  readonly failDeleteFor = new Set<string>();
  readonly surviveDeleteFor = new Set<string>();
  readonly deleteCalls: string[] = [];
  /**
   * When set, the NEXT `deleteObject` call pauses until `release()` is
   * called, then clears itself — used to deterministically simulate a
   * worker that is still genuinely running (not crashed) while its lease
   * expires out from under it, without relying on PGlite's true
   * transaction concurrency (see docs/audits/post-programme-defect-register.md
   * D-T3: PGlite fully serializes transactions regardless of lock
   * contention, so a real Promise.all race here would not reliably prove
   * anything about CAS/fencing — this pause-then-resume technique proves it
   * deterministically instead, mirroring jobs.test.ts's own pattern).
   */
  pauseNextDelete: (() => Promise<void>) | undefined;

  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.objectKey, { contentType: input.contentType, bytes: input.bytes });
  }
  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    return this.objects.get(objectKey);
  }
  async deleteObject(_bucket: StorageBucket, objectKey: string): Promise<void> {
    this.deleteCalls.push(objectKey);
    if (this.pauseNextDelete) {
      const pause = this.pauseNextDelete;
      this.pauseNextDelete = undefined;
      await pause();
    }
    if (this.failDeleteFor.has(objectKey)) throw new Error('simulated delete failure');
    if (!this.surviveDeleteFor.has(objectKey)) this.objects.delete(objectKey);
  }
  async listObjectKeys(): Promise<ListObjectsPage> {
    return { objectKeys: [...this.objects.keys()], cursor: undefined };
  }
}

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
  return { account, applicantId: applicant.value.id };
}

/** A real storageObjects row, independent of any document version, for job tests that check DB cleanup. */
async function seedStorageObject(db: Db, objectKey: string) {
  const [row] = await db
    .insert(schema.storageObjects)
    .values({ bucket: 'CLEAN', objectKey, contentHash: 'deadbeef', sizeBytes: 3 })
    .returning();
  if (!row) throw new Error('storage object');
  return row;
}

describe('erasure outbox', () => {
  let db: Db;
  let storage: FakeBlobStore;
  beforeEach(async () => {
    db = await freshDb();
    storage = new FakeBlobStore();
  });

  it('deletes, verifies, and removes the storage object row on success', async () => {
    const object = await seedStorageObject(db, 'obj-happy');
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-happy',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    });
    await enqueueErasureJob(db, {
      reason: 'ACCOUNT_DELETION',
      bucket: 'CLEAN',
      objectKey: 'obj-happy',
      expectedHash: 'deadbeef',
      storageObjectId: object.id,
    });

    const result = await runErasureWorker(db, storage, { limit: 5 });
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    expect(storage.deleteCalls).toEqual(['obj-happy']);

    const job = (await db.select().from(schema.erasureJobs))[0];
    expect(job?.status).toBe('VERIFIED');
    expect(job?.completedAt).not.toBeNull();
    expect(
      await db.select().from(schema.storageObjects).where(eq(schema.storageObjects.id, object.id)),
    ).toHaveLength(0);

    const auditRows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'ERASURE_VERIFIED'));
    expect(auditRows).toHaveLength(1);
  });

  it('also deletes the deferred document once verified, for RETENTION_PURGE jobs', async () => {
    const { account, applicantId } = await seedApplicant(db, 'purge-doc@example.com');
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'r.pdf',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'obj-purge-doc',
    });
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-purge-doc',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1]),
    });
    const [storageObject] = await db
      .select()
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.objectKey, 'obj-purge-doc'));
    if (!storageObject) throw new Error('storage object');

    await enqueueErasureJob(db, {
      reason: 'RETENTION_PURGE',
      bucket: 'CLEAN',
      objectKey: 'obj-purge-doc',
      expectedHash: null,
      storageObjectId: storageObject.id,
      documentId: doc.value.id,
      applicantId,
    });

    const result = await runErasureWorker(db, storage, { limit: 5 });
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    expect(
      await db.select().from(schema.documents).where(eq(schema.documents.id, doc.value.id)),
    ).toHaveLength(0);
  });

  it('never touches the deferred document for ACCOUNT_DELETION jobs (documentId is unset)', async () => {
    const object = await seedStorageObject(db, 'obj-acct-only');
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-acct-only',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1]),
    });
    const job = await enqueueErasureJob(db, {
      reason: 'ACCOUNT_DELETION',
      bucket: 'CLEAN',
      objectKey: 'obj-acct-only',
      expectedHash: null,
      storageObjectId: object.id,
    });
    expect(job.documentId).toBeNull();

    await runErasureWorker(db, storage, { limit: 5 });
    const final = (await db.select().from(schema.erasureJobs))[0];
    expect(final?.status).toBe('VERIFIED');
  });

  it('retries a failed delete with backoff, then parks at FAILED once attempts are exhausted', async () => {
    const object = await seedStorageObject(db, 'obj-flaky');
    storage.failDeleteFor.add('obj-flaky');
    const created = await enqueueErasureJob(db, {
      reason: 'ACCOUNT_DELETION',
      bucket: 'CLEAN',
      objectKey: 'obj-flaky',
      expectedHash: null,
      storageObjectId: object.id,
    });
    await db
      .update(schema.erasureJobs)
      .set({ maxAttempts: 2 })
      .where(eq(schema.erasureJobs.id, created.id));

    const first = await runErasureWorker(db, storage, { limit: 5 });
    expect(first).toEqual({ processed: 0, blocked: 0, failed: 1 });
    let job = (await db.select().from(schema.erasureJobs))[0];
    expect(job?.status).toBe('PENDING'); // one attempt left — retried, not parked
    expect(job?.attempts).toBe(1);
    expect(job?.lastError).toContain('simulated delete failure');
    // Not due yet (backoff delay).
    expect(await runErasureWorker(db, storage, { limit: 5 })).toEqual({
      processed: 0,
      blocked: 0,
      failed: 0,
    });

    // Force it due now, exhausting the retry budget.
    await db
      .update(schema.erasureJobs)
      .set({ availableAt: new Date() })
      .where(eq(schema.erasureJobs.id, created.id));
    const second = await runErasureWorker(db, storage, { limit: 5 });
    expect(second).toEqual({ processed: 0, blocked: 0, failed: 1 });
    job = (await db.select().from(schema.erasureJobs))[0];
    expect(job?.status).toBe('FAILED');
    expect(job?.attempts).toBe(2);

    // The storage object row is untouched — never removed on a failed job.
    expect(
      await db.select().from(schema.storageObjects).where(eq(schema.storageObjects.id, object.id)),
    ).toHaveLength(1);
  });

  it('treats a delete that leaves bytes in place as a failure, never as verified', async () => {
    const object = await seedStorageObject(db, 'obj-lying');
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-lying',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1]),
    });
    storage.surviveDeleteFor.add('obj-lying'); // deleteObject "succeeds" but bytes remain
    await enqueueErasureJob(db, {
      reason: 'ACCOUNT_DELETION',
      bucket: 'CLEAN',
      objectKey: 'obj-lying',
      expectedHash: null,
      storageObjectId: object.id,
    });

    const result = await runErasureWorker(db, storage, { limit: 5 });
    expect(result).toEqual({ processed: 0, blocked: 0, failed: 1 });
    const job = (await db.select().from(schema.erasureJobs))[0];
    expect(job?.status).toBe('PENDING');
    expect(job?.lastError).toContain('still present');
    // Never removed — the row survives exactly because verification failed.
    expect(
      await db.select().from(schema.storageObjects).where(eq(schema.storageObjects.id, object.id)),
    ).toHaveLength(1);
  });

  it('blocks a RETENTION_PURGE job at finalize time if a hold appears mid-flight, preserving the record', async () => {
    const { applicantId } = await seedApplicant(db, 'finalize-race@example.com');
    const object = await seedStorageObject(db, 'obj-finalize-race');
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-finalize-race',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1]),
    });
    await enqueueErasureJob(db, {
      reason: 'RETENTION_PURGE',
      bucket: 'CLEAN',
      objectKey: 'obj-finalize-race',
      expectedHash: null,
      storageObjectId: object.id,
      applicantId,
    });

    // Monkey-patch: place the hold the instant getObject is called for
    // verification, simulating a hold landing between delete and finalize.
    const originalGetObject = storage.getObject.bind(storage);
    storage.getObject = async (objectKey: string) => {
      const result = await originalGetObject(objectKey);
      await placeLegalHold(db, {
        actorAccountId: applicantId,
        applicantId,
        reason: 'mid-flight',
        stepUpSatisfied: true,
      });
      return result;
    };

    const result = await runErasureWorker(db, storage, { limit: 5 });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    const job = (await db.select().from(schema.erasureJobs))[0];
    expect(job?.status).toBe('BLOCKED_BY_HOLD');
    expect(job?.lastError).toContain('after bytes were deleted');
    // Bytes are unrecoverably gone, but the metadata row is preserved.
    expect(
      await db.select().from(schema.storageObjects).where(eq(schema.storageObjects.id, object.id)),
    ).toHaveLength(1);
  });

  it('lists FAILED and BLOCKED_BY_HOLD jobs for admin attention, never PENDING or VERIFIED', async () => {
    const a = await seedStorageObject(db, 'obj-a');
    const b = await seedStorageObject(db, 'obj-b');
    const c = await seedStorageObject(db, 'obj-c');
    const failed = await enqueueErasureJob(db, {
      reason: 'ACCOUNT_DELETION',
      bucket: 'CLEAN',
      objectKey: 'obj-a',
      expectedHash: null,
      storageObjectId: a.id,
    });
    const blocked = await enqueueErasureJob(db, {
      reason: 'RETENTION_PURGE',
      bucket: 'CLEAN',
      objectKey: 'obj-b',
      expectedHash: null,
      storageObjectId: b.id,
    });
    await enqueueErasureJob(db, {
      reason: 'ACCOUNT_DELETION',
      bucket: 'CLEAN',
      objectKey: 'obj-c',
      expectedHash: null,
      storageObjectId: c.id,
    }); // left PENDING
    await db
      .update(schema.erasureJobs)
      .set({ status: 'FAILED', lastError: 'boom' })
      .where(eq(schema.erasureJobs.id, failed.id));
    await db
      .update(schema.erasureJobs)
      .set({ status: 'BLOCKED_BY_HOLD', lastError: 'held' })
      .where(eq(schema.erasureJobs.id, blocked.id));

    const attention = await listErasureJobsNeedingAttention(db);
    expect(attention.map((j) => j.id).sort()).toEqual([blocked.id, failed.id].sort());
  });

  it('retryErasureJob resets FAILED or BLOCKED_BY_HOLD to PENDING, and no-ops otherwise', async () => {
    const object = await seedStorageObject(db, 'obj-retry');
    const job = await enqueueErasureJob(db, {
      reason: 'ACCOUNT_DELETION',
      bucket: 'CLEAN',
      objectKey: 'obj-retry',
      expectedHash: null,
      storageObjectId: object.id,
    });

    // Not FAILED/BLOCKED yet — no-op.
    expect(await retryErasureJob(db, job.id)).toBe(false);

    await db
      .update(schema.erasureJobs)
      .set({ status: 'FAILED', attempts: 5, lastError: 'boom' })
      .where(eq(schema.erasureJobs.id, job.id));
    expect(await retryErasureJob(db, job.id)).toBe(true);
    let reset = (await db.select().from(schema.erasureJobs))[0];
    expect(reset?.status).toBe('PENDING');
    expect(reset?.attempts).toBe(0);
    expect(reset?.lastError).toBeNull();

    await db
      .update(schema.erasureJobs)
      .set({ status: 'BLOCKED_BY_HOLD', lastError: 'held' })
      .where(eq(schema.erasureJobs.id, job.id));
    expect(await retryErasureJob(db, job.id)).toBe(true);
    reset = (await db.select().from(schema.erasureJobs))[0];
    expect(reset?.status).toBe('PENDING');
  });

  it('respects the claim limit, leaving the rest PENDING', async () => {
    for (let i = 0; i < 3; i++) {
      const object = await seedStorageObject(db, `obj-limit-${i}`);
      await storage.putObject({
        bucket: 'CLEAN',
        objectKey: `obj-limit-${i}`,
        contentType: 'application/pdf',
        bytes: new Uint8Array([1]),
      });
      await enqueueErasureJob(db, {
        reason: 'ACCOUNT_DELETION',
        bucket: 'CLEAN',
        objectKey: `obj-limit-${i}`,
        expectedHash: null,
        storageObjectId: object.id,
      });
    }

    const result = await runErasureWorker(db, storage, { limit: 2 });
    expect(result).toEqual({ processed: 2, blocked: 0, failed: 0 });
    const statuses = (await db.select().from(schema.erasureJobs)).map((j) => j.status).sort();
    expect(statuses).toEqual(['PENDING', 'VERIFIED', 'VERIFIED']);
  });

  describe('leasing and recovery (Codex review, PR-B1, finding #12)', () => {
    it('reclaims a stale lease stuck at CLAIMED (worker crashed right after claiming) and completes the job on the next call', async () => {
      const object = await seedStorageObject(db, 'obj-stale-claimed');
      await storage.putObject({
        bucket: 'CLEAN',
        objectKey: 'obj-stale-claimed',
        contentType: 'application/pdf',
        bytes: new Uint8Array([1]),
      });
      const job = await enqueueErasureJob(db, {
        reason: 'ACCOUNT_DELETION',
        bucket: 'CLEAN',
        objectKey: 'obj-stale-claimed',
        expectedHash: null,
        storageObjectId: object.id,
      });
      // Simulate a worker that claimed this job, then crashed before ever
      // calling deleteObject.
      await db
        .update(schema.erasureJobs)
        .set({
          status: 'CLAIMED',
          leaseOwner: 'ghost-worker',
          leaseExpiresAt: new Date(Date.now() - 1000),
          claimedAt: new Date(Date.now() - 60_000),
        })
        .where(eq(schema.erasureJobs.id, job.id));

      const result = await runErasureWorker(db, storage, { limit: 5 });
      expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
      const row = (await db.select().from(schema.erasureJobs))[0];
      expect(row?.status).toBe('VERIFIED');
      expect(row?.leaseOwner).toBeNull();
      expect(row?.leaseExpiresAt).toBeNull();
    });

    it('reclaims a stale lease stuck at DELETED (worker crashed after the external delete but before verifying) and completes the job on the next call', async () => {
      const object = await seedStorageObject(db, 'obj-stale-deleted');
      // The crashed worker's own delete call actually succeeded — the
      // backing store genuinely has nothing at this key already.
      const job = await enqueueErasureJob(db, {
        reason: 'ACCOUNT_DELETION',
        bucket: 'CLEAN',
        objectKey: 'obj-stale-deleted',
        expectedHash: null,
        storageObjectId: object.id,
      });
      await db
        .update(schema.erasureJobs)
        .set({
          status: 'DELETED',
          leaseOwner: 'ghost-worker',
          leaseExpiresAt: new Date(Date.now() - 1000),
          claimedAt: new Date(Date.now() - 60_000),
        })
        .where(eq(schema.erasureJobs.id, job.id));

      const result = await runErasureWorker(db, storage, { limit: 5 });
      expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
      // Re-ran deleteObject on an already-absent key — safe only because
      // BlobStore.deleteObject is documented idempotent.
      expect(storage.deleteCalls).toEqual(['obj-stale-deleted']);
      const row = (await db.select().from(schema.erasureJobs))[0];
      expect(row?.status).toBe('VERIFIED');
      expect(row?.leaseOwner).toBeNull();
    });

    it('reclaims a CLAIMED job with no lease at all once its claim is old enough — the rollout window where the OLD deployment (predating leasing) claimed it (Codex review, PR-B1)', async () => {
      const object = await seedStorageObject(db, 'obj-rollout-old');
      await storage.putObject({
        bucket: 'CLEAN',
        objectKey: 'obj-rollout-old',
        contentType: 'application/pdf',
        bytes: new Uint8Array([1]),
      });
      const job = await enqueueErasureJob(db, {
        reason: 'ACCOUNT_DELETION',
        bucket: 'CLEAN',
        objectKey: 'obj-rollout-old',
        expectedHash: null,
        storageObjectId: object.id,
      });
      // The migration ran (columns exist), but the still-serving OLD
      // deployment's code claimed this job without ever setting the new
      // lease columns at all — not merely an expired lease, no lease.
      await db
        .update(schema.erasureJobs)
        .set({
          status: 'CLAIMED',
          leaseOwner: null,
          leaseExpiresAt: null,
          claimedAt: new Date(Date.now() - 10 * 60 * 1000), // well past one lease duration
        })
        .where(eq(schema.erasureJobs.id, job.id));

      const result = await runErasureWorker(db, storage, { limit: 5 });
      expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
      const row = (await db.select().from(schema.erasureJobs))[0];
      expect(row?.status).toBe('VERIFIED');
    });

    it('does NOT reclaim a lease-less CLAIMED job whose claim is still recent — the old deployment could genuinely still be mid-flight on it (Codex review, PR-B1)', async () => {
      const object = await seedStorageObject(db, 'obj-rollout-recent');
      const job = await enqueueErasureJob(db, {
        reason: 'ACCOUNT_DELETION',
        bucket: 'CLEAN',
        objectKey: 'obj-rollout-recent',
        expectedHash: null,
        storageObjectId: object.id,
      });
      await db
        .update(schema.erasureJobs)
        .set({
          status: 'CLAIMED',
          leaseOwner: null,
          leaseExpiresAt: null,
          claimedAt: new Date(), // claimed just now — could still be genuinely in flight
        })
        .where(eq(schema.erasureJobs.id, job.id));

      // Reclaiming this too eagerly would let a second worker start
      // processing the SAME job the old deployment might still be
      // mid-delete on — exactly the double-processing hazard leasing exists
      // to prevent, just via a different (lease-less) route.
      const result = await runErasureWorker(db, storage, { limit: 5 });
      expect(result).toEqual({ processed: 0, blocked: 0, failed: 0 });
      const row = (await db.select().from(schema.erasureJobs))[0];
      expect(row?.status).toBe('CLAIMED');
      expect(row?.leaseOwner).toBeNull();
    });

    it("a stale worker whose lease was reclaimed mid-flight can never overwrite the reclaiming worker's outcome", async () => {
      const object = await seedStorageObject(db, 'obj-cas-race');
      await storage.putObject({
        bucket: 'CLEAN',
        objectKey: 'obj-cas-race',
        contentType: 'application/pdf',
        bytes: new Uint8Array([1]),
      });
      await enqueueErasureJob(db, {
        reason: 'ACCOUNT_DELETION',
        bucket: 'CLEAN',
        objectKey: 'obj-cas-race',
        expectedHash: null,
        storageObjectId: object.id,
      });

      let releaseDelete: (() => void) | undefined;
      storage.pauseNextDelete = () =>
        new Promise<void>((resolve) => {
          releaseDelete = resolve;
        });

      // Invocation A claims the job and pauses mid-delete (a slow, still-
      // alive worker — not a crash).
      const invocationA = runErasureWorker(db, storage, { limit: 5 });
      await vi.waitFor(() => {
        if (!releaseDelete) throw new Error('invocation A has not reached deleteObject yet');
      });

      // Its lease expires anyway (a conservative lease duration, or the
      // reclaim sweep firing while it is mid-flight) — the one scenario
      // leasing alone cannot rule out; fencing is what closes it.
      await db
        .update(schema.erasureJobs)
        .set({ leaseExpiresAt: new Date(0) })
        .where(eq(schema.erasureJobs.objectKey, 'obj-cas-race'));

      // Invocation B reclaims and fully processes the same job (its own
      // deleteObject call does not pause — pauseNextDelete already fired
      // once and cleared itself).
      const resultB = await runErasureWorker(db, storage, { limit: 5 });
      expect(resultB).toEqual({ processed: 1, blocked: 0, failed: 0 });
      const afterB = (await db.select().from(schema.erasureJobs))[0];
      expect(afterB?.status).toBe('VERIFIED');

      // Invocation A finally resumes — its lease is long gone. Every write
      // it attempts from here (marking DELETED, then finalizing) is
      // compare-and-set on its own now-stale leaseOwner token, so all of
      // them are rejected; it must never overwrite B's already-correct,
      // already-completed outcome.
      releaseDelete?.();
      const resultA = await invocationA;
      expect(resultA).toEqual({ processed: 0, blocked: 0, failed: 0 });

      const afterA = (await db.select().from(schema.erasureJobs))[0];
      expect(afterA?.status).toBe('VERIFIED'); // unchanged by A's late, rejected write
      expect(
        await db
          .select()
          .from(schema.storageObjects)
          .where(eq(schema.storageObjects.id, object.id)),
      ).toHaveLength(0); // B's cleanup stands, not duplicated or errored by A's late resumption
    });

    it('rejects a stale-lease write even when the row is coincidentally back at a status the stale worker would still match — the fencing TOKEN, not the status alone, is what protects', async () => {
      // The end-to-end test above happens to also be protected by its own
      // status check alone (by the time A resumes, status has moved past
      // CLAIMED entirely) — it doesn't, by itself, prove the leaseOwner
      // comparison specifically matters. This test isolates that: it puts
      // the row back at CLAIMED (the one status A's own check would still
      // match) under a DIFFERENT worker's lease, so only a genuine
      // leaseOwner mismatch — not a status mismatch — can be what rejects
      // A's stale write.
      const object = await seedStorageObject(db, 'obj-fencing-only');
      await storage.putObject({
        bucket: 'CLEAN',
        objectKey: 'obj-fencing-only',
        contentType: 'application/pdf',
        bytes: new Uint8Array([1]),
      });
      await enqueueErasureJob(db, {
        reason: 'ACCOUNT_DELETION',
        bucket: 'CLEAN',
        objectKey: 'obj-fencing-only',
        expectedHash: null,
        storageObjectId: object.id,
      });

      let releaseDelete: (() => void) | undefined;
      storage.pauseNextDelete = () =>
        new Promise<void>((resolve) => {
          releaseDelete = resolve;
        });

      const invocationA = runErasureWorker(db, storage, { limit: 5 });
      await vi.waitFor(() => {
        if (!releaseDelete) throw new Error('invocation A has not reached deleteObject yet');
      });

      // Simulate a different worker having since reclaimed this exact row:
      // status is CLAIMED again, but under a completely different
      // leaseOwner — never produced by this test's own code path, just the
      // state a genuine reclaim-then-reclaim-again sequence would leave.
      await db
        .update(schema.erasureJobs)
        .set({
          leaseOwner: 'a-completely-different-worker',
          leaseExpiresAt: new Date(Date.now() + 60_000),
        })
        .where(eq(schema.erasureJobs.objectKey, 'obj-fencing-only'));

      releaseDelete?.();
      const resultA = await invocationA;
      expect(resultA).toEqual({ processed: 0, blocked: 0, failed: 0 });

      const row = (await db.select().from(schema.erasureJobs))[0];
      expect(row?.status).toBe('CLAIMED'); // untouched by A
      expect(row?.leaseOwner).toBe('a-completely-different-worker'); // still belongs to the other worker
    });
  });
});
