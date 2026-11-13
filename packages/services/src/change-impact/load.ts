import type { AccountId, AgencyId, ApplicantId, DocumentId } from '@visastack/core';
import {
  type Actor as PolicyActor,
  type Resource as PolicyResource,
  authorize,
} from '@visastack/policy';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  collectionResponsesPresent,
  liveCollectionResponse,
} from '../access/collection-response-access';
import { LIVE_GRANT_STATUSES, isLiveGrant } from '../access/grant-scope';
import type { AuthorizedApplicant } from '../access/require-access';
import { snapshotRecordedVersions } from '../application-memory';
import { type Db, schema } from '../db';
import { evidenceFieldPinsPresent } from '../evidence-field-answers';
import { evidenceSubmissionsPresent, pinnedVersionIntact } from '../evidence-submission-tables';
import { type StoredCaseEvidence, readStoredCaseEvidence } from '../finished-case-evidence';
import { readStoredReadiness } from '../finished-case-readiness';
// Imported by the foundation's path, which the read-path guard recognises.
import { presentDocumentCondition } from '../lifecycle/foundation/conditions';
import { lifecycleTablesPresent } from '../lifecycle/foundation/presence';
import { toPolicyGrant } from '../sharing';
import { INACTIVE_CASE_STATES, packageTablesPresent } from '../umpe-package-tables';
import type { ShareReach } from './classify';
import type { ImpactShareReach } from './contract';
import type { RoundRequest, StoredDecision, StoredSend } from './rounds';

/*
 * The readers behind "What This Change Affects". Every exported function takes the traveller's
 * own access proof and reads through the transaction it is given; every statement is filtered by
 * that traveller or by the one changed item, and each reader sends a fixed number of statements
 * however many cases, requests or shares it finds. Nothing here writes.
 */

type Proof = AuthorizedApplicant<'MANAGE'>;

// ---------------------------------------------------------------------------------------------
// Which optional tables exist

export interface TablesPresent {
  /** Recently Deleted and archive records for documents (migration 0113). */
  readonly lifecycle: boolean;
  /** Deliberate copy choices on a case (umpe_package_choices). */
  readonly packageChoices: boolean;
  /** Exact copies sent in answer to document requests (migration 0132). */
  readonly documentPins: boolean;
  /** Exact saved values sent in answer to detail requests (migration 0135). */
  readonly detailPins: boolean;
  /** Answered agency checklists. */
  readonly collectionResponses: boolean;
}

/**
 * Presence of the tables that arrive with later migrations. `to_regclass` never raises, so this
 * is safe before a migration and never disturbs a transaction. Asked on the caller's own handle,
 * before the read's transaction opens.
 */
export async function tablesPresent(access: Proof): Promise<TablesPresent> {
  const db = access.tx;
  const lifecycle = await lifecycleTablesPresent(db);
  const packageChoices = await packageTablesPresent(db);
  const documentPins = await evidenceSubmissionsPresent(db);
  const detailPins = await evidenceFieldPinsPresent(db);
  const collectionResponses = await collectionResponsesPresent(db);
  return { lifecycle, packageChoices, documentPins, detailPins, collectionResponses };
}

// ---------------------------------------------------------------------------------------------
// The changed item

export interface DocumentSubject {
  readonly id: string;
  readonly title: string;
  readonly docType: string | null;
  readonly supersededBy: string | null;
}

const documentColumns = {
  id: schema.documents.id,
  originalName: schema.documents.originalName,
  approvedName: schema.documents.approvedName,
  docType: schema.documents.docType,
  supersededBy: schema.documents.supersededByDocumentId,
};

function toDocumentSubject(row: {
  id: string;
  originalName: string;
  approvedName: string | null;
  docType: string | null;
  supersededBy: string | null;
}): DocumentSubject {
  return {
    id: row.id,
    title: row.approvedName ?? row.originalName,
    docType: row.docType,
    supersededBy: row.supersededBy,
  };
}

/**
 * The document, only if it belongs to this traveller, with a share lock on its row for the rest
 * of the transaction. Recording a replacement locks the same row for update, so this read sees a
 * replacement either wholly recorded or not at all. A made-up id and a real document of someone
 * else send the same statement and both find nothing.
 */
export async function lockDocumentSubject(
  access: Proof,
  tx: Db,
  documentId: string,
  lifecycle: boolean,
): Promise<DocumentSubject | undefined> {
  const [row] = await tx
    .select(documentColumns)
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.applicantId, access.applicant.id),
        // A document in Recently Deleted is not there for any screen, this one included.
        lifecycle ? presentDocumentCondition() : undefined,
      ),
    )
    .for('share');
  return row ? toDocumentSubject(row) : undefined;
}

