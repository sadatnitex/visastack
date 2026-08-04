import type { DocumentState } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq } from 'drizzle-orm';
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
 * DocumentNameVersion rows. NORMALIZING remains a pass-through: no real
 * normalization work exists yet, and this is stated here rather than implied.
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
 */
async function runExtractionStep(
  db: Db,
  extractor: DocumentConverterPort,
  version: DocumentVersion,
): Promise<void> {
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
  if (!document) return; // orphaned version; nothing to extract against

  const storageObject = first(
    await db
      .select()
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.id, version.storageObjectId))
      .limit(1),
  );
  if (!storageObject) return;

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
    await db.transaction(async (tx) => {
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
    });
    return;
  }

  const { result } = outcome;
  const classification = classifyDocumentText(result.text);

  await db.transaction(async (tx) => {
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
    await proposeDocumentName(db, {
      documentId: document.id,
      proposedName,
    });
  }
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
  input: { readonly documentVersionId: string },
): Promise<Result<DocumentVersion, ServiceError>> {
  let version = await loadVersion(db, input.documentVersionId);
  if (!version) return err(serviceError('not_found', 'document version not found'));

  // Bounded loop: at most one pass through the linear pipeline.
  for (let guard = 0; guard < 8; guard++) {
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
        // scanErrored: true marks this as an indeterminate/error outcome,
        // not a genuine unsafe verdict (Codex review, PR-B3R, round 1) --
        // `safe: false` alone is indistinguishable from a real "the scanner
        // examined this and found it unsafe" result, so a later, successful
        // retry would otherwise leave a false unsafe entry sitting in
        // listScanResults()/exported scan history forever.
        await db.insert(schema.documentScanResults).values({
          documentVersionId: version.id,
          scannerName: scanner.name,
          scannerVersion: scanner.version,
          scanErrored: true,
          safe: false,
          detail: `scan threw: ${error instanceof Error ? error.message : String(error)}`.slice(
            0,
            2000,
          ),
        });
        throw error;
      }
      // Durable, append-only evidence of every scan attempt (master
      // directive §7 "PR 3"): which scanner, which version, when, and the
      // result — distinct from documentVersions.safetyStatus (the current
      // state derived from the latest row here). A retried scan adds a new
      // row rather than overwriting the last attempt.
      await db.insert(schema.documentScanResults).values({
        documentVersionId: version.id,
        scannerName: scanner.name,
        scannerVersion: scanner.version,
        safe: result.safe,
        detail: result.detail ?? null,
      });
      const scanned = await commitTransition(db, version, {
        processingStatus: result.safe ? 'NORMALIZING' : 'NEEDS_ATTENTION',
        safetyStatus: result.safe ? 'CLEAN' : 'QUARANTINED',
      });
      // Lost the CAS race (see commitTransition's doc comment): another
      // process already advanced this version past what we last observed.
      // Its outcome is the correct, final one — stop here rather than
      // overwrite it with our now-stale result.
      if (!scanned) return ok((await loadVersion(db, input.documentVersionId)) ?? version);
      version = scanned;
      continue;
    }

    if (state === 'EXTRACTING') {
      // If this throws, the version stays in EXTRACTING and is resumable —
      // same recoverability contract as the scanner step above.
      await runExtractionStep(db, extractor, version);
      const extracted = await commitTransition(db, version, {
        processingStatus: 'AWAITING_REVIEW',
      });
      if (!extracted) return ok((await loadVersion(db, input.documentVersionId)) ?? version);
      version = extracted;
      continue;
    }

    const next = nextIntakeState(state);
    if (next === null) break; // terminal (incl. AWAITING_REVIEW / NEEDS_ATTENTION)
    const advanced = await commitTransition(db, version, {
      processingStatus: next,
      ...(next === 'SCANNING' ? { safetyStatus: 'SCANNING' as const } : {}),
    });
    if (!advanced) return ok((await loadVersion(db, input.documentVersionId)) ?? version);
    version = advanced;
  }

  return ok(version);
}
