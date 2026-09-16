import type { DocumentState } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { classifyDocumentText } from './classification';
import { type Db, first, required, schema } from './db';
import { proposeDocumentName } from './document-naming';
import { type ServiceError, serviceError } from './errors';
import type { DocumentConverterPort } from './extraction';
import { buildProposedName, extensionOf } from './naming';

/**
 * Document intake pipeline (Build Spec §6): quarantine → scan → normalize →
 * extract → awaiting review. Each transition is a small, idempotent,
 * separately-committed step, so a failure leaves a valid resumable state
 * (recoverable) and re-running from any state simply continues. An unsafe scan
 * routes to NEEDS_ATTENTION and never advances to processing.
 *
 * EXTRACTING (master directive §11, Release C) now does real deterministic
 * work: fetch bytes, run text extraction, classify, and propose a filename —
 * persisted as ProcessingRun/ExtractionRun/DocumentClassification/
 * DocumentNameVersion rows. NORMALIZING (Commercial V1 Part 3, EVI-01) now
 * also does real work: enforcing the PRD's "initial configurable limits" a
 * malware scan alone cannot check (50 PDF pages, 40 megapixels per image);
 * see `ContentLimitsPort` below. Genuine content normalization (of the kind
 * a future format-conversion step might do) still does not exist; this
 * state is a bounded-parsing gate, not a conversion step.
 */

export const PIPELINE_VERSION = '1.0.0';

export interface ScanResult {
  readonly safe: boolean;
  readonly detail?: string;
}

export interface MalwareScannerPort {
  /** Identifies which scanner produced a result — persisted on every scan (master directive §7 "PR 3"). */
  readonly name: string;
  readonly version: string;
  scan(input: {
    readonly bucket: 'QUARANTINE' | 'CLEAN';
    readonly objectKey: string;
  }): Promise<ScanResult>;
}

export interface ContentLimitsResult {
  readonly withinLimits: boolean;
  readonly detail?: string;
}

/**
 * EVI-01's "initial configurable limits" a malware scan alone has no reason
 * to enforce (page count, pixel count): a genuinely clean, genuinely
 * well-formed PDF or image can still exceed them. Runs in NORMALIZING,
 * after the scan already confirmed CLEAN: checking an unscanned file's
 * page count would mean parsing untrusted bytes before they are known
 * safe, spending the same "trust the bytes enough to parse them" budget
 * SEC-05's own "bounded parsing" language is about, twice, for no benefit.
 */
export interface ContentLimitsPort {
  /** Identifies which checker produced a result, persisted the same way `MalwareScannerPort.name` is. */
  readonly name: string;
  readonly version: string;
  check(input: {
    readonly bucket: 'QUARANTINE' | 'CLEAN';
    readonly objectKey: string;
  }): Promise<ContentLimitsResult>;
}

export type DocumentVersion = typeof schema.documentVersions.$inferSelect;

/** The pure next-state function for the happy path (unsafe scan handled inline). */
export function nextIntakeState(current: DocumentState): DocumentState | null {
  switch (current) {
    case 'UPLOADING':
      return 'QUARANTINED';
    case 'QUARANTINED':
      return 'SCANNING';
    case 'SCANNING':
      return 'NORMALIZING'; // only when safe; caller diverts unsafe scans
    case 'NORMALIZING':
      return 'EXTRACTING';
    case 'EXTRACTING':
      return 'AWAITING_REVIEW';
    default:
      return null; // terminal / manual states
  }
}

async function loadVersion(db: Db, id: string): Promise<DocumentVersion | undefined> {
  return first(
    await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, id))
      .limit(1),
  );
}

/** Identifies the processing job/lease a `processIntake` run is fenced against — see `stillHoldsLease`. */
export interface IntakeFencing {
  readonly jobId: string;
  readonly leaseOwner: string;
}

/** Re-loads the current DB row, falling back to a caller-supplied stale copy only if the row is somehow gone. */
async function currentOrStale(
  db: Db,
  documentVersionId: string,
  stale: DocumentVersion,
): Promise<DocumentVersion> {
  return (await loadVersion(db, documentVersionId)) ?? stale;
}

