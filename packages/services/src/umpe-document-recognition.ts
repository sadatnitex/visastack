/**
 * UMPE G4: every file is recognised, and placed when the recognition is sure (owner decision,
 * 3 November 2026: "All files should be ai recognized and known by that. Ai's one work is to know
 * the files, contents and recognize, categorize and place that in right places.").
 *
 * Recognition is not reading. It answers one question, what kind of document a file is, from a
 * short excerpt with every number that could identify a person or an account removed
 * (`buildRecognitionExcerpt`, reusing the ADR 0022 matchers). Reading the details of a file stays
 * protected exactly as before: it runs only once the kind is known and not on the protected list.
 *
 * - Confident (at or above `AUTO_PLACE_MIN_CONFIDENCE`): the kind is applied and the automatic
 *   title replaced by the suggested one, at once, with one `document_auto_placements` row so the
 *   owner can Change it back in one step. A name the person chose is never touched.
 * - Less sure: the suggestion waits in Needs One Decision, as before.
 * - A document is placed automatically at most once: once its owner changed a placement back, the
 *   same suggestion waits for them instead.
 *
 * Audits hold kinds, counts and ids only, never a name or a value read from the file.
 */

import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { AuthorizedApplicant, SystemScope } from './access';
import { READER_VERSION, aiReadingIdempotencyKey } from './ai-reading-job';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { lifecycleTablesPresent, presentDocumentCondition } from './lifecycle/foundation';
import { everydayDocumentCondition } from './lifecycle/foundation/conditions';
import { incrementMaterialRevision, missionsSelectingDocument } from './material-revision';
import { AUTOMATIC_TITLE_REASON, documentKindLabel } from './naming';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';
import { hasIban, looksLikeAccountNumber, looksLikeDate } from './redaction';
import { autoPlacementsTablePresent } from './umpe-document-tables';

// --- The excerpt sent for recognition ----------------------------------------------------------

/** At most this many characters of the file are ever sent to recognise it. */
export const RECOGNITION_EXCERPT_MAX_CHARS = 1500;
/** At most this many lines, read from the top of the file, where a document says what it is. */
export const RECOGNITION_EXCERPT_MAX_LINES = 60;
/** What stands in for a removed number, so the shape of the line stays readable. */
export const REMOVED_NUMBER = '[number]';
/** Persisted confidence (0 to 100) from which a recognised kind is applied without asking. */
export const AUTO_PLACE_MIN_CONFIDENCE = 90;

/** A machine-readable passport or identity card line: letters, digits and "<" filler. */
const MRZ_LIKE = /^[A-Z0-9<]{20,44}$/;
/** Any run of 4 or more digits, possibly split by single spaces, hyphens, dots or slashes. */
const DIGIT_RUN = /\d(?:[ ./-]?\d){3,}/g;
/** Every digit run, however short: used on a line that names an account or holds an IBAN. */
const ANY_DIGITS = /\d(?:[ ./-]?\d)*/g;
/** A word that mixes letters and 3 or more digits ("A1234567", "BD12X345"): an identity code. */
const MIXED_CODE = /\b(?=[A-Z0-9]*[A-Z])(?=(?:[A-Z]*\d){3})[A-Z0-9]{5,}\b/gi;
/** An IBAN as printed (country, check digits, then groups of up to four), upper case only. */
const IBAN_PRINTED = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{1,4}){2,8}\b/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PLAIN_YEAR = /^(19|20)\d{2}$/;
/** Long words without spaces, which only machine-readable or encoded content has. */
const LONG_WORD = /\S{41,}/g;

/** One digit run kept or removed: dates and plain years stay, every other number goes. */
function maskDigitRun(run: string): string {
  if (PLAIN_YEAR.test(run)) return run;
  if (looksLikeDate(run) && run.replace(/\D/g, '').length <= 8) return run;
  return REMOVED_NUMBER;
}

/** Every mask, in an order where an earlier one never hides a later one's target. */
function maskLine(line: string): string {
  return line
    .replace(EMAIL, '[email]')
    .replace(LONG_WORD, REMOVED_NUMBER)
    .replace(IBAN_PRINTED, REMOVED_NUMBER)
    .replace(MIXED_CODE, REMOVED_NUMBER)
    .replace(DIGIT_RUN, maskDigitRun);
}

