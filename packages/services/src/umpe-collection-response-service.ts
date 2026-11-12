import { type Result, err, ok } from '@visastack/core';
import { documentTypeName } from '@visastack/core/catalogue/documents';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  type CollectionResponseAccess,
  agencyMayReceiveAnswers,
  collectionRecipientAllowed,
  collectionResponseAccessProblem,
  collectionResponsesPresent,
  lineOf,
  liveCollectionResponse,
} from './access/collection-response-access';
import { GuestCollectionSessionProof } from './access/guest-collection';
import { type SelfScope, selfScopeProblem } from './access/principal';
import { AuthorizedApplicant } from './access/require-access';
import { StepUpProof } from './access/step-up-proof';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { isDocumentVersionUsable } from './documents';
import { activeOrVerifiedErasureStorageObjectIds } from './erasure';
import { type ServiceError, serviceError, keyedError } from './errors';
import {
  everydayDocumentCondition,
  presentDocumentCondition,
} from './lifecycle/foundation/conditions';
import { isUuid } from './lifecycle/foundation/ids';
import { lifecycleTablesPresent } from './lifecycle/foundation/presence';
import { enqueueNotificationBothChannels } from './notifications';
import type { KeyManagementPort } from './ports';
import { isProtectedPlaceholder, revealFactVersionValue } from './profile';
import { RATE_LIMITS, checkRateLimits } from './rate-limit';
import {
  type BrandSnapshot,
  type CollectionItem,
  parseBrandSnapshot,
  parseItems,
  revisionContentSha256,
} from './umpe-collection-request-items';
import {
  type DocumentLike,
  type FactLike,
  type ItemProposal,
  RESPONSE_CONSENT_VERSION,
  type ResponseLine,
  type ServableVersionLike,
  linesFromSelections,
  proposeEvidence,
  responseContentSha256,
} from './umpe-collection-response-evidence';
import { collectionResponseRecipient } from './umpe-collection-response-recipient';

/**
 * A signed-in traveller answers an agency document request from their own record (UMPE P7,
 * locked contract section 6, branches 1 and 2).
 *
 * Opening a link grants nothing. The traveller signs in (the link's recipient address must match
 * when it has one), chooses one of their own people, sees the exact issued checklist with matching
 * copies from that person's record proposed, approves item by item, may leave items Still Missing,
 * and submits. Submitting writes an append-only response naming the exact request revision, the
 * person, every exact document version and fact version chosen, and the consent wording version.
 *
 * The agency reaches ONLY those exact versions, and only through the response itself
 * (`CollectionResponseAccess`): no grant is made, no case is made, nothing else of the person is
 * visible, and a later version of a chosen document is never shared. The traveller can withdraw
 * an answer at any time, which ends the agency's access at the next request. The agency sees
 * "Submitted to Agency", never Reviewed or Accepted.
 *
 * Every refusal on the link side looks exactly like a closed link. Every mutation is audited with
 * counts and kinds only.
 */

/** Everything the traveller may see about an open request they are allowed to answer. */
export interface ResponseDesk {
  readonly linkId: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  /** The agency, only when VisaStack had reviewed it when the request was issued. */
  readonly agency: BrandSnapshot | null;
  readonly destination: string;
  readonly purpose: string | null;
  readonly dueAt: Date | null;
  readonly expiresAt: Date;
  readonly items: readonly CollectionItem[];
  /**
   * Whether VisaStack has reviewed the agency (ACTIVE), checked live. Only a reviewed agency can be
   * answered: the page explains the wait instead of offering Submit.
   */
  readonly agencyReviewed: boolean;
}

/** No withdrawal recorded for the response (whatever the request's state). */
function notWithdrawn() {
  return sql`not exists (select 1 from agency_collection_response_withdrawals w where w.response_id = ${schema.agencyCollectionResponses.id})`;
}

function closed(): ServiceError {
  return keyedError('not_found', 'umpe_collection_response_service.this_request_link_is_not_open');
}