/**
 * True if `fencing`'s job is still genuinely `CLAIMED` by `leaseOwner` at
 * this exact moment (finding #19, post-programme defect register).
 *
 * `jobs.ts`'s own lease fencing (`completeJob`/`failJob`'s compare-and-set)
 * only protects the processing JOB row itself; `commitTransition`'s CAS on
 * `processingStatus` only protects that one field. Neither one gates the
 * DOCUMENT-VERSION-LEVEL side-effect writes a pipeline step performs before
 * its own `commitTransition` call — a scan-result row, an extraction/
 * classification/naming-proposal row set — against a lease that was
 * reclaimed WHILE this invocation was paused inside a slow external call
 * (`scanner.scan()`, `extractor.extract()`). A worker in exactly that
 * position can still win the race to insert those rows even after a new
 * lease-holder has already started (or finished) its own, genuinely
 * authoritative pass over the same document version — duplicate or stale
 * scan-history entries, extraction runs, classifications, or name
 * proposals, none of which `commitTransition`'s later CAS can retroactively
 * un-write. Calling this immediately before each such write (never far in
 * advance of it, since a `SELECT`-only check would leave the same TOCTOU
 * gap this exists to close) and skipping the write entirely on a lost lease
 * closes that gap, mirroring the identical fencing discipline
 * `erasure.ts`'s `processErasureJob` already applies around its own slow
 * external call (`blobStore.deleteObject`) via a CAS write immediately
 * before it.
 *
 * Implemented as a CAS no-op UPDATE (matching on `id`/`status`/`leaseOwner`)
 * rather than a plain `SELECT`, so the check and the guarantee it provides
 * are themselves atomic with respect to a concurrent reclaim.
 *
 * **Codex review, PR-C1, round 1**: matching on `id`/`status`/`leaseOwner`
 * alone answers "does the row still nominally say I'm the holder" — it does
 * NOT answer "is my lease still genuinely unexpired." If this invocation's
 * `leaseExpiresAt` has already passed but no OTHER worker has actually
 * called `claimJobs` to reclaim the row yet, the row still shows this
 * invocation's own `leaseOwner`, so the CAS above would still match and
 * return `true` — right up until the moment a reclaim finally happens,
 * which could land in the narrow window between this check returning and
 * the write it was meant to gate. Requiring `leaseExpiresAt` to still be in
 * the future closes that: once a lease's own clock has run out, this
 * invocation stops treating itself as authoritative immediately, rather
 * than gambling on finishing before some other invocation's `claimJobs`
 * call happens to notice. This is the correct, conservative reading of what
 * a time-bound lease means, not an overly strict addition — the whole
 * point of `leaseExpiresAt` is "you only own this until this time," and any
 * invocation (including this one) should honor that the instant it passes,
 * whether or not a reclaim has physically occurred yet. `leaseExpiresAt` is
 * never `NULL` for a job `fencing` ever refers to: `fencing.leaseOwner`
 * only ever comes from a token `claimJobs` itself just generated, and
 * `claimJobs` always sets a real `leaseExpiresAt` when it claims a job (the
 * lease-less-row case finding #21 fixes only ever arises from CODE THAT
 * PREDATES the lease columns entirely, which never threads `fencing`
 * through at all).
 *
 * `fencing` is optional so every existing direct call to `processIntake`
 * (this module's own tests, and any caller outside the job queue) keeps
 * working unchanged — fencing only applies when a caller actually has a
 * lease to fence against.
 *
 * **Codex review, PR-C1, round 2**: round 1's `leaseExpiresAt > now()`
 * addition only checks the condition at ONE instant — it does not hold any
 * lock spanning from that check through the write it guards. Called with
 * the top-level `db` (its own implicit, autocommitting statement), the row
 * lock this `UPDATE` briefly takes is released the moment it returns. A
 * scan/extraction that returns just BEFORE `leaseExpiresAt`, followed by
 * this check passing, followed by the caller's subsequent
 * insert/`proposeDocumentName` call, still leaves a real — if now
 * millisecond-scale rather than lease-duration-scale — gap in which
 * `claimJobs` can reclaim the job and a new invocation can start before
 * this one's guarded write actually happens. **This function's contract
 * now requires callers to invoke it as the FIRST statement inside the SAME
 * `db.transaction(...)` block as every write it's meant to guard** — every
 * call site in this module does. Passing a `tx` (rather than the top-level
 * `db`) means the row lock this `UPDATE` takes is held until that whole
 * transaction commits, not released the instant this one statement
 * finishes: a concurrent `claimJobs` reclaim attempting its own `UPDATE` on
 * the identical row genuinely blocks — waiting on Postgres's own row-level
 * lock, no extra locking primitive of this module's own invention — until
 * this transaction (check + every guarded write) has fully committed or
 * rolled back. That is true serialization against a concurrent reclaim,
 * not merely a narrower instant-in-time check. `document-naming.ts`'s
 * `proposeDocumentName` composes into this correctly because it already
 * opens its own transaction internally, and Drizzle nests a transaction
 * opened from inside another as a savepoint (the identical pattern
 * `documents.ts`'s `registerDocumentWithVersion` already relies on) —
 * calling it with an outer `tx` keeps it inside the SAME held lock, not a
 * separate one.
 */