/** How far a chain of replacements is followed before it is taken as it stands. */
export const REPLACEMENT_CHAIN_LIMIT = 32;

export interface ReplacementChain {
  /**
   * Every document recorded after `subject` in its chain of replacements, in order, whether or
   * not it is still there. A copy of any of them is a copy of a newer document than the subject.
   */
  readonly laterIds: readonly string[];
  /** The newest of them that is still there (not in Recently Deleted); null when none is. */
  readonly replacement: DocumentSubject | null;
}

/**
 * The chain of recorded replacements that starts at `subject`. The links are read from all of
 * this traveller's own replaced documents in one statement (ids only, including documents in
 * Recently Deleted, so a removed document in the middle does not cut the chain) and walked in
 * memory: a loop in the stored links, or a chain longer than the limit, stops at the last
 * document reached. A second statement reads which of the later documents are still there
 * (`presentDocumentCondition`); the replacement is the last of those.
 */
export async function replacementChain(
  access: Proof,
  tx: Db,
  subject: DocumentSubject,
  lifecycle: boolean,
): Promise<ReplacementChain> {
  if (subject.supersededBy === null) return { laterIds: [], replacement: null };
  const links = await tx
    .select({ id: schema.documents.id, next: schema.documents.supersededByDocumentId })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.applicantId, access.applicant.id),
        isNotNull(schema.documents.supersededByDocumentId),
      ),
    );
  const nextOf = new Map(links.map((link) => [link.id, link.next]));
  const seen = new Set([subject.id]);
  const laterIds: string[] = [];
  let next: string | null | undefined = subject.supersededBy;
  while (next && !seen.has(next) && laterIds.length < REPLACEMENT_CHAIN_LIMIT) {
    seen.add(next);
    laterIds.push(next);
    next = nextOf.get(next);
  }
  const present = await tx
    .select(documentColumns)
    .from(schema.documents)
    .where(
      and(
        inArray(schema.documents.id, laterIds),
        eq(schema.documents.applicantId, access.applicant.id),
        lifecycle ? presentDocumentCondition() : undefined,
      ),
    );
  const last = [...laterIds].reverse().find((id) => present.some((row) => row.id === id));
  const row = present.find((candidate) => candidate.id === last);
  return { laterIds, replacement: row ? toDocumentSubject(row) : null };
}

/**
 * One of this traveller's own documents by id, if it is still there (not in Recently Deleted). A
 * made-up id and someone else's document look alike.
 */
export async function ownDocument(
  access: Proof,
  tx: Db,
  documentId: string,
  lifecycle: boolean,
): Promise<DocumentSubject | undefined> {
  const [row] = await tx
    .select(documentColumns)
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.applicantId, access.applicant.id),
        lifecycle ? presentDocumentCondition() : undefined,
      ),
    );
  return row ? toDocumentSubject(row) : undefined;
}

export interface DetailSubject {
  readonly id: string;
  readonly fieldKey: string;
  /** The sharing category the detail belongs to, when it has one. */
  readonly category: string | null;
  readonly currentVersionId: string | null;
  /**
   * Every saved value, oldest first: ids, times and one yes-or-no, never a value.
   * `sameAsCurrent` is true for the current saved value itself and for any other saved value
   * whose stored text is exactly the current one (saving a detail again without changing it
   * still records a new saved value). For a detail stored protected nothing is compared, because
   * this read never opens a protected value: only the current saved value itself is "the same".
   */
  readonly versions: readonly {
    readonly id: string;
    readonly savedAt: Date;
    readonly sameAsCurrent: boolean;
  }[];
}

/**
 * The detail, only if it belongs to this traveller, with a share lock on its row for the rest of
 * the transaction. Saving a new value and sending the detail to an agency both need a stronger
 * lock on the same row, so the current value cannot move under this read.
 */