/**
 * The redacted, bounded excerpt of a file's text that recognition sends (UMPE G4). Machine-readable
 * passport lines are dropped whole; email addresses, IBANs, identity codes that mix letters and
 * digits, long unbroken words, and every run of 4 or more digits that is not a date or a plain year
 * are replaced. On a line that holds an IBAN or names an account or card (the ADR 0022 matchers),
 * every number goes, dates included; the label stays, because it says what the document is. Pure:
 * the same text always gives the same excerpt, so the classification cache still works.
 */
export function buildRecognitionExcerpt(text: string | null | undefined): string {
  if (!text) return '';
  const kept: string[] = [];
  let length = 0;
  // Bounded before any pattern runs, so a long file costs no more than a short one.
  for (const rawLine of text.slice(0, 20_000).split(/\r?\n/)) {
    if (kept.length >= RECOGNITION_EXCERPT_MAX_LINES || length >= RECOGNITION_EXCERPT_MAX_CHARS) {
      break;
    }
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (line === '') continue;
    const tight = line.toUpperCase().replace(/\s/g, '');
    if (MRZ_LIKE.test(tight) && tight.includes('<')) continue;
    let cleaned = maskLine(line);
    if (hasIban(line) || looksLikeAccountNumber(line, line)) {
      cleaned = cleaned.replace(ANY_DIGITS, REMOVED_NUMBER);
    }
    kept.push(cleaned);
    length += cleaned.length + 1;
  }
  return kept.join('\n').slice(0, RECOGNITION_EXCERPT_MAX_CHARS).trim();
}

// --- Reading again after a kind decision --------------------------------------------------------

/**
 * Queues a fresh automatic reading of the document's newest file after its kind was decided (an
 * accepted suggestion, a changed kind). The reading job checks protection against the kind it then
 * finds, so a protected kind is still never read. A reading already waiting or running is left
 * alone. The owner's proof for the document's person; call it after the deciding transaction.
 */