async function stillHoldsLease(db: Db, fencing: IntakeFencing): Promise<boolean> {
  const touched = await db
    .update(schema.processingJobs)
    .set({ updatedAt: sql`${schema.processingJobs.updatedAt}` })
    .where(
      and(
        eq(schema.processingJobs.id, fencing.jobId),
        eq(schema.processingJobs.status, 'CLAIMED'),
        eq(schema.processingJobs.leaseOwner, fencing.leaseOwner),
        gt(schema.processingJobs.leaseExpiresAt, sql`now()`),
      ),
    )
    .returning({ id: schema.processingJobs.id });
  return touched.length > 0;
}

/**
 * Compare-and-set on `processingStatus`: only takes effect while the version
 * is still in the exact state this caller last observed it in. Returns
 * `undefined` (never throws) if another process already advanced it past
 * that point — normally unreachable (job uniqueness + leasing, master
 * directive §7 "PR 6", ensure at most one worker ever holds a document
 * version's processing job at a time), but this is the backstop for the one
 * scenario leasing alone cannot rule out: a lease that outlives its own
 * expiry because the worker holding it is still genuinely, slowly running
 * (not crashed) when a second worker reclaims and completes the same
 * version. Without this check that second worker's already-correct outcome
 * could be silently overwritten by the first worker's stale, blind write.
 */
async function commitTransition(
  db: Db,
  version: DocumentVersion,
  patch: Partial<{
    processingStatus: DocumentState;
    safetyStatus: DocumentVersion['safetyStatus'];
  }>,
): Promise<DocumentVersion | undefined> {
  return db.transaction(async (tx) => {
    const updated = first(
      await tx
        .update(schema.documentVersions)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(schema.documentVersions.id, version.id),
            eq(schema.documentVersions.processingStatus, version.processingStatus),
          ),
        )
        .returning(),
    );
    if (!updated) return undefined;
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_STATE_CHANGE',
      method: 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'document_version',
      resourceId: version.id,
      metadata: {
        from: version.processingStatus,
        to: updated.processingStatus,
        safety: updated.safetyStatus,
      },
    });
    return updated;
  });
}

/**
 * Run deterministic extraction + classification + naming for one document
 * version and persist the result. Never throws for an expected extraction
 * failure (unsupported format, corrupt file, etc.) — those are recorded on
 * the ProcessingRun/ExtractionRun rows and the pipeline still advances, so a
 * document the deterministic extractor can't handle still reaches
 * AWAITING_REVIEW for manual classification/naming.
 *
 * Returns `'lost-lease'` instead of persisting anything past the initial
 * `processingRuns` row if `fencing` is supplied and no longer holds its
 * lease by the time `extractor.extract()` returns (finding #19, post-
 * programme defect register). The fencing check is the first statement
 * inside the SAME transaction as every write it guards — including the
 * naming proposal — not a standalone check beforehand (Codex review,
 * PR-C1, round 2; see `stillHoldsLease`'s own doc comment for why).
 */
