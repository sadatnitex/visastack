import { type Result, err, ok } from '@visastack/core';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import { MAX_EVIDENCE_REQUESTS_PER_SEND, orgGrantPermits, submitEvidenceResponse } from './agency';
import { type Db, first, schema } from './db';
import {
  type ExpiryEntry,
  describeExpiry,
  expiryDay,
  expiryDayCountsAsExpired,
  toExpiryEntry,
} from './document-expiry-rules';
import { documentExpiryEntriesTablePresent } from './document-expiry-tables';
import { isDocumentVersionUsable } from './documents';
import { activeOrVerifiedErasureStorageObjectIds } from './erasure';
import { type ServiceError, serviceError } from './errors';
import { evidenceSubmissionsPresent } from './evidence-submission-tables';
import { classifyStaleness, parseDocumentDate } from './expiry';
import { everydayDocumentCondition, lifecycleTablesPresent } from './lifecycle/foundation';
import { isUuid } from './lifecycle/foundation/ids';
import { referenceCodesFor } from './reference-codes';

/**
 * Answer From Your Records: everything one agency is waiting for, answered from what the traveller
 * already holds, in one reviewed and confirmed step.
 *
 * - `planEvidenceAnswers` reads. For each agency with a request waiting on the traveller it says,
 *   request by request, what is held, what qualifies, what is uncertain and what is missing. It
 *   writes nothing and shares nothing.
 * - `confirmEvidenceAnswers` sends. It works the plan out again at that moment and sends an answer
 *   only when the plan still offers exactly the copy the person reviewed, for that request, to the
 *   one agency the confirmation names. Each send goes through `submitEvidenceResponse`, which stays
 *   the only writer: it pins the exact version, rechecks the owner, the request and the agency's
 *   standing, queues the agency's notice and writes the audit entry.
 * - `readEvidenceAnswerReceipt` reads back what one confirmation sent, from rows that are never
 *   changed once written.
 *
 * All three take the central access proof and serve the owner of the record only. Anyone else, and
 * any id that does not exist, get the same "not found". Details (profile facts) are left to the
 * request's own page: this step sends documents only.
 *
 * Nothing here comes from a model: kinds, dates and rules are stored facts, and a rule is only ever
 * the one the request's own checklist item holds.
 */

/** Statuses in which a request waits on the traveller. */
const WAITING_STATUSES = ['OPEN', 'NEEDS_REPLACEMENT'] as const;

/** The most waiting requests one plan describes; `more` says when others exist. */
export const ANSWER_PLAN_REQUEST_LIMIT = 100;

/** The most answers one confirmation sends: the size of one agency send. */
export const MAX_ANSWERS_PER_CONFIRMATION = MAX_EVIDENCE_REQUESTS_PER_SEND;

/**
 * The key a page makes on the server for one confirmation: exactly 24 characters of the URL-safe
 * base64 alphabet (18 random bytes). A fixed shape, so one key can never be the start of another.
 */
const CONFIRMATION_KEY = /^[A-Za-z0-9_-]{24}$/;

/** Where one saved copy stands for one request. */
export type AnswerCopyState =
  /** Safe to send, in date, nothing uncertain. */
  | 'OK'
  /** Safe to send, but its date cannot be worked out or two saved dates disagree. */
  | 'DATE_UNCERTAIN'
  /** Past its own expiry date. */
  | 'EXPIRED'
  /** Older than the checklist item allows. */
  | 'TOO_OLD'
  /** The exact copy this agency sent back on this request. */
  | 'SENT_BACK'
  /** Not finished, or not passed, its safety checks. */
  | 'NOT_CHECKED';

export interface AnswerCopy {
  readonly documentId: string;
  /** The exact version that would be sent. */
  readonly versionId: string;
  readonly versionNumber: number;
  readonly name: string;
  readonly addedAt: Date;
  /** `YYYY-MM-DD`, or null when no expiry date is saved. */
  readonly expiresOn: string | null;
  /** The document's own date (`YYYY-MM-DD`), or null when none is saved. */
  readonly documentDate: string | null;
  /** Whole days since the document's own date, when the checklist has an age rule and the date is known. */
  readonly ageDays: number | null;
  readonly state: AnswerCopyState;
  /** True for `OK` and `DATE_UNCERTAIN`: the copy may be sent in this step. */
  readonly sendable: boolean;
  /**
   * This exact version was accepted on an earlier request of this traveller. The traveller's own
   * history, for the traveller only: it is never sent or shown to the agency now asking.
   */
  readonly acceptedBefore: {
    readonly times: number;
    readonly lastAt: Date;
    readonly lastByAgency: string | null;
  } | null;
}