/** The open, intact request this link names, for an account allowed to answer it, or null. */
async function loadDesk(
  db: Db,
  session: GuestCollectionSessionProof,
  accountId: string,
  now: Date,
): Promise<ResponseDesk | null> {
  const row = await collectionResponseRecipient(db, session, now);
  if (!row) return null;
  const revision = first(
    await db
      .select()
      .from(schema.agencyCollectionRequestRevisions)
      .where(
        and(
          eq(schema.agencyCollectionRequestRevisions.id, row.revisionId),
          eq(schema.agencyCollectionRequestRevisions.requestId, row.requestId),
        ),
      )
      .limit(1),
  );
  if (!revision) return null;
  // The issued checklist is re-verified on every read: a changed revision is never shown.
  const items = parseItems(revision.items);
  const brand = parseBrandSnapshot(revision.brandSnapshot);
  if (items === null || brand === 'invalid') return null;
  const intact =
    revisionContentSha256({
      requestId: revision.requestId,
      revisionNo: revision.revisionNo,
      packVersionId: revision.packVersionId,
      packChecksum: revision.packChecksum,
      items,
      brandSnapshot: brand,
    }) === revision.contentSha256;
  if (!intact) return null;
  const allowed = await collectionRecipientAllowed(db, {
    linkId: row.linkId,
    organizationId: row.organizationId,
    // The address this link was sent to, when it was emailed; a copied link binds to nobody.
    emailHint: row.emailHint,
    accountId,
  });
  if (!allowed) return null;
  return {
    linkId: row.linkId,
    organizationId: row.organizationId,
    requestId: row.requestId,
    revisionId: revision.id,
    revisionNo: revision.revisionNo,
    agency: brand,
    destination: row.destination,
    purpose: row.purpose,
    dueAt: row.dueAt,
    expiresAt: row.expiresAt,
    items,
    agencyReviewed: await agencyMayReceiveAnswers(db, row.organizationId),
  };
}

/**
 * The request a signed-in traveller may answer through this link, or not found for every link
 * that is not open, not intact, or not addressed to this account (all alike).
 */
export async function openCollectionResponseDesk(
  db: Db,
  session: GuestCollectionSessionProof,
  self: SelfScope,
  now: Date = new Date(),
): Promise<Result<ResponseDesk, ServiceError>> {
  if (!GuestCollectionSessionProof.isGenuine(session)) return err(closed());
  if (selfScopeProblem(self)) return err(closed());
  const desk = await loadDesk(db, session, self.accountId, now);
  return desk ? ok(desk) : err(closed());
}

/** Detail values the traveller sees for their own record when a value is stored protected. */
const HIDDEN_VALUE = 'Saved, Hidden Here';

/** Fact statuses a traveller has stood behind: their own entry or a confirmed reading. */
const ANSWERABLE_FACT_STATUSES = [
  'DECLARED',
  'APPLICANT_CONFIRMED',
  'DOCUMENT_SUPPORTED',
  'AGENCY_REVIEWED',
] as const;

/** One person's present documents, newest servable version each, and the requested details. */
async function personEvidence(
  db: Db,
  applicantId: string,
  items: readonly CollectionItem[],
  encryption: KeyManagementPort | undefined,
): Promise<{ documents: DocumentLike[]; versions: ServableVersionLike[]; facts: FactLike[] }> {
  const lifecycle = await lifecycleTablesPresent(db);
  const documentRows = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.applicantId, applicantId),
        eq(schema.documents.walletVisible, true),
        lifecycle ? everydayDocumentCondition() : undefined,
      ),
    );
  const documents: DocumentLike[] = documentRows.map((row) => ({
    id: row.id,
    docType: row.docType,
    title:
      row.approvedName ??
      (row.docType ? (documentTypeName(row.docType) ?? row.originalName) : row.originalName),
    expiresAt: row.expiresAt,
    supersededByDocumentId: row.supersededByDocumentId,
  }));
  const versions: ServableVersionLike[] = [];
  if (documents.length > 0) {
    const all = await db
      .select()
      .from(schema.documentVersions)
      .where(
        inArray(
          schema.documentVersions.documentId,
          documents.map((d) => d.id),
        ),
      );
    // Only the newest version of each document is ever offered, and only when it is servable
    // right now: an older copy is never handed over in place of one still being checked.
    const newest = new Map<string, (typeof all)[number]>();
    for (const version of all) {
      const seen = newest.get(version.documentId);
      if (!seen || version.versionNumber > seen.versionNumber) {
        newest.set(version.documentId, version);
      }
    }
    const leaving = await activeOrVerifiedErasureStorageObjectIds(
      db,
      [...newest.values()].map((version) => version.storageObjectId),
    );
    for (const version of newest.values()) {
      if (
        isDocumentVersionUsable({
          safetyStatus: version.safetyStatus,
          processingStatus: version.processingStatus,
          erased: leaving.has(version.storageObjectId),
        })
      ) {
        versions.push({
          id: version.id,
          documentId: version.documentId,
          versionNumber: version.versionNumber,
          createdAt: version.createdAt,
        });
      }
    }
  }
  const fieldKeys = [
    ...new Set(
      items.flatMap((item) => (item.kind === 'FIELD' && item.fieldKey ? [item.fieldKey] : [])),
    ),
  ];
  const facts: FactLike[] = [];
  if (fieldKeys.length > 0) {
    const rows = await db
      .select({
        factId: schema.facts.id,
        fieldKey: schema.fieldDefinitions.key,
        repeatingRecordKey: schema.facts.repeatingRecordKey,
        version: schema.factVersions,
      })
      .from(schema.facts)
      .innerJoin(
        schema.fieldDefinitions,
        eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
      )
      .innerJoin(schema.factVersions, eq(schema.factVersions.id, schema.facts.currentVersionId))
      .where(
        and(
          eq(schema.facts.applicantId, applicantId),
          inArray(schema.fieldDefinitions.key, fieldKeys),
          inArray(schema.factVersions.status, [...ANSWERABLE_FACT_STATUSES]),
        ),
      );
    for (const row of rows) {
      let display = row.version.value ?? '';
      if (row.version.protectedKeyVersion !== null) {
        const revealed = encryption
          ? await revealFactVersionValue(db, encryption, row.version)
          : null;
        display = revealed?.ok ? revealed.value : HIDDEN_VALUE;
      }
      if (display.trim().length === 0 || isProtectedPlaceholder(display)) continue;
      facts.push({
        factId: row.factId,
        factVersionId: row.version.id,
        fieldKey: row.fieldKey,
        repeatingRecordKey: row.repeatingRecordKey,
        display,
        savedAt: row.version.createdAt,
      });
    }
  }
  return { documents, versions, facts };
}