export async function queueReadingAfterKindDecision(
  proof: AuthorizedApplicant<'MANAGE'>,
  /** The document, or one of its versions (its document is then the one read again). */
  input: { readonly documentId: string } | { readonly documentVersionId: string },
): Promise<boolean> {
  if (!AuthorizedApplicant.isGenuine(proof, 'MANAGE') || proof.actor.kind !== 'applicant_owner') {
    return false;
  }
  const tx = proof.tx;
  const documentId =
    'documentId' in input
      ? input.documentId
      : first(
          await tx
            .select({ documentId: schema.documentVersions.documentId })
            .from(schema.documentVersions)
            .where(eq(schema.documentVersions.id, input.documentVersionId))
            .limit(1),
        )?.documentId;
  if (!documentId) return false;
  const version = first(
    await tx
      .select({
        id: schema.documentVersions.id,
        safetyStatus: schema.documentVersions.safetyStatus,
      })
      .from(schema.documentVersions)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
      .where(
        and(
          eq(schema.documentVersions.documentId, documentId),
          eq(schema.documents.applicantId, proof.applicant.id),
          // A command on one document: presentDocumentCondition (deleted answers as missing).
          (await lifecycleTablesPresent(tx)) ? presentDocumentCondition() : undefined,
        ),
      )
      .orderBy(desc(schema.documentVersions.versionNumber))
      .limit(1),
  );
  if (!version || version.safetyStatus !== 'CLEAN') return false;
  const jobs = schema.processingJobs;
  const key = aiReadingIdempotencyKey(version.id);
  const existing = first(
    await tx
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(eq(jobs.idempotencyKey, key))
      .limit(1),
  );
  if (existing) {
    // Only a finished job is set going again, in one guarded write, so a running one is never
    // disturbed.
    const reset = await tx
      .update(jobs)
      .set({
        status: 'PENDING',
        attempts: 0,
        availableAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        claimedAt: null,
        completedAt: null,
        lastError: null,
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, existing.id), inArray(jobs.status, ['DONE', 'FAILED'])))
      .returning({ id: jobs.id });
    return reset.length > 0;
  }
  const inserted = await tx
    .insert(jobs)
    .values({
      documentVersionId: version.id,
      jobType: 'INTAKE',
      processingVersion: READER_VERSION,
      idempotencyKey: key,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  return inserted.length > 0;
}

// --- Placing a confident recognition ------------------------------------------------------------

/** The next free name version number; the document row must already be locked. */
async function nextNameVersionNumber(tx: Db, documentId: string): Promise<number> {
  const top = first(
    await tx
      .select({ versionNumber: schema.documentNameVersions.versionNumber })
      .from(schema.documentNameVersions)
      .where(eq(schema.documentNameVersions.documentId, documentId))
      .orderBy(desc(schema.documentNameVersions.versionNumber))
      .limit(1),
  );
  return (top?.versionNumber ?? 0) + 1;
}

/**
 * True when a person ever decided this document's name (renamed it, or accepted a name). The same
 * rule as `nameThePersonChose` in ai.ts; it is kept private in both places because an exported
 * reader of documents needs an access proof (the access ratchet), and neither caller has one.
 */
async function personChoseName(tx: Db, documentId: string): Promise<boolean> {
  const decided = first(
    await tx
      .select({ id: schema.documentNameVersions.id })
      .from(schema.documentNameVersions)
      .where(
        and(
          eq(schema.documentNameVersions.documentId, documentId),
          inArray(schema.documentNameVersions.decision, ['ACCEPTED_UNCHANGED', 'ACCEPTED_EDITED']),
          isNotNull(schema.documentNameVersions.decidedByAccountId),
        ),
      )
      .limit(1),
  );
  return decided !== undefined;
}

export type PlacementOutcome =
  | { readonly placed: true; readonly docType: string }
  | {
      readonly placed: false;
      readonly reason:
        | 'unavailable'
        | 'no_suggestion'
        | 'not_confident'
        | 'kind_known'
        | 'already_placed'
        | 'not_latest';
    };

/**
 * Applies the waiting AI kind of one file version when it is confident enough (UMPE G4). Called by
 * the background reading right after recognition; owner and applicant come from the version itself.
 * Everything happens in one transaction with the document row locked, and only while the file is
 * still of no known kind and is its document's newest version.
 */
export async function placeRecognisedKind(
  db: Db,
  scope: SystemScope<'process-ai-reading'>,
  input: { readonly documentVersionId: string },
): Promise<PlacementOutcome> {
  if (!SystemScope.isGenuine(scope) || scope.job !== 'process-ai-reading') {
    throw new Error('automatic placement needs the scope of the reading job');
  }
  if (!(await autoPlacementsTablePresent(db))) return { placed: false, reason: 'unavailable' };
  const lifecycle = await lifecycleTablesPresent(db);
  return db.transaction(async (tx: Db): Promise<PlacementOutcome> => {
    const target = first(
      await tx
        .select({
          documentId: schema.documents.id,
          applicantId: schema.documents.applicantId,
        })
        .from(schema.documentVersions)
        .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
        .where(
          and(
            eq(schema.documentVersions.id, input.documentVersionId),
            lifecycle ? presentDocumentCondition() : undefined,
          ),
        )
        .limit(1),
    );
    if (!target) return { placed: false, reason: 'not_latest' };
    const document = first(
      await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, target.documentId))
        .limit(1)
        .for('update'),
    );
    if (!document) return { placed: false, reason: 'not_latest' };
    if (document.docType) return { placed: false, reason: 'kind_known' };
    const newest = first(
      await tx
        .select({ id: schema.documentVersions.id })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, document.id))
        .orderBy(desc(schema.documentVersions.versionNumber))
        .limit(1),
    );
    if (newest?.id !== input.documentVersionId) return { placed: false, reason: 'not_latest' };
    const earlier = first(
      await tx
        .select({ id: schema.documentAutoPlacements.id })
        .from(schema.documentAutoPlacements)
        .where(
          and(
            eq(schema.documentAutoPlacements.documentId, document.id),
            eq(schema.documentAutoPlacements.placement, 'KIND'),
          ),
        )
        .limit(1),
    );
    if (earlier) return { placed: false, reason: 'already_placed' };
    const proposal = first(
      await tx
        .select()
        .from(schema.documentTypeProposals)
        .where(
          and(
            eq(schema.documentTypeProposals.documentVersionId, input.documentVersionId),
            eq(schema.documentTypeProposals.status, 'PENDING'),
          ),
        )
        .orderBy(desc(schema.documentTypeProposals.createdAt))
        .limit(1)
        .for('update'),
    );
    if (!proposal) return { placed: false, reason: 'no_suggestion' };
    if (proposal.confidence < AUTO_PLACE_MIN_CONFIDENCE) {
      return { placed: false, reason: 'not_confident' };
    }

    // The suggested name waits beside the suggested kind (written by the recognition). It replaces
    // the automatic title only; a name the person chose stays, and its waiting copy is closed.
    const waitingName = first(
      await tx
        .select()
        .from(schema.documentNameVersions)
        .where(
          and(
            eq(schema.documentNameVersions.documentId, document.id),
            eq(schema.documentNameVersions.decision, 'PENDING'),
          ),
        )
        .orderBy(desc(schema.documentNameVersions.versionNumber))
        .limit(1),
    );
    const keepName = await personChoseName(tx, document.id);
    // One moment for the name decided here and the placement, so Change can tell a later rename.
    const placedAt = new Date();
    let appliedName = document.approvedName;
    if (waitingName) {
      if (keepName || waitingName.proposedName === document.approvedName) {
        await tx
          .update(schema.documentNameVersions)
          .set({ decision: 'REJECTED', reason: 'kept the current name', decidedAt: placedAt })
          .where(eq(schema.documentNameVersions.id, waitingName.id));
      } else {
        // Written by the system, as an automatic title: a later kind can still retitle it, and
        // it never counts as a name the person chose.
        await tx
          .update(schema.documentNameVersions)
          .set({
            decision: 'ACCEPTED_UNCHANGED',
            finalName: waitingName.proposedName,
            reason: AUTOMATIC_TITLE_REASON,
            decidedAt: placedAt,
          })
          .where(eq(schema.documentNameVersions.id, waitingName.id));
        appliedName = waitingName.proposedName;
      }
    }

    // The same record an accepted suggestion leaves, so every later step treats the kind alike.
    const extractionRun = first(
      await tx
        .select({ id: schema.extractionRuns.id })
        .from(schema.extractionRuns)
        .where(
          and(
            eq(schema.extractionRuns.documentVersionId, input.documentVersionId),
            eq(schema.extractionRuns.status, 'SUCCEEDED'),
          ),
        )
        .orderBy(desc(schema.extractionRuns.createdAt))
        .limit(1),
    );
    const classification = extractionRun
      ? first(
          await tx
            .insert(schema.documentClassifications)
            .values({
              extractionRunId: extractionRun.id,
              documentVersionId: input.documentVersionId,
              classifiedType: proposal.suggestedType,
              confidence: proposal.confidence,
              reviewRequired: false,
              rationale: null,
              source: 'AI_APPROVED',
            })
            .returning({ id: schema.documentClassifications.id }),
        )
      : undefined;
    await tx
      .update(schema.documentTypeProposals)
      .set({
        status: 'APPROVED',
        decidedAt: new Date(),
        classificationId: classification?.id ?? null,
      })
      .where(eq(schema.documentTypeProposals.id, proposal.id));
    await tx
      .update(schema.documents)
      .set({ docType: proposal.suggestedType, approvedName: appliedName })
      .where(eq(schema.documents.id, document.id));
    const placement = first(
      await tx
        .insert(schema.documentAutoPlacements)
        .values({
          applicantId: document.applicantId,
          documentId: document.id,
          placement: 'KIND',
          previousDocType: null,
          previousName: document.approvedName,
          appliedDocType: proposal.suggestedType,
          appliedName,
          confidence: proposal.confidence,
          typeProposalId: proposal.id,
          classificationId: classification?.id ?? null,
          createdAt: placedAt,
        })
        .returning({ id: schema.documentAutoPlacements.id }),
    );
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_RECOGNISED_AUTOMATICALLY',
      method: 'SYSTEM',
      result: 'ALLOWED',
      applicantId: document.applicantId,
      resourceType: 'document',
      resourceId: document.id,
      // Kinds and numbers only, never a name.
      metadata: {
        docType: proposal.suggestedType,
        confidence: proposal.confidence,
        renamed: appliedName !== document.approvedName,
        placementId: placement?.id ?? null,
        typeProposalId: proposal.id,
      },
    });
    for (const missionId of await missionsSelectingDocument(tx, document.id)) {
      await incrementMaterialRevision(tx, missionId);
    }
    return { placed: true, docType: proposal.suggestedType };
  });
}