export type AnswerReadiness =
  /** Exactly one copy qualifies and nothing about it is uncertain. */
  | 'READY'
  /** More than one copy qualifies: the person picks. */
  | 'CHOOSE'
  /** One copy qualifies but its date is uncertain: the person checks it. */
  | 'CHECK_DATE'
  /** Every copy of this kind is expired or older than the checklist allows. */
  | 'OUTDATED'
  /** The only copy is the one this agency sent back. */
  | 'NEEDS_NEW_COPY'
  /** A copy exists but has not finished, or did not pass, its safety checks. */
  | 'NOT_CHECKED'
  /** Nothing of this kind is saved. */
  | 'MISSING'
  /** A detail, or a request that names no kind of document: answered on its own page. */
  | 'OWN_STEP'
  /** The agency no longer has access to the records: nothing can be sent. */
  | 'NO_ACCESS';

export interface AnswerItem {
  readonly requestId: string;
  readonly referenceCode: string | null;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly docType: string | null;
  readonly fieldKey: string | null;
  readonly status: (typeof WAITING_STATUSES)[number];
  readonly missionId: string | null;
  readonly dueDate: Date | null;
  /** What the request's own checklist item says; null when the request came from no checklist item. */
  readonly rule: { readonly maxAgeDays: number | null; readonly optional: boolean } | null;
  readonly readiness: AnswerReadiness;
  /** Every saved copy of the kind asked, newest first, each with where it stands. */
  readonly copies: readonly AnswerCopy[];
}

export interface AnswerAgencyGroup {
  readonly organizationId: string;
  readonly organizationName: string;
  /** False when the agency can receive nothing right now (every item is `NO_ACCESS`). */
  readonly canReceive: boolean;
  /** Soonest due date first, none last. */
  readonly items: readonly AnswerItem[];
}

export interface EvidenceAnswerPlan {
  /** False until exact copies are kept (migration 0132): nothing can then be sent in this step. */
  readonly available: boolean;
  /** One group per agency with a request waiting on the traveller, in the order of their first item. */
  readonly agencies: readonly AnswerAgencyGroup[];
  /** True when more requests wait than this plan describes. */
  readonly more: boolean;
}

function ownerOnly(access: AuthorizedApplicant<'MANAGE'>): boolean {
  return AuthorizedApplicant.isGenuine(access, 'MANAGE') && access.actor.kind === 'applicant_owner';
}

const NOT_FOUND = 'evidence requests not found';

function readinessOf(copies: readonly AnswerCopy[]): AnswerReadiness {
  if (copies.length === 0) return 'MISSING';
  const sendable = copies.filter((copy) => copy.sendable);
  if (sendable.length > 1) return 'CHOOSE';
  const only = sendable[0];
  if (only) return only.state === 'OK' ? 'READY' : 'CHECK_DATE';
  if (copies.some((copy) => copy.state === 'NOT_CHECKED')) return 'NOT_CHECKED';
  if (copies.some((copy) => copy.state === 'SENT_BACK')) return 'NEEDS_NEW_COPY';
  return 'OUTDATED';
}

/**
 * What each agency is waiting for and what the traveller already holds for it. Read-only.
 *
 * Reads are batched: a fixed number of queries for the requests, documents, versions, dates and
 * history, plus one standing check per agency and case (not per request).
 */
export async function planEvidenceAnswers(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly now?: Date } = {},
): Promise<Result<EvidenceAnswerPlan, ServiceError>> {
  if (!ownerOnly(access)) return err(serviceError('not_found', NOT_FOUND));
  return ok(await buildPlan(access.tx, access.applicant.id, input.now ?? new Date()));
}

/**
 * The one definition of the plan, for the whole record or (`onlyRequestId`) for a single request:
 * the confirmation runs it again for each answer inside that answer's own locked transaction, so
 * the rule that offers a copy and the rule that sends it cannot drift apart.
 */
