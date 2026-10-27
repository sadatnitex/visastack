import { type Result, err, ok } from '@visastack/core';
import { and, count, desc, eq, like, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import { type MissionNote, addNote, evidenceRequestTriageGroup } from './agency';
import { schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { referenceCodesFor } from './reference-codes';

/**
 * The traveller's side of one agency request (Programme X WP-V4, spec B09 "Request UX"): what the
 * checklist says about the item, and a bounded question to the agency about it. Nothing here adds a
 * table or a state:
 *
 * - the item's own rule (how recent the evidence must be, and whether the item is optional) is read
 *   from the checklist requirement the request was made from, when there is one;
 * - a question is an ordinary shared case note (the existing comment mechanism, `addNote`) whose
 *   first words name the request by its visible reference code, so the agency and the traveller
 *   point at the same item without a second chat product. Everyone who can read this case's shared
 *   notes can read it, which the screen says before it is sent.
 *
 * Both functions take a proof from the central access gate and require the owner: what an agency
 * asked of a traveller, and what the traveller asks back, are the traveller's own. Nothing here
 * widens who can see evidence requests; an agency's own request list is still for its owners and
 * administrators only.
 */

/** Longest question, in characters. A note allows more; a question about one item does not need it. */
export const REQUEST_QUESTION_MAX_LENGTH = 500;

/** Most questions about one request. The agency answers in the case notes; this keeps a thread bounded. */
export const REQUEST_QUESTION_LIMIT = 5;

/**
 * How many of the owner's question notes one read looks at. Only question notes are read, so this
 * is far above what the limit above allows for any realistic number of requests.
 */
const QUESTION_READ_LIMIT = 1000;

/**
 * The words every question about a request starts with. Built and read in this one place, so the
 * note that is written and the note that is found can never drift apart.
 */
export function requestQuestionPrefix(referenceCode: string): string {
  return `Question about ${referenceCode}: `;
}

/** Matches the start of any question note and captures the request code it names. */
const QUESTION_START = /^Question about (R-[A-Za-z0-9]+): /;

/** The question text without its prefix, or null when the note is not a question about this code. */
export function requestQuestionText(body: string, referenceCode: string): string | null {
  const prefix = requestQuestionPrefix(referenceCode);
  return body.startsWith(prefix) ? body.slice(prefix.length) : null;
}

/** One line of plain text: tabs, line breaks and runs of spaces become one space. */
function cleanQuestion(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function ownerOf(
  proof: AuthorizedApplicant<'COMMENT'> | AuthorizedApplicant<'VIEW_METADATA'>,
  action: 'COMMENT' | 'VIEW_METADATA',
): Result<string, ServiceError> {
  if (!AuthorizedApplicant.isGenuine(proof, action) || proof.actor.kind !== 'applicant_owner') {
    return err(serviceError('forbidden', 'Only the owner of this record can do this.'));
  }
  return ok(proof.applicant.ownerAccountId);
}

/**
 * Ask the agency a question about one request. The proof is COMMENT on the request's own case, so a
 * request that names no case cannot be asked about here (there is no case to hold the note), and a
 * request on another case, or another person's, answers exactly like an unknown one. A closed
 * request (cancelled, or an older value that is not a review) takes no questions.
 *
 * The limit is counted and the note written under one lock per request, so two quick submissions
 * cannot both pass the count.
 */
export async function askAboutRequestItem(
  proof: AuthorizedApplicant<'COMMENT'>,
  input: { readonly requestId: string; readonly question: string },
): Promise<Result<MissionNote, ServiceError>> {
  const owner = ownerOf(proof, 'COMMENT');
  if (!owner.ok) return owner;
  if (proof.resource.kind !== 'mission') {
    return err(serviceError('forbidden', 'Only the owner of this record can do this.'));
  }
  const missionId = proof.resource.mission.id;

  const question = cleanQuestion(input.question);
  if (question.length === 0) return err(serviceError('invalid', 'Write your question first.'));
  if (question.length > REQUEST_QUESTION_MAX_LENGTH) {
    return err(
      serviceError(
        'invalid',
        `Keep your question under ${REQUEST_QUESTION_MAX_LENGTH} characters. You can add more in a second question.`,
      ),
    );
  }

  return proof.tx.transaction(async (tx) => {
    // Held until this transaction ends. Taken before anything is read, so the count below is the
    // count the insert sees.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`visastack:request-question:${input.requestId}`}))`,
    );

    const found = await tx
      .select({
        id: schema.evidenceRequests.id,
        status: schema.evidenceRequests.status,
        kind: schema.evidenceRequests.kind,
        missionId: schema.evidenceRequests.missionId,
        applicantId: schema.evidenceRequests.applicantId,
      })
      .from(schema.evidenceRequests)
      .where(eq(schema.evidenceRequests.id, input.requestId))
      .limit(1);
    const request = found[0];
    if (
      !request ||
      request.applicantId !== proof.applicant.id ||
      request.missionId !== missionId ||
      evidenceRequestTriageGroup(request) === null
    ) {
      return err(serviceError('not_found', 'request not found'));
    }

    // The visible code is read here, never taken from the caller: it is what ties the note to the
    // item, so a code for some other request must never be written. No code yet (the registry is
    // missing, or this request has none) means the item cannot take a question.
    const referenceCode = (await referenceCodesFor(tx, 'R', [request.id])).get(request.id);
    if (!referenceCode) {
      return err(serviceError('invalid', 'This request cannot take a question yet.'));
    }

    const prefix = requestQuestionPrefix(referenceCode);
    const earlier = await tx
      .select({ total: count() })
      .from(schema.missionNotes)
      .where(
        and(
          eq(schema.missionNotes.missionId, missionId),
          eq(schema.missionNotes.authorAccountId, owner.value),
          eq(schema.missionNotes.visibility, 'TRAVELLER_SHARED'),
          // The code holds only capitals, digits and a hyphen, so the prefix holds no wildcard.
          like(schema.missionNotes.body, `${prefix}%`),
        ),
      );
    if ((earlier[0]?.total ?? 0) >= REQUEST_QUESTION_LIMIT) {
      return err(
        serviceError(
          'invalid',
          'You have asked several questions about this item. Wait for the agency to reply in the case notes.',
        ),
      );
    }

    return addNote(tx, {
      actorAccountId: owner.value,
      missionId,
      body: `${prefix}${question}`,
      visibility: 'TRAVELLER_SHARED',
    });
  });
}

/** How the checklist describes an item: how recent its evidence must be, and whether it is optional. */
export interface RequestItemRule {
  readonly maxAgeDays: number | null;
  readonly optional: boolean;
}

/** A question the traveller asked about one request. */
export interface RequestQuestion {
  readonly text: string;
  readonly askedAt: Date;
}

export interface RequestItemExtras {
  /** By request id; only requests made from a checklist item have one. */
  readonly rules: ReadonlyMap<string, RequestItemRule>;
  /** By request id, newest first; only the traveller's own questions. */
  readonly questions: ReadonlyMap<string, readonly RequestQuestion[]>;
}

/**
 * The checklist rule and the traveller's own questions for each of this person's requests, in two
 * reads. `codes` are the visible reference codes the caller already shows (request id to code);
 * they only decide which of the traveller's own notes belong to which request. Agency replies are
 * not matched: they live in the case notes, which the screen links to.
 */
export async function listRequestItemExtras(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  codes: ReadonlyMap<string, string>,
): Promise<Result<RequestItemExtras, ServiceError>> {
  const owner = ownerOf(proof, 'VIEW_METADATA');
  if (!owner.ok) return owner;
  const db = proof.tx;

  const requests = await db
    .select({
      id: schema.evidenceRequests.id,
      missionId: schema.evidenceRequests.missionId,
      maxAgeDays: schema.packRequirements.maxAgeDays,
      optional: schema.packRequirements.optional,
      requirementId: schema.packRequirements.id,
    })
    .from(schema.evidenceRequests)
    .leftJoin(
      schema.packRequirements,
      eq(schema.packRequirements.id, schema.evidenceRequests.packRequirementId),
    )
    .where(eq(schema.evidenceRequests.applicantId, proof.applicant.id));

  const rules = new Map<string, RequestItemRule>();
  const idByKey = new Map<string, string>();
  for (const request of requests) {
    if (request.requirementId !== null) {
      rules.set(request.id, {
        maxAgeDays: request.maxAgeDays ?? null,
        optional: request.optional ?? false,
      });
    }
    const code = codes.get(request.id);
    // A note belongs to a request only on that request's own case, under that request's own code.
    if (code && request.missionId) idByKey.set(`${request.missionId}|${code}`, request.id);
  }

  const questions = new Map<string, RequestQuestion[]>();
  if (idByKey.size > 0) {
    const notes = await db
      .select({
        missionId: schema.missionNotes.missionId,
        body: schema.missionNotes.body,
        createdAt: schema.missionNotes.createdAt,
      })
      .from(schema.missionNotes)
      .where(
        and(
          eq(schema.missionNotes.authorAccountId, owner.value),
          eq(schema.missionNotes.visibility, 'TRAVELLER_SHARED'),
          like(schema.missionNotes.body, 'Question about R-%'),
        ),
      )
      .orderBy(desc(schema.missionNotes.createdAt))
      .limit(QUESTION_READ_LIMIT);
    for (const note of notes) {
      const code = note.body.match(QUESTION_START)?.[1];
      const requestId = code ? idByKey.get(`${note.missionId}|${code}`) : undefined;
      if (!requestId || !code) continue;
      const text = requestQuestionText(note.body, code);
      if (text === null) continue;
      const mine = questions.get(requestId) ?? [];
      if (mine.length < REQUEST_QUESTION_LIMIT) {
        mine.push({ text, askedAt: note.createdAt });
        questions.set(requestId, mine);
      }
    }
  }
  return ok({ rules, questions });
}
