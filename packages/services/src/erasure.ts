import { and, asc, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { hasActiveLegalHold } from './retention';
import type { BlobStore } from './storage';

/**
 * Erasure outbox (master directive §7 "PR 4") — the durable, retriable
 * mechanism for the one step logical-row deletion can never safely do
 * synchronously: removing bytes from an external store and confirming
 * they're actually gone. `deletion.ts` (account deletion) and `retention.ts`
 * (expired-document purge) both enqueue here instead of deleting storage
 * objects directly; this module is the only thing that ever calls
 * `BlobStore.deleteObject`.
 *
 * A job never reports success before `getObject` confirms absence — "delete,
 * then verify" are two separate, independently observable steps (DELETED,
 * then VERIFIED), never collapsed into one. Deliberately a narrower, purpose-
 * built queue rather than a generalization of `processingJobs` (that
 * generalization, if warranted, is PR 6's explicit scope) — same proven
 * `FOR UPDATE SKIP LOCKED` claim pattern as `jobs.ts`, applied to a distinct
 * concern.
 */

export type ErasureJob = typeof schema.erasureJobs.$inferSelect;
export type ErasureJobReason = ErasureJob['reason'];

const DEFAULT_CLAIM_LIMIT = 5;
const BACKOFF_BASE_SECONDS = 30;

export interface EnqueueErasureJobInput {
  readonly reason: ErasureJobReason;
  readonly bucket: 'QUARANTINE' | 'CLEAN';
  readonly objectKey: string;
  readonly expectedHash: string | null;
  readonly storageObjectId: string;
  /** RETENTION_PURGE only — the worker defers this document's own removal until bytes are verified gone. */
  readonly documentId?: string;
  readonly applicantId?: string;
}

/**
 * Queue one external object for deletion. Callers pass their own transaction
 * handle so this composes into the caller's atomic "mark pending deletion"
 * step rather than opening a transaction of its own.
 */
export async function enqueueErasureJob(
  db: Db,
  input: EnqueueErasureJobInput,
): Promise<ErasureJob> {
  return required(
    first(
      await db
        .insert(schema.erasureJobs)
        .values({
          reason: input.reason,
          bucket: input.bucket,
          objectKey: input.objectKey,
          expectedHash: input.expectedHash,
          storageObjectId: input.storageObjectId,
          documentId: input.documentId ?? null,
          applicantId: input.applicantId ?? null,
        })
        .returning(),
    ),
    'erasure job',
  );
}

function backoffSeconds(attemptsSoFar: number): number {
  return BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attemptsSoFar - 1);
}