async function buildPlan(
  db: Db,
  applicantId: string,
  now: Date,
  onlyRequestId?: string,
): Promise<EvidenceAnswerPlan> {
  const requests = schema.evidenceRequests;

  const [available, waitingRows] = await Promise.all([
    evidenceSubmissionsPresent(db),
    db
      .select({
        id: requests.id,
        organizationId: requests.organizationId,
        missionId: requests.missionId,
        kind: requests.kind,
        docType: requests.docType,
        fieldKey: requests.fieldKey,
        status: requests.status,
        dueDate: requests.dueDate,
        respondingDocumentId: requests.respondingDocumentId,
        requirementId: schema.packRequirements.id,
        maxAgeDays: schema.packRequirements.maxAgeDays,
        optional: schema.packRequirements.optional,
      })
      .from(requests)
      .leftJoin(schema.packRequirements, eq(schema.packRequirements.id, requests.packRequirementId))
      .where(
        and(
          eq(requests.applicantId, applicantId),
          inArray(requests.status, WAITING_STATUSES),
          onlyRequestId === undefined ? undefined : eq(requests.id, onlyRequestId),
        ),
      )
      .orderBy(sql`${requests.dueDate} asc nulls last`, asc(requests.createdAt), asc(requests.id))
      .limit(ANSWER_PLAN_REQUEST_LIMIT + 1),
  ]);
  const more = waitingRows.length > ANSWER_PLAN_REQUEST_LIMIT;
  const waiting = waitingRows.slice(0, ANSWER_PLAN_REQUEST_LIMIT);
  if (waiting.length === 0) return { available, agencies: [], more: false };

  const organizationIds = [...new Set(waiting.map((row) => row.organizationId))];
  const docTypes = [
    ...new Set(
      waiting.flatMap((row) => (row.kind === 'DOCUMENT' && row.docType ? [row.docType] : [])),
    ),
  ];
  const lifecycle = await lifecycleTablesPresent(db);
  const [organizationRows, documents, codes] = await Promise.all([
    db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .where(inArray(schema.organizations.id, organizationIds)),
    docTypes.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: schema.documents.id,
            docType: schema.documents.docType,
            originalName: schema.documents.originalName,
            approvedName: schema.documents.approvedName,
            createdAt: schema.documents.createdAt,
            documentDate: schema.documents.documentDate,
            expiresAt: schema.documents.expiresAt,
          })
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.applicantId, applicantId),
              inArray(schema.documents.docType, docTypes),
              // The everyday copy only: present, not archived, not replaced by another document.
              isNull(schema.documents.supersededByDocumentId),
              lifecycle ? everydayDocumentCondition() : undefined,
            ),
          )
          .orderBy(desc(schema.documents.createdAt), desc(schema.documents.id)),
    referenceCodesFor(
      db,
      'R',
      waiting.map((row) => row.id),
    ),
  ]);
  const organizationName = new Map(organizationRows.map((row) => [row.id, row.name] as const));

  // The agency's standing, once per agency and case: the same test the send itself applies.
  const standing = new Map<string, boolean>();
  for (const row of waiting) {
    const key = `${row.organizationId}|${row.missionId ?? ''}`;
    if (!standing.has(key)) {
      standing.set(
        key,
        await orgGrantPermits(
          db,
          row.organizationId,
          applicantId,
          'MANAGE',
          row.missionId ?? undefined,
        ),
      );
    }
  }

  const documentIds = documents.map((document) => document.id);
  type VersionRow = typeof schema.documentVersions.$inferSelect;
  const latestVersion = new Map<string, VersionRow>();
  const expiryEntries = new Map<string, ExpiryEntry[]>();
  if (documentIds.length > 0) {
    const [versions, entriesPresent] = await Promise.all([
      db
        .select()
        .from(schema.documentVersions)
        .where(inArray(schema.documentVersions.documentId, documentIds))
        .orderBy(desc(schema.documentVersions.versionNumber)),
      documentExpiryEntriesTablePresent(db),
    ]);
    for (const version of versions) {
      if (!latestVersion.has(version.documentId)) latestVersion.set(version.documentId, version);
    }
    if (entriesPresent) {
      const rows = await db
        .select({
          documentId: schema.documentExpiryEntries.documentId,
          source: schema.documentExpiryEntries.source,
          expiresOn: schema.documentExpiryEntries.expiresOn,
          mirrored: schema.documentExpiryEntries.mirrored,
        })
        .from(schema.documentExpiryEntries)
        .where(inArray(schema.documentExpiryEntries.documentId, documentIds))
        .orderBy(
          desc(schema.documentExpiryEntries.createdAt),
          desc(schema.documentExpiryEntries.id),
        );
      for (const row of rows) {
        const list = expiryEntries.get(row.documentId) ?? [];
        list.push(toExpiryEntry(row));
        expiryEntries.set(row.documentId, list);
      }
    }
  }
  const versionRows = [...latestVersion.values()];
  const versionIds = versionRows.map((version) => version.id);
  const erased = await activeOrVerifiedErasureStorageObjectIds(
    db,
    versionRows.map((version) => version.storageObjectId),
  );

  // Earlier acceptances of these exact versions, and the version each waiting request last sent.
  const accepted = new Map<string, { times: number; lastAt: Date; lastBy: string }>();
  const lastSentVersion = new Map<string, string>();
  if (available) {
    const submissions = schema.evidenceRequestSubmissions;
    const sentBackIds = waiting
      .filter((row) => row.status === 'NEEDS_REPLACEMENT')
      .map((row) => row.id);
    const [acceptedRows, lastSends] = await Promise.all([
      versionIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              versionId: submissions.documentVersionId,
              decidedAt: schema.evidenceRequestDecisions.createdAt,
              organizationId: requests.organizationId,
            })
            .from(submissions)
            .innerJoin(
              schema.evidenceRequestDecisionSubmissions,
              eq(schema.evidenceRequestDecisionSubmissions.submissionId, submissions.id),
            )
            .innerJoin(
              schema.evidenceRequestDecisions,
              eq(
                schema.evidenceRequestDecisions.id,
                schema.evidenceRequestDecisionSubmissions.decisionId,
              ),
            )
            .innerJoin(requests, eq(requests.id, submissions.evidenceRequestId))
            .where(
              and(
                eq(requests.applicantId, applicantId),
                inArray(submissions.documentVersionId, versionIds),
                eq(schema.evidenceRequestDecisions.outcome, 'ACCEPTED'),
              ),
            )
            .orderBy(asc(schema.evidenceRequestDecisions.createdAt)),
      sentBackIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              requestId: submissions.evidenceRequestId,
              versionId: submissions.documentVersionId,
            })
            .from(submissions)
            .where(inArray(submissions.evidenceRequestId, sentBackIds))
            .orderBy(asc(submissions.roundNo)),
    ]);
    for (const row of acceptedRows) {
      const earlier = accepted.get(row.versionId);
      accepted.set(row.versionId, {
        times: (earlier?.times ?? 0) + 1,
        lastAt: row.decidedAt,
        lastBy: row.organizationId,
      });
    }
    // Oldest round first, so the last write per request is its newest send.
    for (const row of lastSends) lastSentVersion.set(row.requestId, row.versionId);
  }
  // The names of agencies that accepted a copy before, which may not be asking now.
  const acceptedBy = [...new Set([...accepted.values()].map((entry) => entry.lastBy))].filter(
    (id) => !organizationName.has(id),
  );
  if (acceptedBy.length > 0) {
    const rows = await db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .where(inArray(schema.organizations.id, acceptedBy));
    for (const row of rows) organizationName.set(row.id, row.name);
  }

  const copiesFor = (row: (typeof waiting)[number]): AnswerCopy[] => {
    if (row.kind !== 'DOCUMENT' || !row.docType) return [];
    const rule = row.requirementId !== null ? (row.maxAgeDays ?? null) : null;
    const copies: AnswerCopy[] = [];
    for (const document of documents) {
      if (document.docType !== row.docType) continue;
      const version = latestVersion.get(document.id);
      // A document with no stored version is not a copy of anything yet.
      if (!version) continue;
      const usable = isDocumentVersionUsable({
        safetyStatus: version.safetyStatus,
        processingStatus: version.processingStatus,
        erased: erased.has(version.storageObjectId),
      });
      const expiresOn = document.expiresAt ? expiryDay(document.expiresAt) : null;
      const staleness = classifyStaleness(parseDocumentDate(document.documentDate), rule, now);
      const datesDisagree = describeExpiry(
        document.expiresAt,
        expiryEntries.get(document.id) ?? [],
      ).mismatch;
      // The copy the agency sent back is that exact version; a newer upload of the same document
      // is a new copy. Without a pinned send on record, the document it named stands for it.
      const sentVersion = lastSentVersion.get(row.id);
      const sentBack =
        row.status === 'NEEDS_REPLACEMENT' &&
        (sentVersion !== undefined
          ? sentVersion === version.id
          : row.respondingDocumentId === document.id);
      const state: AnswerCopyState = !usable
        ? 'NOT_CHECKED'
        : sentBack
          ? 'SENT_BACK'
          : expiresOn !== null && expiryDayCountsAsExpired(expiresOn, now)
            ? 'EXPIRED'
            : staleness.status === 'stale'
              ? 'TOO_OLD'
              : staleness.status === 'unknown' || datesDisagree
                ? 'DATE_UNCERTAIN'
                : 'OK';
      const before = accepted.get(version.id);
      copies.push({
        documentId: document.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
        name: document.approvedName ?? document.originalName,
        addedAt: document.createdAt,
        expiresOn,
        documentDate: document.documentDate,
        ageDays: staleness.ageDays,
        state,
        sendable: state === 'OK' || state === 'DATE_UNCERTAIN',
        acceptedBefore: before
          ? {
              times: before.times,
              lastAt: before.lastAt,
              lastByAgency: organizationName.get(before.lastBy) ?? null,
            }
          : null,
      });
    }
    return copies;
  };

  const groups = new Map<string, AnswerItem[]>();
  for (const row of waiting) {
    const receivable = standing.get(`${row.organizationId}|${row.missionId ?? ''}`) === true;
    const ownStep = row.kind !== 'DOCUMENT' || !row.docType;
    const copies = receivable && !ownStep ? copiesFor(row) : [];
    const item: AnswerItem = {
      requestId: row.id,
      referenceCode: codes.get(row.id) ?? null,
      kind: row.kind,
      docType: row.docType,
      fieldKey: row.fieldKey,
      status: row.status as AnswerItem['status'],
      missionId: row.missionId,
      dueDate: row.dueDate,
      rule:
        row.requirementId !== null
          ? { maxAgeDays: row.maxAgeDays ?? null, optional: row.optional ?? false }
          : null,
      readiness: !receivable ? 'NO_ACCESS' : ownStep ? 'OWN_STEP' : readinessOf(copies),
      copies,
    };
    const list = groups.get(row.organizationId) ?? [];
    list.push(item);
    groups.set(row.organizationId, list);
  }

  return {
    available,
    more,
    agencies: [...groups.entries()].map(([organizationId, items]) => ({
      organizationId,
      organizationName: organizationName.get(organizationId) ?? '',
      canReceive: items.some((item) => item.readiness !== 'NO_ACCESS'),
      items,
    })),
  };
}