/**
 * Only the record's own owner answers for it (themselves or a profile they manage): an agency or a
 * recipient acting through a grant never does. The owner's account is the one that signed in,
 * because `requireAccess` issues an owner proof only to the owning account.
 */
function notOwner(
  person: AuthorizedApplicant<'VIEW_METADATA'> | AuthorizedApplicant<'SHARE'>,
): boolean {
  return person.actor.kind !== 'applicant_owner';
}

export interface ResponseProposal {
  readonly desk: ResponseDesk;
  readonly person: { readonly id: string; readonly displayName: string };
  readonly proposals: readonly ItemProposal[];
}

/**
 * The issued checklist with the person's own matching copies proposed. Reads only the chosen
 * person's record, and only for its owner (owner or a profile they manage, through
 * `requireAccess`). Grants nothing and writes nothing.
 */
export async function proposeCollectionResponse(
  db: Db,
  session: GuestCollectionSessionProof,
  person: AuthorizedApplicant<'VIEW_METADATA'>,
  options: { readonly encryption?: KeyManagementPort; readonly now?: Date } = {},
): Promise<Result<ResponseProposal, ServiceError>> {
  if (!GuestCollectionSessionProof.isGenuine(session)) return err(closed());
  if (!AuthorizedApplicant.isGenuine(person, 'VIEW_METADATA') || notOwner(person)) {
    return err(keyedError('not_found', 'umpe_collection_response_service.record_not_found'));
  }
  const now = options.now ?? new Date();
  const desk = await loadDesk(db, session, person.applicant.ownerAccountId, now);
  if (!desk) return err(closed());
  const evidence = await personEvidence(db, person.applicant.id, desk.items, options.encryption);
  return ok({
    desk,
    person: { id: person.applicant.id, displayName: person.applicant.displayName },
    proposals: proposeEvidence(
      desk.items,
      evidence.documents,
      evidence.versions,
      evidence.facts,
      now,
    ),
  });
}

export interface SubmitResponseInput {
  /** The link and exact revision the person reviewed: a submit for anything else is refused. */
  readonly linkId: string;
  readonly revisionId: string;
  /** Issued item id to the candidate keys chosen for it; an item left out is Still Missing. */
  readonly selections: Readonly<Record<string, readonly string[]>>;
  /** The consent wording version the traveller agreed to; must be the current one. */
  readonly consentVersion: string;
  readonly now?: Date;
}

export interface SubmittedResponse {
  readonly responseId: string;
  readonly submittedAt: Date;
  readonly documents: number;
  readonly details: number;
  readonly missing: number;
  /** Earlier answers by this person to the same request, now replaced by this one. */
  readonly replaced: number;
}

const SELECTION_MESSAGES = {
  unknown_item: 'This checklist has changed. Reload the page and choose again.',
  not_offered: 'One of your choices is no longer available. Reload the page and choose again.',
  too_many: 'Choose at most 10 copies for one item.',
} as const;

/**
 * Submit the traveller's answer: an append-only response with exactly the chosen document
 * versions and fact versions, and a Still Missing line for every item left empty. Every choice is
 * checked against the proposals worked out again here, inside the transaction, so nothing outside
 * the person's present, servable record can be named. Needs `SHARE` on the person, which carries a
 * recent identity confirmation (step-up), like every other sharing decision. An earlier live
 * answer by the same person to the same request is withdrawn by this one in the same transaction,
 * so the agency always sees one current answer. No grant and no case are made.
 */