export async function lockDetailSubject(
  access: Proof,
  tx: Db,
  factId: string,
): Promise<DetailSubject | undefined> {
  const [row] = await tx
    .select({
      id: schema.facts.id,
      currentVersionId: schema.facts.currentVersionId,
      fieldKey: schema.fieldDefinitions.key,
      category: schema.fieldDefinitions.packId,
    })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
    )
    .where(and(eq(schema.facts.id, factId), eq(schema.facts.applicantId, access.applicant.id)))
    .for('share', { of: schema.facts });
  if (!row) return undefined;
  // The stored text is read only to compare it with the current one, here, in memory. It is
  // never returned, logged or passed on: what leaves this function is the yes-or-no.
  const stored = await tx
    .select({
      id: schema.factVersions.id,
      savedAt: schema.factVersions.createdAt,
      value: schema.factVersions.value,
      protectedKeyVersion: schema.factVersions.protectedKeyVersion,
    })
    .from(schema.factVersions)
    .where(eq(schema.factVersions.factId, row.id))
    .orderBy(asc(schema.factVersions.createdAt), asc(schema.factVersions.id));
  const current = stored.find((version) => version.id === row.currentVersionId);
  const isPlain = (version: (typeof stored)[number]) => version.protectedKeyVersion === null;
  const versions = stored.map((version) => ({
    id: version.id,
    savedAt: version.savedAt,
    sameAsCurrent:
      current !== undefined &&
      (version.id === current.id ||
        // Exact equality of the stored text: no trimming, no case folding.
        (isPlain(version) && isPlain(current) && version.value === current.value)),
  }));
  return { ...row, versions };
}

// ---------------------------------------------------------------------------------------------
// Cases

export interface CaseRow {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly createdAt: Date;
  readonly packVersionId: string | null;
  readonly materialRevision: number;
  readonly closedAt: Date | null;
}

const caseColumns = {
  id: schema.missions.id,
  title: schema.missions.title,
  state: schema.missions.state,
  createdAt: schema.missions.createdAt,
  packVersionId: schema.missions.packVersionId,
  materialRevision: schema.missions.materialRevision,
  closedAt: schema.missions.closedAt,
};

/** This traveller's cases that select the document or the detail. */
export async function casesSelecting(
  access: Proof,
  tx: Db,
  subject: { readonly documentId: string } | { readonly factId: string },
): Promise<CaseRow[]> {
  return tx
    .selectDistinct(caseColumns)
    .from(schema.selectedEvidence)
    .innerJoin(schema.missions, eq(schema.missions.id, schema.selectedEvidence.missionId))
    .where(
      and(
        'documentId' in subject
          ? eq(schema.selectedEvidence.documentId, subject.documentId)
          : eq(schema.selectedEvidence.factId, subject.factId),
        eq(schema.missions.applicantId, access.applicant.id),
      ),
    );
}

/** This traveller's cases that hold a deliberate, still-standing choice of this document's copy. */
export async function casesKeepingCopy(
  access: Proof,
  tx: Db,
  documentId: string,
): Promise<CaseRow[]> {
  const choices = schema.umpePackageChoices;
  return tx
    .selectDistinct(caseColumns)
    .from(choices)
    .innerJoin(schema.missions, eq(schema.missions.id, choices.missionId))
    .where(
      and(
        eq(choices.applicantId, access.applicant.id),
        eq(choices.documentId, documentId),
        eq(choices.choice, 'USE_COPY'),
        isNull(choices.supersededAt),
        eq(schema.missions.applicantId, access.applicant.id),
      ),
    );
}

/**
 * This traveller's cases that hold a deliberate, still-standing choice of one saved value of
 * this detail, with the saved value each one chose.
 */
export async function casesKeepingValue(
  access: Proof,
  tx: Db,
  factId: string,
): Promise<(CaseRow & { readonly chosenVersionId: string | null })[]> {
  const choices = schema.umpePackageChoices;
  return tx
    .selectDistinct({ ...caseColumns, chosenVersionId: choices.factVersionId })
    .from(choices)
    .innerJoin(schema.missions, eq(schema.missions.id, choices.missionId))
    .where(
      and(
        eq(choices.applicantId, access.applicant.id),
        eq(choices.factId, factId),
        eq(choices.choice, 'USE_COPY'),
        isNull(choices.supersededAt),
        eq(schema.missions.applicantId, access.applicant.id),
      ),
    );
}

/** This traveller's finished cases with any copy that lists the document or the detail. */
export async function finishedCasesWithCopyOf(
  access: Proof,
  tx: Db,
  subject: { readonly documentId: string } | { readonly factId: string },
): Promise<CaseRow[]> {
  const shape =
    'documentId' in subject
      ? { documents: [{ documentId: subject.documentId }] }
      : { facts: [{ factId: subject.factId }] };
  return tx
    .selectDistinct(caseColumns)
    .from(schema.missionSnapshots)
    .innerJoin(schema.missions, eq(schema.missions.id, schema.missionSnapshots.missionId))
    .where(
      and(
        eq(schema.missions.applicantId, access.applicant.id),
        inArray(schema.missions.state, [...INACTIVE_CASE_STATES]),
        sql`${schema.missionSnapshots.content} @> ${JSON.stringify(shape)}::jsonb`,
      ),
    );
}

