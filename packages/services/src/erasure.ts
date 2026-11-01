import { randomUUID } from 'node:crypto';
import {
  type SQLWrapper,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { lifecycleTablesPresent } from './lifecycle/foundation/presence';
import { incrementMaterialRevision, missionsSelectingDocument } from './material-revision';
import { redactionMasksTablePresent } from './redaction-table';
import { documentBlockedByLegalHold, hasActiveLegalHold } from './retention';
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

/**
 * Reasons that remove a whole document row once every one of its stored files is verified gone:
 * the retention purge, and a lifecycle removal (a deleted duplicate whose 30 days ended, or a file
 * support approved for removal). Both take the identical path: hold recheck, document row lock,
 * all-siblings-verified, material revision for every case selecting it, then the row and its
 * storage objects.
 */
export const DOCUMENT_ROW_REASONS: ReadonlySet<ErasureJobReason> = new Set<ErasureJobReason>([
  'RETENTION_PURGE',
  'DOCUMENT_REMOVAL',
]);

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

/** Genuinely still progressing toward `VERIFIED` on its own — nothing further to do for a fresh enqueue request against the same storage object. */
const IN_FLIGHT_ERASURE_JOB_STATUSES: readonly ErasureJob['status'][] = [
  'PENDING',
  'CLAIMED',
  'DELETED',
];
/**
 * Parked — will never resume on its own; only an explicit action (an admin's
 * `retryErasureJob`, or a fresh enqueue request, see below) moves it again.
 */
const PARKED_ERASURE_JOB_STATUSES: readonly ErasureJob['status'][] = ['FAILED', 'BLOCKED_BY_HOLD'];

/**
 * Queue one external object for deletion. Callers pass their own transaction
 * handle so this composes into the caller's atomic "mark pending deletion"
 * step rather than opening a transaction of its own.
 *
 * Genuinely idempotent per storage object (D-A1, post-programme defect
 * register): a job already `PENDING`/`CLAIMED`/`DELETED` for this
 * `storageObjectId` is already progressing toward `VERIFIED` on its own and
 * is returned unchanged. `purgeExpiredDocuments` can be invoked repeatedly
 * (a manual admin action) against the same still-not-fully-erased document
 * indefinitely — by design, a document deliberately survives until every
 * sibling storage object's job reaches `VERIFIED` (finding #13) — so a
 * document with one stuck `FAILED`/`BLOCKED_BY_HOLD` sibling is exactly the
 * shape a repeated purge run would otherwise keep re-enqueueing redundant
 * jobs against. This closes a pure efficiency/hygiene gap (wasted worker
 * attempts, unbounded row growth), never a correctness one:
 * `finalizeVerifiedJob`'s own completion check already groups by distinct
 * `storageObjectId`, so it was already correct regardless of how or why a
 * duplicate row arose, before this fix existed.
 *
 * A job already `FAILED`/`BLOCKED_BY_HOLD` is **requeued** — reset to
 * `PENDING` with a fresh attempt budget, and its `reason`/`documentId`/
 * `applicantId` overwritten to match THIS call's own input — rather than
 * returned inertly (Codex review, PR-C1, round 1). A parked job left
 * untouched here would never resume on its own: `executeAccountDeletion`
 * deletes the applicant/document rows and THEN enqueues an `ACCOUNT_DELETION`
 * job for each storage object (no `documentId`/`applicantId` — the rows are
 * already gone by then); if that storage object already had an unrelated
 * `RETENTION_PURGE` job parked here from an earlier attempt, the original
 * inert-return design would hand back that stale, going-nowhere row — the
 * account's logical rows would be gone while its external bytes sat
 * undeleted indefinitely, with no automatic path to erasure. Overwriting
 * `reason`/`documentId`/`applicantId` (not merely `status`) matters: a
 * requeued job that kept a stale `RETENTION_PURGE` reason/`documentId`
 * pointing at an already-deleted document would take
 * `finalizeVerifiedJob`'s RETENTION_PURGE branch (hold recheck, document-
 * row lock, sibling-completion cascade) against rows that no longer exist,
 * instead of the simple, already-correct `ACCOUNT_DELETION` branch the
 * fresh request actually calls for. Safe in the reverse direction too — a
 * `RETENTION_PURGE` call finding its OWN earlier parked attempt just
 * overwrites `reason`/`documentId`/`applicantId` with the same values they
 * already held. `bucket`/`objectKey`/`expectedHash` are never overwritten:
 * they describe the underlying object itself, not why erasure is needed,
 * and are already guaranteed identical for the same `storageObjectId`.
 *
 * Race-safety for the one caller with a genuine repeated-invocation risk
 * (`purgeExpiredDocuments`) comes from the `documents` row lock it already
 * takes before calling this function; this existence check adds no locking
 * primitive of its own, so a duplicate under a true concurrent call with no
 * matching external lock remains theoretically possible — strictly no worse
 * than the total absence of any check this replaces, never a regression.
 */
export async function enqueueErasureJob(
  db: Db,
  input: EnqueueErasureJobInput,
): Promise<ErasureJob> {
  // Safe copy boxes (ADR 0022, S23) and their stored page drawings go with the bytes they were
  // drawn from, in this same transaction: once a file is being erased nothing can be made from
  // it, and nothing about it is kept. Each drawing (finished, or one still being stored) is queued
  // for verified erasure like any other stored file. Asked with a presence check first, so a
  // database before migration 0102 is unaffected. A drawing's own erasure finds no versions of
  // its own here.
  if (input.reason !== 'SAFE_COPY_REMOVAL' && (await redactionMasksTablePresent(db))) {
    const versions = db
      .select({ id: schema.documentVersions.id })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.storageObjectId, input.storageObjectId));
    await removeSafeCopyMasks(db, versions, input.applicantId);
  }
  const existing = first(
    await db
      .select()
      .from(schema.erasureJobs)
      .where(
        and(
          eq(schema.erasureJobs.storageObjectId, input.storageObjectId),
          inArray(schema.erasureJobs.status, [
            ...IN_FLIGHT_ERASURE_JOB_STATUSES,
            ...PARKED_ERASURE_JOB_STATUSES,
          ]),
        ),
      )
      .limit(1),
  );
  if (existing) {
    if ((IN_FLIGHT_ERASURE_JOB_STATUSES as readonly string[]).includes(existing.status)) {
      return existing;
    }
    // PARKED: give it a fresh attempt budget under THIS call's own reason/
    // context rather than leaving it stranded.
    const requeued = first(
      await db
        .update(schema.erasureJobs)
        .set({
          reason: input.reason,
          documentId: input.documentId ?? null,
          applicantId: input.applicantId ?? null,
          status: 'PENDING',
          attempts: 0,
          lastError: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          availableAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.erasureJobs.id, existing.id))
        .returning(),
    );
    if (requeued) return requeued;
  }
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
 *
 * Also reclaims lease-LESS CLAIMED/DELETED rows — `lease_expires_at IS NULL`
 * — once `claimedAt` is older than a full lease duration (Codex review,
 * PR-B1). Two distinct sources produce such a row, and this one predicate
 * covers both uniformly: (1) migration 0025 deliberately does NOT backfill
 * any pre-existing CLAIMED/DELETED row — this repo's build command runs
 * the migration before `next build` (`apps/web/vercel.json`), so the OLD
 * deployment is still live and serving when it runs, and a row at that
 * exact moment could belong to a genuinely still-running old-code worker,
 * not an orphan; and (2) that same still-live old deployment can itself
 * claim a *new* job after the migration has already added the lease
 * columns, setting `claimedAt` but leaving them unset since that code
 * predates them. `lease_expires_at < now()` alone would never match either
 * case — SQL comparison against NULL is neither true nor false —
 * permanently stranding the row exactly like the bug this module exists to
 * close. A plain `IS NULL` check alone would be too eager: it could
 * reclaim (and let a new worker immediately re-claim and start processing)
 * a job an old-code worker is still genuinely, actively mid-flight on,
 * recreating the double-processing hazard leasing exists to prevent — the
 * old code's own writes are gated only by row id, with no status/lease
 * check at all. Gating on `claimedAt` age instead makes both code
 * versions' worth of work fit safely inside one lease duration, mirroring
 * the same generosity assumption `LEASE_DURATION_MS` itself already rests
 * on.
 */