async function runExtractionStep(
  db: Db,
  extractor: DocumentConverterPort,
  version: DocumentVersion,
  fencing?: IntakeFencing,
): Promise<'ok' | 'lost-lease'> {
  const document = first(
    await db
      .select({
        id: schema.documents.id,
        applicantId: schema.documents.applicantId,
        originalName: schema.documents.originalName,
      })
      .from(schema.documents)
      .innerJoin(
        schema.documentVersions,
        eq(schema.documentVersions.documentId, schema.documents.id),
      )
      .where(eq(schema.documentVersions.id, version.id))
      .limit(1),
  );
  if (!document) return 'ok'; // orphaned version; nothing to extract against

  const storageObject = first(
    await db
      .select()
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.id, version.storageObjectId))
      .limit(1),
  );
  if (!storageObject) return 'ok';

  const applicant = first(
    await db
      .select()
      .from(schema.applicants)
      .where(eq(schema.applicants.id, document.applicantId))
      .limit(1),
  );

  const run = required(
    first(
      await db
        .insert(schema.processingRuns)
        .values({ documentVersionId: version.id, pipelineVersion: PIPELINE_VERSION })
        .returning(),
    ),
    'processing run',
  );

  const outcome = await extractor.extract({
    bucket: storageObject.bucket,
    objectKey: storageObject.objectKey,
    originalName: document.originalName,
  });

  if (!outcome.ok) {
    // Fencing check and every write it guards now share ONE transaction
    // (Codex review, PR-C1, round 2) -- see stillHoldsLease's own doc
    // comment for why a standalone check right after extractor.extract()
    // (round 1) still left a narrow gap before the writes it was meant to
    // gate. A lost lease means another worker now owns this job's outcome
    // -- stop before persisting anything past the already-committed
    // processingRuns row (left PENDING/uncompleted; harmless and self-
    // explanatory if ever inspected, no different from any other
    // resumable-mid-step state this pipeline already leaves on a crash).
    const recorded = await db.transaction(async (tx) => {
      if (fencing && !(await stillHoldsLease(tx, fencing))) return false;
      await tx.insert(schema.extractionRuns).values({
        processingRunId: run.id,
        documentVersionId: version.id,
        parserName: 'dispatcher',
        parserVersion: PIPELINE_VERSION,
        status: 'FAILED',
        errorCode: outcome.code,
      });
      await tx
        .update(schema.processingRuns)
        .set({ status: 'FAILED', errorCode: outcome.code, completedAt: new Date() })
        .where(eq(schema.processingRuns.id, run.id));
      await appendAuditEvent(tx, {
        eventType: 'DOCUMENT_EXTRACTION_RUN',
        method: 'SYSTEM',
        result: 'ALLOWED',
        applicantId: document.applicantId,
        resourceType: 'document_version',
        resourceId: version.id,
        metadata: { status: 'FAILED', code: outcome.code },
      });
      return true;
    });
    return recorded ? 'ok' : 'lost-lease';
  }

  const { result } = outcome;
  const classification = classifyDocumentText(result.text);

  // Same fencing-check-plus-every-write transaction on the success path
  // (Codex review, PR-C1, round 2) -- including the naming proposal,
  // which used to happen in its own later, separate call outside any
  // transaction (exactly the additional gap the round-2 finding called
  // out by name). proposeDocumentName opens its own transaction
  // internally; called with this outer tx (rather than the top-level db),
  // Drizzle nests it as a savepoint within the SAME transaction -- the
  // identical pattern documents.ts's registerDocumentWithVersion already
  // relies on -- so it stays inside the one lock this whole function holds
  // from the fencing check through its very last write.
  const recorded = await db.transaction(async (tx) => {
    if (fencing && !(await stillHoldsLease(tx, fencing))) return false;
    const extractionRun = required(
      first(
        await tx
          .insert(schema.extractionRuns)
          .values({
            processingRunId: run.id,
            documentVersionId: version.id,
            parserName: result.parserName,
            parserVersion: result.parserVersion,
            status: 'SUCCEEDED',
            extractedText: result.text,
            truncated: result.truncated,
            pageCount: result.pageCount,
            confidence: classification.confidence,
            warnings: result.warnings,
          })
          .returning(),
      ),
      'extraction run',
    );

    await tx.insert(schema.documentClassifications).values({
      extractionRunId: extractionRun.id,
      documentVersionId: version.id,
      classifiedType: classification.classifiedType,
      confidence: classification.confidence,
      reviewRequired: classification.reviewRequired,
      rationale: classification.rationale,
    });

    await tx
      .update(schema.processingRuns)
      .set({ status: 'COMPLETED', completedAt: new Date() })
      .where(eq(schema.processingRuns.id, run.id));

    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_EXTRACTION_RUN',
      method: 'SYSTEM',
      result: 'ALLOWED',
      applicantId: document.applicantId,
      resourceType: 'document_version',
      resourceId: version.id,
      metadata: {
        status: 'SUCCEEDED',
        classifiedType: classification.classifiedType,
        confidence: classification.confidence,
      },
    });

    // A filename proposal only when classification cleared review (never
    // proposes a name built on a guessed type).
    if (classification.classifiedType && !classification.reviewRequired) {
      const proposedName = buildProposedName({
        classifiedType: classification.classifiedType,
        primarySubject: applicant?.displayName ?? 'Unknown',
        ...(classification.mrz ? { issuerOrContext: classification.mrz.issuingCountry } : {}),
        ...(classification.mrz
          ? { relevantDateOrPeriod: `Expires ${classification.mrz.expiryDate}` }
          : {}),
        extension: extensionOf(document.originalName),
      });
      await proposeDocumentName(tx, {
        documentId: document.id,
        proposedName,
      });
    }
    return true;
  });
  return recorded ? 'ok' : 'lost-lease';
}