export interface WaitingAgency {
  readonly organizationId: string;
  readonly organizationName: string;
  /** Requests of this agency that wait on the traveller. */
  readonly waiting: number;
  /** How many of them ask for a document (the ones the review step can answer). */
  readonly documents: number;
}

/**
 * Who is waiting, in one query: each agency with a request waiting on the traveller, by name, with
 * how many requests wait. For the card on the Requests page, which must stay cheap; it says nothing
 * about what is held.
 */
export async function listWaitingAgencies(
  access: AuthorizedApplicant<'MANAGE'>,
): Promise<Result<readonly WaitingAgency[], ServiceError>> {
  if (!ownerOnly(access)) return err(serviceError('not_found', NOT_FOUND));
  const requests = schema.evidenceRequests;
  const rows = await access.tx
    .select({
      organizationId: requests.organizationId,
      organizationName: schema.organizations.name,
      waiting: sql<number>`count(*)::int`,
      documents: sql<number>`(count(*) filter (where ${requests.kind} = 'DOCUMENT' and ${requests.docType} is not null))::int`,
      firstDue: sql<Date | null>`min(${requests.dueDate})`,
    })
    .from(requests)
    .innerJoin(schema.organizations, eq(schema.organizations.id, requests.organizationId))
    .where(
      and(
        eq(requests.applicantId, access.applicant.id),
        inArray(requests.status, WAITING_STATUSES),
      ),
    )
    .groupBy(requests.organizationId, schema.organizations.name)
    .orderBy(sql`min(${requests.dueDate}) asc nulls last`, asc(schema.organizations.name));
  return ok(
    rows.map((row) => ({
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      waiting: Number(row.waiting),
      documents: Number(row.documents),
    })),
  );
}

