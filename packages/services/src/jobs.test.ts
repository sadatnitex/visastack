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
import type { DocumentConverterPort } from './extraction';
import type { MalwareScannerPort } from './intake';
import { enqueueIntakeJob, listFailedJobs, retryFailedJob, runIntakeWorker } from './jobs';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

// A valid ICAO TD3 specimen (check digits computed to validate) -- confident
// PASSPORT classification, reviewRequired: false, so a naming proposal is
// actually generated (pipeline.test.ts uses the identical fixture).
const MRZ_L1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const MRZ_L2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seedVersion(db: Db, email: string) {
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
  const doc = await registerDocument(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    originalName: 'p.pdf',
  });
  if (!isOk(doc)) throw new Error('doc');
  const version = await addDocumentVersion(db, {
    actorAccountId: account.id,
    documentId: doc.value.id,
    bucket: 'QUARANTINE',
    objectKey: `obj-${email}`,
  });
  if (!isOk(version)) throw new Error('version');
  return version.value.version.id;
}

const cleanScanner: MalwareScannerPort = {
  name: 'test-scanner',
  version: '0.0.0',
  async scan() {
    return { safe: true };
  },
};
const infectedScanner: MalwareScannerPort = {
  name: 'test-scanner',
  version: '0.0.0',
  async scan() {
    return { safe: false, detail: 'eicar' };
  },
};
const noOpExtractor: DocumentConverterPort = {
  async extract() {
    return { ok: false, code: 'unsupported_format', message: 'test fixture: not exercised here' };
  },
};

