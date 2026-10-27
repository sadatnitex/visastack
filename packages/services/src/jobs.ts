import { randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { SystemScope } from './access';
import { type AiReadingPorts, processAiReading } from './ai-reading';
import { type ReadingStopReason, isAiReadingJob, isIntakeJob } from './ai-reading-job';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import type { DocumentConverterPort } from './extraction';
import type { ContentLimitsPort, MalwareScannerPort } from './intake';
import { processIntake } from './intake';
import type { ObservabilityPort } from './ports';

/**
 * Low-volume durable job queue (Release B; master directive §5 — "DB-backed
 * jobs for low pilot volume" is approved infra, Inngest/paid queues are not).
 * Decouples intake processing from the upload HTTP request: a row is claimed
 * with `FOR UPDATE SKIP LOCKED` so concurrent workers never double-process the
 * same job, and a failure retries with exponential backoff up to
 * `maxAttempts` before parking at FAILED — visible and inspectable, never
 * silently dropped. This module is deliberately storage-agnostic: callers
 * inject the `MalwareScannerPort`/`ContentLimitsPort`, exactly like
 * `processIntake` itself.
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

/** A single audited refresh for files read before the private OCR reader was available. */
export async function requestDocumentReExtraction(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly documentId: string;
    readonly expectedVersionId: string;
  },
): Promise<Result<void, ServiceError>> {
  if (
    ![input.documentId, input.expectedVersionId].every((id) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
    )
  )
    return err(serviceError('invalid', 'Document reference is invalid.'));
  return db.transaction(async (tx) => {
    const document = first(
      await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, input.documentId))
        .for('update'),
    );
    const person =
      document &&
      first(
        await tx
          .select()
          .from(schema.applicants)
          .where(eq(schema.applicants.id, document.applicantId))
          .limit(1),
      );
    if (!document || person?.ownerAccountId !== input.actorAccountId)
      return err(
        serviceError('forbidden', 'Only the traveller owner can request another reading.'),
      );
    if (!(await hasConsent(tx, input.actorAccountId, 'CORE_PROCESSING')))
      return err(serviceError('consent_required', 'Core processing consent is required.'));
    const version = first(
      await tx
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, document.id))
        .orderBy(desc(schema.documentVersions.versionNumber))
        .limit(1),
    );
    if (!version || version.id !== input.expectedVersionId)
      return err(
        serviceError('invalid', 'This document changed. Reload before requesting another reading.'),
      );
    if (
      version.safetyStatus !== 'CLEAN' ||
      !['AWAITING_REVIEW', 'APPROVED'].includes(version.processingStatus)
    )
      return err(
        serviceError('invalid', 'The file must complete safety checks before another reading.'),
      );
    const active = first(
      await tx
        .select()
        .from(schema.processingJobs)
        .where(
          and(
            eq(schema.processingJobs.documentVersionId, version.id),
            inArray(schema.processingJobs.status, ['PENDING', 'CLAIMED']),
          ),
        )
        .limit(1),
    );
    if (active) return err(serviceError('invalid', 'This file is already queued or being read.'));
    const processingVersion = 2;
    const queued = await tx
      .insert(schema.processingJobs)
      .values({
        documentVersionId: version.id,
        jobType: 'INTAKE',
        processingVersion,
        idempotencyKey: idempotencyKeyFor(version.id, 'INTAKE', processingVersion),
      })
      .onConflictDoNothing()
      .returning();
    if (!queued.length)
      return err(
        serviceError(
          'invalid',
          'This copy has already used the current reader. Upload a clearer copy if details are still missing.',
        ),
      );
    await tx
      .update(schema.documentVersions)
      .set({ processingStatus: 'EXTRACTING' })
      .where(eq(schema.documentVersions.id, version.id));
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_REEXTRACTION_REQUESTED',
      actorAccountId: input.actorAccountId,
      applicantId: person.id,
      resourceType: 'document_version',
      resourceId: version.id,
      method: 'MANUAL',
      result: 'ALLOWED',
    });
    return ok(undefined);
  });
}

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
 *
 * Also reclaims lease-LESS `CLAIMED` rows — `lease_expires_at IS NULL` —
 * once `claimedAt` is older than a full lease duration (finding #21, post-
 * programme defect register; mirrors `erasure.ts`'s already-proven identical
 * fix, Codex review PR-B1). Migration `0020_wide_doctor_doom.sql` added
 * `lease_expires_at` as nullable with no backfill, so any row that reached
 * `CLAIMED` before that migration ran keeps a permanently-`NULL` value;
 * `lease_expires_at < now()` alone never matches `NULL` under SQL's
 * three-valued logic, permanently stranding such a row — exactly the bug
 * leasing exists to prevent. A plain `IS NULL` check alone would be too
 * eager: it could reclaim (and let a new worker immediately re-claim and
 * start processing) a job whose OWN worker is still genuinely, actively
 * mid-flight on it under code that predates the lease columns entirely
 * (no lease-aware CAS at all), recreating the double-processing hazard
 * leasing exists to prevent. Gating on `claimedAt` age instead makes that
 * legacy code's own worth of work fit safely inside one lease duration,
 * mirroring the same generosity assumption `LEASE_DURATION_MS` itself
 * already rests on.
 */
