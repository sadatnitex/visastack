import { and, desc, eq } from 'drizzle-orm';
import { DEFAULT_DOCUMENT_PROTECTION, SystemScope, isRestrictedDocumentType } from './access';
import { loadDocumentProtectionSettings } from './access/restricted-documents';
import {
  type AiExtractionPort,
  type RunExtractionInput,
  type RunOcrInput,
  runExtraction,
  runOcr,
} from './ai';
import { isAiDispatchAllowed } from './ai-provider-config';
import { READER_VERSION, type ReadingStopReason } from './ai-reading-job';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, schema } from './db';
import { getDocumentTypeOfVersion } from './documents';
import type { ServiceError } from './errors';
import { getLatestReadableText } from './intake';
import type { AiOcrPort, OcrSourceImageOutcome } from './ocr';

/**
 * Automatic AI reading of one file version (S5, ADR 0019). It runs from the durable queue, under
 * the scope of the `process-ai-reading` job and nobody else's, and does the same two things the
 * manual buttons do, in the owner's name and under the owner's consent:
 *
 * 1. If no usable text exists and the file can be read as an image, AI OCR (needs `AI_OCR`).
 * 2. AI extraction over the best text there is (needs `AI_EXTRACTION`).
 *
 * Both only propose details; nothing is written to the profile without the person's approval. The
 * existing budgets, caps, cache keys, kill switch and fallback provider apply unchanged, because
 * the steps are `runOcr` and `runExtraction` themselves.
 *
 * Security invariants:
 * - The acting owner is derived from the file version (version, document, applicant). Nothing the
 *   job row says about who it is for is trusted, and nothing outside the version is read.
 * - Consent is checked for that owner when the job runs, not when it was queued, so withdrawing it
 *   stops a queued job.
 * - No document text is logged or audited: the summary event holds kinds and counts only.
 */

/** The six operating limits the AI steps run under (the same values the manual buttons use). */
export interface ReadingLimits {
  readonly budgetLimitUnits: number;
  readonly perDocumentBudgetLimitUnits: number;
  readonly maxAttemptsPerDocument: number;
  readonly maxPagesPerDocument: number;
  readonly cacheMaxAgeDays: number;
  readonly maxConcurrentCalls: number;
}

/**
 * What the web app supplies, because the providers, their keys and the file storage are resolved
 * there. Each resolver answers undefined when nothing usable is configured; the web side should
 * resolve lazily and once, since a job pass can read several files.
 */
export interface AiReadingPorts {
  extraction(): Promise<
    | {
        readonly ai: AiExtractionPort;
        readonly limits: ReadingLimits;
        readonly fallback?: { readonly ai: AiExtractionPort };
      }
    | undefined
  >;
  ocr(): Promise<
    | {
        readonly ai: AiOcrPort;
        readonly limits: ReadingLimits;
        readonly fallback?: { readonly ai: AiOcrPort };
      }
    | undefined
  >;
  /** The first page of the file as an image, for AI OCR. */
  renderImage(documentVersionId: string, applicantId: string): Promise<OcrSourceImageOutcome>;
  /** Registers the fields this kind of document carries, so the AI is offered them. Safe to repeat. */
  prepareFields(documentVersionId: string): Promise<void>;
}

export interface AiReadingResult {
  /** READ: every step that could run did. STOPPED: a step could not run (see `stopReason`). SKIPPED: nothing to do for this file. */
  readonly outcome: 'READ' | 'STOPPED' | 'SKIPPED';
  readonly stopReason?: ReadingStopReason;
  readonly ranOcr: boolean;
  readonly ranExtraction: boolean;
  /** How many suggestions the AI extraction stored. */
  readonly suggestions: number;
}

const IN_PROGRESS_STATES = ['UPLOADING', 'QUARANTINED', 'SCANNING', 'NORMALIZING', 'EXTRACTING'];

interface ReadingTarget {
  readonly versionId: string;
  readonly applicantId: string;
  readonly ownerAccountId: string;
  readonly safetyStatus: string;
  readonly processingStatus: string;
  readonly isLatestVersion: boolean;
}

