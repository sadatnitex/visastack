import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { LIVE_GRANT_STATUSES } from '../../access/grant-scope';
import { type Db, schema } from '../../db';
import { isDocumentVersionUsable } from '../../documents';
import { activeOrVerifiedErasureStorageObjectIds } from '../../erasure';
// Imported by the foundation's path, which the read-path guard recognises.
import { presentDocumentCondition } from '../../lifecycle/foundation/conditions';
import { type LifecycleAccess, lifecycleScope } from '../foundation/access';
import type { DuplicateBlockReason } from '../foundation/actions';
import { isUuid } from '../foundation/ids';
import { lifecycleTablesPresent } from '../foundation/presence';
import { FINISHED_CASE_STATES_FOR_REPLACE } from '../replace/replace';

/*
 * Whether a document is an exact duplicate the person may delete themselves (LC-C, owner
 * decisions D2 and D5).
 *
 * D2: every version's fingerprint must exist in another of the same person's documents that
 * stays: present (not in Recently Deleted, not being removed), not waiting for a removal support
 * approved or is reviewing, kept in the person's own documents, and usable (checked clean,
 * servable, its file not being erased). A version with no fingerprint makes the document unique.
 *
 * D5: a deletable duplicate is still refused, with Archive offered instead, when a finished case
 * selected it, it answered an agency evidence request, a contributor handed it over, a live share
 * names it, or a legal hold covers it.
 *
 * This is stricter than `findDuplicateVersions` (documents.ts), which only says "looks the same"
 * after an upload and is left as it is.
 */

/** Case states that are over (D5): the same list Replace uses. */
export const FINISHED_CASE_STATES = FINISHED_CASE_STATES_FOR_REPLACE;

export interface DuplicateStatus {
  /** D2 holds: another usable document that stays holds every version of this one. */
  readonly isDuplicate: boolean;
  /** The identical document that stays and that open cases switch to; null when not a duplicate. */
  readonly survivorDocumentId: string | null;
  /** Why deleting is refused (D5); null when it may be deleted, or when it is not a duplicate. */
  readonly blockReason: DuplicateBlockReason | null;
}

export const NOT_A_DUPLICATE: DuplicateStatus = Object.freeze({
  isDuplicate: false,
  survivorDocumentId: null,
  blockReason: null,
});

/** Removal states that mean "this document is going": support is reviewing it or approved it. */
const REMOVAL_IN_PROGRESS = ['PENDING', 'APPROVED'] as const;

interface Candidate {
  readonly documentId: string;
  readonly applicantId: string;
  readonly createdAt: Date;
  readonly archived: boolean;
  readonly replaced: boolean;
  readonly docType: string | null;
  readonly expired: boolean;
  readonly latestSha: string | null;
  readonly usableShas: ReadonlySet<string>;
}