export interface EvidenceAnswer {
  readonly requestId: string;
  readonly documentId: string;
  /** The exact version the person reviewed. */
  readonly documentVersionId: string;
}

export type EvidenceAnswerOutcome =
  /** Sent now: this exact copy went to the agency. */
  | { readonly requestId: string; readonly outcome: 'SENT'; readonly submissionId: string }
  /** This confirmation had already sent this exact copy: nothing was sent twice. */
  | { readonly requestId: string; readonly outcome: 'ALREADY_SENT'; readonly submissionId: string }
  /**
   * Nothing was sent: the record no longer offers that copy for that request to that agency. One
   * answer for every reason (a newer upload, an expiry, an ended share, a request answered
   * elsewhere, another agency's request, an id that does not exist), so it reveals nothing.
   */
  | { readonly requestId: string; readonly outcome: 'CHANGED' };

export interface EvidenceAnswerConfirmation {
  readonly organizationId: string;
  readonly organizationName: string;
  /** One entry per answer, in the order given. */
  readonly outcomes: readonly EvidenceAnswerOutcome[];
  readonly sent: number;
  readonly alreadySent: number;
  readonly changed: number;
}

/** The retry key one request's send carries under one confirmation. */
function sendKey(confirmationKey: string, requestId: string): string {
  return `${confirmationKey}_${requestId.toLowerCase()}`;
}

