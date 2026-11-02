import { type Result, err, ok } from '@visastack/core';
import { documentTypeName } from '@visastack/core/catalogue/documents';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  type CollectionResponseAccess,
  collectionRecipientAllowed,
  collectionResponseAccessProblem,
  collectionResponsesPresent,
} from './access/collection-response-access';
import { CollectionLinkProof } from './access/collection-scope';
import { type SelfScope, selfScopeProblem } from './access/principal';
import { AuthorizedApplicant } from './access/require-access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { isDocumentVersionUsable } from './documents';
import { hasActiveOrVerifiedErasureJob } from './erasure';
import { type ServiceError, serviceError } from './errors';
import { everydayDocumentCondition } from './lifecycle/foundation/conditions';
import { isUuid } from './lifecycle/foundation/ids';
import { lifecycleTablesPresent } from './lifecycle/foundation/presence';
import type { KeyManagementPort } from './ports';
import { isProtectedPlaceholder, revealFactVersionValue } from './profile';
import {
  type BrandSnapshot,
  type CollectionItem,
  parseBrandSnapshot,
  parseItems,
  revisionContentSha256,
} from './umpe-collection-request-items';
import { openLinkFor } from './umpe-collection-request-service';
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
}

function closed(): ServiceError {
  return serviceError('not_found', 'this request link is not open');
}

/** The open, intact request this link names, for an account allowed to answer it, or null. */
async function loadDesk(
  db: Db,
  link: CollectionLinkProof,
  accountId: string,
  now: Date,
): Promise<ResponseDesk | null> {
  const open = await openLinkFor(db, link, now);
  if (!open) return null;
  const links = schema.agencyCollectionLinks;
  const requests = schema.agencyCollectionRequests;
  const row = first(
    await db
      .select({
        revisionId: links.revisionId,
        linkHint: links.recipientEmailHint,
        expiresAt: links.expiresAt,
        requestId: requests.id,
        requestHint: requests.recipientEmailHint,
        destination: requests.destination,
        purpose: requests.purpose,
        dueAt: requests.dueAt,
      })
      .from(links)
      .innerJoin(requests, eq(requests.id, links.requestId))
      .where(and(eq(links.id, open.linkId), eq(requests.organizationId, open.organizationId)))
      .limit(1),
  );
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
    linkId: open.linkId,
    organizationId: open.organizationId,
    emailHint: row.linkHint ?? row.requestHint,
    accountId,
  });
  if (!allowed) return null;
  return {
    linkId: open.linkId,
    requestId: row.requestId,
    revisionId: revision.id,
    revisionNo: revision.revisionNo,
    agency: brand,
    destination: row.destination,
    purpose: row.purpose,
    dueAt: row.dueAt,
    expiresAt: row.expiresAt,
    items,
  };
}

/** The organization a desk belongs to, read again for the write (never trusted from the page). */
async function deskOrganization(db: Db, desk: ResponseDesk): Promise<string | null> {
  const row = first(
    await db
      .select({ organizationId: schema.agencyCollectionRequests.organizationId })
      .from(schema.agencyCollectionRequests)
      .where(eq(schema.agencyCollectionRequests.id, desk.requestId))
      .limit(1),
  );
  return row?.organizationId ?? null;
}

/**
 * The request a signed-in traveller may answer through this link, or not found for every link
 * that is not open, not intact, or not addressed to this account (all alike).
 */
