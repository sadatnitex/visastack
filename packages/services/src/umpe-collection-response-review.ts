import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq } from 'drizzle-orm';
import {
  agencyMayReceiveAnswers,
  collectionResponseAccess,
} from './access/collection-response-access';
import {
  type AgencyCollectionScope,
  agencyCollectionScopeProblem,
} from './access/collection-scope';
import { guestUploadsPresent, liveGuestSubmission } from './access/guest-submission-access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError, keyedError } from './errors';
import { isUuid } from './lifecycle/foundation/ids';
import { parseItems } from './umpe-collection-request-items';
import { queueGuestCorrectionNotice } from './umpe-guest-correction-notice';
import { type CollectionReviewDecision, parseItemNotes } from './umpe-guest-uploads';

/**
 * The agency's review of an answer to its document request (UMPE P9), for both sources in one
 * queue: a signed-in traveller's response (P7, `source: 'account'`) and a guest submission
 * (`source: 'guest'`). Three decisions, in the agency's own words: Received (it arrived and is
 * being looked at), Needs Correction (with a note per item, so the person knows what to send
 * again) and Accepted. Decisions are append-only history: the latest is the answer's state, and a
 * correction from the person arrives as a new answer, never as an edit of the reviewed one.
 *
 * Only the agency's own active owners and admins decide (a fresh scope), only on a live answer of
 * its own request; an account answer is reached only through its response access (P7), so a
 * withdrawn or changed answer cannot be reviewed. Every decision is audited with counts.
 */

export const REVIEW_DECISIONS = ['RECEIVED', 'NEEDS_CORRECTION', 'ACCEPTED'] as const;
export const REVIEW_NOTE_LIMIT = 500;
export const REVIEW_GENERAL_NOTE_LIMIT = 1000;
const MAX_ITEM_NOTES = 120;

function missing(): ServiceError {
  return keyedError('not_found', 'umpe_collection_response_review.no_such_answer');
}

function isDecision(value: unknown): value is CollectionReviewDecision {
  return (REVIEW_DECISIONS as readonly unknown[]).includes(value);
}

export interface ReviewInput {
  readonly source: 'account' | 'guest';
  readonly answerId: string;
  readonly decision: unknown;
  readonly note?: unknown;
  /** Item id to the agency's note for it. Empty notes are dropped. */
  readonly itemNotes?: Readonly<Record<string, unknown>>;
}

export interface CollectionReview {
  readonly decision: CollectionReviewDecision;
  readonly note: string | null;
  readonly itemNotes: readonly { readonly itemId: string; readonly note: string }[];
  readonly decidedAt: Date;
}

function cleanNotes(
  raw: Readonly<Record<string, unknown>> | undefined,
  allowed: ReadonlySet<string> | null,
): { itemId: string; note: string }[] | string {
  const notes: { itemId: string; note: string }[] = [];
  for (const [itemId, value] of Object.entries(raw ?? {})) {
    const note = typeof value === 'string' ? value.trim() : '';
    if (note.length === 0) continue;
    if (itemId.length > 64 || (allowed && !allowed.has(itemId)))
      return 'Choose an item from the list.';
    if (note.length > REVIEW_NOTE_LIMIT) {
      return `Keep each note to ${REVIEW_NOTE_LIMIT} characters.`;
    }
    notes.push({ itemId, note });
  }
  if (notes.length > MAX_ITEM_NOTES) return 'Too many notes at once.';
  return notes;
}