/** The file version and, from it alone, the applicant and the owner it belongs to. */
async function loadReadingTarget(
  db: Db,
  documentVersionId: string,
): Promise<ReadingTarget | undefined> {
  const row = first(
    await db
      .select({
        versionId: schema.documentVersions.id,
        documentId: schema.documentVersions.documentId,
        versionNumber: schema.documentVersions.versionNumber,
        safetyStatus: schema.documentVersions.safetyStatus,
        processingStatus: schema.documentVersions.processingStatus,
        applicantId: schema.documents.applicantId,
        ownerAccountId: schema.applicants.ownerAccountId,
      })
      .from(schema.documentVersions)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
      .innerJoin(schema.applicants, eq(schema.applicants.id, schema.documents.applicantId))
      .where(eq(schema.documentVersions.id, documentVersionId))
      .limit(1),
  );
  if (!row) return undefined;
  const newest = first(
    await db
      .select({ versionNumber: schema.documentVersions.versionNumber })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, row.documentId))
      .orderBy(desc(schema.documentVersions.versionNumber))
      .limit(1),
  );
  return {
    versionId: row.versionId,
    applicantId: row.applicantId,
    ownerAccountId: row.ownerAccountId,
    safetyStatus: row.safetyStatus,
    processingStatus: row.processingStatus,
    isLatestVersion: (newest?.versionNumber ?? row.versionNumber) === row.versionNumber,
  };
}

/**
 * True when suggestions were already read for this version, by AI or by the passport's
 * machine-readable lines. A repeated job never lists the same details twice, and an AI reading of
 * a passport that already has its lines read would only compete with them.
 */
async function alreadyHasSuggestions(db: Db, documentVersionId: string): Promise<boolean> {
  const row = first(
    await db
      .select({ id: schema.aiExtractionRuns.id })
      .from(schema.aiExtractionRuns)
      .where(
        and(
          eq(schema.aiExtractionRuns.documentVersionId, documentVersionId),
          eq(schema.aiExtractionRuns.status, 'SUCCEEDED'),
        ),
      )
      .limit(1),
  );
  return row !== undefined;
}

/**
 * Turns a refusal from an AI step into the reason shown to the person, or throws when the right
 * response is to try again later (a busy provider or a per-person rate limit).
 */
async function reasonForRefusal(db: Db, error: ServiceError): Promise<ReadingStopReason | 'SKIP'> {
  switch (error.code) {
    case 'consent_required':
      return 'NO_CONSENT';
    case 'not_found':
      return 'SKIP';
    case 'rate_limited':
      // Not a final answer: the queue retries with a growing delay.
      throw new Error('AI reading is busy; trying again shortly');
    case 'invalid':
      // The kill switch and the budget, attempt and page limits all arrive as a refusal.
      return (await isAiDispatchAllowed(db)) ? 'LIMIT_REACHED' : 'SWITCHED_OFF';
    default:
      return 'COULD_NOT_READ';
  }
}

/**
 * Reads one file version. Throws only when the queue should try again (the file is still being
 * checked, or the provider is busy); every other outcome is a result the job records.
 */
