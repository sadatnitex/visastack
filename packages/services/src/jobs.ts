import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { type Db, first, required, schema } from './db';
import type { TextExtractionPort } from './extraction';
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
 *
 * Leases (master directive §7 "PR 6"): a claim is a time-bound lease, not a
 * permanent hand-off. Each `claimJobs` call generates one `leaseOwner` token
 * for that invocation; every job it claims carries that token plus a
 * `leaseExpiresAt`. `completeJob`/`failJob` are compare-and-set: they only
 * take effect `WHERE status = 'CLAIMED' AND lease_owner = <this invocation>`,
 * so an invocation that outlives its own lease (e.g. it hung, and the sweep
 * already reclaimed the job) can never stomp on whoever claimed it next — its
 * write simply matches zero rows. `claimJobs` reclaims expired leases as
 * part of the same transaction that claims new work, so a crashed worker's
 * job becomes claimable again automatically, with no separate admin action
 * or cron required.
 */

export type ProcessingJob = typeof schema.processingJobs.$inferSelect;

const DEFAULT_CLAIM_LIMIT = 5;
const BACKOFF_BASE_SECONDS = 30;
/** Generous relative to a single-document pass (seconds): bounds how long a crashed worker can strand a job before the next claim attempt reclaims it. */
const LEASE_DURATION_MS = 5 * 60 * 1000;
const CURRENT_INTAKE_PROCESSING_VERSION = 1;

function idempotencyKeyFor(
  documentVersionId: string,
  jobType: ProcessingJob['jobType'],
  processingVersion: number,
): string {
  return `${documentVersionId}:${jobType}:${processingVersion}`;
}

/**
 * Queue a document version for intake processing. Genuinely idempotent
 * (job uniqueness, master directive §7 "PR 6"): calling this twice for the
 * same document version — e.g. a retried upload request — returns the same
 * row both times rather than creating a duplicate job that could later be
 * claimed and processed concurrently with the first.
 */