describe('low-volume durable job queue — async intake', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('enqueues a PENDING job for a document version', async () => {
    const versionId = await seedVersion(db, 'j1@example.com');
    const job = await enqueueIntakeJob(db, { documentVersionId: versionId });
    expect(job.status).toBe('PENDING');
    expect(job.attempts).toBe(0);
    expect(job.documentVersionId).toBe(versionId);
  });

  it('drives a clean document through the pipeline and marks the job DONE', async () => {
    const versionId = await seedVersion(db, 'j2@example.com');
    const job = await enqueueIntakeJob(db, { documentVersionId: versionId });

    const result = await runIntakeWorker(db, cleanScanner, noOpExtractor);
    expect(result).toEqual({ processed: 1, failed: 0 });

    const [version] = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, versionId));
    expect(version?.processingStatus).toBe('AWAITING_REVIEW');
    expect(version?.safetyStatus).toBe('CLEAN');

    const [row] = await db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.id, job.id));
    expect(row?.status).toBe('DONE');
    expect(row?.completedAt).not.toBeNull();
  });

  it('completes the job even when the scan routes to NEEDS_ATTENTION (not a job failure)', async () => {
    const versionId = await seedVersion(db, 'j3@example.com');
    await enqueueIntakeJob(db, { documentVersionId: versionId });

    const result = await runIntakeWorker(db, infectedScanner, noOpExtractor);
    expect(result).toEqual({ processed: 1, failed: 0 });

    const [version] = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, versionId));
    expect(version?.processingStatus).toBe('NEEDS_ATTENTION');
    expect(version?.safetyStatus).toBe('QUARANTINED');
  });

  it('is a fast no-op when nothing is due', async () => {
    const result = await runIntakeWorker(db, cleanScanner, noOpExtractor);
    expect(result).toEqual({ processed: 0, failed: 0 });
  });

  it('retries a failing job with backoff, then parks it at FAILED once attempts are exhausted', async () => {
    const versionId = await seedVersion(db, 'j4@example.com');
    const job = await enqueueIntakeJob(db, { documentVersionId: versionId });
    // Force a short retry budget so the test doesn't need 5 rounds.
    await db
      .update(schema.processingJobs)
      .set({ maxAttempts: 2 })
      .where(eq(schema.processingJobs.id, job.id));

    const brokenScanner: MalwareScannerPort = {
      name: 'test-scanner',
      version: '0.0.0',
      async scan() {
        throw new Error('scanner unavailable');
      },
    };

    // Attempt 1: fails, retried with backoff (availableAt pushed into the future).
    const first = await runIntakeWorker(db, brokenScanner, noOpExtractor);
    expect(first).toEqual({ processed: 0, failed: 1 });
    const afterFirst = (
      await db.select().from(schema.processingJobs).where(eq(schema.processingJobs.id, job.id))
    )[0];
    expect(afterFirst?.status).toBe('PENDING');
    expect(afterFirst?.attempts).toBe(1);
    expect(afterFirst?.lastError).toContain('scanner unavailable');
    expect(afterFirst?.availableAt.getTime()).toBeGreaterThan(Date.now());

    // Not due yet — a worker pass right now finds nothing to claim.
    const notYetDue = await runIntakeWorker(db, brokenScanner, noOpExtractor);
    expect(notYetDue).toEqual({ processed: 0, failed: 0 });

    // Simulate the backoff having elapsed.
    await db
      .update(schema.processingJobs)
      .set({ availableAt: new Date(0) })
      .where(eq(schema.processingJobs.id, job.id));

    // Attempt 2 (the last one, maxAttempts: 2): fails again, exhausted -> FAILED.
    const second = await runIntakeWorker(db, brokenScanner, noOpExtractor);
    expect(second).toEqual({ processed: 0, failed: 1 });
    const afterSecond = (
      await db.select().from(schema.processingJobs).where(eq(schema.processingJobs.id, job.id))
    )[0];
    expect(afterSecond?.status).toBe('FAILED');
    expect(afterSecond?.attempts).toBe(2);

    // A FAILED job is never picked up again, even if forced due.
    await db
      .update(schema.processingJobs)
      .set({ availableAt: new Date(0) })
      .where(eq(schema.processingJobs.id, job.id));
    const afterExhausted = await runIntakeWorker(db, brokenScanner, noOpExtractor);
    expect(afterExhausted).toEqual({ processed: 0, failed: 0 });
  });

  it('respects the limit, leaving extra due jobs for the next call', async () => {
    const v1 = await seedVersion(db, 'j5a@example.com');
    const v2 = await seedVersion(db, 'j5b@example.com');
    await enqueueIntakeJob(db, { documentVersionId: v1 });
    await enqueueIntakeJob(db, { documentVersionId: v2 });

    const first = await runIntakeWorker(db, cleanScanner, noOpExtractor, { limit: 1 });
    expect(first).toEqual({ processed: 1, failed: 0 });

    const second = await runIntakeWorker(db, cleanScanner, noOpExtractor, { limit: 1 });
    expect(second).toEqual({ processed: 1, failed: 0 });

    const third = await runIntakeWorker(db, cleanScanner, noOpExtractor, { limit: 1 });
    expect(third).toEqual({ processed: 0, failed: 0 });
  });

  it('lists exhausted jobs with document context, and lets an admin retry one', async () => {
    const versionId = await seedVersion(db, 'j6@example.com');
    const job = await enqueueIntakeJob(db, { documentVersionId: versionId });
    await db
      .update(schema.processingJobs)
      .set({ maxAttempts: 1 })
      .where(eq(schema.processingJobs.id, job.id));

    const brokenScanner: MalwareScannerPort = {
      name: 'test-scanner',
      version: '0.0.0',
      async scan() {
        throw new Error('scanner unavailable');
      },
    };
    await runIntakeWorker(db, brokenScanner, noOpExtractor);

    const failed = await listFailedJobs(db);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.documentName).toBe('p.pdf');
    expect(failed[0]?.lastError).toContain('scanner unavailable');
    expect(failed[0]?.attempts).toBe(1);

    const retried = await retryFailedJob(db, job.id);
    expect(retried).toBe(true);

    const afterRetry = (
      await db.select().from(schema.processingJobs).where(eq(schema.processingJobs.id, job.id))
    )[0];
    expect(afterRetry?.status).toBe('PENDING');
    expect(afterRetry?.attempts).toBe(0);
    expect(afterRetry?.lastError).toBeNull();
    expect(await listFailedJobs(db)).toHaveLength(0);

    // Retrying a job that isn't FAILED is a safe no-op.
    expect(await retryFailedJob(db, job.id)).toBe(false);
  });

  it('is genuinely idempotent (master directive §7 "PR 6") — enqueuing the same document version twice returns the same row, never a duplicate', async () => {
    const versionId = await seedVersion(db, 'j-idem@example.com');
    const first = await enqueueIntakeJob(db, { documentVersionId: versionId });
    const second = await enqueueIntakeJob(db, { documentVersionId: versionId });
    expect(second.id).toBe(first.id);

    const rows = await db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.documentVersionId, versionId));
    expect(rows).toHaveLength(1);
  });

  it('reclaims a stale lease (worker crashed after claiming) and processes the job on the next call', async () => {
    const versionId = await seedVersion(db, 'j-stale@example.com');
    const job = await enqueueIntakeJob(db, { documentVersionId: versionId });
    // Simulate a worker that claimed this job, then crashed before completing.
    await db
      .update(schema.processingJobs)
      .set({
        status: 'CLAIMED',
        leaseOwner: 'ghost-worker',
        leaseExpiresAt: new Date(Date.now() - 1000),
        claimedAt: new Date(Date.now() - 60_000),
      })
      .where(eq(schema.processingJobs.id, job.id));

    const result = await runIntakeWorker(db, cleanScanner, noOpExtractor);
    expect(result).toEqual({ processed: 1, failed: 0 });

    const [row] = await db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.id, job.id));
    expect(row?.status).toBe('DONE');
    expect(row?.leaseOwner).toBeNull();
  });

  it("reclaims a CLAIMED job with no lease at all once its claim is old enough — the rollout window where the OLD deployment (predating leasing) claimed it (finding #21, post-programme defect register, mirrors erasure.ts's identical Codex-review-PR-B1 fix)", async () => {
    const versionId = await seedVersion(db, 'j-rollout-old@example.com');
    const job = await enqueueIntakeJob(db, { documentVersionId: versionId });
    // The migration ran (columns exist), but the still-serving OLD
    // deployment's code claimed this job without ever setting the new
    // lease columns at all — not merely an expired lease, no lease.
    await db
      .update(schema.processingJobs)
      .set({
        status: 'CLAIMED',
        leaseOwner: null,
        leaseExpiresAt: null,
        claimedAt: new Date(Date.now() - 10 * 60 * 1000), // well past one lease duration
      })
      .where(eq(schema.processingJobs.id, job.id));

    const result = await runIntakeWorker(db, cleanScanner, noOpExtractor);
    expect(result).toEqual({ processed: 1, failed: 0 });
    const [row] = await db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.id, job.id));
    expect(row?.status).toBe('DONE');
  });

  it('does NOT reclaim a lease-less CLAIMED job whose claim is still recent — the old deployment could genuinely still be mid-flight on it (finding #21, post-programme defect register)', async () => {
    const versionId = await seedVersion(db, 'j-rollout-recent@example.com');
    const job = await enqueueIntakeJob(db, { documentVersionId: versionId });
    await db
      .update(schema.processingJobs)
      .set({
        status: 'CLAIMED',
        leaseOwner: null,
        leaseExpiresAt: null,
        claimedAt: new Date(), // claimed just now — could still be genuinely in flight
      })
      .where(eq(schema.processingJobs.id, job.id));

    // Reclaiming this too eagerly would let a second worker start
    // processing the SAME job the old deployment might still be mid-flight
    // on — exactly the double-processing hazard leasing exists to prevent,
    // just via a different (lease-less) route.
    const result = await runIntakeWorker(db, cleanScanner, noOpExtractor);
    expect(result).toEqual({ processed: 0, failed: 0 });
    const [row] = await db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.id, job.id));
    expect(row?.status).toBe('CLAIMED');
    expect(row?.leaseOwner).toBeNull();
  });

  it('a lease reclaimed while the original claimer is still genuinely running protects against a double-completion (CAS)', async () => {
    const versionId = await seedVersion(db, 'j-cas@example.com');
    const job = await enqueueIntakeJob(db, { documentVersionId: versionId });

    let releaseScan: (() => void) | undefined;
    const pausedScanner: MalwareScannerPort = {
      name: 'test-scanner',
      version: '0.0.0',
      async scan() {
        await new Promise<void>((resolve) => {
          releaseScan = resolve;
        });
        return { safe: true };
      },
    };

    // Invocation A claims the job and pauses mid-scan (simulating a slow,
    // still-alive worker — not a crash).
    const invocationA = runIntakeWorker(db, pausedScanner, noOpExtractor);
    await vi.waitFor(() => {
      if (!releaseScan) throw new Error('invocation A has not reached the scan yet');
    });

    // Its lease expires anyway (e.g. a conservative lease duration, or the
    // sweep firing while it is mid-flight) — the one scenario leasing alone
    // cannot rule out.
    await db
      .update(schema.processingJobs)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(schema.processingJobs.id, job.id));

    // Invocation B reclaims and fully processes the same job.
    const resultB = await runIntakeWorker(db, cleanScanner, noOpExtractor);
    expect(resultB).toEqual({ processed: 1, failed: 0 });
    const [afterB] = await db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.id, job.id));
    expect(afterB?.status).toBe('DONE');

    // Invocation A finally resumes — its lease is gone and the document
    // version has already moved past what it last observed. Its write is
    // rejected at both layers (commitTransition's CAS, completeJob's CAS);
    // it must never overwrite B's already-correct, already-completed outcome.
    releaseScan?.();
    const resultA = await invocationA;
    expect(resultA).toEqual({ processed: 0, failed: 0 });

    const [afterA] = await db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.id, job.id));
    expect(afterA?.status).toBe('DONE'); // unchanged by A's late, rejected write
    const [version] = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, versionId));
    expect(version?.processingStatus).toBe('AWAITING_REVIEW'); // B's outcome stands

    // Finding #19 (post-programme defect register): before fencing was
    // threaded into processIntake's own side-effect writes, A's late,
    // ultimately-rejected scan would still have inserted its OWN
    // documentScanResults row before ever reaching commitTransition's CAS
    // — a stale, duplicate scan-history entry surviving despite losing the
    // race. A's fencing check (right after its paused scanner.scan()
    // finally resolves, before any write) now catches the lost lease first
    // and skips that insert entirely: exactly one row, B's.
    const scanResults = await db
      .select()
      .from(schema.documentScanResults)
      .where(eq(schema.documentScanResults.documentVersionId, versionId));
    expect(scanResults).toHaveLength(1);
  });

  it('does not let a worker whose lease was reclaimed mid-extraction persist its own extraction/classification/naming-proposal side effects (finding #19, post-programme defect register)', async () => {
    const versionId = await seedVersion(db, 'j-cas-extract@example.com');
    const job = await enqueueIntakeJob(db, { documentVersionId: versionId });

    // An array, not a single shared variable: both invocations call
    // extract() through the SAME mock, so a single closure variable would
    // have invocation B's resolver silently overwrite invocation A's before
    // the test ever gets a chance to release A specifically.
    const releaseFns: Array<() => void> = [];
    const passportExtractor: DocumentConverterPort = {
      async extract() {
        await new Promise<void>((resolve) => {
          releaseFns.push(resolve);
        });
        return {
          ok: true,
          result: {
            text: `PASSPORT\n${MRZ_L1}\n${MRZ_L2}\n`,
            truncated: false,
            pageCount: 1,
            warnings: [],
            parserName: 'test-fixture',
            parserVersion: '1.0.0',
          },
        };
      },
    };

    // Invocation A claims the job, clears SCANNING/NORMALIZING (both
    // instant with cleanScanner/no side effects to race on), then pauses
    // mid-extraction — simulating a slow, still-alive worker, not a crash.
    const invocationA = runIntakeWorker(db, cleanScanner, passportExtractor);
    await vi.waitFor(() => {
      if (releaseFns.length < 1) throw new Error('invocation A has not reached extraction yet');
    });

    // Its lease expires anyway, exactly like the scan-step CAS test above.
    await db
      .update(schema.processingJobs)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(schema.processingJobs.id, job.id));

    // Invocation B reclaims and fully processes the same job, using the
    // same extractor port (so B ALSO pauses mid-extraction).
    const invocationB = runIntakeWorker(db, cleanScanner, passportExtractor);
    await vi.waitFor(() => {
      if (releaseFns.length < 2) throw new Error('invocation B has not reached extraction yet');
    });

    // Release B's own call (the second resolver) so B finishes
    // deterministically before A ever resumes.
    releaseFns[1]?.();
    const resultB = await invocationB;
    expect(resultB).toEqual({ processed: 1, failed: 0 });
    const [afterB] = await db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.id, job.id));
    expect(afterB?.status).toBe('DONE');

    // Invocation A finally resumes — its lease is gone. Its fencing check
    // (right after its own paused extractor.extract() resolves) must catch
    // the lost lease and skip persisting anything past that point: no
    // second extractionRuns/documentClassifications/name-proposal row set
    // from a worker that no longer owns this document version. (A's own
    // processingRuns row from BEFORE the pause still exists, uncompleted —
    // that append-only "an attempt was started" row is expected and
    // harmless, exactly like what a genuine mid-extraction crash would
    // leave behind; two rows there is correct, not a duplicate-side-effect
    // bug. What must NOT duplicate is A's own account of ITS attempt's
    // outcome, since B already recorded the real one.)
    releaseFns[0]?.();
    const resultA = await invocationA;
    expect(resultA).toEqual({ processed: 0, failed: 0 });

    const extractionRuns = await db
      .select()
      .from(schema.extractionRuns)
      .where(eq(schema.extractionRuns.documentVersionId, versionId));
    expect(extractionRuns).toHaveLength(1);
    const classifications = await db
      .select()
      .from(schema.documentClassifications)
      .where(eq(schema.documentClassifications.documentVersionId, versionId));
    expect(classifications).toHaveLength(1);

    const [documentRow] = await db
      .select({ documentId: schema.documentVersions.documentId })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, versionId));
    const proposals = documentRow
      ? await db
          .select()
          .from(schema.documentNameVersions)
          .where(eq(schema.documentNameVersions.documentId, documentRow.documentId))
      : [];
    expect(proposals).toHaveLength(1);

    const [version] = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, versionId));
    expect(version?.processingStatus).toBe('AWAITING_REVIEW'); // B's outcome stands
  });

  it('records a categorized, safe error code derived from the stage that failed — never the raw error text as the category', async () => {
    const versionId = await seedVersion(db, 'j-errcode@example.com');
    const job = await enqueueIntakeJob(db, { documentVersionId: versionId });
    await db
      .update(schema.processingJobs)
      .set({ maxAttempts: 1 })
      .where(eq(schema.processingJobs.id, job.id));

    const brokenScanner: MalwareScannerPort = {
      name: 'test-scanner',
      version: '0.0.0',
      async scan() {
        throw new Error('scanner unavailable: connection refused at 10.0.4.12:9000');
      },
    };
    await runIntakeWorker(db, brokenScanner, noOpExtractor);

    const [row] = await db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.id, job.id));
    expect(row?.status).toBe('FAILED');
    expect(row?.errorCode).toBe('SCAN_FAILED');
    // The raw message (which could carry internal detail) stays a separate,
    // admin-only field — never conflated with the safe category.
    expect(row?.lastError).toContain('10.0.4.12');
  });
});