async function claimErasureJobs(db: Db, limit: number): Promise<ErasureJob[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: schema.erasureJobs.id })
      .from(schema.erasureJobs)
      .where(
        and(
          eq(schema.erasureJobs.status, 'PENDING'),
          lte(schema.erasureJobs.availableAt, sql`now()`),
        ),
      )
      .orderBy(asc(schema.erasureJobs.availableAt))
      .limit(limit)
      .for('update', { skipLocked: true });

    if (due.length === 0) return [];

    return tx
      .update(schema.erasureJobs)
      .set({
        status: 'CLAIMED',
        claimedAt: new Date(),
        attempts: sql`${schema.erasureJobs.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(
        inArray(
          schema.erasureJobs.id,
          due.map((row) => row.id),
        ),
      )
      .returning();
  });
}

async function blockOnHold(db: Db, job: ErasureJob, note: string): Promise<void> {
  await db
    .update(schema.erasureJobs)
    .set({ status: 'BLOCKED_BY_HOLD', lastError: note, updatedAt: new Date() })
    .where(eq(schema.erasureJobs.id, job.id));
}

async function failErasureJob(db: Db, job: ErasureJob, errorMessage: string): Promise<void> {
  const exhausted = job.attempts >= job.maxAttempts;
  await db
    .update(schema.erasureJobs)
    .set({
      status: exhausted ? 'FAILED' : 'PENDING',
      lastError: errorMessage.slice(0, 2000),
      ...(exhausted
        ? {}
        : { availableAt: new Date(Date.now() + backoffSeconds(job.attempts) * 1000) }),
      updatedAt: new Date(),
    })
    .where(eq(schema.erasureJobs.id, job.id));
}

/** Finalize a verified job: remove the now-provably-empty storage reference, audit, and (for a deferred purge) the document itself. */
async function finalizeVerifiedJob(db: Db, job: ErasureJob): Promise<void> {
  await db.transaction(async (tx) => {
    // Recheck the hold here too: the delete+verify round trip against the
    // external store can take long enough for a hold placed after the initial
    // check (processErasureJob) to land before this finalize step runs. The
    // bytes are already gone by this point (unrecoverable), but the logical
    // record itself — the thing a hold actually protects — is preserved.
    if (job.reason === 'RETENTION_PURGE' && job.applicantId) {
      const held = await hasActiveLegalHold(tx, job.applicantId);
      if (held) {
        await tx
          .update(schema.erasureJobs)
          .set({
            status: 'BLOCKED_BY_HOLD',
            lastError: 'a legal hold was placed after bytes were deleted; logical record preserved',
            updatedAt: new Date(),
          })
          .where(eq(schema.erasureJobs.id, job.id));
        return;
      }
    }

    // Document first: documentVersions.storageObjectId is `onDelete: restrict`,
    // so the storage object can't go while a version still points at it. The
    // document's own cascade removes that version as part of this delete.
    if (job.reason === 'RETENTION_PURGE' && job.documentId) {
      await tx.delete(schema.documents).where(eq(schema.documents.id, job.documentId));
    }
    await tx.delete(schema.storageObjects).where(eq(schema.storageObjects.id, job.storageObjectId));
    await tx
      .update(schema.erasureJobs)
      .set({ status: 'VERIFIED', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.erasureJobs.id, job.id));
    await appendAuditEvent(tx, {
      eventType: 'ERASURE_VERIFIED',
      method: 'SYSTEM',
      result: 'ALLOWED',
      applicantId: job.applicantId,
      resourceType: 'storage_object',
      resourceId: job.storageObjectId,
      metadata: { reason: job.reason, objectKey: job.objectKey },
    });
  });
}

/** Claim, delete, and verify one job. Never throws — failures are recorded on the job row. */
async function processErasureJob(db: Db, blobStore: BlobStore, job: ErasureJob): Promise<void> {
  try {
    if (job.reason === 'RETENTION_PURGE' && job.applicantId) {
      const held = await hasActiveLegalHold(db, job.applicantId);
      if (held) {
        await blockOnHold(db, job, 'an active legal hold blocks this purge');
        return;
      }
    }

    await blobStore.deleteObject(job.bucket, job.objectKey);
    await db
      .update(schema.erasureJobs)
      .set({ status: 'DELETED', updatedAt: new Date() })
      .where(eq(schema.erasureJobs.id, job.id));

    const stillPresent = await blobStore.getObject(job.objectKey);
    if (stillPresent !== undefined) {
      throw new Error('object still present after deleteObject — deletion not verified');
    }

    await finalizeVerifiedJob(db, job);
  } catch (error) {
    await failErasureJob(db, job, error instanceof Error ? error.message : String(error));
  }
}

export interface ErasureWorkerResult {
  readonly processed: number;
  readonly blocked: number;
  readonly failed: number;
}

/**
 * Claim and run up to `limit` due erasure jobs. Safe to call opportunistically
 * (right after a deletion/purge, for near-instant cleanup) and from a
 * periodic sweep (durability: anything left over from a crashed invocation,
 * or previously BLOCKED_BY_HOLD and since retried, gets picked up here).
 */
export async function runErasureWorker(
  db: Db,
  blobStore: BlobStore,
  options: { readonly limit?: number } = {},
): Promise<ErasureWorkerResult> {
  const jobs = await claimErasureJobs(db, options.limit ?? DEFAULT_CLAIM_LIMIT);
  let processed = 0;
  let blocked = 0;
  let failed = 0;
  for (const job of jobs) {
    await processErasureJob(db, blobStore, job);
    const final = first(
      await db.select().from(schema.erasureJobs).where(eq(schema.erasureJobs.id, job.id)),
    );
    if (final?.status === 'VERIFIED') processed++;
    else if (final?.status === 'BLOCKED_BY_HOLD') blocked++;
    else failed++;
  }
  return { processed, blocked, failed };
}

/** A job needing admin attention, with enough context to act on it. */
export interface ErasureJobSummary {
  readonly id: string;
  readonly reason: ErasureJobReason;
  readonly status: ErasureJob['status'];
  readonly objectKey: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

/** FAILED (exhausted retries) or BLOCKED_BY_HOLD jobs — parked, never silently dropped, admin-visible. */
export async function listErasureJobsNeedingAttention(
  db: Db,
  limit = 50,
): Promise<ErasureJobSummary[]> {
  const rows = await db
    .select()
    .from(schema.erasureJobs)
    .where(
      or(eq(schema.erasureJobs.status, 'FAILED'), eq(schema.erasureJobs.status, 'BLOCKED_BY_HOLD')),
    )
    .orderBy(desc(schema.erasureJobs.updatedAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    reason: row.reason,
    status: row.status,
    objectKey: row.objectKey,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * Re-queue a FAILED or BLOCKED_BY_HOLD job with a fresh retry budget. No-op
 * (returns false) if the job is already active — never resurrects a job
 * another path already moved.
 */
export async function retryErasureJob(db: Db, jobId: string): Promise<boolean> {
  const updated = await db
    .update(schema.erasureJobs)
    .set({
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      availableAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.erasureJobs.id, jobId),
        or(
          eq(schema.erasureJobs.status, 'FAILED'),
          eq(schema.erasureJobs.status, 'BLOCKED_BY_HOLD'),
        ),
      ),
    )
    .returning({ id: schema.erasureJobs.id });
  return updated.length > 0;
}