/** Survivor preference: current over archived, not replaced, its latest file the same, oldest. */
function better(a: Candidate, b: Candidate, sha: string): number {
  const rank = (c: Candidate) => [
    c.archived ? 1 : 0,
    c.replaced ? 1 : 0,
    c.latestSha === sha ? 0 : 1,
  ];
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i += 1) {
    const diff = (ra[i] ?? 0) - (rb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  const time = a.createdAt.getTime() - b.createdAt.getTime();
  if (time !== 0) return time;
  return a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0;
}

/**
 * The duplicate status of each document, keyed by document id. A document the access does not
 * cover, that does not exist, or that is already in Recently Deleted or being removed, is absent.
 * While migration 0113 has not run, every covered document reads "not a duplicate": nothing can
 * be deleted yet, so nothing is offered.
 *
 * `access` is any genuine proof for the documents' traveller, a scheduled job or fresh staff.
 */
export async function duplicateStatuses(
  db: Db,
  documentIds: readonly string[],
  access: LifecycleAccess,
  options: { readonly now?: Date } = {},
): Promise<ReadonlyMap<string, DuplicateStatus>> {
  const scope = lifecycleScope(access);
  const ids = [...new Set(documentIds.filter(isUuid).map((id) => id.toLowerCase()))];
  if (scope === undefined || ids.length === 0) return new Map();
  const now = options.now ?? new Date();
  const lifecycle = await lifecycleTablesPresent(db);
  const documents = schema.documents;

  const subjects = await db
    .select({
      id: documents.id,
      applicantId: documents.applicantId,
      docType: documents.docType,
      expiresAt: documents.expiresAt,
      supersededBy: documents.supersededByDocumentId,
    })
    .from(documents)
    .where(
      and(
        inArray(documents.id, ids),
        scope === null ? undefined : eq(documents.applicantId, scope),
        lifecycle ? presentDocumentCondition() : undefined,
      ),
    );
  const result = new Map<string, DuplicateStatus>(
    subjects.map((row) => [row.id, NOT_A_DUPLICATE] as const),
  );
  if (!lifecycle || subjects.length === 0) return result;

  // Every version of every subject, oldest first, so the last one seen is the latest.
  const subjectVersions = await db
    .select({
      id: schema.documentVersions.id,
      documentId: schema.documentVersions.documentId,
      sha256: schema.documentVersions.sha256,
    })
    .from(schema.documentVersions)
    .where(
      inArray(
        schema.documentVersions.documentId,
        subjects.map((row) => row.id),
      ),
    )
    .orderBy(asc(schema.documentVersions.versionNumber));
  // A copy the profile's confirmed details were read from stays, so that evidence is never lost
  // when its file is destroyed; its identical twin is the one that can go.
  const citedVersions = new Set(
    subjectVersions.length === 0
      ? []
      : (
          await db
            .selectDistinct({ versionId: schema.factVersions.sourceDocumentVersionId })
            .from(schema.factVersions)
            .where(
              inArray(
                schema.factVersions.sourceDocumentVersionId,
                subjectVersions.map((v) => v.id),
              ),
            )
        ).map((row) => row.versionId),
  );
  const citedDocuments = new Set(
    subjectVersions.filter((v) => citedVersions.has(v.id)).map((v) => v.documentId),
  );
  const versionsOf = new Map<string, (string | null)[]>();
  for (const version of subjectVersions) {
    const list = versionsOf.get(version.documentId) ?? [];
    list.push(version.sha256);
    versionsOf.set(version.documentId, list);
  }
  const hashes = [
    ...new Set(subjectVersions.flatMap((v) => (v.sha256 === null ? [] : [v.sha256]))),
  ];
  if (hashes.length === 0) return result;

  // Every other present document of the same people holding one of those fingerprints.
  const applicantIds = [...new Set(subjects.map((row) => row.applicantId))];
  const lc = schema.documentLifecycle;
  const removals = schema.documentRemovalRequests;
  const candidateRows = await db
    .select({
      documentId: documents.id,
      applicantId: documents.applicantId,
      createdAt: documents.createdAt,
      supersededBy: documents.supersededByDocumentId,
      docType: documents.docType,
      expiresAt: documents.expiresAt,
      archivedAt: lc.archivedAt,
      versionNumber: schema.documentVersions.versionNumber,
      sha256: schema.documentVersions.sha256,
      safetyStatus: schema.documentVersions.safetyStatus,
      processingStatus: schema.documentVersions.processingStatus,
      storageObjectId: schema.documentVersions.storageObjectId,
    })
    .from(schema.documentVersions)
    .innerJoin(documents, eq(documents.id, schema.documentVersions.documentId))
    .leftJoin(lc, eq(lc.documentId, documents.id))
    .where(
      and(
        inArray(documents.applicantId, applicantIds),
        inArray(schema.documentVersions.sha256, hashes),
        // Only what the person keeps in their own documents can stand in for what they delete.
        eq(documents.walletVisible, true),
        presentDocumentCondition(),
        sql`not exists (select 1 from ${removals} where ${removals.documentId} = ${documents.id} and ${removals.status} in (${sql.join(
          REMOVAL_IN_PROGRESS.map((status) => sql`${status}`),
          sql`, `,
        )}))`,
      ),
    );
  const erased = await activeOrVerifiedErasureStorageObjectIds(
    db,
    candidateRows.map((row) => row.storageObjectId),
  );
  // The latest version of each candidate, to prefer a survivor whose current file is the same.
  const latestOf = new Map<string, string | null>();
  const latestRows = await db
    .select({
      documentId: schema.documentVersions.documentId,
      versionNumber: schema.documentVersions.versionNumber,
      sha256: schema.documentVersions.sha256,
    })
    .from(schema.documentVersions)
    .where(
      inArray(schema.documentVersions.documentId, [
        ...new Set(candidateRows.map((row) => row.documentId)),
        // An empty IN list is not valid SQL; a subject id is always safe to add.
        ...subjects.map((row) => row.id),
      ]),
    )
    .orderBy(asc(schema.documentVersions.versionNumber));
  for (const row of latestRows) latestOf.set(row.documentId, row.sha256);

  const candidates = new Map<string, Candidate & { usableShas: Set<string> }>();
  for (const row of candidateRows) {
    const usable =
      row.sha256 !== null &&
      !erased.has(row.storageObjectId) &&
      isDocumentVersionUsable({
        safetyStatus: row.safetyStatus,
        processingStatus: row.processingStatus,
        erased: false,
      });
    const existing = candidates.get(row.documentId) ?? {
      documentId: row.documentId,
      applicantId: row.applicantId,
      createdAt: row.createdAt,
      archived: row.archivedAt !== null,
      replaced: row.supersededBy !== null,
      docType: row.docType,
      expired: row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime(),
      latestSha: latestOf.get(row.documentId) ?? null,
      usableShas: new Set<string>(),
    };
    if (usable && row.sha256) existing.usableShas.add(row.sha256);
    candidates.set(row.documentId, existing);
  }

  const duplicates = new Map<string, { applicantId: string; survivor: string }>();
  for (const subject of subjects) {
    const shas = versionsOf.get(subject.id) ?? [];
    if (shas.length === 0 || shas.some((sha) => sha === null)) continue; // no fingerprint
    if (citedDocuments.has(subject.id)) continue; // the profile's evidence
    const others = [...candidates.values()].filter(
      (c) => c.documentId !== subject.id && c.applicantId === subject.applicantId,
    );
    const covered = shas.every((sha) => others.some((c) => sha !== null && c.usableShas.has(sha)));
    if (!covered) continue;
    const latest = shas[shas.length - 1] as string;
    // The copy cases and AI app choices switch to must serve them as well as this one did: the
    // same kind, not replaced or expired unless this one is too (D4).
    const subjectExpired =
      subject.expiresAt !== null && subject.expiresAt.getTime() <= now.getTime();
    const survivor = others
      .filter(
        (c) =>
          c.usableShas.has(latest) &&
          (subject.docType === null || c.docType === subject.docType) &&
          (!c.replaced || subject.supersededBy !== null) &&
          (!c.expired || subjectExpired),
      )
      .sort((a, b) => better(a, b, latest))[0];
    if (!survivor) continue;
    duplicates.set(subject.id, {
      applicantId: subject.applicantId,
      survivor: survivor.documentId,
    });
  }
  if (duplicates.size === 0) return result;

  const blocks = await blockReasons(db, duplicates, now);
  for (const [documentId, { survivor }] of duplicates) {
    result.set(documentId, {
      isDuplicate: true,
      survivorDocumentId: survivor,
      blockReason: blocks.get(documentId) ?? null,
    });
  }
  return result;
}

/** `duplicateStatuses` for one document; null when it is absent from that map. */
export async function duplicateStatus(
  db: Db,
  documentId: string,
  access: LifecycleAccess,
  options: { readonly now?: Date } = {},
): Promise<DuplicateStatus | null> {
  return (
    (await duplicateStatuses(db, [documentId], access, options)).get(documentId.toLowerCase()) ??
    null
  );
}

/**
 * The first D5 reason that refuses deleting each duplicate, in a fixed order: a legal hold, a
 * finished case, an agency request it answered, a contributor's handover, a live share naming it.
 */
async function blockReasons(
  db: Db,
  duplicates: ReadonlyMap<string, { readonly applicantId: string }>,
  now: Date,
): Promise<ReadonlyMap<string, DuplicateBlockReason>> {
  const ids = [...duplicates.keys()];
  const found = new Map<string, Set<DuplicateBlockReason>>();
  const add = (documentId: string | null, reason: DuplicateBlockReason) => {
    if (!documentId) return;
    const set = found.get(documentId) ?? new Set<DuplicateBlockReason>();
    set.add(reason);
    found.set(documentId, set);
  };

  // Legal holds in one read (the rule of documentBlockedByLegalHold): applicant-wide, on the
  // document, or on a case that selects it.
  const applicantIds = [...new Set([...duplicates.values()].map((d) => d.applicantId))];
  const holds = await db
    .select({
      applicantId: schema.legalHolds.applicantId,
      missionId: schema.legalHolds.missionId,
      documentId: schema.legalHolds.documentId,
    })
    .from(schema.legalHolds)
    .where(
      and(inArray(schema.legalHolds.applicantId, applicantIds), eq(schema.legalHolds.active, true)),
    );
  if (holds.length > 0) {
    const selections = await db
      .select({
        documentId: schema.selectedEvidence.documentId,
        missionId: schema.selectedEvidence.missionId,
      })
      .from(schema.selectedEvidence)
      .where(inArray(schema.selectedEvidence.documentId, ids));
    for (const [documentId, { applicantId }] of duplicates) {
      const missions = new Set(
        selections.filter((s) => s.documentId === documentId).map((s) => s.missionId),
      );
      const held = holds.some(
        (hold) =>
          hold.applicantId === applicantId &&
          ((hold.missionId === null && hold.documentId === null) ||
            hold.documentId === documentId ||
            (hold.missionId !== null && missions.has(hold.missionId))),
      );
      if (held) add(documentId, 'LEGAL_HOLD');
    }
  }

  const finished = await db
    .selectDistinct({ documentId: schema.selectedEvidence.documentId })
    .from(schema.selectedEvidence)
    .innerJoin(schema.missions, eq(schema.missions.id, schema.selectedEvidence.missionId))
    .where(
      and(
        inArray(schema.selectedEvidence.documentId, ids),
        inArray(schema.missions.state, [...FINISHED_CASE_STATES]),
      ),
    );
  for (const row of finished) add(row.documentId, 'FINISHED_CASE');

  const answered = await db
    .selectDistinct({ documentId: schema.evidenceRequests.respondingDocumentId })
    .from(schema.evidenceRequests)
    .where(inArray(schema.evidenceRequests.respondingDocumentId, ids));
  for (const row of answered) add(row.documentId, 'AGENCY_REQUEST_ANSWER');
  const decided = await db
    .selectDistinct({ documentId: schema.evidenceRequestDecisions.respondingDocumentId })
    .from(schema.evidenceRequestDecisions)
    .where(inArray(schema.evidenceRequestDecisions.respondingDocumentId, ids));
  for (const row of decided) add(row.documentId, 'AGENCY_REQUEST_ANSWER');

  const handedOver = await db
    .selectDistinct({ documentId: schema.contributorRequests.submittedDocumentId })
    .from(schema.contributorRequests)
    .where(inArray(schema.contributorRequests.submittedDocumentId, ids));
  for (const row of handedOver) add(row.documentId, 'CONTRIBUTOR_HANDOVER');

  const grants = await db
    .select({ documentIds: schema.grants.documentIds })
    .from(schema.grants)
    .where(
      and(
        inArray(schema.grants.applicantId, applicantIds),
        isNotNull(schema.grants.documentIds),
        inArray(schema.grants.status, [...LIVE_GRANT_STATUSES]),
        or(isNull(schema.grants.expiryAt), gt(schema.grants.expiryAt, now)),
      ),
    );
  const named = new Set(grants.flatMap((grant) => grant.documentIds ?? []));
  for (const id of ids) if (named.has(id)) add(id, 'SHARED_BY_NAME');

  const order: readonly DuplicateBlockReason[] = [
    'LEGAL_HOLD',
    'FINISHED_CASE',
    'AGENCY_REQUEST_ANSWER',
    'CONTRIBUTOR_HANDOVER',
    'SHARED_BY_NAME',
  ];
  const result = new Map<string, DuplicateBlockReason>();
  for (const [documentId, reasons] of found) {
    const first = order.find((reason) => reasons.has(reason));
    if (first) result.set(documentId, first);
  }
  return result;
}