export async function submitCollectionResponse(
  db: Db,
  session: GuestCollectionSessionProof,
  person: AuthorizedApplicant<'SHARE'>,
  input: SubmitResponseInput,
): Promise<Result<SubmittedResponse, ServiceError>> {
  if (!GuestCollectionSessionProof.isGenuine(session)) return err(closed());
  if (!AuthorizedApplicant.isGenuine(person, 'SHARE') || notOwner(person)) {
    return err(keyedError('not_found', 'umpe_collection_response_service.record_not_found'));
  }
  const accountId = person.applicant.ownerAccountId;
  if (input.consentVersion !== RESPONSE_CONSENT_VERSION) {
    return err(keyedError('invalid', 'umpe_collection_response_service.agree_to_share_before_you_submit'));
  }
  if (!(await collectionResponsesPresent(db))) {
    return err(keyedError('upstream_error', 'umpe_collection_response_service.answering_requests_is_not_available_yet'));
  }
  const applicantId = person.applicant.id;
  return db.transaction(async (tx) => {
    // One answer at a time per person and request: two submits cannot both stay live.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`visastack:collection-response:${applicantId}`}))`,
    );
    // The time is read once the lock is held, so answers are always stored in the order they won.
    const now = input.now ?? new Date();
    const desk = await loadDesk(tx, session, accountId, now);
    if (!desk) return err(closed());
    // What the person reviewed and agreed to must be exactly what this link opens now; a cookie
    // replaced by another request's link (another tab) must never receive this answer.
    if (desk.linkId !== input.linkId || desk.revisionId !== input.revisionId) {
      return err(
        keyedError('invalid', 'umpe_collection_response_service.this_page_is_out_of_date'),
      );
    }
    if (!desk.agencyReviewed) {
      return err(keyedError('forbidden', 'umpe_collection_response_service.this_agency_has_not_been_reviewed'));
    }
    const organizationId = desk.organizationId;
    const evidence = await personEvidence(tx, applicantId, desk.items, undefined);
    const proposals = proposeEvidence(
      desk.items,
      evidence.documents,
      evidence.versions,
      evidence.facts,
      now,
    );
    const made = linesFromSelections(proposals, input.selections);
    if (!made.ok) return err(serviceError('invalid', SELECTION_MESSAGES[made.problem]));
    const lines = made.lines;
    // Every answer is kept for good and notifies the agency, so one account, and one request,
    // receive only so many in an hour. Counted here, once the answer is valid, inside the
    // transaction: an attempt refused for any reason above is never counted.
    const limited = await checkRateLimits(tx, [
      {
        input: {
          subjectId: `account:${accountId}`,
          action: 'collect.response_submit',
          label: 'answer',
        },
        config: RATE_LIMITS.COLLECTION_RESPONSE_SUBMIT_ACCOUNT,
      },
      {
        input: {
          subjectId: `request:${desk.requestId}`,
          action: 'collect.response_request',
          label: 'answer',
        },
        config: RATE_LIMITS.COLLECTION_RESPONSE_SUBMIT_REQUEST,
      },
    ]);
    if (!limited.allowed) {
      return err(
        keyedError('rate_limited', 'umpe_collection_response_service.too_many_answers_were_sent_just'),
      );
    }
    const responses = schema.agencyCollectionResponses;
    const earlier = await tx
      .select({ id: responses.id })
      .from(responses)
      .where(
        and(
          eq(responses.requestId, desk.requestId),
          eq(responses.organizationId, organizationId),
          eq(responses.applicantId, applicantId),
          notWithdrawn(),
        ),
      );
    if (earlier.length > 0) {
      await tx.insert(schema.agencyCollectionResponseWithdrawals).values(
        earlier.map((replaced) => ({
          responseId: replaced.id,
          applicantId,
          withdrawnByAccountId: accountId,
          reason: 'REPLACED',
          withdrawnAt: now,
        })),
      );
    }
    for (const replaced of earlier) {
      await appendAuditEvent(tx, {
        eventType: 'AGENCY_COLLECTION_RESPONSE_WITHDRAWN',
        actorAccountId: accountId,
        action: 'SHARE',
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId,
        resourceType: 'agency_collection_response',
        resourceId: replaced.id,
        reason: 'replaced_by_new_answer',
        metadata: { organizationId },
      });
    }
    const titles = new Map(evidence.documents.map((d) => [d.id, d.title] as const));
    const contentSha256 = responseContentSha256({
      requestId: desk.requestId,
      revisionId: desk.revisionId,
      applicantId,
      consentVersion: RESPONSE_CONSENT_VERSION,
      lines,
    });
    const created = first(
      await tx
        .insert(responses)
        .values({
          organizationId,
          requestId: desk.requestId,
          revisionId: desk.revisionId,
          linkId: desk.linkId,
          applicantId,
          submittedByAccountId: accountId,
          destination: desk.destination,
          revisionNo: desk.revisionNo,
          personName: person.applicant.displayName.slice(0, 200) || 'Traveller',
          consentVersion: RESPONSE_CONSENT_VERSION,
          contentSha256,
          submittedAt: now,
        })
        .returning({ id: responses.id, submittedAt: responses.submittedAt }),
    );
    if (!created) throw new Error('response insert returned nothing');
    await tx.insert(schema.agencyCollectionResponseItems).values(
      lines.map((line) => ({
        responseId: created.id,
        itemId: line.itemId,
        kind: line.kind,
        documentId: line.kind === 'DOCUMENT' ? line.documentId : null,
        documentVersionId: line.kind === 'DOCUMENT' ? line.documentVersionId : null,
        factId: line.kind === 'FIELD' ? line.factId : null,
        factVersionId: line.kind === 'FIELD' ? line.factVersionId : null,
        title: line.kind === 'DOCUMENT' ? (titles.get(line.documentId) ?? null) : null,
      })),
    );
    const counts = countLines(lines);
    await appendAuditEvent(tx, {
      eventType: 'AGENCY_COLLECTION_RESPONSE_SUBMITTED',
      actorAccountId: accountId,
      action: 'SHARE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'agency_collection_response',
      resourceId: created.id,
      metadata: {
        organizationId,
        requestId: desk.requestId,
        revisionNo: desk.revisionNo,
        consentVersion: RESPONSE_CONSENT_VERSION,
        ...counts,
        replaced: earlier.length,
      },
    });
    await noticeAgencyAdmins(tx, {
      organizationId,
      requestId: desk.requestId,
      responseId: created.id,
      agencyName: desk.agency?.name ?? null,
    });
    return ok({
      responseId: created.id,
      submittedAt: created.submittedAt,
      ...counts,
      replaced: earlier.length,
    });
  });
}