export async function processAiReading(
  db: Db,
  scope: SystemScope<'process-ai-reading'>,
  ports: AiReadingPorts,
  input: { readonly documentVersionId: string },
): Promise<AiReadingResult> {
  // A type alone does not stop a cast object at run time.
  if (!SystemScope.isGenuine(scope) || scope.job !== 'process-ai-reading') {
    throw new Error('automatic reading needs the scope of its own job');
  }
  const skipped: AiReadingResult = {
    outcome: 'SKIPPED',
    ranOcr: false,
    ranExtraction: false,
    suggestions: 0,
  };
  const target = await loadReadingTarget(db, input.documentVersionId);
  if (!target || target.safetyStatus !== 'CLEAN') return skipped;
  if (IN_PROGRESS_STATES.includes(target.processingStatus)) {
    throw new Error('the file is still being checked');
  }
  // Only a file that opened for review is read, and only the newest copy of a document.
  if (!['AWAITING_REVIEW', 'APPROVED'].includes(target.processingStatus)) return skipped;
  if (!target.isLatestVersion) return skipped;

  const audited = async (result: AiReadingResult): Promise<AiReadingResult> => {
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'AI_READING_JOB',
        method: 'SYSTEM',
        result: 'ALLOWED',
        applicantId: target.applicantId,
        resourceType: 'document_version',
        resourceId: target.versionId,
        // Kinds and counts only, never text.
        metadata: {
          outcome: result.outcome,
          stopReason: result.stopReason ?? null,
          ranOcr: result.ranOcr,
          ranExtraction: result.ranExtraction,
          suggestions: result.suggestions,
          readerVersion: READER_VERSION,
        },
      });
    });
    return result;
  };
  const stopped = (
    stopReason: ReadingStopReason,
    progress: Partial<Pick<AiReadingResult, 'ranOcr' | 'ranExtraction' | 'suggestions'>> = {},
  ) =>
    audited({
      outcome: 'STOPPED',
      stopReason,
      ranOcr: progress.ranOcr ?? false,
      ranExtraction: progress.ranExtraction ?? false,
      suggestions: progress.suggestions ?? 0,
    });

  // Consent is the owner's, checked now.
  const mayReadScans = await hasConsent(db, target.ownerAccountId, 'AI_OCR');
  const mayReadDetails = await hasConsent(db, target.ownerAccountId, 'AI_EXTRACTION');
  if (!mayReadScans && !mayReadDetails) return stopped('NO_CONSENT');
  if (!(await isAiDispatchAllowed(db))) return stopped('SWITCHED_OFF');

  // A kind of document on the protected list is only ever read when the person asks. If the
  // switches cannot be read, every document counts as protected.
  const protection = await loadDocumentProtectionSettings(db, DEFAULT_DOCUMENT_PROTECTION);
  const kind = await getDocumentTypeOfVersion(db, target.versionId);
  if (isRestrictedDocumentType(kind, protection)) return stopped('PROTECTED');

  const killSwitchCheck = () => isAiDispatchAllowed(db);
  let ranOcr = false;
  let text = await getLatestReadableText(db, scope, target.versionId, target.applicantId);

  if (!text) {
    // Nothing to start from: read the picture, if the owner allows it and the file is an image.
    if (!mayReadScans) return stopped('NO_CONSENT');
    const ocr = await ports.ocr();
    if (!ocr) return stopped('SWITCHED_OFF');
    const image = await ports.renderImage(target.versionId, target.applicantId);
    if (!image.ok) {
      // A file that is not image-shaped (a Word file, plain text) has nothing to read this way.
      if (image.code === 'unsupported_format') return stopped('NOTHING_TO_READ');
      throw new Error(`the picture could not be prepared (${image.code})`);
    }
    const ocrInput: RunOcrInput = {
      actorAccountId: target.ownerAccountId,
      applicantId: target.applicantId,
      documentVersionId: target.versionId,
      imageBytes: image.imageBytes,
      contentType: image.contentType,
      budgetLimitUnits: ocr.limits.budgetLimitUnits,
      perDocumentBudgetLimitUnits: ocr.limits.perDocumentBudgetLimitUnits,
      maxAttemptsPerDocument: ocr.limits.maxAttemptsPerDocument,
      cacheMaxAgeDays: ocr.limits.cacheMaxAgeDays,
      maxConcurrentCalls: ocr.limits.maxConcurrentCalls,
      killSwitchCheck,
      ...(ocr.fallback ? { fallback: ocr.fallback } : {}),
    };
    const ocrRun = await runOcr(db, ocr.ai, ocrInput);
    if (!ocrRun.ok) {
      const reason = await reasonForRefusal(db, ocrRun.error);
      return reason === 'SKIP' ? skipped : stopped(reason);
    }
    ranOcr = true;
    text = await getLatestReadableText(db, scope, target.versionId, target.applicantId);
    if (!text) return stopped('NOTHING_TO_READ', { ranOcr });
  }

  // The text is in hand; reading details out of it needs the other consent.
  if (!mayReadDetails) return stopped('NO_CONSENT', { ranOcr });
  // One reading per file (see alreadyHasSuggestions).
  if (await alreadyHasSuggestions(db, target.versionId)) {
    return audited({ outcome: 'READ', ranOcr, ranExtraction: false, suggestions: 0 });
  }
  const extraction = await ports.extraction();
  if (!extraction) return stopped('SWITCHED_OFF', { ranOcr });
  await ports.prepareFields(target.versionId);
  const extractionInput: RunExtractionInput = {
    actorAccountId: target.ownerAccountId,
    applicantId: target.applicantId,
    documentVersionId: target.versionId,
    text: text.text,
    budgetLimitUnits: extraction.limits.budgetLimitUnits,
    perDocumentBudgetLimitUnits: extraction.limits.perDocumentBudgetLimitUnits,
    maxAttemptsPerDocument: extraction.limits.maxAttemptsPerDocument,
    maxPagesPerDocument: extraction.limits.maxPagesPerDocument,
    cacheMaxAgeDays: extraction.limits.cacheMaxAgeDays,
    maxConcurrentCalls: extraction.limits.maxConcurrentCalls,
    killSwitchCheck,
    ...(extraction.fallback ? { fallback: extraction.fallback } : {}),
  };
  const run = await runExtraction(db, extraction.ai, extractionInput);
  if (!run.ok) {
    const reason = await reasonForRefusal(db, run.error);
    return reason === 'SKIP' ? skipped : stopped(reason, { ranOcr });
  }
  return audited({
    outcome: 'READ',
    ranOcr,
    ranExtraction: true,
    suggestions: run.value.proposals.length,
  });
}