/**
 * The copy each finished case reads from, or null when it has none to trust. The same choice as
 * `finishedCaseCopy` in missions.ts (rules in finished-case-readiness.ts), made for many cases
 * in three statements: a submitted case reads the copy its submission was made from; a case
 * closed or cancelled without one reads the latest copy taken before it finished, only while the
 * case has not changed since. `parity.test.ts` holds this to `pinnedFactVersionsOfFinishedCase`.
 */
export async function savedCopiesOf(
  access: Proof,
  tx: Db,
  cases: readonly CaseRow[],
): Promise<Map<string, StoredCaseEvidence | null>> {
  const copies = new Map<string, StoredCaseEvidence | null>();
  if (cases.length === 0) return copies;
  const ids = cases.map((row) => row.id);
  const owned = and(
    inArray(schema.missions.id, ids),
    eq(schema.missions.applicantId, access.applicant.id),
  );
  const submissions = await tx
    .select({
      missionId: schema.missionSubmissions.missionId,
      snapshotId: schema.missionSubmissions.snapshotId,
    })
    .from(schema.missionSubmissions)
    .innerJoin(schema.missions, eq(schema.missions.id, schema.missionSubmissions.missionId))
    .where(owned)
    .orderBy(desc(schema.missionSubmissions.createdAt));
  const snapshots = await tx
    .select({
      id: schema.missionSnapshots.id,
      missionId: schema.missionSnapshots.missionId,
      version: schema.missionSnapshots.version,
      createdAt: schema.missionSnapshots.createdAt,
      revision: schema.missionSnapshots.materialRevisionAtCapture,
    })
    .from(schema.missionSnapshots)
    .innerJoin(schema.missions, eq(schema.missions.id, schema.missionSnapshots.missionId))
    .where(owned);

  const chosen = new Map<string, string>();
  for (const row of cases) {
    const own = snapshots.filter((s) => s.missionId === row.id);
    const submission = submissions.find((s) => s.missionId === row.id);
    if (submission) {
      if (own.some((s) => s.id === submission.snapshotId))
        chosen.set(row.id, submission.snapshotId);
      continue;
    }
    const closedAt = row.closedAt;
    if (!closedAt) continue;
    const latest = own
      .filter((s) => s.createdAt.getTime() <= closedAt.getTime())
      .sort((a, b) => b.version - a.version)[0];
    if (latest && latest.revision === row.materialRevision) chosen.set(row.id, latest.id);
  }

  const content = schema.missionSnapshots.content;
  const stored =
    chosen.size === 0
      ? []
      : await tx
          .select({
            id: schema.missionSnapshots.id,
            readiness: sql<unknown>`${content} -> 'readiness'`,
            copiedPackVersionId: sql<unknown>`${content} #> '{packVersion,id}'`,
            mapping: sql<unknown>`${content} -> 'requirementMapping'`,
            documents: sql<unknown>`${content} -> 'documents'`,
          })
          .from(schema.missionSnapshots)
          .where(inArray(schema.missionSnapshots.id, [...chosen.values()]));
  for (const row of cases) {
    const copy = stored.find((s) => s.id === chosen.get(row.id));
    const usable =
      copy !== undefined &&
      Array.isArray(copy.mapping) &&
      Array.isArray(copy.documents) &&
      readStoredReadiness(copy.readiness, copy.copiedPackVersionId, row.packVersionId) !== null;
    copies.set(row.id, usable ? readStoredCaseEvidence(copy.mapping, copy.documents) : null);
  }
  return copies;
}

export interface CaseConfirmation {
  /** A confirmation still stands. */
  readonly live: boolean;
  /**
   * The saved values the latest confirmed copy recorded, ids only; null when that copy did not
   * record exact versions.
   */
  readonly recordedFactVersionIds: readonly string[] | null;
}

/**
 * For each of these cases that was ever confirmed: whether a confirmation still stands, and
 * which saved values the latest confirmed copy recorded. A case that was never confirmed has no
 * entry. Two statements; one when only "does a confirmation stand" is asked
 * (`withRecordedValues: false`).
 */
