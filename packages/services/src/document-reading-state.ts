import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { AuthorizedApplicant } from './access';
import { type ReadingStopReason, isAiReadingKey, isReadingStopReason } from './ai-reading-job';
import { isDeterministicModelVersion } from './ai-run-kinds';
import { schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * What the documents page says about a file's reading (S6, ADR 0019). The words live on the web
 * side; this module decides which of the five states a file is in and where each suggestion came
 * from, from records only. It reads kinds and counts, never text.
 */

export const READING_STAGES = [
  /** Being scanned or checked for safety. */
  'checking',
  /** Being read: text is being taken out, or an automatic AI reading is queued or running. */
  'reading',
  /** Read, with suggestions waiting for the person. */
  'found',
  /** Read, and nothing was found; the person adds the details. */
  'could_not_read',
  /** Held, refused or failed; the existing reasons apply. */
  'needs_attention',
  /** Read, and every suggestion has been decided. */
  'done',
] as const;
export type ReadingStage = (typeof READING_STAGES)[number];

/** Why nothing was found: a stop reason from the automatic reading, or just that nothing was there. */
export type NotReadReason = ReadingStopReason | 'NOTHING_FOUND';

export interface DocumentReadingState {
  readonly stage: ReadingStage;
  /** Set only for `could_not_read`. */
  readonly reason?: NotReadReason;
}

export interface ReadingStateFacts {
  readonly safetyStatus: string;
  readonly processingStatus: string;
  /** The newest automatic reading for the file, if one was ever queued. */
  readonly readingJob?: {
    readonly status: 'PENDING' | 'CLAIMED' | 'DONE' | 'FAILED';
    readonly errorCode: string | null;
  };
  readonly pendingSuggestions: number;
  readonly decidedSuggestions: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STILL_CHECKING = ['UPLOADING', 'QUARANTINED', 'SCANNING', 'NORMALIZING'];
const NEEDS_ATTENTION = ['NEEDS_ATTENTION', 'FAILED', 'REJECTED'];

/** The one rule that turns a file's records into a state. Pure. */
export function deriveReadingState(facts: ReadingStateFacts): DocumentReadingState {
  if (facts.safetyStatus === 'QUARANTINED' || NEEDS_ATTENTION.includes(facts.processingStatus)) {
    return { stage: 'needs_attention' };
  }
  if (STILL_CHECKING.includes(facts.processingStatus)) return { stage: 'checking' };
  if (facts.processingStatus === 'EXTRACTING') return { stage: 'reading' };
  // Opened for review (AWAITING_REVIEW or APPROVED).
  const job = facts.readingJob;
  if (job && (job.status === 'PENDING' || job.status === 'CLAIMED')) return { stage: 'reading' };
  if (facts.pendingSuggestions > 0) return { stage: 'found' };
  if (facts.decidedSuggestions > 0) return { stage: 'done' };
  if (job?.status === 'FAILED') return { stage: 'could_not_read', reason: 'COULD_NOT_READ' };
  const stopReason = job && isReadingStopReason(job.errorCode) ? job.errorCode : undefined;
  return { stage: 'could_not_read', reason: stopReason ?? 'NOTHING_FOUND' };
}

/** Where a suggestion came from, in the three plain ways the page names. */
export const READING_SOURCES = [
  /** The passport's machine-readable lines, read by fixed rules. */
  'machine_readable',
  /** The document's own text (typed text, or text read on our side), interpreted for details. */
  'document_text',
  /** The picture of the file, read by an AI provider. */
  'ai_image',
] as const;
export type ReadingSource = (typeof READING_SOURCES)[number];

export interface DocumentReadingStates {
  /** By file version id. A version with no row here has no state to show. */
  readonly states: ReadonlyMap<string, DocumentReadingState>;
  /** By the id of the reading run a suggestion belongs to (`field_proposals.ai_extraction_run_id`). */
  readonly sourceOfRun: ReadonlyMap<string, ReadingSource>;
}

/**
 * The reading state of each given file version, and the source of every reading run on them, for
 * the owner's own documents page. Owner only, and only versions of this traveller record: an id
 * from anywhere else is simply left out. Bounded by the versions asked about (one per document).
 */
export async function listDocumentReadingStates(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
  documentVersionIds: readonly string[],
): Promise<Result<DocumentReadingStates, ServiceError>> {
  if (access.actor.kind !== 'applicant_owner') {
    return err(serviceError('forbidden', 'only the owner can see how a file was read'));
  }
  // Anything that is not an id is dropped before it reaches the database.
  const ids = [...new Set(documentVersionIds)].filter((id) => UUID.test(id));
  if (ids.length === 0) return ok({ states: new Map(), sourceOfRun: new Map() });
  const db = access.tx;
  const applicantId = access.applicant.id;

  const own = await db
    .select({
      id: schema.documentVersions.id,
      safetyStatus: schema.documentVersions.safetyStatus,
      processingStatus: schema.documentVersions.processingStatus,
    })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(
      // Only this traveller's own versions, whatever ids were asked for.
      and(inArray(schema.documentVersions.id, ids), eq(schema.documents.applicantId, applicantId)),
    );
  if (own.length === 0) return ok({ states: new Map(), sourceOfRun: new Map() });
  const ownIds = own.map((version) => version.id);

  const jobs = await db
    .select({
      documentVersionId: schema.processingJobs.documentVersionId,
      status: schema.processingJobs.status,
      errorCode: schema.processingJobs.errorCode,
      idempotencyKey: schema.processingJobs.idempotencyKey,
    })
    .from(schema.processingJobs)
    .where(inArray(schema.processingJobs.documentVersionId, ownIds))
    .orderBy(desc(schema.processingJobs.createdAt));
  const newestJob = new Map<string, NonNullable<ReadingStateFacts['readingJob']>>();
  for (const job of jobs) {
    if (!isAiReadingKey(job.idempotencyKey) || newestJob.has(job.documentVersionId)) {
      continue;
    }
    newestJob.set(job.documentVersionId, { status: job.status, errorCode: job.errorCode });
  }

  const proposals = await db
    .select({
      documentVersionId: schema.fieldProposals.documentVersionId,
      status: schema.fieldProposals.status,
    })
    .from(schema.fieldProposals)
    .where(inArray(schema.fieldProposals.documentVersionId, ownIds));
  const pending = new Map<string, number>();
  const decided = new Map<string, number>();
  for (const proposal of proposals) {
    const bucket = proposal.status === 'PENDING' ? pending : decided;
    bucket.set(proposal.documentVersionId, (bucket.get(proposal.documentVersionId) ?? 0) + 1);
  }

  const states = new Map<string, DocumentReadingState>();
  for (const version of own) {
    const job = newestJob.get(version.id);
    states.set(
      version.id,
      deriveReadingState({
        safetyStatus: version.safetyStatus,
        processingStatus: version.processingStatus,
        ...(job ? { readingJob: job } : {}),
        pendingSuggestions: pending.get(version.id) ?? 0,
        decidedSuggestions: decided.get(version.id) ?? 0,
      }),
    );
  }

  // Where each suggestion came from, by its run. A rule-based run is the machine-readable lines.
  // An AI run is "from the picture" when the file had no text of its own and an AI reading of the
  // picture exists, and "from the document's text" otherwise.
  const runs = await db
    .select({
      id: schema.aiExtractionRuns.id,
      documentVersionId: schema.aiExtractionRuns.documentVersionId,
      modelVersion: schema.aiExtractionRuns.modelVersion,
    })
    .from(schema.aiExtractionRuns)
    .where(inArray(schema.aiExtractionRuns.documentVersionId, ownIds));
  const withOwnText = new Set(
    (
      await db
        .select({
          documentVersionId: schema.extractionRuns.documentVersionId,
          text: schema.extractionRuns.extractedText,
          status: schema.extractionRuns.status,
        })
        .from(schema.extractionRuns)
        .where(inArray(schema.extractionRuns.documentVersionId, ownIds))
    )
      .filter((row) => row.status === 'SUCCEEDED' && (row.text ?? '').trim().length > 0)
      .map((row) => row.documentVersionId),
  );
  const withPictureReading = new Set(
    (
      await db
        .select({
          documentVersionId: schema.ocrRuns.documentVersionId,
          status: schema.ocrRuns.status,
        })
        .from(schema.ocrRuns)
        .where(inArray(schema.ocrRuns.documentVersionId, ownIds))
    )
      .filter((row) => row.status === 'SUCCEEDED')
      .map((row) => row.documentVersionId),
  );
  const sourceOfRun = new Map<string, ReadingSource>();
  for (const run of runs) {
    sourceOfRun.set(
      run.id,
      isDeterministicModelVersion(run.modelVersion)
        ? 'machine_readable'
        : !withOwnText.has(run.documentVersionId) && withPictureReading.has(run.documentVersionId)
          ? 'ai_image'
          : 'document_text',
    );
  }
  return ok({ states, sourceOfRun });
}