/**
 * "Submitted to Agency" for the agency's active owners and admins, in the app and by email,
 * queued with the answer. Names the agency only: never the person, the route or what was shared.
 * The worker sends it only while the answer is still live (`collectionResponseStillLive`) and the
 * recipient is still an owner or admin of the reviewed agency.
 */
async function noticeAgencyAdmins(
  tx: Db,
  input: {
    readonly organizationId: string;
    readonly requestId: string;
    readonly responseId: string;
    readonly agencyName: string | null;
  },
): Promise<void> {
  const admins = await tx
    .select({ accountId: schema.memberships.accountId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, input.organizationId),
        eq(schema.memberships.active, true),
        inArray(schema.memberships.role, ['OWNER', 'ADMIN']),
      ),
    );
  for (const admin of admins) {
    await enqueueNotificationBothChannels(tx, {
      eventType: 'AGENCY_COLLECTION_RESPONSE_SUBMITTED',
      resourceId: input.responseId,
      recipientAccountId: admin.accountId,
      organizationId: input.organizationId,
      payload: {
        subject: 'Submitted to Agency',
        summary: input.agencyName
          ? `An answer to one of your document requests was submitted to ${input.agencyName}.`
          : 'An answer to one of your document requests was submitted to your agency.',
        deepLinkPath: `/app/agency/${input.organizationId}/collection/request?id=${input.requestId}#collection-responses`,
      },
    });
  }
}

function countLines(lines: readonly ResponseLine[]): {
  documents: number;
  details: number;
  missing: number;
} {
  return {
    documents: lines.filter((l) => l.kind === 'DOCUMENT').length,
    details: lines.filter((l) => l.kind === 'FIELD').length,
    missing: lines.filter((l) => l.kind === 'MISSING').length,
  };
}

/** One of the person's answers, as their owner sees it. */
export interface OwnCollectionResponse {
  readonly id: string;
  /** The agency's name, or null while VisaStack has not reviewed it (it is never shown then). */
  readonly agencyName: string | null;
  readonly destination: string;
  readonly revisionNo: number;
  readonly submittedAt: Date;
  readonly withdrawnAt: Date | null;
  readonly documents: number;
  readonly details: number;
  readonly missing: number;
}

/** The newest answers the owner's list shows. */
export const OWN_RESPONSE_LIST_LIMIT = 100;

/**
 * Every answer this person has given to agency requests, newest first, with whom each went to and
 * how much it holds, so the owner always sees what is shared. Owner only. Empty before the
 * migration runs.
 */
