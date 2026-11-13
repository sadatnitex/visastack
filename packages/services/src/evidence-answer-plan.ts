import { type Result, err, ok } from '@visastack/core';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import { MAX_EVIDENCE_REQUESTS_PER_SEND, orgGrantPermits, submitEvidenceResponse } from './agency';
import { type Db, first, schema } from './db';
import { isDocumentVersionUsable, listDocumentsDetailed } from './documents';
import { activeOrVerifiedErasureStorageObjectIds } from './erasure';
import { type ServiceError, serviceError } from './errors';
import { listRequestHistoriesForOwner } from './evidence-request-histories';
import { evidenceSubmissionsPresent } from './evidence-submission-tables';
import type { EvidenceSubmissionState } from './evidence-submissions';
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
  /** An exact copy this agency already turned down on this request, in any round. */
  | 'SENT_BACK'
  /** Cannot be sent as it is: still being checked, did not pass its checks, or no longer stored. */
  | 'NOT_CHECKED';

export interface AnswerCopy {
  readonly documentId: string;
  /** The exact version that would be sent. */
  readonly versionId: string;
  readonly versionNumber: number;
  readonly name: string;
  /** When this exact version was added (not when the document was first saved). */
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
  /** Every copy is one this agency already turned down on this request. */
  | 'NEEDS_NEW_COPY'
  /** A copy exists but cannot be sent as it is (still checking, failed its checks, or erased). */
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
  return ok(await buildPlan(access.tx, access.applicant, input.now ?? new Date()));
}

/** Which optional tables exist, asked once and handed to every plan a confirmation works out. */
interface TablesPresent {
  readonly submissions: boolean;
  readonly lifecycle: boolean;
}

async function tablesPresent(db: Db): Promise<TablesPresent> {
  const [submissions, lifecycle] = await Promise.all([
    evidenceSubmissionsPresent(db),
    lifecycleTablesPresent(db),
  ]);
  return { submissions, lifecycle };
}

/**
 * The one definition of the plan, for the whole record or for a single request (`decide`): the
 * confirmation runs it again for each answer inside that answer's own locked transaction, so the
 * rule that offers a copy and the rule that sends it cannot drift apart. For a decision only what
 * decides is read: names, reference codes and the history of earlier acceptances are left out.
 */