export async function enqueueIntakeJob(
  db: Db,
  input: { readonly documentVersionId: string },
): Promise<ProcessingJob> {
  const jobType = 'INTAKE' as const;
  const processingVersion = CURRENT_INTAKE_PROCESSING_VERSION;
  return required(
    first(
      await db
        .insert(schema.processingJobs)
        .values({
          documentVersionId: input.documentVersionId,
          jobType,
          processingVersion,
          idempotencyKey: idempotencyKeyFor(input.documentVersionId, jobType, processingVersion),
        })
        .onConflictDoUpdate({
          target: schema.processingJobs.idempotencyKey,
          // No-op touch: onConflictDoUpdate is the only Drizzle upsert form
          // that reliably returns the existing row, and DO NOTHING would
          // silently discard the caller's ability to observe it.
          set: { updatedAt: sql`${schema.processingJobs.updatedAt}` },
        })
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
 * Claim up to `limit` due jobs in one transaction. First reclaims any
 * `CLAIMED` job whose lease has expired (the same transaction that then
 * claims new work — a reclaimed row is immediately eligible), then claims
 * `PENDING` due jobs with `FOR UPDATE SKIP LOCKED` so a concurrent claimer
 * skips rows this call already holds rather than blocking or double-claiming
 * them. Every job claimed by this call shares one `leaseOwner` token.
 */
async function claimJobs(db: Db, limit: number): Promise<ProcessingJob[]> {
  const leaseOwner = randomUUID();
  return db.transaction(async (tx) => {
    await tx
      .update(schema.processingJobs)
      .set({ status: 'PENDING', leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.processingJobs.status, 'CLAIMED'),
          lt(schema.processingJobs.leaseExpiresAt, sql`now()`),
        ),
      );

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

    const now = new Date();
    return tx
      .update(schema.processingJobs)
      .set({
        status: 'CLAIMED',
        claimedAt: now,
        heartbeatAt: now,
        leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
        attempts: sql`${schema.processingJobs.attempts} + 1`,
        updatedAt: now,
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

/**
 * Compare-and-set completion: only takes effect while this invocation still
 * holds the lease. Returns `false` (never throws) if the lease was already
 * reclaimed and re-claimed by another invocation — that invocation now owns
 * the job's outcome, so this one has nothing further to do.
 */
async function completeJob(db: Db, job: ProcessingJob, leaseOwner: string): Promise<boolean> {
  const updated = await db
    .update(schema.processingJobs)
    .set({
      status: 'DONE',
      completedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.processingJobs.id, job.id),
        eq(schema.processingJobs.status, 'CLAIMED'),
        eq(schema.processingJobs.leaseOwner, leaseOwner),
      ),
    )
    .returning({ id: schema.processingJobs.id });
  return updated.length > 0;
}

/** A closed, display-safe failure category — never the raw internal error text. */
export type JobErrorCode = 'SCAN_FAILED' | 'EXTRACTION_FAILED' | 'STORAGE_UNAVAILABLE' | 'UNKNOWN';

/** Best-effort classification from the document version's state at failure time — never guesses beyond what that state actually shows. */
async function classifyFailure(db: Db, documentVersionId: string): Promise<JobErrorCode> {
  const version = first(
    await db
      .select({ processingStatus: schema.documentVersions.processingStatus })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, documentVersionId))
      .limit(1),
  );
  switch (version?.processingStatus) {
    case 'SCANNING':
      return 'SCAN_FAILED';
    case 'NORMALIZING':
    case 'EXTRACTING':
      return 'EXTRACTION_FAILED';
    default:
      return 'UNKNOWN';
  }
}

/**
 * On failure: retry with backoff until maxAttempts, then park at FAILED.
 * Compare-and-set like `completeJob` — a lost lease is a safe no-op, not an
 * error.
 */
async function failJob(
  db: Db,
  job: ProcessingJob,
  leaseOwner: string,
  errorMessage: string,
): Promise<boolean> {
  const exhausted = job.attempts >= job.maxAttempts;
  const errorCode = await classifyFailure(db, job.documentVersionId);
  const updated = await db
    .update(schema.processingJobs)
    .set({
      status: exhausted ? 'FAILED' : 'PENDING',
      lastError: errorMessage.slice(0, 2000),
      errorCode,
      leaseOwner: null,
      leaseExpiresAt: null,
      ...(exhausted
        ? {}
        : { availableAt: new Date(Date.now() + backoffSeconds(job.attempts) * 1000) }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.processingJobs.id, job.id),
        eq(schema.processingJobs.status, 'CLAIMED'),
        eq(schema.processingJobs.leaseOwner, leaseOwner),
      ),
    )
    .returning({ id: schema.processingJobs.id });
  return updated.length > 0;
}

/** A FAILED job with enough document context for an admin to act on it. */
export interface FailedJobSummary {
  readonly id: string;
  readonly documentVersionId: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly applicantId: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lastError: string | null;
  readonly errorCode: string | null;
  readonly updatedAt: string;
}

/** Jobs that exhausted their retries — parked, never silently dropped, admin-visible. */
export async function listFailedJobs(db: Db, limit = 50): Promise<FailedJobSummary[]> {
  const rows = await db
    .select({
      id: schema.processingJobs.id,
      documentVersionId: schema.processingJobs.documentVersionId,
      documentId: schema.documents.id,
      documentName: schema.documents.originalName,
      applicantId: schema.documents.applicantId,
      attempts: schema.processingJobs.attempts,
      maxAttempts: schema.processingJobs.maxAttempts,
      lastError: schema.processingJobs.lastError,
      errorCode: schema.processingJobs.errorCode,
      updatedAt: schema.processingJobs.updatedAt,
    })
    .from(schema.processingJobs)
    .innerJoin(
      schema.documentVersions,
      eq(schema.processingJobs.documentVersionId, schema.documentVersions.id),
    )
    .innerJoin(schema.documents, eq(schema.documentVersions.documentId, schema.documents.id))
    .where(eq(schema.processingJobs.status, 'FAILED'))
    .orderBy(desc(schema.processingJobs.updatedAt))
    .limit(limit);

  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

/**
 * Re-queue a FAILED job with a fresh retry budget (an admin has intervened,
 * so it deserves another full attempt count rather than picking up where a
 * possibly-transient failure left off). No-op (returns false) if the job
 * isn't currently FAILED — never resurrects a job another path already moved.
 */
export async function retryFailedJob(db: Db, jobId: string): Promise<boolean> {
  const updated = await db
    .update(schema.processingJobs)
    .set({
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      errorCode: null,
      availableAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.processingJobs.id, jobId), eq(schema.processingJobs.status, 'FAILED')))
    .returning({ id: schema.processingJobs.id });
  return updated.length > 0;
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
 * anything left over from a crashed/killed invocation gets picked up later,
 * either on its own next `availableAt` or once its lease expires and a later
 * `claimJobs` call reclaims it).
 */
export async function runIntakeWorker(
  db: Db,
  scanner: ScannerPort,
  extractor: TextExtractionPort,
  options: { readonly limit?: number } = {},
): Promise<IntakeWorkerResult> {
  const jobs = await claimJobs(db, options.limit ?? DEFAULT_CLAIM_LIMIT);
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    const leaseOwner = job.leaseOwner;
    if (!leaseOwner) continue; // claimJobs always sets one; satisfies the type.
    try {
      const result = await processIntake(db, scanner, extractor, {
        documentVersionId: job.documentVersionId,
      });
      if (!result.ok) throw new Error(result.error.message);
      if (await completeJob(db, job, leaseOwner)) processed++;
    } catch (error) {
      const stillOwned = await failJob(
        db,
        job,
        leaseOwner,
        error instanceof Error ? error.message : String(error),
      );
      if (stillOwned) failed++;
    }
  }
  return { processed, failed };
}