/** Record one review decision on a live answer of this agency's request. */
export async function recordCollectionReview(
  db: Db,
  scope: AgencyCollectionScope,
  input: ReviewInput,
  now: Date = new Date(),
): Promise<Result<CollectionReview, ServiceError>> {
  const problem = agencyCollectionScopeProblem(scope);
  if (problem) return err(problem);
  if (!isUuid(input.answerId) || !(await guestUploadsPresent(db))) return err(missing());
  if (!isDecision(input.decision)) return err(keyedError('invalid', 'umpe_collection_response_review.choose_a_decision'));
  const general = typeof input.note === 'string' ? input.note.trim() : '';
  if (general.length > REVIEW_GENERAL_NOTE_LIMIT) {
    return err(
      serviceError('invalid', `Keep the note to ${REVIEW_GENERAL_NOTE_LIMIT} characters.`),
    );
  }

  let requestId: string;
  let allowed: ReadonlySet<string> | null = null;
  if (input.source === 'account') {
    // Reached only through P7's own gate: live, this agency's, reviewed agency.
    const access = await collectionResponseAccess(db, scope, input.answerId);
    if (!access.ok) return err(missing());
    requestId = access.value.requestId;
  } else if (input.source === 'guest') {
    // As for every guest read: only an agency VisaStack has reviewed.
    if (!(await agencyMayReceiveAnswers(db, scope.organizationId))) return err(missing());
    const submission = first(
      await db
        .select({
          requestId: schema.agencyCollectionGuestSubmissions.requestId,
          revisionId: schema.agencyCollectionGuestSubmissions.revisionId,
        })
        .from(schema.agencyCollectionGuestSubmissions)
        .where(
          and(
            eq(schema.agencyCollectionGuestSubmissions.id, input.answerId),
            eq(schema.agencyCollectionGuestSubmissions.organizationId, scope.organizationId),
            liveGuestSubmission(),
          ),
        )
        .limit(1),
    );
    if (!submission) return err(missing());
    requestId = submission.requestId;
    const revision = first(
      await db
        .select({ items: schema.agencyCollectionRequestRevisions.items })
        .from(schema.agencyCollectionRequestRevisions)
        .where(
          and(
            eq(schema.agencyCollectionRequestRevisions.id, submission.revisionId),
            eq(schema.agencyCollectionRequestRevisions.requestId, submission.requestId),
          ),
        )
        .limit(1),
    );
    allowed = new Set((parseItems(revision?.items) ?? []).map((item) => item.id));
  } else {
    return err(missing());
  }

  const notes = cleanNotes(input.itemNotes, allowed);
  if (typeof notes === 'string') return err(serviceError('invalid', notes));
  if (input.decision === 'NEEDS_CORRECTION' && notes.length === 0 && general.length === 0) {
    return err(
      keyedError('invalid', 'umpe_collection_response_review.say_what_needs_correcting_add_a'),
    );
  }
  const reviews = schema.agencyCollectionReviews;
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(reviews)
      .values({
        organizationId: scope.organizationId,
        requestId,
        source: input.source,
        responseId: input.source === 'account' ? input.answerId : null,
        guestSubmissionId: input.source === 'guest' ? input.answerId : null,
        decision: input.decision as CollectionReviewDecision,
        itemNotes: notes,
        note: general.length > 0 ? general : null,
        decidedByAccountId: scope.accountId,
        decidedAt: now,
      })
      .returning({ id: reviews.id });
    // UMPE G3: a guest is emailed that a correction was asked for (checked again at send time).
    const reviewId = first(inserted)?.id;
    const correctionEmail =
      input.source === 'guest' && input.decision === 'NEEDS_CORRECTION' && reviewId
        ? await queueGuestCorrectionNotice(
            tx,
            scope,
            {
              reviewId,
              submissionId: input.answerId,
            },
            now,
          )
        : null;
    await appendAuditEvent(tx, {
      eventType: 'AGENCY_COLLECTION_ANSWER_REVIEWED',
      actorAccountId: scope.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'agency_collection_request',
      resourceId: requestId,
      metadata: {
        organizationId: scope.organizationId,
        source: input.source,
        decision: input.decision as string,
        itemNotes: notes.length,
        ...(correctionEmail ? { correctionEmail } : {}),
      },
    });
    return ok({
      decision: input.decision as CollectionReviewDecision,
      note: general.length > 0 ? general : null,
      itemNotes: notes,
      decidedAt: now,
    });
  });
}

/** The newest decisions one request reads at once. */
const REVIEW_LIST_LIMIT = 500;

/**
 * Every review decision on this agency's request, newest first, keyed by answer id (a response id
 * or a guest submission id). Empty for any refusal, and before the migration runs.
 */
export async function listCollectionReviews(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
): Promise<ReadonlyMap<string, readonly CollectionReview[]>> {
  if (agencyCollectionScopeProblem(scope)) return new Map();
  if (!isUuid(requestId) || !(await guestUploadsPresent(db))) return new Map();
  const reviews = schema.agencyCollectionReviews;
  const rows = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.organizationId, scope.organizationId), eq(reviews.requestId, requestId)))
    .orderBy(desc(reviews.decidedAt), desc(reviews.id))
    .limit(REVIEW_LIST_LIMIT);
  const byAnswer = new Map<string, CollectionReview[]>();
  for (const row of rows) {
    const answerId = row.responseId ?? row.guestSubmissionId;
    if (!answerId || !isDecision(row.decision)) continue;
    byAnswer.set(answerId, [
      ...(byAnswer.get(answerId) ?? []),
      {
        decision: row.decision,
        note: row.note,
        itemNotes: parseItemNotes(row.itemNotes),
        decidedAt: row.decidedAt,
      },
    ]);
  }
  return byAnswer;
}