// --- What the owner sees, and their one-step Change -----------------------------------------------

/** How long an automatic placement is listed with its Change. */
const SHOWN_FOR_MS = 30 * 24 * 60 * 60 * 1000;

export interface AutoPlacementView {
  readonly placementId: string;
  readonly documentId: string;
  readonly placement: 'KIND' | 'PERSON';
  /** The document's name as listed now. */
  readonly title: string;
  /** Plain label of the kind applied ("Bank Statement"); null for a filing. */
  readonly kindLabel: string | null;
}

/**
 * The person's automatic placements still standing, for the Recognised Automatically and Filed
 * Automatically notes on their documents page. The owner's own proof only; anyone else sees none.
 */
export async function listAutoPlacements(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  options: { readonly now?: Date } = {},
): Promise<readonly AutoPlacementView[]> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') ||
    proof.actor.kind !== 'applicant_owner'
  ) {
    return [];
  }
  const db = proof.tx;
  if (!(await autoPlacementsTablePresent(db))) return [];
  const placements = schema.documentAutoPlacements;
  const rows = await db
    .select({
      id: placements.id,
      documentId: placements.documentId,
      placement: placements.placement,
      appliedDocType: placements.appliedDocType,
      docType: schema.documents.docType,
      approvedName: schema.documents.approvedName,
      originalName: schema.documents.originalName,
    })
    .from(placements)
    .innerJoin(schema.documents, eq(schema.documents.id, placements.documentId))
    .where(
      and(
        eq(placements.applicantId, proof.applicant.id),
        eq(schema.documents.applicantId, proof.applicant.id),
        // Archived and deleted files are put away: nothing to change there.
        (await lifecycleTablesPresent(db)) ? everydayDocumentCondition() : undefined,
        eq(placements.status, 'APPLIED'),
        // Shown while it is recent; after that it is simply how the file is.
        gte(placements.createdAt, new Date((options.now ?? new Date()).getTime() - SHOWN_FOR_MS)),
      ),
    )
    .orderBy(desc(placements.createdAt))
    .limit(200);
  return rows
    .filter((row) => row.placement === 'PERSON' || row.docType === row.appliedDocType)
    .map((row) => ({
      placementId: row.id,
      documentId: row.documentId,
      placement: row.placement === 'PERSON' ? 'PERSON' : 'KIND',
      // The same name the document list shows.
      title: row.approvedName?.trim() || row.originalName,
      kindLabel:
        row.placement === 'KIND' && row.appliedDocType
          ? documentKindLabel(row.appliedDocType)
          : null,
    }));
}

