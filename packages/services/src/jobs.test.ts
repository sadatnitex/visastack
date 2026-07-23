import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import type { TextExtractionPort } from './extraction';
import type { ScannerPort } from './intake';
import { enqueueIntakeJob, listFailedJobs, retryFailedJob, runIntakeWorker } from './jobs';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

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

const cleanScanner: ScannerPort = {
  async scan() {
    return { safe: true };
  },
};
const infectedScanner: ScannerPort = {
  async scan() {
    return { safe: false, detail: 'eicar' };
  },
};
const noOpExtractor: TextExtractionPort = {
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

    const brokenScanner: ScannerPort = {
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

    const brokenScanner: ScannerPort = {
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
});