async function claimJobs(
  db: Db,
  limit: number,
  /** Intake passes and automatic AI readings share the queue; each worker claims only its own kind. */
  kind: 'intake' | 'reading' = 'intake',
): Promise<ProcessingJob[]> {
  const leaseOwner = randomUUID();
  const rolloutGraceExpiry = new Date(Date.now() - LEASE_DURATION_MS);
  return db.transaction(async (tx) => {
    await tx
      .update(schema.processingJobs)
      .set({ status: 'PENDING', leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.processingJobs.status, 'CLAIMED'),
          or(
            lt(schema.processingJobs.leaseExpiresAt, sql`now()`),
            and(
              isNull(schema.processingJobs.leaseExpiresAt),
              lt(schema.processingJobs.claimedAt, rolloutGraceExpiry),
            ),
          ),
        ),
      );

    const due = await tx
      .select({ id: schema.processingJobs.id })
      .from(schema.processingJobs)
      .where(
        and(
          eq(schema.processingJobs.status, 'PENDING'),
          lte(schema.processingJobs.availableAt, sql`now()`),
          kind === 'reading'
            ? isAiReadingJob(schema.processingJobs.idempotencyKey)
            : isIntakeJob(schema.processingJobs.idempotencyKey),
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
 *
 * Also requires `leaseExpiresAt` to still be in the future (Codex review,
 * PR-C1, round 1 — the same fix `intake.ts`'s `stillHoldsLease` needed, for
 * the same reason, kept consistent with it here): matching only on
 * `status`/`leaseOwner` answers "does this row still nominally say I'm the
 * holder," not "is my lease still genuinely unexpired." Without this, an
 * invocation whose lease expired by wall-clock time but was never actually
 * reclaimed by anyone (e.g. `stillHoldsLease` correctly stopped it from
 * writing any document-processing side effects, but nothing else has run
 * `claimJobs` yet) would still mark this job `DONE` here — even though the
 * document version it was supposed to advance was never actually touched.
 * Requiring the same unexpired-lease condition here means such an
 * invocation contributes nothing at all: the job stays `CLAIMED` with its
 * expired lease, exactly the shape a crashed worker leaves, and the next
 * ordinary `claimJobs` call reclaims and reprocesses it from scratch —
 * never silently marked complete with unfinished work.
 */
async function completeJob(
  db: Db,
  job: ProcessingJob,
  leaseOwner: string,
  /** For an automatic reading that finished without reading everything: the safe-to-show reason. */
  stopReason?: ReadingStopReason,
): Promise<boolean> {
  const updated = await db
    .update(schema.processingJobs)
    .set({
      status: 'DONE',
      completedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
      ...(stopReason ? { errorCode: stopReason } : {}),
    })
    .where(
      and(
        eq(schema.processingJobs.id, job.id),
        eq(schema.processingJobs.status, 'CLAIMED'),
        eq(schema.processingJobs.leaseOwner, leaseOwner),
        gt(schema.processingJobs.leaseExpiresAt, sql`now()`),
      ),
    )
    .returning({ id: schema.processingJobs.id });
  return updated.length > 0;
}

/** A closed, display-safe failure category — never the raw internal error text. */
export type JobErrorCode =
  | 'SCAN_FAILED'
  | 'EXTRACTION_FAILED'
  | 'STORAGE_UNAVAILABLE'
  | 'READING_FAILED'
  | 'UNKNOWN';

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

interface FailJobOutcome {
  /** False only when the lease was already lost to another invocation (a safe no-op, not an error). */
  readonly recorded: boolean;
  readonly errorCode: JobErrorCode;
  /** True once this job has exhausted every retry and is now permanently parked at FAILED. */
  readonly exhausted: boolean;
}

/**
 * On failure: retry with backoff until maxAttempts, then park at FAILED.
 * Compare-and-set like `completeJob` — a lost lease is a safe no-op, not an
 * error. Also requires an unexpired lease, for the identical reason and
 * consistency `completeJob` documents (Codex review, PR-C1, round 1).
 */
async function failJob(
  db: Db,
  job: ProcessingJob,
  leaseOwner: string,
  errorMessage: string,
  /** Set for a kind of job whose failure is not told by the file's intake state (an automatic reading). */
  knownErrorCode?: JobErrorCode,
): Promise<FailJobOutcome> {
  const exhausted = job.attempts >= job.maxAttempts;
  const errorCode = knownErrorCode ?? (await classifyFailure(db, job.documentVersionId));
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
        gt(schema.processingJobs.leaseExpiresAt, sql`now()`),
      ),
    )
    .returning({ id: schema.processingJobs.id });
  return { recorded: updated.length > 0, errorCode, exhausted };
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
 *
 * `observability`, when provided, records a `job_failure` event on every
 * failed attempt (directive Part 3 §13's "job failures" monitoring signal),
 * carrying the same `errorCode` classification (`SCAN_FAILED`/
 * `EXTRACTION_FAILED`/`STORAGE_UNAVAILABLE`/`UNKNOWN`) already persisted on
 * the job row, at `error` severity once a job is permanently parked at
 * FAILED and `warning` while it still has retries left. A sustained run of
 * `errorCode: 'SCAN_FAILED'` events is this pipeline's available proxy for
 * scanner-availability problems; a dedicated, continuous scanner-health
 * signal independent of an actual job failing is not built here (tracked in
 * `known-issues.md`).
 */
export async function runIntakeWorker(
  db: Db,
  scanner: MalwareScannerPort,
  extractor: DocumentConverterPort,
  contentLimits: ContentLimitsPort,
  options: { readonly limit?: number; readonly observability?: ObservabilityPort } = {},
): Promise<IntakeWorkerResult> {
  const jobs = await claimJobs(db, options.limit ?? DEFAULT_CLAIM_LIMIT);
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    const leaseOwner = job.leaseOwner;
    if (!leaseOwner) continue; // claimJobs always sets one; satisfies the type.
    try {
      // Threading {jobId, leaseOwner} lets processIntake fence its own
      // side-effect writes (scan-result rows, extraction-run rows,
      // classification/naming-proposal rows) against a mid-pipeline lease
      // loss, not just the final processingStatus transition (finding #19,
      // post-programme defect register) -- see intake.ts's own doc comments
      // on stillHoldsLease for the precise gap this closes.
      const result = await processIntake(db, scanner, extractor, contentLimits, {
        documentVersionId: job.documentVersionId,
        fencing: { jobId: job.id, leaseOwner },
      });
      if (!result.ok) throw new Error(result.error.message);
      if (await completeJob(db, job, leaseOwner)) processed++;
    } catch (error) {
      const outcome = await failJob(
        db,
        job,
        leaseOwner,
        error instanceof Error ? error.message : String(error),
      );
      if (outcome.recorded) {
        failed++;
        options.observability?.record({
          name: 'job_failure',
          severity: outcome.exhausted ? 'error' : 'warning',
          metadata: {
            jobType: 'INTAKE',
            documentVersionId: job.documentVersionId,
            errorCode: outcome.errorCode,
            attempts: job.attempts,
            maxAttempts: job.maxAttempts,
            exhausted: outcome.exhausted,
          },
        });
      }
    }
  }
  return { processed, failed };
}

export interface AiReadingWorkerResult {
  /** Files read as far as the owner allows. */
  readonly processed: number;
  /** Files whose reading stopped for a stated reason (no consent, switched off, a limit, protected). */
  readonly stopped: number;
  /** Attempts that failed and will be tried again, or were parked at FAILED. */
  readonly failed: number;
}

/** One pass leaves time for the response; the cron route's function limit is 60 seconds. */
const DEFAULT_READING_TIME_BUDGET_MS = 40_000;
const DEFAULT_READING_LIMIT = 5;

/**
 * Claim and run due automatic AI readings, one at a time, until the limit or the time budget is
 * reached (S5, ADR 0019). Under the `process-ai-reading` scope only: the scope is what lets the job
 * act for a file's owner, and a copied or forged one is refused before anything is claimed. Safe
 * to call at any time and from several places at once: claims are leases, so a file is read by one
 * worker, and a finished or already-read file is a no-op.
 */
export async function runAiReadingWorker(
  db: Db,
  scope: SystemScope<'process-ai-reading'>,
  ports: AiReadingPorts,
  options: {
    readonly limit?: number;
    readonly timeBudgetMs?: number;
    readonly observability?: ObservabilityPort;
  } = {},
): Promise<AiReadingWorkerResult> {
  if (!SystemScope.isGenuine(scope) || scope.job !== 'process-ai-reading') {
    throw new Error('automatic reading needs the scope of its own job');
  }
  const limit = options.limit ?? DEFAULT_READING_LIMIT;
  const deadline = Date.now() + (options.timeBudgetMs ?? DEFAULT_READING_TIME_BUDGET_MS);
  let processed = 0;
  let stopped = 0;
  let failed = 0;
  for (let handled = 0; handled < limit && Date.now() < deadline; handled++) {
    const [job] = await claimJobs(db, 1, 'reading');
    if (!job) break;
    const leaseOwner = job.leaseOwner;
    if (!leaseOwner) continue; // claimJobs always sets one; satisfies the type.
    try {
      const result = await processAiReading(db, scope, ports, {
        documentVersionId: job.documentVersionId,
      });
      if (await completeJob(db, job, leaseOwner, result.stopReason)) {
        if (result.outcome === 'STOPPED') stopped++;
        else processed++;
      }
    } catch (error) {
      const outcome = await failJob(
        db,
        job,
        leaseOwner,
        error instanceof Error ? error.message : String(error),
        'READING_FAILED',
      );
      if (outcome.recorded) {
        failed++;
        options.observability?.record({
          name: 'job_failure',
          severity: outcome.exhausted ? 'error' : 'warning',
          metadata: {
            jobType: 'AI_READING',
            documentVersionId: job.documentVersionId,
            errorCode: outcome.errorCode,
            attempts: job.attempts,
            maxAttempts: job.maxAttempts,
            exhausted: outcome.exhausted,
          },
        });
      }
    }
  }
  return { processed, stopped, failed };
}
