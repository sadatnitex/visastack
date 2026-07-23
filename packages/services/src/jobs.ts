import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { type Db, first, required, schema } from './db';
import type { ScannerPort } from './intake';
import { processIntake } from './intake';

/**
 * Low-volume durable job queue (Release B; master directive §5 — "DB-backed
 * jobs for low pilot volume" is approved infra, Inngest/paid queues are not).
 * Decouples intake processing from the upload HTTP request: a row is claimed
 * with `FOR UPDATE SKIP LOCKED` so concurrent workers never double-process the
 * same job, and a failure retries with exponential backoff up to
 * `maxAttempts` before parking at FAILED — visible and inspectable, never
 * silently dropped. This module is deliberately storage-agnostic: callers
 * inject the `ScannerPort`, exactly like `processIntake` itself.
 */

export type ProcessingJob = typeof schema.processingJobs.$inferSelect;

const DEFAULT_CLAIM_LIMIT = 5;
const BACKOFF_BASE_SECONDS = 30;

/** Queue a document version for intake processing. Idempotent to call once per version. */
export async function enqueueIntakeJob(
  db: Db,
  input: { readonly documentVersionId: string },
): Promise<ProcessingJob> {
  return required(
    first(
      await db
        .insert(schema.processingJobs)
        .values({ documentVersionId: input.documentVersionId })
        .returning(),
    ),
    'processing job',
  );
}

/** Exponential backoff after a failed attempt: 30s, 60s, 120s, 240s, ... */
function backoffSeconds(attemptsSoFar: number): number {
  return BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attemptsSoFar - 1);
}

/**
 * Claim up to `limit` due jobs in one transaction: `FOR UPDATE SKIP LOCKED`
 * means a concurrent claimer skips rows this call already holds, rather than
 * blocking or double-claiming them.
 */
async function claimJobs(db: Db, limit: number): Promise<ProcessingJob[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: schema.processingJobs.id })
      .from(schema.processingJobs)
      .where(
        and(
          eq(schema.processingJobs.status, 'PENDING'),
          lte(schema.processingJobs.availableAt, sql`now()`),
        ),
      )
      .orderBy(asc(schema.processingJobs.availableAt))
      .limit(limit)
      .for('update', { skipLocked: true });

    if (due.length === 0) return [];

    return tx
      .update(schema.processingJobs)
      .set({
        status: 'CLAIMED',
        claimedAt: new Date(),
        attempts: sql`${schema.processingJobs.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(
        inArray(
          schema.processingJobs.id,
          due.map((row) => row.id),
        ),
      )
      .returning();
  });
}

async function completeJob(db: Db, jobId: string): Promise<void> {
  await db
    .update(schema.processingJobs)
    .set({ status: 'DONE', completedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.processingJobs.id, jobId));
}

/** On failure: retry with backoff until maxAttempts, then park at FAILED. */
async function failJob(db: Db, job: ProcessingJob, errorMessage: string): Promise<void> {
  const exhausted = job.attempts >= job.maxAttempts;
  await db
    .update(schema.processingJobs)
    .set({
      status: exhausted ? 'FAILED' : 'PENDING',
      lastError: errorMessage.slice(0, 2000),
      ...(exhausted
        ? {}
        : { availableAt: new Date(Date.now() + backoffSeconds(job.attempts) * 1000) }),
      updatedAt: new Date(),
    })
    .where(eq(schema.processingJobs.id, job.id));
}

export interface IntakeWorkerResult {
  readonly processed: number;
  readonly failed: number;
}

/**
 * Claim and run up to `limit` due intake jobs. Safe to call concurrently and
 * safe to call opportunistically — a call that finds nothing due is a fast
 * no-op, so it can be triggered both right after an upload (for near-instant
 * processing in the common case) and from a periodic sweep (for durability:
 * anything left over from a crashed/killed invocation gets picked up later).
 */
export async function runIntakeWorker(
  db: Db,
  scanner: ScannerPort,
  options: { readonly limit?: number } = {},
): Promise<IntakeWorkerResult> {
  const jobs = await claimJobs(db, options.limit ?? DEFAULT_CLAIM_LIMIT);
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const result = await processIntake(db, scanner, {
        documentVersionId: job.documentVersionId,
      });
      if (!result.ok) throw new Error(result.error.message);
      await completeJob(db, job.id);
      processed++;
    } catch (error) {
      await failJob(db, job, error instanceof Error ? error.message : String(error));
      failed++;
    }
  }
  return { processed, failed };
}