export async function listOwnCollectionResponses(
  db: Db,
  person: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<Result<OwnCollectionResponse[], ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(person, 'VIEW_METADATA') ||
    person.actor.kind !== 'applicant_owner'
  ) {
    return err(keyedError('not_found', 'umpe_collection_response_service.record_not_found'));
  }
  if (!(await collectionResponsesPresent(db))) return ok([]);
  const responses = schema.agencyCollectionResponses;
  const rows = await db
    .select({
      id: responses.id,
      agencyName: schema.organizations.name,
      agencyStatus: schema.organizations.status,
      destination: responses.destination,
      revisionNo: responses.revisionNo,
      submittedAt: responses.submittedAt,
      withdrawnAt: schema.agencyCollectionResponseWithdrawals.withdrawnAt,
    })
    .from(responses)
    .innerJoin(schema.organizations, eq(schema.organizations.id, responses.organizationId))
    .leftJoin(
      schema.agencyCollectionResponseWithdrawals,
      eq(schema.agencyCollectionResponseWithdrawals.responseId, responses.id),
    )
    .where(eq(responses.applicantId, person.applicant.id))
    // Live answers first, so one that can still be withdrawn never drops off the list.
    .orderBy(
      sql`${schema.agencyCollectionResponseWithdrawals.withdrawnAt} is not null`,
      desc(responses.submittedAt),
      desc(responses.id),
    )
    .limit(OWN_RESPONSE_LIST_LIMIT);
  if (rows.length === 0) return ok([]);
  const counts = await lineCounts(
    db,
    rows.map((r) => r.id),
  );
  return ok(
    rows.map(({ agencyStatus, agencyName, ...row }) => ({
      ...row,
      // Named only while VisaStack has reviewed the agency, as everywhere a traveller sees one.
      agencyName: agencyStatus === 'ACTIVE' ? agencyName : null,
      ...(counts.get(row.id) ?? { documents: 0, details: 0, missing: 0 }),
    })),
  );
}

async function lineCounts(
  db: Db,
  responseIds: readonly string[],
): Promise<Map<string, { documents: number; details: number; missing: number }>> {
  const items = schema.agencyCollectionResponseItems;
  const rows = await db
    .select({ responseId: items.responseId, kind: items.kind, n: sql<number>`count(*)::int` })
    .from(items)
    .where(inArray(items.responseId, [...responseIds]))
    .groupBy(items.responseId, items.kind);
  const map = new Map<string, { documents: number; details: number; missing: number }>();
  for (const row of rows) {
    const entry = map.get(row.responseId) ?? { documents: 0, details: 0, missing: 0 };
    if (row.kind === 'DOCUMENT') entry.documents = Number(row.n);
    else if (row.kind === 'FIELD') entry.details = Number(row.n);
    else entry.missing = Number(row.n);
    map.set(row.responseId, entry);
  }
  return map;
}

/**
 * Withdraw one of the person's answers. The agency loses access to everything in it at its next
 * request (a file link already handed out is re-checked when opened, and refused). The answer
 * itself stays as history; the withdrawal is its own append-only record. Owner only; taking access away needs no fresh sign-in.
 */
export async function withdrawCollectionResponse(
  db: Db,
  person: AuthorizedApplicant<'MANAGE'>,
  responseId: string,
  now: Date = new Date(),
): Promise<Result<{ readonly withdrawnAt: Date }, ServiceError>> {
  if (!AuthorizedApplicant.isGenuine(person, 'MANAGE') || person.actor.kind !== 'applicant_owner') {
    return err(keyedError('not_found', 'umpe_collection_response_service.record_not_found'));
  }
  const notFound = err(keyedError('not_found', 'umpe_collection_response_review.no_such_answer'));
  if (!isUuid(responseId) || !(await collectionResponsesPresent(db))) return notFound;
  const actorAccountId = person.applicant.ownerAccountId;
  return db.transaction(async (tx) => {
    const responses = schema.agencyCollectionResponses;
    const own = first(
      await tx
        .select({ organizationId: responses.organizationId })
        .from(responses)
        .where(and(eq(responses.id, responseId), eq(responses.applicantId, person.applicant.id)))
        .limit(1),
    );
    if (!own) return notFound;
    // One withdrawal per answer (unique): a second attempt changes nothing and says so.
    const recorded = first(
      await tx
        .insert(schema.agencyCollectionResponseWithdrawals)
        .values({
          responseId,
          applicantId: person.applicant.id,
          withdrawnByAccountId: actorAccountId,
          reason: 'WITHDRAWN',
          withdrawnAt: now,
        })
        .onConflictDoNothing()
        .returning({ withdrawnAt: schema.agencyCollectionResponseWithdrawals.withdrawnAt }),
    );
    if (!recorded) return notFound;
    const updated = { organizationId: own.organizationId, withdrawnAt: recorded.withdrawnAt };
    await appendAuditEvent(tx, {
      eventType: 'AGENCY_COLLECTION_RESPONSE_WITHDRAWN',
      actorAccountId,
      action: 'SHARE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: person.applicant.id,
      resourceType: 'agency_collection_response',
      resourceId: responseId,
      metadata: { organizationId: updated.organizationId },
    });
    return ok({ withdrawnAt: updated.withdrawnAt });
  });
}