async function claimErasureJobs(db: Db, limit: number): Promise<ErasureJob[]> {
  const leaseOwner = randomUUID();
  const rolloutGraceExpiry = new Date(Date.now() - LEASE_DURATION_MS);
  return db.transaction(async (tx) => {
    await tx
      .update(schema.erasureJobs)
      .set({ status: 'PENDING', leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(
        and(
          inArray(schema.erasureJobs.status, ['CLAIMED', 'DELETED']),
          or(
            lt(schema.erasureJobs.leaseExpiresAt, sql`now()`),
            and(
              isNull(schema.erasureJobs.leaseExpiresAt),
              lt(schema.erasureJobs.claimedAt, rolloutGraceExpiry),
            ),
          ),
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
 *
 * Finding #14 (post-programme defect register): the hold recheck below locks
 * the applicant row (`SELECT ... FOR UPDATE`) before reading `legalHolds`.
 * `placeLegalHold` and `executeAccountDeletion` take the identical lock on
 * the identical key before their own hold-sensitive work, so a hold that
 * commits anywhere in that window can never be invisible to this recheck —
 * without it, a plain unlocked read here could miss a hold that is
 * concurrently, genuinely being placed.
 *
 * Finding #13: a multi-version document has one erasure job per storage
 * object, all sharing one `documentId` — the `documents` row must survive
 * until every sibling job is VERIFIED, not just this one. Before deciding,
 * this locks the `documents` row itself (not the erasure-job rows): a single
 * shared lock target that every sibling's finalize call contends for is
 * inherently deadlock-free (first-come-first-served on one resource, never
 * a partial-lock-then-request-more pattern), and — Codex review, PR-B2,
 * round 1 — the identical lock, on the identical row, is what
 * `addDocumentVersion` and `purgeExpiredDocuments` also take before their
 * own document-mutating decisions (see their own comments). That shared
 * lock is what makes the completion check below actually correct:
 * `addDocumentVersion` refuses to attach a new version once any
 * non-`VERIFIED` job exists for a document, so the set of storage objects
 * requiring a verified deletion is closed the moment the first job is
 * enqueued — no version can appear here that this check didn't already
 * account for. The check itself is per DISTINCT storage object, not per job
 * row (Codex review, PR-B2, round 5) — see its own comment below for why.
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
    if (DOCUMENT_ROW_REASONS.has(job.reason) && job.applicantId) {
      await tx
        .select({ id: schema.applicants.id })
        .from(schema.applicants)
        .where(eq(schema.applicants.id, job.applicantId))
        .for('update');

      // A job created without a specific document (rare -- every real
      // RETENTION_PURGE job retention.ts itself enqueues carries one) can
      // only be checked against an applicant-wide hold; one carrying a
      // document gets the full scope-aware check, which is a strict
      // superset of that (see `documentBlockedByLegalHold`'s own comment).
      const held = job.documentId
        ? await documentBlockedByLegalHold(tx, {
            applicantId: job.applicantId,
            documentId: job.documentId,
          })
        : await hasActiveLegalHold(tx, job.applicantId);
      if (held) {
        const blocked = await blockOnHold(
          tx,
          job,
          leaseOwner,
          'DELETED',
          'a legal hold was placed after bytes were deleted; logical record preserved',
        );
        if (blocked) await blockRemovalReceipt(tx, job);
        return blocked ? 'blocked' : 'lost-lease';
      }
    }

    if (DOCUMENT_ROW_REASONS.has(job.reason) && job.documentId) {
      await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.id, job.documentId))
        .for('update');
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
    // so a storage object can't go while any version still points at it —
    // and for RETENTION_PURGE that stops being true only once the WHOLE
    // document is deleted, cascading every sibling's document_versions row
    // at once. A multi-version document must not lose its logical record
    // (or the metadata of versions not yet erased) while any sibling's
    // storage object still awaits verified deletion — so until every
    // DISTINCT storage object this document ever referenced has a VERIFIED
    // job, NEITHER the document NOR any sibling's storage object (including
    // this job's own) can be removed yet. This isn't just this function's
    // own bookkeeping: the restrict FK enforces it structurally — a first
    // draft of this fix deleted this job's own storage object
    // unconditionally here and hit exactly that FK violation, since this
    // job's document_versions row survives for as long as the deliberately
    // still-alive document does.
    //
    // Completion is evaluated per DISTINCT storageObjectId, not per job row
    // (Codex review, PR-B2, round 5): `purgeExpiredDocuments` locks the
    // `documents` row before enqueueing, but that only serializes concurrent
    // purge attempts against each other — it does not stop a LATER,
    // sequential purge run (the document is still "past retention" for as
    // long as any sibling hasn't verified) from enqueueing a second,
    // redundant job for a storage object that already has one. A row-count
    // check (`siblings.every(status === 'VERIFIED')`) would then let one
    // redundant job's own retry exhaustion (FAILED) block the document
    // forever, even though the actual storage object it targets is already
    // provably gone via the OTHER job. Grouping by storageObjectId instead
    // makes finalization robust to duplicate rows by construction — however
    // they arose — without needing to prevent duplicate enqueueing. D-A1
    // (§1.2) separately closes that as a pure efficiency/hygiene concern
    // (PR-C1: `enqueueErasureJob`'s own existence check, above) — avoiding
    // the wasted redundant work, not a correctness gap, since this
    // completion check never depended on it in the first place.
    if (DOCUMENT_ROW_REASONS.has(job.reason) && job.documentId) {
      const siblings = await tx
        .select({
          status: schema.erasureJobs.status,
          storageObjectId: schema.erasureJobs.storageObjectId,
        })
        .from(schema.erasureJobs)
        .where(eq(schema.erasureJobs.documentId, job.documentId));
      const requiredStorageObjectIds = new Set(siblings.map((sibling) => sibling.storageObjectId));
      const verifiedStorageObjectIds = new Set(
        siblings
          .filter((sibling) => sibling.status === 'VERIFIED')
          .map((sibling) => sibling.storageObjectId),
      );
      const documentFullyErased = [...requiredStorageObjectIds].every((id) =>
        verifiedStorageObjectIds.has(id),
      );
      if (documentFullyErased) {
        // TRU-03 (Part 7 §4): "selected document version/removal" is
        // material. Read who has it selected BEFORE the delete below --
        // `selectedEvidence.documentId` cascades on `documents` deletion, so
        // the rows this reads would already be gone afterward. The sibling
        // ACCOUNT_DELETION path (the `else` branch here) needs no such call:
        // `missions.applicantId` also cascades, so a mission that would need
        // its revision bumped has already been deleted along with its
        // applicant by the time this worker step ever runs.
        for (const missionId of await missionsSelectingDocument(tx, job.documentId)) {
          await incrementMaterialRevision(tx, missionId);
        }
        // Read before the delete: the document's lifecycle row goes with it. Whichever reason
        // finishes the document (a lifecycle removal, or a retention purge reaching a document
        // that sits in Recently Deleted), its Removal Record reads Removed.
        const receiptId = await removalReceiptId(tx, job.documentId);
        const freed =
          receiptId === null
            ? 0
            : (
                await tx
                  .select({ size: schema.storageObjects.sizeBytes })
                  .from(schema.storageObjects)
                  .where(inArray(schema.storageObjects.id, [...requiredStorageObjectIds]))
              ).reduce((sum, row) => sum + (row.size ?? 0), 0);
        await tx.delete(schema.documents).where(eq(schema.documents.id, job.documentId));
        await tx
          .delete(schema.storageObjects)
          .where(inArray(schema.storageObjects.id, [...requiredStorageObjectIds]));
        if (receiptId !== null) await completeRemovalReceipt(tx, receiptId, freed);
      }
    } else {
      await tx
        .delete(schema.storageObjects)
        .where(eq(schema.storageObjects.id, job.storageObjectId));
    }
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

/**
 * The Removal Record of a deleted document, read from its lifecycle row (migration 0113), or null
 * when there is none (the tables are missing, or the document was never deleted).
 */
async function removalReceiptId(tx: Db, documentId: string): Promise<string | null> {
  if (!(await lifecycleTablesPresent(tx))) return null;
  const row = first(
    await tx
      .select({ receiptId: schema.documentLifecycle.receiptId })
      .from(schema.documentLifecycle)
      .where(eq(schema.documentLifecycle.documentId, documentId)),
  );
  return row?.receiptId ?? null;
}

/**
 * Every stored file of a removed document is verified gone: its Removal Record reads Removed,
 * with the time and the space freed. A record already finished is left as it is; the receipt
 * guard of migration 0113 accepts only this forward move.
 */
async function completeRemovalReceipt(
  tx: Db,
  receiptId: string,
  bytesFreed: number,
): Promise<void> {
  const receipt = first(
    await tx
      .select({ status: schema.deletionReceipts.status, effects: schema.deletionReceipts.effects })
      .from(schema.deletionReceipts)
      .where(eq(schema.deletionReceipts.id, receiptId))
      .for('update'),
  );
  if (!receipt || receipt.status === 'REMOVED' || receipt.status === 'RESTORED') return;
  if (receipt.status !== 'REMOVING') {
    await tx
      .update(schema.deletionReceipts)
      .set({ status: 'REMOVING' })
      .where(eq(schema.deletionReceipts.id, receiptId));
  }
  const effects =
    receipt.effects.bytesFreed === undefined ? { ...receipt.effects, bytesFreed } : receipt.effects;
  await tx
    .update(schema.deletionReceipts)
    .set({ status: 'REMOVED', verifiedGoneAt: new Date(), effects })
    .where(eq(schema.deletionReceipts.id, receiptId));
}

/** A legal hold stopped a `DOCUMENT_REMOVAL`: its Removal Record reads Kept (Legal Requirement). */
async function blockRemovalReceipt(tx: Db, job: ErasureJob): Promise<void> {
  if (job.reason !== 'DOCUMENT_REMOVAL' || !job.documentId) return;
  const receiptId = await removalReceiptId(tx, job.documentId);
  if (receiptId === null) return;
  await tx
    .update(schema.deletionReceipts)
    .set({ status: 'BLOCKED' })
    .where(
      and(
        eq(schema.deletionReceipts.id, receiptId),
        inArray(schema.deletionReceipts.status, ['SCHEDULED', 'REMOVING']),
      ),
    );
  await appendAuditEvent(tx, {
    eventType: 'DOCUMENT_REMOVAL_BLOCKED',
    method: 'SYSTEM',
    result: 'ALLOWED',
    applicantId: job.applicantId,
    resourceType: 'document',
    resourceId: job.documentId,
    metadata: { receiptId, cause: 'LEGAL_HOLD' },
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
    if (DOCUMENT_ROW_REASONS.has(job.reason) && job.applicantId) {
      const held = job.documentId
        ? await documentBlockedByLegalHold(db, {
            applicantId: job.applicantId,
            documentId: job.documentId,
          })
        : await hasActiveLegalHold(db, job.applicantId);
      if (held) {
        const blocked = await db.transaction(async (tx) => {
          const done = await blockOnHold(
            tx,
            job,
            leaseOwner,
            'CLAIMED',
            'an active legal hold blocks this purge',
          );
          if (done) await blockRemovalReceipt(tx, job);
          return done;
        });
        return blocked ? 'blocked' : 'lost-lease';
      }
    }

    // deletionAttemptedAt is written here, BEFORE the external call, in its
    // own committed statement — deliberately, not after deleteObject returns
    // (Codex review, PR-B2, round 5). If deleteObject succeeds but the CAS
    // below then throws (an infra failure — a dropped connection, a timeout
    // — not a domain one), failErasureJob can still send this job back to
    // PENDING/FAILED; with the marker already durable, that transition
    // doesn't erase the fact that a delete was attempted. We can never
    // safely tell "deleteObject wasn't reached" apart from "it was reached
    // and either the response or this follow-up write was lost" from inside
    // the catch block alone, so the marker has to be written first. A lost
    // lease here (a concurrent invocation already reclaimed this job) means
    // we no longer own it — return immediately, before ever calling
    // deleteObject, rather than attempting a delete on a job we might not
    // finish accounting for.
    const attempted = await db
      .update(schema.erasureJobs)
      .set({ deletionAttemptedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.erasureJobs.id, job.id),
          eq(schema.erasureJobs.status, 'CLAIMED'),
          eq(schema.erasureJobs.leaseOwner, leaseOwner),
        ),
      )
      .returning({ id: schema.erasureJobs.id });
    if (attempted.length === 0) return 'lost-lease';

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
 * The WHERE-clause predicate shared by every "is this storage object's data
 * still safe to treat as present" check in this module: true for a row
 * whose `status` is `CLAIMED`, `DELETED`, or `VERIFIED`, OR that has ever
 * had `deletionAttemptedAt` set.
 *
 * Two conditions, not one, covering two different gaps (Codex review,
 * PR-B2, rounds 4-5):
 *
 * - The legacy `status IN (...)` check alone can't answer "were the bytes
 *   ever actually deleted" once a job has been retried past `DELETED` — a
 *   lying-delete retry (verification correctly found bytes still present,
 *   `status` back to `PENDING`/`FAILED`) and a plain verification hiccup
 *   (bytes genuinely gone, `status` at the same `PENDING`/`FAILED`) are
 *   indistinguishable from `status` alone (round 4's original finding).
 *   `deletionAttemptedAt` closes that: never cleared once set (not by
 *   `failErasureJob`, not even by the admin-facing `retryErasureJob`), so
 *   it survives every one of those transitions.
 * - `deletionAttemptedAt` alone can't cover a row written by code that
 *   predates this column — a job that reached `DELETED`/`VERIFIED` during
 *   the deploy window before this migration ran (the same rollout hazard
 *   `claimErasureJobs`' own lease-less-row handling documents) has the
 *   marker permanently NULL, real bytes or not (round 5's finding: the
 *   round-4 predicate had *replaced* the status check with the marker
 *   check, silently losing coverage for exactly these rows). Keeping the
 *   legacy `status IN ('CLAIMED', 'DELETED', 'VERIFIED')` check alongside
 *   the marker — augmenting, not replacing — covers both eras of row
 *   uniformly, with no backfill migration required (a backfill can't
 *   reliably distinguish a genuinely-orphaned row from one a still-live
 *   old-code worker is legitimately mid-flight on, the same reasoning
 *   `claimErasureJobs`' own rollout-grace window already rests on).
 *
 * One known, narrow, accepted residual: a *legacy* `DELETED` row that gets
 * reclaimed (lease expired) but not immediately re-claimed within the same
 * transaction commits at bare `PENDING` with no marker — a read in that
 * exact window would see it as servable again. This requires a crash
 * during the one historical deploy window this migration ever rolls out
 * in, compounded with an unlucky claim-batch boundary; closing it
 * completely would need a backfill this module deliberately avoids for the
 * reasons above, so it is accepted and documented rather than engineered
 * around, consistent with this PR's other honestly-scoped residual windows.
 */
function erasureInProgressOrBytesGone() {
  return or(
    inArray(schema.erasureJobs.status, ['CLAIMED', 'DELETED', 'VERIFIED']),
    isNotNull(schema.erasureJobs.deletionAttemptedAt),
  );
}

/**
 * The documents among `documentIds`, on the proof's own record only, whose file is leaving (S20,
 * AI connector original files): a version with an erasure job that is queued (`PENDING`), or in
 * progress or done by the product's own rule (`erasureInProgressOrBytesGone`, the rule every
 * read path uses). A FAILED or held job counts exactly as it does there. Owner or reader proof
 * for the record; a document of another record is never named.
 */
export async function documentsLeavingByErasure(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  documentIds: readonly string[],
  /** Where to read, when not the proof's own transaction (a savepoint inside it). */
  db: Db = proof.tx,
): Promise<Set<string>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') ||
    proof.resource.kind !== 'applicant' ||
    documentIds.length === 0
  ) {
    return new Set();
  }
  const rows = await db
    .selectDistinct({ documentId: schema.documentVersions.documentId })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .innerJoin(
      schema.erasureJobs,
      eq(schema.erasureJobs.storageObjectId, schema.documentVersions.storageObjectId),
    )
    .where(
      and(
        inArray(schema.documentVersions.documentId, [...documentIds]),
        eq(schema.documents.applicantId, proof.applicant.id),
        or(eq(schema.erasureJobs.status, 'PENDING'), erasureInProgressOrBytesGone()),
      ),
    );
  return new Set(rows.map((row) => row.documentId));
}

/**
 * True if this storage object's bytes are gone, or the worker has started
 * making them gone. Used by the document read path (`documents.ts`'s
 * `accessDocument`) to refuse to serve a version whose bytes are already
 * erased or actively being erased.
 *
 * Finding #13's design deliberately lets a multi-version document's row —
 * and every version's row, including one whose OWN job has already
 * verified — survive for as long as any sibling job hasn't (Codex review,
 * PR-B2, round 2): without this check, that already-erased version would
 * still look completely ordinary to the read path, which never otherwise
 * consults `erasureJobs` at all, and `accessDocument` would issue a working-
 * looking read reference for bytes that provably no longer exist.
 *
 * This remains a plain point-in-time read, not something serialized against
 * the erasure worker's own external `BlobStore.deleteObject` call (Codex
 * review, PR-B2, round 3) — no in-process lock can serialize against a
 * network call to an external store without blocking every other
 * reader/writer for its duration, an unacceptable trade for a hot read
 * path. `erasureInProgressOrBytesGone`'s two conditions shrink the
 * exploitable window down to a single, narrow `PENDING`→`CLAIMED`
 * transition, mirroring the same accepted, documented bytes-vs-record
 * tradeoff `finalizeVerifiedJob`'s own hold recheck already makes.
 */
export async function hasActiveOrVerifiedErasureJob(
  db: Db,
  storageObjectId: string,
): Promise<boolean> {
  const row = first(
    await db
      .select({ id: schema.erasureJobs.id })
      .from(schema.erasureJobs)
      .where(
        and(
          eq(schema.erasureJobs.storageObjectId, storageObjectId),
          erasureInProgressOrBytesGone(),
        ),
      )
      .limit(1),
  );
  return row !== undefined;
}

/** A stored safe copy page drawing (ADR 0022, S23), with what erasure needs to find and check it. */
export interface SafeCopyDrawing {
  readonly storageObjectId: string;
  readonly bucket: 'QUARANTINE' | 'CLEAN';
  readonly objectKey: string;
  readonly contentHash: string | null;
}

/** Every drawing a mask row names: its finished drawing, and one still being stored. */
export function safeCopyDrawingIds(
  rows: readonly {
    readonly renderedStorageObjectId: string | null;
    readonly pendingStorageObjectId: string | null;
  }[],
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.renderedStorageObjectId) ids.add(row.renderedStorageObjectId);
    if (row.pendingStorageObjectId) ids.add(row.pendingStorageObjectId);
  }
  return [...ids];
}

/**
 * Removes the safe copy boxes of the versions stored on one file and queues every drawing they
 * name (finished, or still being stored) for verified erasure, in the caller's transaction. The
 * caller checks first that migration 0102 has run. Module-local because of the access ratchet:
 * redaction.ts and documents.ts keep their own small copies inside their gated or listed
 * functions.
 */
async function removeSafeCopyMasks(
  db: Db,
  versionIds: SQLWrapper,
  applicantId: string | undefined,
): Promise<void> {
  const removed = await db
    .delete(schema.redactionMasks)
    .where(inArray(schema.redactionMasks.documentVersionId, versionIds))
    .returning({
      renderedStorageObjectId: schema.redactionMasks.renderedStorageObjectId,
      pendingStorageObjectId: schema.redactionMasks.pendingStorageObjectId,
    });
  const drawingIds = safeCopyDrawingIds(removed);
  if (drawingIds.length === 0) return;
  const drawings = await db
    .select()
    .from(schema.storageObjects)
    .where(inArray(schema.storageObjects.id, drawingIds));
  for (const drawing of drawings) {
    await enqueueErasureJob(db, {
      reason: 'SAFE_COPY_REMOVAL',
      bucket: drawing.bucket,
      objectKey: drawing.objectKey,
      expectedHash: drawing.contentHash,
      storageObjectId: drawing.id,
      ...(applicantId ? { applicantId } : {}),
    });
  }
}

/**
 * Bulk counterpart to `hasActiveOrVerifiedErasureJob`, for callers deciding
 * servability for many storage objects at once (Codex review, PR-B2, round
 * 4 — `missions.ts`'s document-eligibility scan): one query instead of N,
 * same predicate.
 */
export async function activeOrVerifiedErasureStorageObjectIds(
  db: Db,
  storageObjectIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (storageObjectIds.length === 0) return new Set();
  const rows = await db
    .select({ storageObjectId: schema.erasureJobs.storageObjectId })
    .from(schema.erasureJobs)
    .where(
      and(
        inArray(schema.erasureJobs.storageObjectId, storageObjectIds),
        erasureInProgressOrBytesGone(),
      ),
    );
  return new Set(rows.map((row) => row.storageObjectId));
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