/**
 * The most recent successfully deterministically-extracted text for a
 * document version (AI Gateway input — packages/services/src/ai.ts). Returns
 * undefined if extraction never succeeded (e.g. `unsupported_format`), in
 * which case there is nothing grounded to hand the AI adapter.
 */
export async function getLatestExtractedText(
  db: Db,
  documentVersionId: string,
): Promise<string | undefined> {
  const row = first(
    await db
      .select({ text: schema.extractionRuns.extractedText })
      .from(schema.extractionRuns)
      .where(
        and(
          eq(schema.extractionRuns.documentVersionId, documentVersionId),
          eq(schema.extractionRuns.status, 'SUCCEEDED'),
        ),
      )
      .orderBy(desc(schema.extractionRuns.createdAt))
      .limit(1),
  );
  return row?.text ?? undefined;
}

export type DocumentScanResult = typeof schema.documentScanResults.$inferSelect;

/** The full scan history for a document version, newest first (master directive §7 "PR 3"). */
export async function listScanResults(
  db: Db,
  documentVersionId: string,
): Promise<DocumentScanResult[]> {
  const rows = await db
    .select()
    .from(schema.documentScanResults)
    .where(eq(schema.documentScanResults.documentVersionId, documentVersionId));
  return [...rows].sort((a, b) => b.scannedAt.getTime() - a.scannedAt.getTime());
}

/**
 * Drive a document version through the intake pipeline to a terminal state
 * (AWAITING_REVIEW on success, NEEDS_ATTENTION on an unsafe scan). Idempotent:
 * calling it on an already-terminal version is a no-op.
 */