/** One exact copy an answer holds for an item. */
export type CollectionResponseVersion =
  | {
      readonly kind: 'DOCUMENT';
      readonly documentVersionId: string;
      readonly title: string;
      readonly versionNumber: number;
    }
  | {
      readonly kind: 'FIELD';
      /** A protected detail's value is null until the agency admin confirms it is them. */
      readonly value: string | null;
      readonly protected: boolean;
    }
  /** UMPE P9: one exact file a guest sent, by its name as sent. */
  | {
      readonly kind: 'GUEST_FILE';
      readonly fileId: string;
      readonly title: string;
      readonly sizeBytes: number;
      /** False: only the file's structure was checked (no virus scanner is switched on). */
      readonly virusScanned: boolean;
    };

/**
 * What the agency sees of one answer, per issued item: exactly the chosen copies. The shape is
 * shared with guest answers (P9), which carry `source: 'guest'` through the same review queue.
 */
export interface CollectionResponseItemView {
  readonly itemId: string;
  readonly item: CollectionItem;
  readonly source: 'account' | 'guest';
  readonly versions: readonly CollectionResponseVersion[];
  readonly missing: boolean;
}

export interface CollectionResponseView {
  readonly id: string;
  /** Always "Submitted to Agency": a response is never Reviewed or Accepted by being received. */
  readonly status: 'SUBMITTED_TO_AGENCY';
  /** The person's name as it was when they answered. */
  readonly personName: string;
  readonly revisionNo: number;
  readonly submittedAt: Date;
  readonly consentVersion: string;
  /** False when the stored response no longer matches what was submitted (never shown as if it did). */
  readonly intact: boolean;
  /** Whether any chosen detail is protected (shown only after a fresh identity check). */
  readonly hasProtectedDetails: boolean;
  readonly lines: readonly CollectionResponseItemView[];
}

/** Shown to the agency for a detail whose protected value cannot be opened here. */
const UNREADABLE_VALUE = 'Could Not Be Shown';

/** The identity check that opens an answer's protected details: bound to the admin and the answer. */
export function protectedDetailsStepUp(access: {
  readonly accountId: string;
  readonly responseId: string;
}): {
  readonly accountId: string;
  readonly action: 'VIEW_METADATA';
  readonly resourceId: string;
} {
  return { accountId: access.accountId, action: 'VIEW_METADATA', resourceId: access.responseId };
}

/**
 * One answer, as the agency sees it: the person's name and the file names as they were when sent,
 * the issued items and, for each, exactly the chosen document versions (by name and version
 * number) and fact versions (their values, from those exact versions, never the current ones), or
 * Still Missing. A protected detail (a passport number, for example) is opened only with a recent
 * identity confirmation of this admin for this answer (`protectedDetailsStepUp`). Every read is
 * audited with counts (and how many protected details were opened). A changed answer shows nothing and opens nothing. Nothing else of
 * the person is read.
 */