/**
 * Send the reviewed copies to one named agency. The traveller's explicit confirmation: nothing is
 * sent to any other agency, nothing is sent that the plan would not offer at that moment, and a
 * repeat with the same key sends nothing twice.
 *
 * Each answer is its own transaction, as when requests are answered one by one. Inside it the
 * request row and the document row are locked first, the plan for that one request is worked out
 * again under those locks, and only if it still offers exactly the reviewed copy is the existing
 * sender called (in the same transaction). The outcome of every answer is reported; there is no
 * all-or-nothing, because each request stands alone.
 */
export async function confirmEvidenceAnswers(
  access: AuthorizedApplicant<'MANAGE'>,
  input: {
    readonly organizationId: string;
    readonly confirmationKey: string;
    readonly answers: readonly EvidenceAnswer[];
    readonly now?: Date;
  },
): Promise<Result<EvidenceAnswerConfirmation, ServiceError>> {
  if (!ownerOnly(access)) return err(serviceError('not_found', NOT_FOUND));
  if (!CONFIRMATION_KEY.test(input.confirmationKey)) {
    return err(serviceError('invalid', 'the confirmation key is not valid'));
  }
  if (input.answers.length === 0) {
    return err(serviceError('invalid', 'choose at least one answer to send'));
  }
  if (input.answers.length > MAX_ANSWERS_PER_CONFIRMATION) {
    return err(
      serviceError(
        'invalid',
        `at most ${MAX_ANSWERS_PER_CONFIRMATION} answers can be sent in one step`,
      ),
    );
  }
  const requestIds = input.answers.map((answer) => answer.requestId.toLowerCase());
  if (new Set(requestIds).size !== requestIds.length) {
    return err(serviceError('invalid', 'each request can be answered once in one step'));
  }
  const db = access.tx;
  const actorAccountId = access.applicant.ownerAccountId;
  const applicantId = access.applicant.id;
  if (!(await evidenceSubmissionsPresent(db))) {
    return err(serviceError('invalid', 'answering in one step is not available yet'));
  }
  const organizationId = isUuid(input.organizationId) ? input.organizationId.toLowerCase() : null;
  const submissions = schema.evidenceRequestSubmissions;
  const requests = schema.evidenceRequests;

  /** The send this confirmation already recorded for one request of this traveller and agency. */
  const recorded = async (
    handle: Db,
    requestId: string,
  ): Promise<{ id: string; documentId: string; versionId: string } | undefined> =>
    organizationId === null
      ? undefined
      : first(
          await handle
            .select({
              id: submissions.id,
              documentId: submissions.documentId,
              versionId: submissions.documentVersionId,
            })
            .from(submissions)
            .innerJoin(requests, eq(requests.id, submissions.evidenceRequestId))
            .where(
              and(
                eq(requests.applicantId, applicantId),
                eq(requests.organizationId, organizationId),
                eq(submissions.evidenceRequestId, requestId),
                eq(submissions.idempotencyKey, sendKey(input.confirmationKey, requestId)),
              ),
            )
            .limit(1),
        );

  const outcomes: EvidenceAnswerOutcome[] = [];
  for (const answer of input.answers) {
    const changed: EvidenceAnswerOutcome = { requestId: answer.requestId, outcome: 'CHANGED' };
    if (
      organizationId === null ||
      !isUuid(answer.requestId) ||
      !isUuid(answer.documentId) ||
      !isUuid(answer.documentVersionId)
    ) {
      outcomes.push(changed);
      continue;
    }
    const requestId = answer.requestId.toLowerCase();
    const documentId = answer.documentId.toLowerCase();
    const versionId = answer.documentVersionId.toLowerCase();
    /** A repeat reports the same copy as already sent; a different copy never goes under a used key. */
    const repeatOf = (before: { id: string; documentId: string; versionId: string }) =>
      before.documentId === documentId && before.versionId === versionId
        ? ({
            requestId: answer.requestId,
            outcome: 'ALREADY_SENT',
            submissionId: before.id,
          } as const)
        : changed;

    outcomes.push(
      await db.transaction(async (tx): Promise<EvidenceAnswerOutcome> => {
        // The request first, then the document: nothing below can interleave with another send,
        // a decision, or a change to this document's row.
        const locked = first(
          await tx
            .select({ id: requests.id })
            .from(requests)
            .where(
              and(
                eq(requests.id, requestId),
                eq(requests.applicantId, applicantId),
                eq(requests.organizationId, organizationId),
              ),
            )
            .limit(1)
            .for('update'),
        );
        if (!locked) return changed;
        const before = await recorded(tx, requestId);
        if (before) return repeatOf(before);
        await tx
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(
            and(eq(schema.documents.id, documentId), eq(schema.documents.applicantId, applicantId)),
          )
          .limit(1)
          .for('update');
        const plan = await buildPlan(tx, applicantId, input.now ?? new Date(), requestId);
        const item = plan.agencies
          .find((agency) => agency.organizationId === organizationId)
          ?.items.find((candidate) => candidate.requestId === requestId);
        const copy = item?.copies.find(
          (candidate) =>
            candidate.sendable &&
            candidate.documentId === documentId &&
            candidate.versionId === versionId,
        );
        if (!copy) return changed;
        const sent = await submitEvidenceResponse(tx, {
          actorAccountId,
          requestId,
          documentId,
          documentVersionId: versionId,
          idempotencyKey: sendKey(input.confirmationKey, requestId),
        });
        if (sent.ok && sent.value.submissionId !== null) {
          return {
            requestId: answer.requestId,
            outcome: sent.value.replayed ? 'ALREADY_SENT' : 'SENT',
            submissionId: sent.value.submissionId,
          };
        }
        return changed;
      }),
    );
  }

  const count = (outcome: EvidenceAnswerOutcome['outcome']) =>
    outcomes.filter((entry) => entry.outcome === outcome).length;
  const organization =
    organizationId === null
      ? undefined
      : first(
          await db
            .select({ name: schema.organizations.name })
            .from(schema.organizations)
            .innerJoin(requests, eq(requests.organizationId, schema.organizations.id))
            .where(
              and(
                eq(schema.organizations.id, organizationId),
                eq(requests.applicantId, applicantId),
              ),
            )
            .limit(1),
        );
  return ok({
    organizationId: input.organizationId,
    organizationName: organization?.name ?? '',
    outcomes,
    sent: count('SENT'),
    alreadySent: count('ALREADY_SENT'),
    changed: count('CHANGED'),
  });
}