export async function processIntake(
  db: Db,
  scanner: MalwareScannerPort,
  extractor: DocumentConverterPort,
  contentLimits: ContentLimitsPort,
  input: {
    readonly documentVersionId: string;
    /** Fences this run's side-effect writes against a mid-pipeline lease loss — see `stillHoldsLease`. Omit for a direct (non-job-queue) call. */
    readonly fencing?: IntakeFencing;
  },
): Promise<Result<DocumentVersion, ServiceError>> {
  let version = await loadVersion(db, input.documentVersionId);
  if (!version) return err(serviceError('not_found', 'document version not found'));

  // Bounded loop: at most one pass through the linear pipeline.
  for (let guard = 0; guard < 8; guard++) {
    // Cheap early exit: catches a lease already lost before this iteration
    // even begins. Deliberately NOT wrapped with a subsequent write in one
    // transaction the way the SCANNING/EXTRACTING branches' own checks are
    // (Codex review, PR-C1, round 2) -- a PLAIN transition's only write is
    // commitTransition's own processingStatus CAS, which is already
    // race-safe by construction regardless of lease state: two workers
    // racing the identical "from" status each get an ordinary Postgres
    // row-level UPDATE race, the loser's CAS cleanly matches zero rows, and
    // there is no side-effect write of any kind to duplicate or corrupt (the
    // property finding #19 protects). This check is a best-effort, purely
    // advisory "stop doing wasted work" -- not a correctness boundary the
    // way the SCANNING/EXTRACTING transactions are.
    if (input.fencing && !(await stillHoldsLease(db, input.fencing))) {
      return ok(await currentOrStale(db, input.documentVersionId, version));
    }
    const state = version.processingStatus;

    if (state === 'SCANNING') {
      const storageObject = first(
        await db
          .select()
          .from(schema.storageObjects)
          .where(eq(schema.storageObjects.id, version.storageObjectId))
          .limit(1),
      );
      if (!storageObject) return err(serviceError('not_found', 'stored object missing'));
      // Captured once as a plain, non-reassignable local: `version` itself
      // is a `let` reassigned elsewhere in this loop, so TypeScript can't
      // carry its narrowed (non-undefined) type across the nested
      // `db.transaction(async (tx) => {...})` closures below.
      const documentVersionId = version.id;
      // If the scanner throws, the version stays in SCANNING and is
      // resumable — but a throw used to skip the documentScanResults insert
      // entirely, leaving no durable trace an attempt was ever made (Codex
      // review, PR-B3, finding #10): listScanResults() couldn't distinguish
      // "never scanned" from "repeatedly failed to scan." A failure row is
      // now recorded before the error propagates, then the SAME error is
      // rethrown unchanged — this doesn't change the resumability contract,
      // only makes the failed attempt visible.
      let result: ScanResult;
      try {
        result = await scanner.scan({
          bucket: storageObject.bucket,
          objectKey: storageObject.objectKey,
        });
      } catch (error) {
        // Fencing check and the scanErrored insert it guards now share ONE
        // transaction (Codex review, PR-C1, round 2) -- see stillHoldsLease's
        // own doc comment for why a standalone, autocommitting check alone
        // (round 1) still left a narrow gap between "confirmed the lease was
        // valid" and "performed the write." The row lock stillHoldsLease's
        // UPDATE takes is now held for the insert too, genuinely blocking a
        // concurrent claimJobs reclaim of this exact row until this whole
        // transaction commits. Can't rethrow the original scanner error from
        // INSIDE the callback -- that would roll back the very insert this
        // is trying to durably commit -- so the callback returns a plain
        // boolean and the error is rethrown afterward, once committed.
        const recorded = await db.transaction(async (tx) => {
          if (input.fencing && !(await stillHoldsLease(tx, input.fencing))) return false;
          // scanErrored: true marks this as an indeterminate/error outcome,
          // not a genuine unsafe verdict (Codex review, PR-B3R, round 1) --
          // `safe: false` alone is indistinguishable from a real "the
          // scanner examined this and found it unsafe" result, so a later,
          // successful retry would otherwise leave a false unsafe entry
          // sitting in listScanResults()/exported scan history forever.
          await tx.insert(schema.documentScanResults).values({
            documentVersionId,
            scannerName: scanner.name,
            scannerVersion: scanner.version,
            scanErrored: true,
            safe: false,
            detail: `scan threw: ${error instanceof Error ? error.message : String(error)}`.slice(
              0,
              2000,
            ),
          });
          return true;
        });
        // Lost lease: don't rethrow (that would reach runIntakeWorker's
        // catch block and call failJob, whose own CAS would harmlessly
        // no-op anyway, but throwing here would also misreport this as a
        // domain failure rather than a benign handoff).
        if (!recorded) {
          return ok(await currentOrStale(db, input.documentVersionId, version));
        }
        throw error;
      }
      // Same fencing-check-plus-write transaction on the success path
      // (Codex review, PR-C1, round 2), for the identical reason.
      const scanRecorded = await db.transaction(async (tx) => {
        if (input.fencing && !(await stillHoldsLease(tx, input.fencing))) return false;
        // Durable, append-only evidence of every scan attempt (master
        // directive §7 "PR 3"): which scanner, which version, when, and the
        // result — distinct from documentVersions.safetyStatus (the current
        // state derived from the latest row here). A retried scan adds a
        // new row rather than overwriting the last attempt.
        await tx.insert(schema.documentScanResults).values({
          documentVersionId,
          scannerName: scanner.name,
          scannerVersion: scanner.version,
          safe: result.safe,
          detail: result.detail ?? null,
        });
        return true;
      });
      if (!scanRecorded) {
        return ok(await currentOrStale(db, input.documentVersionId, version));
      }
      const scanned = await commitTransition(db, version, {
        processingStatus: result.safe ? 'NORMALIZING' : 'NEEDS_ATTENTION',
        safetyStatus: result.safe ? 'CLEAN' : 'QUARANTINED',
      });
      // Lost the CAS race (see commitTransition's doc comment): another
      // process already advanced this version past what we last observed.
      // Its outcome is the correct, final one — stop here rather than
      // overwrite it with our now-stale result.
      if (!scanned) return ok(await currentOrStale(db, input.documentVersionId, version));
      version = scanned;
      continue;
    }

    if (state === 'NORMALIZING') {
      const storageObject = first(
        await db
          .select()
          .from(schema.storageObjects)
          .where(eq(schema.storageObjects.id, version.storageObjectId))
          .limit(1),
      );
      if (!storageObject) return err(serviceError('not_found', 'stored object missing'));
      const documentVersionId = version.id;
      // Same throw/resumability contract as the SCANNING branch above: a
      // thrown error leaves the version in NORMALIZING (resumable), and the
      // failed attempt is still durably recorded (reusing
      // documentScanResults, distinguished by scannerName, rather than a
      // parallel table; see AD-08) before the error propagates.
      let result: ContentLimitsResult;
      try {
        result = await contentLimits.check({
          bucket: storageObject.bucket,
          objectKey: storageObject.objectKey,
        });
      } catch (error) {
        const recorded = await db.transaction(async (tx) => {
          if (input.fencing && !(await stillHoldsLease(tx, input.fencing))) return false;
          await tx.insert(schema.documentScanResults).values({
            documentVersionId,
            scannerName: contentLimits.name,
            scannerVersion: contentLimits.version,
            scanErrored: true,
            safe: false,
            detail:
              `content-limits check threw: ${error instanceof Error ? error.message : String(error)}`.slice(
                0,
                2000,
              ),
          });
          return true;
        });
        if (!recorded) {
          return ok(await currentOrStale(db, input.documentVersionId, version));
        }
        throw error;
      }
      const checkRecorded = await db.transaction(async (tx) => {
        if (input.fencing && !(await stillHoldsLease(tx, input.fencing))) return false;
        await tx.insert(schema.documentScanResults).values({
          documentVersionId,
          scannerName: contentLimits.name,
          scannerVersion: contentLimits.version,
          safe: result.withinLimits,
          detail: result.detail ?? null,
        });
        return true;
      });
      if (!checkRecorded) {
        return ok(await currentOrStale(db, input.documentVersionId, version));
      }
      const normalized = await commitTransition(db, version, {
        processingStatus: result.withinLimits ? 'EXTRACTING' : 'NEEDS_ATTENTION',
      });
      if (!normalized) return ok(await currentOrStale(db, input.documentVersionId, version));
      version = normalized;
      continue;
    }

    if (state === 'EXTRACTING') {
      // If this throws, the version stays in EXTRACTING and is resumable —
      // same recoverability contract as the scanner step above.
      const extractionStep = await runExtractionStep(db, extractor, version, input.fencing);
      // Lease lost partway through extraction (finding #19) -- its own
      // side-effect writes were already skipped inside runExtractionStep;
      // stop here too, rather than also attempting the transition below.
      if (extractionStep === 'lost-lease') {
        return ok(await currentOrStale(db, input.documentVersionId, version));
      }
      const extracted = await commitTransition(db, version, {
        processingStatus: 'AWAITING_REVIEW',
      });
      if (!extracted) return ok(await currentOrStale(db, input.documentVersionId, version));
      version = extracted;
      continue;
    }

    const next = nextIntakeState(state);
    if (next === null) break; // terminal (incl. AWAITING_REVIEW / NEEDS_ATTENTION)
    const advanced = await commitTransition(db, version, {
      processingStatus: next,
      ...(next === 'SCANNING' ? { safetyStatus: 'SCANNING' as const } : {}),
    });
    if (!advanced) return ok(await currentOrStale(db, input.documentVersionId, version));
    version = advanced;
  }

  return ok(version);
}