export async function readCollectionResponse(
  db: Db,
  access: CollectionResponseAccess,
  options: { readonly encryption?: KeyManagementPort; readonly stepUp?: StepUpProof } = {},
): Promise<Result<CollectionResponseView, ServiceError>> {
  const problem = collectionResponseAccessProblem(access);
  if (problem) return err(problem);
  const responses = schema.agencyCollectionResponses;
  const response = first(
    await db
      .select({
        id: responses.id,
        requestId: responses.requestId,
        revisionId: responses.revisionId,
        applicantId: responses.applicantId,
        consentVersion: responses.consentVersion,
        contentSha256: responses.contentSha256,
        submittedAt: responses.submittedAt,
        personName: responses.personName,
        revisionNo: responses.revisionNo,
      })
      .from(responses)
      .where(
        and(
          eq(responses.id, access.responseId),
          eq(responses.organizationId, access.organizationId),
          eq(responses.applicantId, access.applicantId),
          liveCollectionResponse(),
        ),
      )
      .limit(1),
  );
  if (!response) return err(keyedError('not_found', 'umpe_collection_response_service.no_such_response'));
  const revision = first(
    await db
      .select()
      .from(schema.agencyCollectionRequestRevisions)
      .where(
        and(
          eq(schema.agencyCollectionRequestRevisions.id, response.revisionId),
          eq(schema.agencyCollectionRequestRevisions.requestId, response.requestId),
        ),
      )
      .limit(1),
  );
  const items = revision ? parseItems(revision.items) : null;
  const itemRows = await db
    .select()
    .from(schema.agencyCollectionResponseItems)
    .where(eq(schema.agencyCollectionResponseItems.responseId, response.id));
  const lines = itemRows.map(lineOf);
  // A line removed with its document, or one added after submission, changes the content.
  const intact =
    items !== null &&
    responseContentSha256({
      requestId: response.requestId,
      revisionId: response.revisionId,
      applicantId: response.applicantId,
      consentVersion: response.consentVersion,
      lines,
    }) === response.contentSha256;
  const base = {
    id: response.id,
    status: 'SUBMITTED_TO_AGENCY' as const,
    personName: response.personName,
    revisionNo: response.revisionNo,
    submittedAt: response.submittedAt,
    consentVersion: response.consentVersion,
  };
  // Every agency read is audited, with counts and kinds only.
  const audit = async (counts: Readonly<Record<string, number | boolean>>) =>
    db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'AGENCY_COLLECTION_RESPONSE_READ',
        actorAccountId: access.accountId,
        actorRole: 'org:collection_response',
        action: 'VIEW_METADATA',
        method: 'API',
        result: 'ALLOWED',
        applicantId: response.applicantId,
        resourceType: 'agency_collection_response',
        resourceId: response.id,
        metadata: { organizationId: access.organizationId, ...counts },
      });
    });
  if (!intact || !items) {
    await audit({ intact: false });
    return ok({ ...base, intact: false, hasProtectedDetails: false, lines: [] });
  }

  const titles = new Map(
    itemRows.flatMap((row) =>
      row.documentVersionId && row.title ? [[row.documentVersionId, row.title] as const] : [],
    ),
  );
  const versionIds = lines.flatMap((l) => (l.kind === 'DOCUMENT' ? [l.documentVersionId] : []));
  const documents = new Map<string, { title: string; versionNumber: number }>();
  if (versionIds.length > 0) {
    const rows = await db
      .select({
        versionId: schema.documentVersions.id,
        versionNumber: schema.documentVersions.versionNumber,
        originalName: schema.documents.originalName,
        docType: schema.documents.docType,
      })
      .from(schema.documentVersions)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
      .where(
        and(
          inArray(schema.documentVersions.id, versionIds),
          eq(schema.documents.applicantId, response.applicantId),
          // A document the person moved to Recently Deleted is no longer offered (archived stays).
          (await lifecycleTablesPresent(db)) ? presentDocumentCondition() : undefined,
        ),
      );
    for (const row of rows) {
      documents.set(row.versionId, {
        title:
          titles.get(row.versionId) ??
          (row.docType ? (documentTypeName(row.docType) ?? 'Document') : 'Document'),
        versionNumber: row.versionNumber,
      });
    }
  }
  const factVersionIds = lines.flatMap((l) => (l.kind === 'FIELD' ? [l.factVersionId] : []));
  const values = new Map<string, { value: string | null; protected: boolean }>();
  const mayOpenProtected = StepUpProof.covers(options.stepUp, protectedDetailsStepUp(access));
  let opened = 0;
  if (factVersionIds.length > 0) {
    const rows = await db
      .select({ version: schema.factVersions })
      .from(schema.factVersions)
      .innerJoin(schema.facts, eq(schema.facts.id, schema.factVersions.factId))
      .where(
        and(
          inArray(schema.factVersions.id, factVersionIds),
          eq(schema.facts.applicantId, response.applicantId),
        ),
      );
    for (const { version } of rows) {
      if (version.protectedKeyVersion === null) {
        values.set(version.id, { value: version.value ?? '', protected: false });
        continue;
      }
      if (!mayOpenProtected) {
        values.set(version.id, { value: null, protected: true });
        continue;
      }
      const revealed = options.encryption
        ? await revealFactVersionValue(db, options.encryption, version)
        : null;
      if (revealed?.ok) opened++;
      values.set(version.id, {
        value: revealed?.ok ? revealed.value : UNREADABLE_VALUE,
        protected: true,
      });
    }
  }
  await audit({
    intact: true,
    documents: versionIds.length,
    details: factVersionIds.length,
    protectedOpened: opened,
  });

  const view: CollectionResponseItemView[] = items.map((item) => {
    const own = lines.filter((l) => l.itemId === item.id);
    const versions: CollectionResponseVersion[] = own.flatMap((l): CollectionResponseVersion[] => {
      if (l.kind === 'DOCUMENT') {
        const document = documents.get(l.documentVersionId);
        return document
          ? [{ kind: 'DOCUMENT', documentVersionId: l.documentVersionId, ...document }]
          : [];
      }
      if (l.kind === 'FIELD') {
        const detail = values.get(l.factVersionId);
        return detail ? [{ kind: 'FIELD', ...detail }] : [];
      }
      return [];
    });
    return {
      itemId: item.id,
      item,
      source: 'account',
      versions,
      missing: own.length === 0 || own.every((l) => l.kind === 'MISSING'),
    };
  });
  return ok({
    ...base,
    intact: true,
    hasProtectedDetails: [...values.values()].some((v) => v.protected),
    lines: view,
  });
}