export async function confirmationsOf(
  access: Proof,
  tx: Db,
  cases: readonly CaseRow[],
  options: { readonly withRecordedValues: boolean } = { withRecordedValues: true },
): Promise<Map<string, CaseConfirmation>> {
  const out = new Map<string, CaseConfirmation>();
  if (cases.length === 0) return out;
  const rows = await tx
    .select({
      missionId: schema.acknowledgements.missionId,
      snapshotId: schema.acknowledgements.snapshotId,
      createdAt: schema.acknowledgements.createdAt,
      invalidatedAt: schema.acknowledgements.invalidatedAt,
    })
    .from(schema.acknowledgements)
    .where(
      and(
        inArray(
          schema.acknowledgements.missionId,
          cases.map((row) => row.id),
        ),
        eq(schema.acknowledgements.subjectApplicantId, access.applicant.id),
        eq(schema.acknowledgements.decision, 'ACKNOWLEDGED'),
      ),
    )
    .orderBy(desc(schema.acknowledgements.createdAt));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.missionId)) latest.set(row.missionId, row);
  if (latest.size === 0) return out;
  if (!options.withRecordedValues) {
    for (const missionId of latest.keys()) {
      out.set(missionId, {
        live: rows.some((r) => r.missionId === missionId && r.invalidatedAt === null),
        recordedFactVersionIds: null,
      });
    }
    return out;
  }
  const copies = await tx
    .select({
      id: schema.missionSnapshots.id,
      facts: sql<unknown>`${schema.missionSnapshots.content} -> 'facts'`,
    })
    .from(schema.missionSnapshots)
    .where(
      inArray(
        schema.missionSnapshots.id,
        [...latest.values()].map((row) => row.snapshotId),
      ),
    );
  for (const [missionId, row] of latest) {
    const copy = copies.find((c) => c.id === row.snapshotId);
    const recorded = snapshotRecordedVersions({ facts: copy?.facts ?? null });
    out.set(missionId, {
      live: rows.some((r) => r.missionId === missionId && r.invalidatedAt === null),
      recordedFactVersionIds: copy && recorded.exact ? recorded.factVersionIds : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sends to agencies: evidence requests

export interface RequestRow extends RoundRequest {
  readonly agencyId: string;
  readonly agencyName: string;
  readonly missionId: string | null;
  /** The request's case, when it names one this traveller can still open. */
  readonly mission: { readonly title: string; readonly state: string } | null;
  readonly createdAt: Date;
}

export interface RequestHistory {
  readonly request: RequestRow;
  readonly sends: readonly StoredSend[];
  readonly decisions: readonly StoredDecision[];
}

const requestColumns = {
  id: schema.evidenceRequests.id,
  status: schema.evidenceRequests.status,
  agencyId: schema.evidenceRequests.organizationId,
  agencyName: schema.organizations.name,
  missionId: schema.evidenceRequests.missionId,
  missionTitle: schema.missions.title,
  missionState: schema.missions.state,
  respondedAt: schema.evidenceRequests.respondedAt,
  createdAt: schema.evidenceRequests.createdAt,
  respondingDocumentId: schema.evidenceRequests.respondingDocumentId,
  respondingFactId: schema.evidenceRequests.respondingFactId,
};

function requestsQuery(access: Proof, tx: Db) {
  return tx
    .select(requestColumns)
    .from(schema.evidenceRequests)
    .innerJoin(
      schema.organizations,
      eq(schema.organizations.id, schema.evidenceRequests.organizationId),
    )
    .leftJoin(
      schema.missions,
      and(
        eq(schema.missions.id, schema.evidenceRequests.missionId),
        eq(schema.missions.applicantId, access.applicant.id),
      ),
    );
}

type RawRequest = Awaited<ReturnType<typeof requestsQuery>>[number];

function toRequestRow(row: RawRequest, kind: 'DOCUMENT' | 'FIELD'): RequestRow {
  return {
    id: row.id,
    status: row.status,
    respondingId: kind === 'DOCUMENT' ? row.respondingDocumentId : row.respondingFactId,
    respondedAt: row.respondedAt,
    agencyId: row.agencyId,
    agencyName: row.agencyName,
    missionId: row.missionId,
    mission:
      row.missionTitle !== null && row.missionState !== null
        ? { title: row.missionTitle, state: row.missionState }
        : null,
    createdAt: row.createdAt,
  };
}

function historiesOf(
  kind: 'DOCUMENT' | 'FIELD',
  requests: readonly RawRequest[],
  sends: readonly StoredSend[],
  decisions: readonly StoredDecision[],
): RequestHistory[] {
  return requests.map((row) => ({
    request: toRequestRow(row, kind),
    sends: sends.filter((send) => send.requestId === row.id),
    decisions: decisions.filter((decision) => decision.requestId === row.id),
  }));
}

/**
 * This traveller's document requests that ever carried one of `documentIds` (as the request's
 * answer, in a pinned send or in a decision), each with every send and decision. Three
 * statements; two when exact copies are not kept yet. `onlyRequestIds` narrows the read to those
 * requests, for reading a few of them again.
 */
export async function documentRequestHistories(
  access: Proof,
  tx: Db,
  documentIds: readonly string[],
  pinsPresent: boolean,
  onlyRequestIds?: readonly string[],
): Promise<RequestHistory[]> {
  const requests = schema.evidenceRequests;
  const sendsTable = schema.evidenceRequestSubmissions;
  const decisionsTable = schema.evidenceRequestDecisions;
  const ids = [...documentIds];
  const rows = await requestsQuery(access, tx).where(
    and(
      eq(requests.applicantId, access.applicant.id),
      eq(requests.kind, 'DOCUMENT'),
      onlyRequestIds ? inArray(requests.id, [...onlyRequestIds]) : undefined,
      or(
        inArray(requests.respondingDocumentId, ids),
        pinsPresent
          ? inArray(
              requests.id,
              tx
                .select({ id: sendsTable.evidenceRequestId })
                .from(sendsTable)
                .where(inArray(sendsTable.documentId, ids)),
            )
          : undefined,
        inArray(
          requests.id,
          tx
            .select({ id: decisionsTable.evidenceRequestId })
            .from(decisionsTable)
            .where(inArray(decisionsTable.respondingDocumentId, ids)),
        ),
      ),
    ),
  );
  if (rows.length === 0) return [];
  const requestIds = rows.map((row) => row.id);

  const sends: StoredSend[] = pinsPresent
    ? (
        await tx
          .select({
            send: sendsTable,
            version: {
              documentId: schema.documentVersions.documentId,
              storageObjectId: schema.documentVersions.storageObjectId,
              sha256: schema.documentVersions.sha256,
            },
          })
          .from(sendsTable)
          .leftJoin(
            schema.documentVersions,
            eq(schema.documentVersions.id, sendsTable.documentVersionId),
          )
          .where(inArray(sendsTable.evidenceRequestId, requestIds))
      ).map(({ send, version }) => ({
        id: send.id,
        requestId: send.evidenceRequestId,
        roundNo: send.roundNo,
        sentAt: send.sentAt,
        subjectId: send.documentId,
        versionId: send.documentVersionId,
        intact: version !== null && pinnedVersionIntact(send, version),
      }))
    : [];

  const links = schema.evidenceRequestDecisionSubmissions;
  const decisionColumns = {
    id: decisionsTable.id,
    requestId: decisionsTable.evidenceRequestId,
    outcome: decisionsTable.outcome,
    decidedAt: decisionsTable.createdAt,
    subjectId: decisionsTable.respondingDocumentId,
  };
  const decisions: StoredDecision[] = pinsPresent
    ? await tx
        .select({ ...decisionColumns, sendId: links.submissionId })
        .from(decisionsTable)
        .leftJoin(links, eq(links.decisionId, decisionsTable.id))
        .where(inArray(decisionsTable.evidenceRequestId, requestIds))
    : (
        await tx
          .select(decisionColumns)
          .from(decisionsTable)
          .where(inArray(decisionsTable.evidenceRequestId, requestIds))
      ).map((row) => ({ ...row, sendId: null }));
  return historiesOf('DOCUMENT', rows, sends, decisions);
}

/**
 * This traveller's detail requests that ever carried `factId`, each with every send and
 * decision. Three statements; two when exact saved values are not kept yet. `onlyRequestIds`
 * narrows the read to those requests, for reading a few of them again.
 */
export async function detailRequestHistories(
  access: Proof,
  tx: Db,
  factId: string,
  knownVersionIds: ReadonlySet<string>,
  pinsPresent: boolean,
  onlyRequestIds?: readonly string[],
): Promise<RequestHistory[]> {
  const requests = schema.evidenceRequests;
  const sendsTable = schema.evidenceRequestFactSubmissions;
  const decisionsTable = schema.evidenceRequestDecisions;
  const rows = await requestsQuery(access, tx).where(
    and(
      eq(requests.applicantId, access.applicant.id),
      eq(requests.kind, 'FIELD'),
      onlyRequestIds ? inArray(requests.id, [...onlyRequestIds]) : undefined,
      or(
        eq(requests.respondingFactId, factId),
        pinsPresent
          ? inArray(
              requests.id,
              tx
                .select({ id: sendsTable.evidenceRequestId })
                .from(sendsTable)
                .where(eq(sendsTable.factId, factId)),
            )
          : undefined,
        inArray(
          requests.id,
          tx
            .select({ id: decisionsTable.evidenceRequestId })
            .from(decisionsTable)
            .where(eq(decisionsTable.respondingFactId, factId)),
        ),
      ),
    ),
  );
  if (rows.length === 0) return [];
  const requestIds = rows.map((row) => row.id);

  const sends: StoredSend[] = pinsPresent
    ? (
        await tx.select().from(sendsTable).where(inArray(sendsTable.evidenceRequestId, requestIds))
      ).map((send) => ({
        id: send.id,
        requestId: send.evidenceRequestId,
        roundNo: send.roundNo,
        sentAt: send.sentAt,
        subjectId: send.factId,
        versionId: send.factVersionId,
        // A send of this detail must pin one of its saved values; anything else is a broken record.
        intact: send.factId !== factId || knownVersionIds.has(send.factVersionId),
      }))
    : [];

  const links = schema.evidenceRequestDecisionFactSubmissions;
  const decisionColumns = {
    id: decisionsTable.id,
    requestId: decisionsTable.evidenceRequestId,
    outcome: decisionsTable.outcome,
    decidedAt: decisionsTable.createdAt,
    subjectId: decisionsTable.respondingFactId,
  };
  const decisions: StoredDecision[] = pinsPresent
    ? await tx
        .select({ ...decisionColumns, sendId: links.submissionId })
        .from(decisionsTable)
        .leftJoin(links, eq(links.decisionId, decisionsTable.id))
        .where(inArray(decisionsTable.evidenceRequestId, requestIds))
    : (
        await tx
          .select(decisionColumns)
          .from(decisionsTable)
          .where(inArray(decisionsTable.evidenceRequestId, requestIds))
      ).map((row) => ({ ...row, sendId: null }));
  return historiesOf('FIELD', rows, sends, decisions);
}

// ---------------------------------------------------------------------------------------------
// Sends to agencies: answered checklists

export interface CollectionAnswer {
  /** The traveller's own answer (the record their answers page lists). */
  readonly responseId: string;
  readonly agencyId: string;
  /** Empty while the agency is not one VisaStack names to a traveller. */
  readonly agencyName: string;
  readonly submittedAt: Date;
  /** The documents, or the saved values of the detail, this answer carried. */
  readonly carriedIds: readonly string[];
}

/**
 * This traveller's live answers to agency checklists that carried one of the documents, or the
 * detail. "Live" is the access layer's own rule (`liveCollectionResponse`): not withdrawn, not
 * replaced by a newer answer, request not revoked. Two statements.
 *
 * What the agency decided about an answer is not read: its decisions and the checklist request
 * itself live in tables kept for the asking agency alone (the agency document request ratchet in
 * access/enforcement.test.ts allows no exception), so a traveller's read cannot say whether an
 * answer is still being checked, was accepted or was sent back.
 */
export async function collectionAnswersCarrying(
  access: Proof,
  tx: Db,
  subject: { readonly documentIds: readonly string[] } | { readonly factId: string },
): Promise<CollectionAnswer[]> {
  const responses = schema.agencyCollectionResponses;
  const items = schema.agencyCollectionResponseItems;
  const carries =
    'documentIds' in subject
      ? inArray(items.documentId, [...subject.documentIds])
      : eq(items.factId, subject.factId);
  const rows = await tx
    .select({
      responseId: responses.id,
      agencyId: responses.organizationId,
      agencyName: schema.organizations.name,
      agencyStatus: schema.organizations.status,
      submittedAt: responses.submittedAt,
    })
    .from(responses)
    .innerJoin(schema.organizations, eq(schema.organizations.id, responses.organizationId))
    .where(
      and(
        eq(responses.applicantId, access.applicant.id),
        liveCollectionResponse(),
        inArray(responses.id, tx.select({ id: items.responseId }).from(items).where(carries)),
      ),
    );
  if (rows.length === 0) return [];
  const carried = await tx
    .select({
      responseId: items.responseId,
      documentId: items.documentId,
      factVersionId: items.factVersionId,
    })
    .from(items)
    .where(
      and(
        inArray(
          items.responseId,
          rows.map((row) => row.responseId),
        ),
        carries,
      ),
    );
  return rows.map((row) => ({
    responseId: row.responseId,
    agencyId: row.agencyId,
    // Named only while VisaStack has reviewed the agency, as the traveller's own answers list does.
    agencyName: row.agencyStatus === 'ACTIVE' ? row.agencyName : '',
    submittedAt: row.submittedAt,
    carriedIds: carried
      .filter((item) => item.responseId === row.responseId)
      .flatMap((item) => {
        const id = 'documentIds' in subject ? item.documentId : item.factVersionId;
        return id ? [id] : [];
      }),
  }));
}

// ---------------------------------------------------------------------------------------------
// Sharing

export interface LiveShare {
  readonly grantId: string;
  readonly recipientKind: 'ORGANIZATION' | 'PERSON';
  readonly recipientName: string;
  readonly agencyId: string | null;
  readonly reach: ImpactShareReach;
  readonly createdAt: Date;
  /** Whether this share lets its recipient open the thing described, by the policy evaluation. */
  readonly reaches: (resource: {
    readonly documentId?: string;
    readonly category?: string | null;
  }) => boolean;
}

/** Stands in for the member of an agency a share was made to; no account has this id. */
const SOME_MEMBER = '00000000-0000-0000-0000-000000000000' as AccountId;

/**
 * Every live share of this traveller's record (`isLiveGrant` at `now`), each with a `reaches`
 * question answered by the policy engine itself (`authorize`), the way the recipient's own
 * workspace decides what to list. The question is about scope: the share is judged as it applies
 * once in force (a paused or not yet accepted share is still live and can come into force), for
 * any action it carries, with its own purpose. A share to an agency that is not active reaches
 * nothing. No access record is read: this says what a recipient may open, never what they opened.
 * One statement.
 */
export async function liveShares(access: Proof, tx: Db, now: Date): Promise<LiveShare[]> {
  const grants = schema.grants;
  const rows = await tx
    .select({
      grant: grants,
      agencyName: schema.organizations.name,
      agencyStatus: schema.organizations.status,
      accountEmail: schema.accounts.email,
    })
    .from(grants)
    .leftJoin(schema.organizations, eq(schema.organizations.id, grants.recipientOrganizationId))
    .leftJoin(schema.accounts, eq(schema.accounts.id, grants.recipientAccountId))
    .where(
      and(
        eq(grants.applicantId, access.applicant.id),
        inArray(grants.status, [...LIVE_GRANT_STATUSES]),
      ),
    );
  const applicantId = access.applicant.id as ApplicantId;
  return rows
    .filter((row) => isLiveGrant(row.grant, now))
    .map(({ grant, agencyName, agencyStatus, accountEmail }) => {
      const toAgency = grant.recipientOrganizationId !== null;
      const actor: PolicyActor = toAgency
        ? {
            kind: 'organization_member',
            accountId: (grant.recipientAccountId as AccountId | null) ?? SOME_MEMBER,
            membership: {
              organizationId: grant.recipientOrganizationId as AgencyId,
              role: 'OWNER',
              active: true,
              organizationActive: agencyStatus === 'ACTIVE',
            },
          }
        : { kind: 'individual_recipient', accountId: grant.recipientAccountId as AccountId };
      const inForce = {
        ...toPolicyGrant(grant),
        status: 'ACTIVE' as const,
        acceptedAt: (grant.acceptedAt ?? grant.startAt).toISOString(),
      };
      const at = new Date(Math.max(now.getTime(), grant.startAt.getTime()));
      const context = { now: at, purpose: grant.purpose, stepUpSatisfied: true, grants: [inForce] };
      return {
        grantId: grant.id,
        recipientKind: toAgency ? ('ORGANIZATION' as const) : ('PERSON' as const),
        recipientName: (toAgency ? agencyName : accountEmail) ?? '',
        agencyId: grant.recipientOrganizationId,
        reach:
          grant.documentIds !== null
            ? ('BY_NAME' as const)
            : grant.categories !== null
              ? ('CATEGORY' as const)
              : ('WHOLE_RECORD' as const),
        createdAt: grant.createdAt,
        reaches: (asked) => {
          const resource: PolicyResource = {
            applicantId,
            ...(asked.documentId ? { documentId: asked.documentId as DocumentId } : {}),
            ...(asked.category ? { category: asked.category } : {}),
          };
          return grant.actions.some(
            (action) => authorize({ actor, action, resource, context }).allowed,
          );
        },
      };
    });
}

/** What one live share reaches, for the classification rules. */
export function shareReachOf(
  share: LiveShare,
  asked: {
    readonly subject: { readonly documentId?: string; readonly category?: string | null };
    readonly replacement?: { readonly documentId: string; readonly category?: string | null };
    readonly laterDocument?: { readonly documentId: string; readonly category?: string | null };
  },
): ShareReach {
  return {
    subject: share.reaches(asked.subject),
    replacement: asked.replacement ? share.reaches(asked.replacement) : null,
    laterDocument: asked.laterDocument ? share.reaches(asked.laterDocument) : null,
  };
}