async function buildPlan(
  db: Db,
  applicant: { readonly id: string; readonly ownerAccountId: string },
  now: Date,
  decide?: { readonly requestId: string; readonly present: TablesPresent },
): Promise<EvidenceAnswerPlan> {
  const applicantId = applicant.id;
  const onlyRequestId = decide?.requestId;
  const forDisplay = decide === undefined;
  const present = decide?.present ?? (await tablesPresent(db));
  const available = present.submissions;
  const lifecycle = present.lifecycle;
  const requests = schema.evidenceRequests;

  const waitingRows = await db
    .select({
      id: requests.id,
      organizationId: requests.organizationId,
      missionId: requests.missionId,
      kind: requests.kind,
      docType: requests.docType,
      fieldKey: requests.fieldKey,
      status: requests.status,
      dueDate: requests.dueDate,
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
    .limit(ANSWER_PLAN_REQUEST_LIMIT + 1);
  const more = waitingRows.length > ANSWER_PLAN_REQUEST_LIMIT;
  const waiting = waitingRows.slice(0, ANSWER_PLAN_REQUEST_LIMIT);
  if (waiting.length === 0) return { available, agencies: [], more: false };

  const organizationIds = [...new Set(waiting.map((row) => row.organizationId))];
  const docTypes = [
    ...new Set(
      waiting.flatMap((row) => (row.kind === 'DOCUMENT' && row.docType ? [row.docType] : [])),
    ),
  ];
  const [organizationRows, documents, codes] = await Promise.all([
    forDisplay
      ? db
          .select({ id: schema.organizations.id, name: schema.organizations.name })
          .from(schema.organizations)
          .where(inArray(schema.organizations.id, organizationIds))
      : Promise.resolve([]),
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
    forDisplay
      ? referenceCodesFor(
          db,
          'R',
          waiting.map((row) => row.id),
        )
      : Promise.resolve(new Map<string, string>()),
  ]);
  const organizationName = new Map(organizationRows.map((row) => [row.id, row.name] as const));

  const documentIds = documents.map((document) => document.id);
  const requestIds = waiting.map((row) => row.id);
  const decisions = schema.evidenceRequestDecisions;
  const submissions = schema.evidenceRequestSubmissions;
  const turnedDown = and(
    inArray(decisions.evidenceRequestId, requestIds),
    inArray(decisions.outcome, ['NEEDS_REPLACEMENT', 'CONTRADICTION', 'CORRECTION_PROPOSED']),
  );
  const standingKeys = [
    ...new Map(
      waiting.map((row) => [`${row.organizationId}|${row.missionId ?? ''}`, row] as const),
    ),
  ];
  // Independent of each other once the requests and documents are known, so read together: the
  // newest version of each document, its saved dates, what each agency already turned down, and
  // each agency's standing (once per agency and case: the same test the send itself applies).
  const [versionRows, expiryRows, turnedDownRows, standingRows] = await Promise.all([
    documentIds.length === 0
      ? Promise.resolve([])
      : db
          .selectDistinctOn([schema.documentVersions.documentId], {
            id: schema.documentVersions.id,
            documentId: schema.documentVersions.documentId,
            versionNumber: schema.documentVersions.versionNumber,
            storageObjectId: schema.documentVersions.storageObjectId,
            safetyStatus: schema.documentVersions.safetyStatus,
            processingStatus: schema.documentVersions.processingStatus,
            createdAt: schema.documentVersions.createdAt,
          })
          .from(schema.documentVersions)
          .where(inArray(schema.documentVersions.documentId, documentIds))
          .orderBy(schema.documentVersions.documentId, desc(schema.documentVersions.versionNumber)),
    // Whether a typed and a read expiry date disagree, through the one reader allowed to say
    // where a saved date came from. It changes what is ticked in advance, never what may be sent,
    // so a decision does not read it.
    forDisplay && documentIds.length > 0
      ? listDocumentsDetailed(db, applicant.ownerAccountId, applicantId, { withExpiry: true })
      : Promise.resolve(undefined),
    available
      ? db
          .select({
            requestId: decisions.evidenceRequestId,
            documentId: decisions.respondingDocumentId,
            decidedAt: decisions.createdAt,
            versionId: submissions.documentVersionId,
          })
          .from(decisions)
          .leftJoin(
            schema.evidenceRequestDecisionSubmissions,
            eq(schema.evidenceRequestDecisionSubmissions.decisionId, decisions.id),
          )
          .leftJoin(
            submissions,
            eq(submissions.id, schema.evidenceRequestDecisionSubmissions.submissionId),
          )
          .where(turnedDown)
      : db
          .select({
            requestId: decisions.evidenceRequestId,
            documentId: decisions.respondingDocumentId,
            decidedAt: decisions.createdAt,
            versionId: sql<string | null>`null`,
          })
          .from(decisions)
          .where(turnedDown),
    Promise.all(
      standingKeys.map(async ([key, row]) => {
        const permits = await orgGrantPermits(
          db,
          row.organizationId,
          applicantId,
          'MANAGE',
          row.missionId ?? undefined,
        );
        return [key, permits] as const;
      }),
    ),
  ]);
  const standing = new Map(standingRows);
  const latestVersion = new Map(
    versionRows.map((version) => [version.documentId, version] as const),
  );
  const datesDisagreeFor = new Set(
    expiryRows?.ok
      ? expiryRows.value.flatMap((summary) => (summary.expiry?.mismatch ? [summary.id] : []))
      : [],
  );

  // What each waiting request's agency already turned down, in every round and not only the last:
  // the exact versions it decided against, and, for a send made before exact copies were kept,
  // the document that decision named. A copy the agency rejected is never offered to it again on
  // that request; a newer upload of the same document is a new copy.
  const rejectedVersions = new Map<string, Set<string>>();
  /** By request, then document: the moment of the latest decision against an unpinned send. */
  const rejectedDocuments = new Map<string, Map<string, Date>>();
  for (const row of turnedDownRows) {
    if (row.versionId !== null) {
      const set = rejectedVersions.get(row.requestId) ?? new Set<string>();
      set.add(row.versionId);
      rejectedVersions.set(row.requestId, set);
    } else if (row.documentId !== null) {
      const byDocument = rejectedDocuments.get(row.requestId) ?? new Map<string, Date>();
      const earlier = byDocument.get(row.documentId);
      if (!earlier || earlier < row.decidedAt) byDocument.set(row.documentId, row.decidedAt);
      rejectedDocuments.set(row.requestId, byDocument);
    }
  }

  const versionIds = versionRows.map((version) => version.id);
  // Erased files, and (for display only) earlier acceptances of these exact versions on any
  // request of this traveller, with the name of the agency that accepted.
  const [erased, acceptedRows] = await Promise.all([
    activeOrVerifiedErasureStorageObjectIds(
      db,
      versionRows.map((version) => version.storageObjectId),
    ),
    forDisplay && available && versionIds.length > 0
      ? db
          .select({
            versionId: submissions.documentVersionId,
            decidedAt: decisions.createdAt,
            agencyName: schema.organizations.name,
          })
          .from(submissions)
          .innerJoin(
            schema.evidenceRequestDecisionSubmissions,
            eq(schema.evidenceRequestDecisionSubmissions.submissionId, submissions.id),
          )
          .innerJoin(
            decisions,
            eq(decisions.id, schema.evidenceRequestDecisionSubmissions.decisionId),
          )
          .innerJoin(requests, eq(requests.id, submissions.evidenceRequestId))
          .innerJoin(schema.organizations, eq(schema.organizations.id, requests.organizationId))
          .where(
            and(
              eq(requests.applicantId, applicantId),
              inArray(submissions.documentVersionId, versionIds),
              eq(decisions.outcome, 'ACCEPTED'),
            ),
          )
          .orderBy(asc(decisions.createdAt))
      : Promise.resolve([]),
  ]);
  const accepted = new Map<string, { times: number; lastAt: Date; lastByAgency: string }>();
  for (const row of acceptedRows) {
    accepted.set(row.versionId, {
      times: (accepted.get(row.versionId)?.times ?? 0) + 1,
      lastAt: row.decidedAt,
      lastByAgency: row.agencyName,
    });
  }

  const copiesFor = (row: (typeof waiting)[number]): AnswerCopy[] => {
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
      // Saved as midnight UTC of its day, and expired from the start of that day: the same
      // comparison readiness and the wallet make.
      const expiresOn = document.expiresAt ? document.expiresAt.toISOString().slice(0, 10) : null;
      const expired = document.expiresAt !== null && document.expiresAt.getTime() <= now.getTime();
      const staleness = classifyStaleness(parseDocumentDate(document.documentDate), rule, now);
      const datesDisagree = datesDisagreeFor.has(document.id);
      // Turned down as this exact version; or, when the send kept no exact copy, as this document
      // in a version that already existed when the agency decided.
      const unpinnedAt = rejectedDocuments.get(row.id)?.get(document.id);
      const sentBack =
        rejectedVersions.get(row.id)?.has(version.id) === true ||
        (unpinnedAt !== undefined && version.createdAt <= unpinnedAt);
      const state: AnswerCopyState = !usable
        ? 'NOT_CHECKED'
        : sentBack
          ? 'SENT_BACK'
          : expired
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
        addedAt: version.createdAt,
        expiresOn,
        documentDate: document.documentDate,
        ageDays: staleness.ageDays,
        state,
        sendable: state === 'OK' || state === 'DATE_UNCERTAIN',
        acceptedBefore: before ?? null,
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

export interface AskingAgency {
  readonly organizationId: string;
  readonly organizationName: string;
  /** Requests of this agency that wait on the traveller (0 when all are answered or closed). */
  readonly waiting: number;
  /** How many of the waiting ones ask for a document (the ones the review step can answer). */
  readonly waitingDocuments: number;
}

/**
 * Who has asked, in one query: every agency with a request for this traveller, by name, with how
 * many of its requests wait on the traveller. Agencies with something waiting come first, soonest
 * due date first. For the card on the Requests page and the "Asked by" line of each request; it
 * must stay cheap and says nothing about what is held.
 */
export async function listAskingAgencies(
  access: AuthorizedApplicant<'MANAGE'>,
): Promise<Result<readonly AskingAgency[], ServiceError>> {
  if (!ownerOnly(access)) return err(serviceError('not_found', NOT_FOUND));
  const requests = schema.evidenceRequests;
  const waits = inArray(requests.status, WAITING_STATUSES);
  const rows = await access.tx
    .select({
      organizationId: requests.organizationId,
      organizationName: schema.organizations.name,
      waiting: sql<number>`(count(*) filter (where ${waits}))::int`,
      waitingDocuments: sql<number>`(count(*) filter (where ${waits} and ${requests.kind} = 'DOCUMENT' and ${requests.docType} is not null))::int`,
    })
    .from(requests)
    .innerJoin(schema.organizations, eq(schema.organizations.id, requests.organizationId))
    .where(eq(requests.applicantId, access.applicant.id))
    .groupBy(requests.organizationId, schema.organizations.name)
    .orderBy(
      sql`(count(*) filter (where ${waits})) = 0`,
      sql`min(${requests.dueDate}) filter (where ${waits}) asc nulls last`,
      asc(schema.organizations.name),
    );
  return ok(
    rows.map((row) => ({
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      waiting: Number(row.waiting),
      waitingDocuments: Number(row.waitingDocuments),
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
  // Asked once here: each answer below runs on its own transaction handle, which would ask again.
  const present = await tablesPresent(db);
  if (!present.submissions) {
    return err(serviceError('invalid', 'answering in one step is not available yet'));
  }
  const organizationId = isUuid(input.organizationId) ? input.organizationId.toLowerCase() : null;
  const submissions = schema.evidenceRequestSubmissions;
  const requests = schema.evidenceRequests;

  /** The send this confirmation already recorded for one request of this traveller and agency. */
  const recorded = async (
    handle: Db,
    agencyId: string,
    requestId: string,
  ): Promise<{ id: string; documentId: string; versionId: string } | undefined> =>
    first(
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
            eq(requests.organizationId, agencyId),
            eq(submissions.evidenceRequestId, requestId),
            eq(submissions.idempotencyKey, sendKey(input.confirmationKey, requestId)),
          ),
        )
        .limit(1),
    );

  // Several answers to one agency in one confirmation give the agency one combined notice, keyed
  // on this confirmation and on the smallest request id in it (the same for a repeat, however many
  // answers were already sent), so it is written once, with the first answer to commit. A single
  // answer keeps its own notice.
  const agencyNotice =
    input.answers.length > 1
      ? { batchKey: input.confirmationKey, anchorRequestId: [...requestIds].sort()[0] ?? '' }
      : undefined;

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
        const before = await recorded(tx, organizationId, requestId);
        if (before) return repeatOf(before);
        await tx
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(
            and(eq(schema.documents.id, documentId), eq(schema.documents.applicantId, applicantId)),
          )
          .limit(1)
          .for('update');
        const plan = await buildPlan(tx, access.applicant, input.now ?? new Date(), {
          requestId,
          present,
        });
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
          ...(agencyNotice ? { agencyNotice } : {}),
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
      title: submissions.titleAtSend,
      docType: submissions.docTypeAtSend,
      versionNumber: submissions.versionNumber,
      sentAt: submissions.sentAt,
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
  if (rows.length === 0) return ok(empty);

  const requestIds = [...new Set(rows.map((row) => row.requestId))];
  // Where each send stands now comes from the one reader the request's own conversation uses, so
  // the receipt and the conversation cannot disagree.
  const [histories, codes, organization] = await Promise.all([
    listRequestHistoriesForOwner(access, { requestIds }),
    referenceCodesFor(db, 'R', requestIds),
    db
      .select({ name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1),
  ]);
  if (!histories.ok) return histories;
  const sendById = new Map(
    [...histories.value.values()].flatMap((history) =>
      history.sends.submissions.map((send) => [send.id, send] as const),
    ),
  );
  return ok({
    organizationId,
    organizationName: first(organization)?.name ?? '',
    lines: rows.map((row) => {
      const send = sendById.get(row.id);
      return {
        submissionId: row.id,
        requestId: row.requestId,
        referenceCode: codes.get(row.requestId) ?? null,
        docType: row.docType,
        title: row.title,
        versionNumber: row.versionNumber,
        checksumFingerprint: send?.checksumFingerprint ?? null,
        sentAt: row.sentAt,
        state: receiptState(send?.state),
      };
    }),
  });
}

/** A send the conversation no longer lists (only the newest are kept there) reads as closed. */
function receiptState(state: EvidenceSubmissionState | undefined): AnswerReceiptState {
  switch (state) {
    case 'AWAITING_DECISION':
      return 'WAITING_FOR_REVIEW';
    case 'ACCEPTED':
      return 'ACCEPTED';
    case 'NEEDS_REPLACEMENT':
    case 'CONTRADICTION':
    case 'CORRECTION_PROPOSED':
      return 'SENT_BACK';
    default:
      return 'CLOSED';
  }
}
