import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
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
 * generalization, if warranted, is PR 6's explicit scope).
 *
 * Leasing (Codex review, PR-B1 — finding #12): a claim is a time-bound lease,
 * not a permanent hand-off, mirroring `jobs.ts`'s proven pattern exactly.
 * Each `claimErasureJobs` call generates one `leaseOwner` token for that
 * invocation; every job it claims carries that token plus a
 * `leaseExpiresAt`. Every write past the initial claim — the CLAIMED→DELETED
 * transition, `finalizeVerifiedJob`, `failErasureJob`, `blockOnHold` — is
 * compare-and-set: it only takes effect while the row still carries this
 * exact `leaseOwner`, so an invocation that outlives its own lease (it hung,
 * and a later claim already reclaimed the job) can never stomp whichever
 * invocation claimed it next — its write simply matches zero rows.
 * `claimErasureJobs` reclaims expired leases (rows stuck at CLAIMED or
 * DELETED past their lease) as part of the same transaction that claims new
 * work, so a crashed worker's job becomes claimable again automatically —
 * no separate admin action or cron required. Reprocessing a reclaimed job
 * from scratch (re-running delete then verify) is safe because
 * `BlobStore.deleteObject`/`getObject` are both documented idempotent.
 */

export type ErasureJob = typeof schema.erasureJobs.$inferSelect;
export type ErasureJobReason = ErasureJob['reason'];

const DEFAULT_CLAIM_LIMIT = 5;
const BACKOFF_BASE_SECONDS = 30;
/**
 * Generous relative to a single job's real work (one delete + one get
 * against the blob store, typically sub-second): bounds how long a crashed
 * or hung worker can strand a job before the next claim attempt reclaims it.
 * No active heartbeat renewal — `processingJobs`' own lease (the pattern
 * this mirrors) doesn't refresh one mid-processing either, and a single
 * erasure job's work is far shorter than that pipeline's, so a fixed,
 * generous duration is sufficient without the added complexity.
 */
const LEASE_DURATION_MS = 5 * 60 * 1000;

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

/**
 * Claim up to `limit` due jobs in one transaction. First reclaims any
 * CLAIMED/DELETED job whose lease has expired (same transaction that then
 * claims new work — a reclaimed row is immediately eligible), then claims
 * PENDING due jobs with `FOR UPDATE SKIP LOCKED` so a concurrent claimer
 * skips rows this call already holds rather than blocking or double-claiming
 * them. Every job claimed by this call shares one `leaseOwner` token.
 */
async function claimErasureJobs(db: Db, limit: number): Promise<ErasureJob[]> {
  const leaseOwner = randomUUID();
  return db.transaction(async (tx) => {
    await tx
      .update(schema.erasureJobs)
      .set({ status: 'PENDING', leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(
        and(
          inArray(schema.erasureJobs.status, ['CLAIMED', 'DELETED']),
          lt(schema.erasureJobs.leaseExpiresAt, sql`now()`),
        ),
      );

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

    const now = new Date();
    return tx
      .update(schema.erasureJobs)
      .set({
        status: 'CLAIMED',
        claimedAt: now,
        leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
        attempts: sql`${schema.erasureJobs.attempts} + 1`,
        updatedAt: now,
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

/**
 * Compare-and-set: only takes effect while this invocation still holds the
 * lease on a row currently at `fromStatus`. Returns `false` (never throws)
 * if the lease was already reclaimed — that invocation now owns the job's
 * outcome, so this one has nothing further to do.
 */
async function blockOnHold(
  db: Db,
  job: ErasureJob,
  leaseOwner: string,
  fromStatus: 'CLAIMED' | 'DELETED',
  note: string,
): Promise<boolean> {
  const updated = await db
    .update(schema.erasureJobs)
    .set({
      status: 'BLOCKED_BY_HOLD',
      lastError: note,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.erasureJobs.id, job.id),
        eq(schema.erasureJobs.status, fromStatus),
        eq(schema.erasureJobs.leaseOwner, leaseOwner),
      ),
    )
    .returning({ id: schema.erasureJobs.id });
  return updated.length > 0;
}

/** Compare-and-set like `blockOnHold` — a lost lease is a safe no-op, not an error. */
async function failErasureJob(
  db: Db,
  job: ErasureJob,
  leaseOwner: string,
  errorMessage: string,
): Promise<boolean> {
  const exhausted = job.attempts >= job.maxAttempts;
  const updated = await db
    .update(schema.erasureJobs)
    .set({
      status: exhausted ? 'FAILED' : 'PENDING',
      lastError: errorMessage.slice(0, 2000),
      leaseOwner: null,
      leaseExpiresAt: null,
      ...(exhausted
        ? {}
        : { availableAt: new Date(Date.now() + backoffSeconds(job.attempts) * 1000) }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.erasureJobs.id, job.id),
        inArray(schema.erasureJobs.status, ['CLAIMED', 'DELETED']),
        eq(schema.erasureJobs.leaseOwner, leaseOwner),
      ),
    )
    .returning({ id: schema.erasureJobs.id });
  return updated.length > 0;
}

type FinalizeOutcome = 'verified' | 'blocked' | 'lost-lease';

/**
 * Finalize a verified job: remove the now-provably-empty storage reference,
 * audit, and (for a deferred purge) the document itself — or, if a hold
 * landed in the meantime, transition to BLOCKED_BY_HOLD instead. These are
 * two DISTINCT successful outcomes, not one — collapsing them into a single
 * boolean ("did this invocation's lease still hold") would hide which one
 * actually happened from the caller, silently misreporting a hold as a
 * completed verification.
 *
 * Claims whichever outcome applies FIRST, atomically, before any destructive
 * delete — a stale worker whose lease was already reclaimed gets zero rows
 * on that compare-and-set and returns `lost-lease` immediately, never
 * touching `documents`/`storageObjects` at all. Ordinary Postgres row-level
 * locking makes this race-safe against a concurrent reclaim with no extra
 * locking primitive: whichever of this update or a concurrent reclaim's
 * update commits first determines which one the other sees when it
 * re-evaluates its own WHERE clause.
 */
async function finalizeVerifiedJob(
  db: Db,
  job: ErasureJob,
  leaseOwner: string,
): Promise<FinalizeOutcome> {
  return db.transaction(async (tx) => {
    // Recheck the hold here too: the delete+verify round trip against the
    // external store can take long enough for a hold placed after the initial
    // check (processErasureJob) to land before this finalize step runs. The
    // bytes are already gone by this point (unrecoverable), but the logical
    // record itself — the thing a hold actually protects — is preserved.
    if (job.reason === 'RETENTION_PURGE' && job.applicantId) {
      const held = await hasActiveLegalHold(tx, job.applicantId);
      if (held) {
        const blocked = await blockOnHold(
          tx,
          job,
          leaseOwner,
          'DELETED',
          'a legal hold was placed after bytes were deleted; logical record preserved',
        );
        return blocked ? 'blocked' : 'lost-lease';
      }
    }

    const finalized = await tx
      .update(schema.erasureJobs)
      .set({
        status: 'VERIFIED',
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.erasureJobs.id, job.id),
          eq(schema.erasureJobs.status, 'DELETED'),
          eq(schema.erasureJobs.leaseOwner, leaseOwner),
        ),
      )
      .returning({ id: schema.erasureJobs.id });
    if (finalized.length === 0) return 'lost-lease';

    // Document first: documentVersions.storageObjectId is `onDelete: restrict`,
    // so the storage object can't go while a version still points at it. The
    // document's own cascade removes that version as part of this delete.
    if (job.reason === 'RETENTION_PURGE' && job.documentId) {
      await tx.delete(schema.documents).where(eq(schema.documents.id, job.documentId));
    }
    await tx.delete(schema.storageObjects).where(eq(schema.storageObjects.id, job.storageObjectId));
    await appendAuditEvent(tx, {
      eventType: 'ERASURE_VERIFIED',
      method: 'SYSTEM',
      result: 'ALLOWED',
      applicantId: job.applicantId,
      resourceType: 'storage_object',
      resourceId: job.storageObjectId,
      metadata: { reason: job.reason, objectKey: job.objectKey },
    });
    return 'verified';
  });
}

type ProcessOutcome = 'verified' | 'blocked' | 'failed' | 'lost-lease';

/**
 * Claim, delete, and verify one job. Never throws — failures are recorded on
 * the job row. Every write is compare-and-set on `leaseOwner`; `lost-lease`
 * means a different invocation already reclaimed this job, so this call
 * correctly contributes nothing to the caller's counts.
 */
async function processErasureJob(
  db: Db,
  blobStore: BlobStore,
  job: ErasureJob,
  leaseOwner: string,
): Promise<ProcessOutcome> {
  try {
    if (job.reason === 'RETENTION_PURGE' && job.applicantId) {
      const held = await hasActiveLegalHold(db, job.applicantId);
      if (held) {
        const blocked = await blockOnHold(
          db,
          job,
          leaseOwner,
          'CLAIMED',
          'an active legal hold blocks this purge',
        );
        return blocked ? 'blocked' : 'lost-lease';
      }
    }

    await blobStore.deleteObject(job.bucket, job.objectKey);
    const marked = await db
      .update(schema.erasureJobs)
      .set({ status: 'DELETED', updatedAt: new Date() })
      .where(
        and(
          eq(schema.erasureJobs.id, job.id),
          eq(schema.erasureJobs.status, 'CLAIMED'),
          eq(schema.erasureJobs.leaseOwner, leaseOwner),
        ),
      )
      .returning({ id: schema.erasureJobs.id });
    if (marked.length === 0) return 'lost-lease';

    const stillPresent = await blobStore.getObject(job.objectKey);
    if (stillPresent !== undefined) {
      throw new Error('object still present after deleteObject — deletion not verified');
    }

    return await finalizeVerifiedJob(db, job, leaseOwner);
  } catch (error) {
    const failed = await failErasureJob(
      db,
      job,
      leaseOwner,
      error instanceof Error ? error.message : String(error),
    );
    return failed ? 'failed' : 'lost-lease';
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
    const leaseOwner = job.leaseOwner;
    if (!leaseOwner) continue; // claimErasureJobs always sets one; satisfies the type.
    const outcome = await processErasureJob(db, blobStore, job, leaseOwner);
    if (outcome === 'verified') processed++;
    else if (outcome === 'blocked') blocked++;
    else if (outcome === 'failed') failed++;
    // 'lost-lease': a different invocation already reclaimed and owns this
    // job's real outcome — correctly counted by that invocation, not this one.
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
 * another path already moved. Clears any lease fields defensively even
 * though a terminal (FAILED/BLOCKED_BY_HOLD) row should never carry a live
 * one — cheap, and consistent with every other transition in this module.
 */
export async function retryErasureJob(db: Db, jobId: string): Promise<boolean> {
  const updated = await db
    .update(schema.erasureJobs)
    .set({
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
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