/** Where a sent copy stands now, in the words the traveller's request list already uses. */
export type AnswerReceiptState = 'WAITING_FOR_REVIEW' | 'ACCEPTED' | 'SENT_BACK' | 'CLOSED';

export interface AnswerReceiptLine {
  readonly submissionId: string;
  readonly requestId: string;
  readonly referenceCode: string | null;
  readonly docType: string | null;
  /** The name the file had when it was sent. */
  readonly title: string;
  readonly versionNumber: number;
  /** The first characters of the file's checksum; null when none was recorded. */
  readonly checksumFingerprint: string | null;
  readonly sentAt: Date;
  readonly state: AnswerReceiptState;
}

export interface EvidenceAnswerReceipt {
  readonly organizationId: string;
  readonly organizationName: string;
  /** Oldest send first. Empty when the key names no send of this traveller to this agency. */
  readonly lines: readonly AnswerReceiptLine[];
}

/**
 * What one confirmation sent, read back from the exact-copy records, which are never changed once
 * written. For the owner only; an unknown key, another traveller's key and another agency's id all
 * give the same empty receipt.
 */
export async function readEvidenceAnswerReceipt(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly organizationId: string; readonly confirmationKey: string },
): Promise<Result<EvidenceAnswerReceipt, ServiceError>> {
  if (!ownerOnly(access)) return err(serviceError('not_found', NOT_FOUND));
  const empty: EvidenceAnswerReceipt = {
    organizationId: input.organizationId,
    organizationName: '',
    lines: [],
  };
  const db = access.tx;
  if (
    !isUuid(input.organizationId) ||
    !CONFIRMATION_KEY.test(input.confirmationKey) ||
    !(await evidenceSubmissionsPresent(db))
  ) {
    return ok(empty);
  }
  const organizationId = input.organizationId.toLowerCase();
  const submissions = schema.evidenceRequestSubmissions;
  const requests = schema.evidenceRequests;
  const rows = await db
    .select({
      id: submissions.id,
      requestId: submissions.evidenceRequestId,
      key: submissions.idempotencyKey,
      title: submissions.titleAtSend,
      docType: submissions.docTypeAtSend,
      versionNumber: submissions.versionNumber,
      contentSha256: submissions.contentSha256,
      sentAt: submissions.sentAt,
      roundNo: submissions.roundNo,
      requestStatus: requests.status,
    })
    .from(submissions)
    .innerJoin(requests, eq(requests.id, submissions.evidenceRequestId))
    .where(
      and(
        eq(requests.applicantId, access.applicant.id),
        eq(requests.organizationId, organizationId),
        // Exactly the key this confirmation gives that request: no pattern match.
        sql`${submissions.idempotencyKey} = ${input.confirmationKey} || '_' || ${submissions.evidenceRequestId}::text`,
      ),
    )
    .orderBy(asc(submissions.sentAt), asc(submissions.id));
  const mine = rows.filter((row) => row.key === sendKey(input.confirmationKey, row.requestId));
  if (mine.length === 0) return ok(empty);

  const submissionIds = mine.map((row) => row.id);
  const requestIds = [...new Set(mine.map((row) => row.requestId))];
  const [decisions, newest, codes, organization] = await Promise.all([
    db
      .select({
        submissionId: schema.evidenceRequestDecisionSubmissions.submissionId,
        outcome: schema.evidenceRequestDecisions.outcome,
      })
      .from(schema.evidenceRequestDecisionSubmissions)
      .innerJoin(
        schema.evidenceRequestDecisions,
        eq(
          schema.evidenceRequestDecisions.id,
          schema.evidenceRequestDecisionSubmissions.decisionId,
        ),
      )
      .where(inArray(schema.evidenceRequestDecisionSubmissions.submissionId, submissionIds)),
    db
      .select({
        requestId: submissions.evidenceRequestId,
        roundNo: sql<number>`max(${submissions.roundNo})::int`,
      })
      .from(submissions)
      .where(inArray(submissions.evidenceRequestId, requestIds))
      .groupBy(submissions.evidenceRequestId),
    referenceCodesFor(db, 'R', requestIds),
    db
      .select({ name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1),
  ]);
  const decided = new Map(decisions.map((row) => [row.submissionId, row.outcome] as const));
  const newestRound = new Map(newest.map((row) => [row.requestId, Number(row.roundNo)] as const));
  const stateOf = (row: (typeof mine)[number]): AnswerReceiptState => {
    const outcome = decided.get(row.id);
    if (outcome === 'ACCEPTED') return 'ACCEPTED';
    if (outcome !== undefined) return outcome === 'CANCELLED' ? 'CLOSED' : 'SENT_BACK';
    const stillNewest = newestRound.get(row.requestId) === row.roundNo;
    return stillNewest && (row.requestStatus === 'RECEIVED' || row.requestStatus === 'UNDER_REVIEW')
      ? 'WAITING_FOR_REVIEW'
      : 'CLOSED';
  };
  return ok({
    organizationId,
    organizationName: first(organization)?.name ?? '',
    lines: mine.map((row) => ({
      submissionId: row.id,
      requestId: row.requestId,
      referenceCode: codes.get(row.requestId) ?? null,
      docType: row.docType,
      title: row.title,
      versionNumber: row.versionNumber,
      checksumFingerprint: row.contentSha256 ? row.contentSha256.slice(0, 12) : null,
      sentAt: row.sentAt,
      state: stateOf(row),
    })),
  });
}