/**
 * Change: puts back the kind and name a file had before it was recognised automatically (UMPE G4).
 * The owner only, with the proof made for this document. Refused as stale once anything changed
 * since (the kind or the name), so a later decision of the person is never undone. The suggestion
 * waits again in Needs One Decision; it is never applied automatically a second time.
 */
export async function changeRecognisedKind(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: { readonly placementId: string },
): Promise<Result<{ readonly restored: true }, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'MANAGE') ||
    proof.actor.kind !== 'applicant_owner' ||
    proof.resource.kind !== 'document'
  ) {
    return err(serviceError('forbidden', 'only the owner can change this'));
  }
  const notFound = err(serviceError('not_found', 'placement not found'));
  const db = proof.tx;
  if (!(await autoPlacementsTablePresent(db))) return notFound;
  const documentId = proof.resource.document.id;
  const actorAccountId = proof.applicant.ownerAccountId;
  const placements = schema.documentAutoPlacements;
  const limited = await checkRateLimit(
    db,
    { subjectId: actorAccountId, action: 'document.placement_change', label: 'change' },
    RATE_LIMITS.AUTO_PLACEMENT_CHANGE,
  );
  if (!limited.allowed) return err(serviceError('rate_limited', limited.reason));
  const lifecycle = await lifecycleTablesPresent(db);
  return db.transaction(async (tx: Db) => {
    const document = first(
      await tx
        .select()
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.documents.applicantId, proof.applicant.id),
            // A command on one document: presentDocumentCondition (deleted answers as missing).
            lifecycle ? presentDocumentCondition() : undefined,
          ),
        )
        .limit(1)
        .for('update'),
    );
    if (!document) return notFound;
    const placement = first(
      await tx
        .select()
        .from(placements)
        .where(
          and(
            eq(placements.id, input.placementId),
            eq(placements.documentId, documentId),
            eq(placements.applicantId, proof.applicant.id),
            eq(placements.placement, 'KIND'),
            eq(placements.status, 'APPLIED'),
          ),
        )
        .limit(1)
        .for('update'),
    );
    if (!placement) return notFound;
    if (document.docType !== placement.appliedDocType) {
      return err(serviceError('stale', 'this file was changed since it was recognised'));
    }
    // The name goes back only while it is still the one the recognition gave.
    const restoreName =
      placement.appliedName !== placement.previousName &&
      document.approvedName === placement.appliedName &&
      !(await nameDecidedAfter(tx, documentId, placement.createdAt));
    if (restoreName && placement.previousName) {
      await tx.insert(schema.documentNameVersions).values({
        documentId,
        versionNumber: await nextNameVersionNumber(tx, documentId),
        proposedName: placement.previousName,
        finalName: placement.previousName,
        decision: 'ACCEPTED_UNCHANGED',
        reason: AUTOMATIC_TITLE_REASON,
        decidedAt: new Date(),
      });
    }
    await tx
      .update(schema.documents)
      .set({
        docType: placement.previousDocType,
        subject: null,
        ...(restoreName ? { approvedName: placement.previousName } : {}),
      })
      .where(eq(schema.documents.id, documentId));
    // The system's classification goes, so the file reads as unknown again, and the suggestion
    // waits for the person instead.
    if (placement.classificationId) {
      await tx
        .update(schema.documentTypeProposals)
        .set({ classificationId: null })
        .where(eq(schema.documentTypeProposals.classificationId, placement.classificationId));
      await tx
        .delete(schema.documentClassifications)
        .where(eq(schema.documentClassifications.id, placement.classificationId));
    }
    if (placement.typeProposalId) {
      await tx
        .update(schema.documentTypeProposals)
        .set({ status: 'PENDING', decidedAt: null, decidedByAccountId: null })
        .where(
          and(
            eq(schema.documentTypeProposals.id, placement.typeProposalId),
            eq(schema.documentTypeProposals.status, 'APPROVED'),
          ),
        );
    }
    await tx
      .update(placements)
      .set({ status: 'CHANGED', changedAt: new Date(), changedByAccountId: actorAccountId })
      .where(eq(placements.id, placement.id));
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_AUTOMATIC_PLACEMENT_CHANGED',
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: proof.applicant.id,
      resourceType: 'document',
      resourceId: documentId,
      metadata: {
        placement: 'KIND',
        placementId: placement.id,
        docType: placement.appliedDocType,
        nameRestored: restoreName,
      },
    });
    for (const missionId of await missionsSelectingDocument(tx, documentId)) {
      await incrementMaterialRevision(tx, missionId);
    }
    return ok({ restored: true as const });
  });
}

/** True when any name of the document was decided (by anyone) after the given moment. */
async function nameDecidedAfter(tx: Db, documentId: string, since: Date): Promise<boolean> {
  const later = first(
    await tx
      .select({ id: schema.documentNameVersions.id })
      .from(schema.documentNameVersions)
      .where(
        and(
          eq(schema.documentNameVersions.documentId, documentId),
          ne(schema.documentNameVersions.decision, 'PENDING'),
          sql`${schema.documentNameVersions.decidedAt} > ${since}`,
        ),
      )
      .limit(1),
  );
  return later !== undefined;
}