export async function openCollectionResponseDesk(
  db: Db,
  link: CollectionLinkProof,
  self: SelfScope,
  now: Date = new Date(),
): Promise<Result<ResponseDesk, ServiceError>> {
  if (!CollectionLinkProof.isGenuine(link)) return err(closed());
  if (selfScopeProblem(self)) return err(closed());
  const desk = await loadDesk(db, link, self.accountId, now);
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
    for (const version of newest.values()) {
      const erased = await hasActiveOrVerifiedErasureJob(db, version.storageObjectId);
      if (
        isDocumentVersionUsable({
          safetyStatus: version.safetyStatus,
          processingStatus: version.processingStatus,
          erased,
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
  link: CollectionLinkProof,
  person: AuthorizedApplicant<'VIEW_METADATA'>,
  options: { readonly encryption?: KeyManagementPort; readonly now?: Date } = {},
): Promise<Result<ResponseProposal, ServiceError>> {
  if (!CollectionLinkProof.isGenuine(link)) return err(closed());
  if (!AuthorizedApplicant.isGenuine(person, 'VIEW_METADATA') || notOwner(person)) {
    return err(serviceError('not_found', 'record not found'));
  }
  const now = options.now ?? new Date();
  const desk = await loadDesk(db, link, person.applicant.ownerAccountId, now);
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
  link: CollectionLinkProof,
  person: AuthorizedApplicant<'SHARE'>,
  input: SubmitResponseInput,
): Promise<Result<SubmittedResponse, ServiceError>> {
  if (!CollectionLinkProof.isGenuine(link)) return err(closed());
  if (!AuthorizedApplicant.isGenuine(person, 'SHARE') || notOwner(person)) {
    return err(serviceError('not_found', 'record not found'));
  }
  const accountId = person.applicant.ownerAccountId;
  if (input.consentVersion !== RESPONSE_CONSENT_VERSION) {
    return err(serviceError('invalid', 'Agree to share before you submit.'));
  }
  if (!(await collectionResponsesPresent(db))) {
    return err(serviceError('upstream_error', 'Answering requests is not available yet.'));
  }
  const now = input.now ?? new Date();
  const applicantId = person.applicant.id;
  return db.transaction(async (tx) => {
    // One answer at a time per person and request: two submits cannot both stay live.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`visastack:collection-response:${applicantId}`}))`,
    );
    const desk = await loadDesk(tx, link, accountId, now);
    if (!desk) return err(closed());
    const organizationId = await deskOrganization(tx, desk);
    if (!organizationId) return err(closed());
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
    const responses = schema.agencyCollectionResponses;
    const earlier = await tx
      .update(responses)
      .set({ withdrawnAt: now, withdrawnByAccountId: accountId })
      .where(
        and(
          eq(responses.requestId, desk.requestId),
          eq(responses.organizationId, organizationId),
          eq(responses.applicantId, applicantId),
          isNull(responses.withdrawnAt),
        ),
      )
      .returning({ id: responses.id });
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
    return ok({
      responseId: created.id,
      submittedAt: created.submittedAt,
      ...counts,
      replaced: earlier.length,
    });
  });
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
  readonly agencyName: string;
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
    return err(serviceError('not_found', 'record not found'));
  }
  if (!(await collectionResponsesPresent(db))) return ok([]);
  const responses = schema.agencyCollectionResponses;
  const rows = await db
    .select({
      id: responses.id,
      agencyName: schema.organizations.name,
      destination: responses.destination,
      revisionNo: responses.revisionNo,
      submittedAt: responses.submittedAt,
      withdrawnAt: responses.withdrawnAt,
    })
    .from(responses)
    .innerJoin(schema.organizations, eq(schema.organizations.id, responses.organizationId))
    .where(eq(responses.applicantId, person.applicant.id))
    .orderBy(desc(responses.submittedAt), desc(responses.id))
    .limit(OWN_RESPONSE_LIST_LIMIT);
  if (rows.length === 0) return ok([]);
  const counts = await lineCounts(
    db,
    rows.map((r) => r.id),
  );
  return ok(
    rows.map((row) => ({
      ...row,
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
 * itself stays as history, marked withdrawn. Owner only; taking access away needs no fresh sign-in.
 */
export async function withdrawCollectionResponse(
  db: Db,
  person: AuthorizedApplicant<'MANAGE'>,
  responseId: string,
  now: Date = new Date(),
): Promise<Result<{ readonly withdrawnAt: Date }, ServiceError>> {
  if (!AuthorizedApplicant.isGenuine(person, 'MANAGE') || person.actor.kind !== 'applicant_owner') {
    return err(serviceError('not_found', 'record not found'));
  }
  const notFound = err(serviceError('not_found', 'no such answer'));
  if (!isUuid(responseId) || !(await collectionResponsesPresent(db))) return notFound;
  const actorAccountId = person.applicant.ownerAccountId;
  return db.transaction(async (tx) => {
    const responses = schema.agencyCollectionResponses;
    const updated = first(
      await tx
        .update(responses)
        .set({ withdrawnAt: now, withdrawnByAccountId: actorAccountId })
        .where(
          and(
            eq(responses.id, responseId),
            eq(responses.applicantId, person.applicant.id),
            isNull(responses.withdrawnAt),
          ),
        )
        .returning({
          organizationId: responses.organizationId,
          withdrawnAt: responses.withdrawnAt,
        }),
    );
    if (!updated?.withdrawnAt) return notFound;
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

/** What the agency sees of one answer: exactly the chosen copies, per issued item. */
export interface AgencyResponseLine {
  readonly item: CollectionItem;
  readonly documents: readonly {
    readonly documentVersionId: string;
    readonly title: string;
    readonly versionNumber: number;
  }[];
  readonly details: readonly { readonly value: string }[];
  readonly missing: boolean;
}

export interface AgencyResponseView {
  readonly id: string;
  /** Always "Submitted to Agency": a response is never Reviewed or Accepted by being received. */
  readonly status: 'SUBMITTED_TO_AGENCY';
  readonly personName: string;
  readonly revisionNo: number;
  readonly submittedAt: Date;
  readonly consentVersion: string;
  /** False when the stored response no longer matches what was submitted (never shown as if it did). */
  readonly intact: boolean;
  readonly lines: readonly AgencyResponseLine[];
}

/** Shown to the agency for a detail whose protected value cannot be opened here. */
const UNREADABLE_VALUE = 'Could Not Be Shown';

/**
 * One answer, as the agency sees it: the person's name, the issued items and, for each, exactly
 * the chosen document versions (by name and version number) and fact versions (their values, from
 * those exact versions, never the current ones), or Still Missing. Reading the values is audited
 * with counts. Nothing else of the person is read.
 */
export async function readCollectionResponse(
  db: Db,
  access: CollectionResponseAccess,
  options: { readonly encryption?: KeyManagementPort } = {},
): Promise<Result<AgencyResponseView, ServiceError>> {
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
        personName: schema.applicants.displayName,
      })
      .from(responses)
      .innerJoin(schema.applicants, eq(schema.applicants.id, responses.applicantId))
      .where(
        and(
          eq(responses.id, access.responseId),
          eq(responses.organizationId, access.organizationId),
          eq(responses.applicantId, access.applicantId),
          isNull(responses.withdrawnAt),
        ),
      )
      .limit(1),
  );
  if (!response) return err(serviceError('not_found', 'no such response'));
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
  const lines: ResponseLine[] = itemRows.map((row) =>
    row.kind === 'DOCUMENT' && row.documentId && row.documentVersionId
      ? {
          itemId: row.itemId,
          kind: 'DOCUMENT',
          documentId: row.documentId,
          documentVersionId: row.documentVersionId,
        }
      : row.kind === 'FIELD' && row.factId && row.factVersionId
        ? {
            itemId: row.itemId,
            kind: 'FIELD',
            factId: row.factId,
            factVersionId: row.factVersionId,
          }
        : { itemId: row.itemId, kind: 'MISSING' },
  );
  // A line removed with its document (the person deleted it) changes the content: the view says so.
  const intact =
    items !== null &&
    responseContentSha256({
      requestId: response.requestId,
      revisionId: response.revisionId,
      applicantId: response.applicantId,
      consentVersion: response.consentVersion,
      lines,
    }) === response.contentSha256;

  const versionIds = lines.flatMap((l) => (l.kind === 'DOCUMENT' ? [l.documentVersionId] : []));
  const documents = new Map<string, { title: string; versionNumber: number }>();
  if (versionIds.length > 0) {
    const rows = await db
      .select({
        versionId: schema.documentVersions.id,
        versionNumber: schema.documentVersions.versionNumber,
        approvedName: schema.documents.approvedName,
        originalName: schema.documents.originalName,
        docType: schema.documents.docType,
      })
      .from(schema.documentVersions)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
      .where(
        and(
          inArray(schema.documentVersions.id, versionIds),
          eq(schema.documents.applicantId, response.applicantId),
        ),
      );
    for (const row of rows) {
      documents.set(row.versionId, {
        title:
          row.approvedName ??
          (row.docType ? (documentTypeName(row.docType) ?? row.originalName) : row.originalName),
        versionNumber: row.versionNumber,
      });
    }
  }
  const factVersionIds = lines.flatMap((l) => (l.kind === 'FIELD' ? [l.factVersionId] : []));
  const values = new Map<string, string>();
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
        values.set(version.id, version.value ?? '');
        continue;
      }
      const revealed = options.encryption
        ? await revealFactVersionValue(db, options.encryption, version)
        : null;
      values.set(version.id, revealed?.ok ? revealed.value : UNREADABLE_VALUE);
    }
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'AGENCY_COLLECTION_RESPONSE_DETAILS_READ',
        actorAccountId: access.accountId,
        actorRole: 'org:collection_response',
        action: 'VIEW_METADATA',
        method: 'API',
        result: 'ALLOWED',
        applicantId: response.applicantId,
        resourceType: 'agency_collection_response',
        resourceId: response.id,
        metadata: { organizationId: access.organizationId, details: values.size },
      });
    });
  }

  const view: AgencyResponseLine[] = (items ?? []).map((item) => {
    const own = lines.filter((l) => l.itemId === item.id);
    return {
      item,
      documents: own.flatMap((l) => {
        if (l.kind !== 'DOCUMENT') return [];
        const document = documents.get(l.documentVersionId);
        return document ? [{ documentVersionId: l.documentVersionId, ...document }] : [];
      }),
      details: own.flatMap((l) =>
        l.kind === 'FIELD' && values.has(l.factVersionId)
          ? [{ value: values.get(l.factVersionId) ?? '' }]
          : [],
      ),
      missing: own.length === 0 || own.every((l) => l.kind === 'MISSING'),
    };
  });
  return ok({
    id: response.id,
    status: 'SUBMITTED_TO_AGENCY',
    personName: response.personName,
    revisionNo: revision?.revisionNo ?? 0,
    submittedAt: response.submittedAt,
    consentVersion: response.consentVersion,
    intact,
    lines: intact ? view : [],
  });
}
