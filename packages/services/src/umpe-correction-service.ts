/**
 * UMPE P11 (S06): Suggest a Checklist Correction.
 *
 * A traveller (from a line of their own case checklist) or an agency owner or admin (from one of
 * their document requests) tells pack editors that an item looks missing, out of date or wrong,
 * optionally with an official link. The suggestion goes to a moderated queue next to Official
 * Sources. It is never a rule and changes nothing by itself:
 *
 * - No pack, version, requirement, case, handoff or agency revision is written here, ever. A
 *   correction reaches travellers only after an editor writes a draft in Pack Studio and a second
 *   person approves and publishes it (the existing author and reviewer steps).
 * - The official link is checked for shape only (https, no sign-in details, bounded) and is never
 *   fetched or shown as anything but a plain link with its address visible.
 * - The submitter's account is kept only for the limit and for duplicates; editors never see who
 *   sent a suggestion, only whether a traveller or an agency did.
 * - Audit records carry ids and kinds only: never the detail, the link or the item's words.
 */
import { type Result, err, ok } from '@visastack/core';
import { and, asc, count, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { AuthorizedApplicant, type StaffScope } from './access';
import {
  type AgencyCollectionScope,
  agencyCollectionScopeProblem,
} from './access/collection-scope';
import { staffScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError, keyedError } from './errors';
import { isUuid } from './lifecycle/foundation/ids';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';
import { CORRECTIONS_NOT_READY, correctionTablesPresent } from './umpe-correction-tables';

export const CORRECTION_CATEGORIES = [
  'MISSING',
  'OUTDATED',
  'WRONG',
  'WRONG_NECESSITY',
  'ALTERNATIVE_ACCEPTED',
  'SOURCE_DISCREPANCY',
  'OTHER',
] as const;
export type CorrectionCategory = (typeof CORRECTION_CATEGORIES)[number];

/** What each category means, in the words the person chooses from. */
export const CORRECTION_CATEGORY_LABELS: Readonly<Record<CorrectionCategory, string>> = {
  MISSING: 'Something Is Missing',
  OUTDATED: 'Out of Date',
  WRONG: 'Wrong or Does Not Apply',
  WRONG_NECESSITY: 'Should Be Required or Optional',
  ALTERNATIVE_ACCEPTED: 'Another Document Is Accepted',
  SOURCE_DISCREPANCY: 'The Official Page Says Otherwise',
  OTHER: 'Something Else',
};

export const CORRECTION_STATUSES = [
  'RECEIVED',
  'IN_REVIEW',
  'DISMISSED',
  'ACCEPTED_FOR_DRAFT',
] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];
export type CorrectionDecision = Exclude<CorrectionStatus, 'RECEIVED'>;

export const CORRECTION_STATUS_LABELS: Readonly<Record<CorrectionStatus, string>> = {
  RECEIVED: 'New',
  IN_REVIEW: 'In Review',
  DISMISSED: 'Dismissed',
  ACCEPTED_FOR_DRAFT: 'Accepted for Draft',
};

const OPEN_STATUSES = ['RECEIVED', 'IN_REVIEW'] as const;

export const CORRECTION_DETAIL_MAX = 1000;
export const CORRECTION_URL_MAX = 2048;
export const CORRECTION_QUEUE_LIMIT = 100;
const DECIDED_LIST_LIMIT = 20;




// Control characters other than tab and line breaks, and the bidirectional overrides that can
// make a link or a note read differently from what it holds. Built from code points.
const UNSAFE_CLASS = `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}${String.fromCharCode(0x202a)}-${String.fromCharCode(0x202e)}${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]`;
const UNSAFE_ANY = new RegExp(UNSAFE_CLASS);
const UNSAFE_ALL = new RegExp(UNSAFE_CLASS, 'g');

function isCategory(value: string): value is CorrectionCategory {
  return (CORRECTION_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The official link as it will be stored, null when none was given, or a refusal. Only an https
 * address with a host and no user name or password; it is never fetched.
 */
export function cleanOfficialUrl(
  raw: string | null | undefined,
): string | null | { error: string } {
  const text = (raw ?? '').trim();
  if (text.length === 0) return null;
  const refused = { error: 'Enter the full https address of an official page, or leave it empty.' };
  if (text.length > CORRECTION_URL_MAX || UNSAFE_ANY.test(text) || /\s/.test(text)) return refused;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return refused;
  }
  if (url.protocol !== 'https:' || url.hostname.length === 0) return refused;
  if (url.username !== '' || url.password !== '') return refused;
  if (url.href.length > CORRECTION_URL_MAX) return refused;
  return url.href;
}

/** The detail as stored: trimmed, unsafe characters removed, null when empty. */
function cleanDetail(raw: string | null | undefined): string | null | { error: string } {
  // A browser sends each line break as two characters; count it as the one the person typed.
  const text = (raw ?? '').replace(/\r\n?/g, '\n').replace(UNSAFE_ALL, '').trim();
  if (text.length === 0) return null;
  if (text.length > CORRECTION_DETAIL_MAX) {
    return { error: 'Keep the detail under 1,000 characters.' };
  }
  return text;
}

export interface CorrectionInput {
  /** The checklist item it is about; null for something missing from the checklist as a whole. */
  readonly packRequirementId: string | null;
  readonly category: string;
  readonly officialUrl?: string | null;
  readonly detail?: string | null;
}

export interface SuggestedCorrection {
  readonly id: string;
  /** The same open suggestion was already sent from this account: nothing new was stored. */
  readonly duplicate: boolean;
}

interface CleanCorrection {
  readonly packRequirementId: string | null;
  readonly category: CorrectionCategory;
  readonly officialUrl: string | null;
  readonly detail: string | null;
}

function cleanInput(input: CorrectionInput): CleanCorrection | ServiceError {
  if (!isCategory(input.category)) return keyedError('invalid', 'umpe_correction_service.choose_what_looks_wrong');
  if (input.packRequirementId !== null && !isUuid(input.packRequirementId)) {
    return keyedError('not_found', 'umpe_correction_service.this_item_is_not_on_this');
  }
  if (input.packRequirementId === null && input.category !== 'MISSING') {
    return keyedError('invalid', 'umpe_correction_service.choose_the_item_this_is_about');
  }
  const officialUrl = cleanOfficialUrl(input.officialUrl);
  if (officialUrl !== null && typeof officialUrl === 'object') {
    return serviceError('invalid', officialUrl.error);
  }
  const detail = cleanDetail(input.detail);
  if (detail !== null && typeof detail === 'object') return serviceError('invalid', detail.error);
  return {
    packRequirementId: input.packRequirementId,
    category: input.category,
    officialUrl,
    detail,
  };
}

/** The requirement's own version, when it belongs to one of `versionIds`. */
async function requirementVersion(
  tx: Db,
  packRequirementId: string,
  versionIds: readonly string[],
): Promise<string | null> {
  if (versionIds.length === 0) return null;
  const row = first(
    await tx
      .select({ packVersionId: schema.packRequirements.packVersionId })
      .from(schema.packRequirements)
      .where(
        and(
          eq(schema.packRequirements.id, packRequirementId),
          inArray(schema.packRequirements.packVersionId, [...versionIds]),
        ),
      )
      .limit(1),
  );
  return row?.packVersionId ?? null;
}

/**
 * Stores one suggestion after the limit and the duplicate check, with its audit record, in the
 * caller's transaction. `packVersionId` is already proven to be one the submitter sees.
 */
async function storeCorrection(
  tx: Db,
  clean: CleanCorrection,
  packVersionId: string,
  submitter: {
    readonly kind: 'TRAVELLER' | 'AGENCY';
    readonly accountId: string;
    readonly organizationId: string | null;
  },
): Promise<Result<SuggestedCorrection, ServiceError>> {
  const limited = await checkRateLimit(
    tx,
    { subjectId: submitter.accountId, action: 'checklist_correction.suggest', label: 'suggestion' },
    RATE_LIMITS.CHECKLIST_CORRECTION,
  );
  if (!limited.allowed) return err(serviceError('rate_limited', limited.reason));
  const c = schema.umpeChecklistCorrections;
  const duplicate = first(
    await tx
      .select({ id: c.id })
      .from(c)
      .where(
        and(
          eq(c.submittedByAccountId, submitter.accountId),
          eq(c.packVersionId, packVersionId),
          clean.packRequirementId === null
            ? isNull(c.packRequirementId)
            : eq(c.packRequirementId, clean.packRequirementId),
          eq(c.category, clean.category),
          inArray(c.status, [...OPEN_STATUSES]),
        ),
      )
      .limit(1),
  );
  if (duplicate) return ok({ id: duplicate.id, duplicate: true });
  const version = first(
    await tx
      .select({ packId: schema.packVersions.packId })
      .from(schema.packVersions)
      .where(eq(schema.packVersions.id, packVersionId))
      .limit(1),
  );
  if (!version) return err(keyedError('not_found', 'umpe_correction_service.this_checklist_is_not_available_to'));
  const row = first(
    await tx
      .insert(c)
      .values({
        packId: version.packId,
        packVersionId,
        packRequirementId: clean.packRequirementId,
        category: clean.category,
        officialUrl: clean.officialUrl,
        detail: clean.detail,
        submitterKind: submitter.kind,
        submittedByAccountId: submitter.accountId,
        organizationId: submitter.organizationId,
      })
      .returning({ id: c.id }),
  );
  if (!row) return err(keyedError('stale', 'umpe_correction_service.the_suggestion_was_not_saved_try'));
  await appendAuditEvent(tx, {
    eventType: 'CHECKLIST_CORRECTION_SUGGESTED',
    actorAccountId: submitter.accountId,
    method: 'MANUAL',
    result: 'ALLOWED',
    resourceType: 'checklist_correction',
    resourceId: row.id,
    metadata: {
      category: clean.category,
      submitterKind: submitter.kind,
      wholeChecklist: clean.packRequirementId === null,
      withLink: clean.officialUrl !== null,
      withDetail: clean.detail !== null,
    },
  });
  return ok({ id: row.id, duplicate: false });
}

/**
 * A traveller suggests a correction on their own case's checklist. Only the case owner, only an
 * item of the version the case is pinned to. The case itself is only read.
 */
export async function suggestCaseChecklistCorrection(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  input: CorrectionInput & { readonly missionId: string },
): Promise<Result<SuggestedCorrection, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') ||
    proof.actor.kind !== 'applicant_owner'
  ) {
    return err(keyedError('forbidden', 'umpe_correction_service.only_the_traveller_who_owns_this'));
  }
  const resource = proof.resource;
  if (
    !isUuid(input.missionId) ||
    resource.kind !== 'mission' ||
    resource.mission.id !== input.missionId ||
    resource.mission.applicantId !== proof.applicant.id
  ) {
    return err(keyedError('not_found', 'umpe_correction_service.this_checklist_is_not_available_to'));
  }
  const clean = cleanInput(input);
  if ('code' in clean) return err(clean);
  if (!(await correctionTablesPresent(proof.tx))) {
    return err(keyedError('stale', 'umpe_correction_service.checklist_corrections_can_be_used_once'));
  }
  return proof.tx.transaction(async (tx) => {
    // The case as it is now, inside this transaction, scoped to the proof's person.
    const mission = first(
      await tx
        .select({ packVersionId: schema.missions.packVersionId })
        .from(schema.missions)
        .where(
          and(
            eq(schema.missions.id, input.missionId),
            eq(schema.missions.applicantId, proof.applicant.id),
            isNull(schema.missions.purgedAt),
          ),
        )
        .limit(1),
    );
    if (!mission) return err(keyedError('not_found', 'umpe_correction_service.this_checklist_is_not_available_to'));
    if (!mission.packVersionId) {
      return err(keyedError('invalid', 'umpe_correction_service.this_case_has_no_checklist_yet'));
    }
    if (
      clean.packRequirementId !== null &&
      !(await requirementVersion(tx, clean.packRequirementId, [mission.packVersionId]))
    ) {
      return err(keyedError('not_found', 'umpe_correction_service.this_item_is_not_on_this'));
    }
    return storeCorrection(tx, clean, mission.packVersionId, {
      kind: 'TRAVELLER',
      accountId: proof.applicant.ownerAccountId,
      organizationId: null,
    });
  });
}

/**
 * An agency owner or admin suggests a correction on the official checklist one of their document
 * requests follows (its working draft or any issued revision). Only official items qualify: the
 * agency's own items are theirs to change. No request row or revision is written.
 */
export async function suggestAgencyChecklistCorrection(
  db: Db,
  scope: AgencyCollectionScope,
  input: CorrectionInput & { readonly requestId: string },
): Promise<Result<SuggestedCorrection, ServiceError>> {
  const problem = agencyCollectionScopeProblem(scope);
  if (problem) return err(problem);
  if (!isUuid(input.requestId)) return err(keyedError('not_found', 'umpe_correction_service.this_checklist_is_not_available_to'));
  const clean = cleanInput(input);
  if ('code' in clean) return err(clean);
  if (!(await correctionTablesPresent(db)))
    return err(keyedError('stale', 'umpe_correction_service.checklist_corrections_can_be_used_once'));
  return db.transaction(async (tx) => {
    const request = first(
      await tx
        .select({
          id: schema.agencyCollectionRequests.id,
          draftPackVersionId: schema.agencyCollectionRequests.draftPackVersionId,
        })
        .from(schema.agencyCollectionRequests)
        .where(
          and(
            eq(schema.agencyCollectionRequests.id, input.requestId),
            eq(schema.agencyCollectionRequests.organizationId, scope.organizationId),
          ),
        )
        .limit(1),
    );
    if (!request) return err(keyedError('not_found', 'umpe_correction_service.this_checklist_is_not_available_to'));
    const revisions = await tx
      .select({ packVersionId: schema.agencyCollectionRequestRevisions.packVersionId })
      .from(schema.agencyCollectionRequestRevisions)
      .where(eq(schema.agencyCollectionRequestRevisions.requestId, request.id))
      .orderBy(desc(schema.agencyCollectionRequestRevisions.revisionNo));
    const versions = [
      ...new Set(
        [request.draftPackVersionId, ...revisions.map((r) => r.packVersionId)].filter(
          (id): id is string => id !== null,
        ),
      ),
    ];
    const primary = versions[0];
    if (!primary) {
      return err(
        keyedError('invalid', 'umpe_correction_service.this_request_uses_your_agency_s'),
      );
    }
    const packVersionId =
      clean.packRequirementId === null
        ? primary
        : await requirementVersion(tx, clean.packRequirementId, versions);
    if (!packVersionId) return err(keyedError('not_found', 'umpe_correction_service.this_item_is_not_on_this'));
    return storeCorrection(tx, clean, packVersionId, {
      kind: 'AGENCY',
      accountId: scope.accountId,
      organizationId: scope.organizationId,
    });
  });
}

// --- The editors' queue --------------------------------------------------------------------------

export interface CorrectionView {
  readonly id: string;
  readonly category: CorrectionCategory;
  readonly status: CorrectionStatus;
  readonly packId: string;
  readonly packName: string;
  readonly packVersionId: string;
  readonly version: number;
  /** The item, by its rule code; null for something missing from the whole checklist. */
  readonly item: { readonly kind: 'FIELD' | 'DOCUMENT'; readonly key: string } | null;
  readonly officialUrl: string | null;
  readonly detail: string | null;
  readonly submitterKind: 'TRAVELLER' | 'AGENCY';
  readonly createdAt: Date;
  /** How many other open suggestions say the same about the same item of the same version. */
  readonly alsoSuggestedBy: number;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;
}

export interface CorrectionQueue {
  readonly ready: boolean;
  readonly open: readonly CorrectionView[];
  /** The most recently decided, newest first, for context. */
  readonly decided: readonly CorrectionView[];
  readonly openCount: number;
}

/** A genuine, fresh pack management scope (the shared five-minute rule), or the refusal. */
function staffProblem(staff: StaffScope<'PACK_MANAGE'>): ServiceError | undefined {
  return staffScopeProblem(staff, 'PACK_MANAGE')
    ? keyedError('forbidden', 'umpe_correction_service.not_authorized')
    : undefined;
}

type CorrectionRow = typeof schema.umpeChecklistCorrections.$inferSelect;

async function viewsOf(db: Db, rows: readonly CorrectionRow[]): Promise<CorrectionView[]> {
  if (rows.length === 0) return [];
  const versionIds = [...new Set(rows.map((r) => r.packVersionId))];
  const requirementIds = [
    ...new Set(rows.map((r) => r.packRequirementId).filter((id): id is string => id !== null)),
  ];
  const [versions, requirements] = await Promise.all([
    db
      .select({
        id: schema.packVersions.id,
        version: schema.packVersions.version,
        packName: schema.packs.name,
      })
      .from(schema.packVersions)
      .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
      .where(inArray(schema.packVersions.id, versionIds)),
    requirementIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: schema.packRequirements.id,
            kind: schema.packRequirements.kind,
            fieldKey: schema.packRequirements.fieldKey,
            docType: schema.packRequirements.docType,
          })
          .from(schema.packRequirements)
          .where(inArray(schema.packRequirements.id, requirementIds)),
  ]);
  const versionById = new Map(versions.map((v) => [v.id, v]));
  const requirementById = new Map(requirements.map((r) => [r.id, r]));
  return rows.map((row) => {
    const version = versionById.get(row.packVersionId);
    const requirement = row.packRequirementId ? requirementById.get(row.packRequirementId) : null;
    const key = requirement
      ? requirement.kind === 'FIELD'
        ? requirement.fieldKey
        : requirement.docType
      : null;
    return {
      id: row.id,
      category: row.category as CorrectionCategory,
      status: row.status as CorrectionStatus,
      packId: row.packId,
      packName: version?.packName ?? '',
      packVersionId: row.packVersionId,
      version: version?.version ?? 0,
      item: requirement && key ? { kind: requirement.kind, key } : null,
      officialUrl: row.officialUrl,
      detail: row.detail,
      submitterKind: row.submitterKind as 'TRAVELLER' | 'AGENCY',
      createdAt: row.createdAt,
      alsoSuggestedBy: 0,
      reviewedAt: row.reviewedAt,
      reviewNote: row.reviewNote,
    };
  });
}

/**
 * The editors' queue: open suggestions oldest first (capped), each with how many others said the
 * same, and the latest decisions. Pack management only. Never names who sent a suggestion.
 */
export async function listChecklistCorrections(
  db: Db,
  staff: StaffScope<'PACK_MANAGE'>,
): Promise<Result<CorrectionQueue, ServiceError>> {
  const problem = staffProblem(staff);
  if (problem) return err(problem);
  if (!(await correctionTablesPresent(db))) {
    return ok({ ready: false, open: [], decided: [], openCount: 0 });
  }
  const c = schema.umpeChecklistCorrections;
  const [openRows, decidedRows, total] = await Promise.all([
    db
      .select()
      .from(c)
      .where(inArray(c.status, [...OPEN_STATUSES]))
      .orderBy(asc(c.createdAt), asc(c.id))
      .limit(CORRECTION_QUEUE_LIMIT),
    db
      .select()
      .from(c)
      .where(notInArray(c.status, [...OPEN_STATUSES]))
      .orderBy(desc(c.reviewedAt), desc(c.id))
      .limit(DECIDED_LIST_LIMIT),
    db
      .select({ n: count() })
      .from(c)
      .where(inArray(c.status, [...OPEN_STATUSES])),
  ]);
  // Same version, same item, same category, still open: counted across the whole queue.
  const sameKey = (r: Pick<CorrectionRow, 'packVersionId' | 'packRequirementId' | 'category'>) =>
    `${r.packVersionId}|${r.packRequirementId ?? '-'}|${r.category}`;
  const groups =
    openRows.length === 0
      ? []
      : await db
          .select({
            packVersionId: c.packVersionId,
            packRequirementId: c.packRequirementId,
            category: c.category,
            n: count(),
          })
          .from(c)
          .where(
            and(
              inArray(c.status, [...OPEN_STATUSES]),
              inArray(c.packVersionId, [...new Set(openRows.map((r) => r.packVersionId))]),
            ),
          )
          .groupBy(c.packVersionId, c.packRequirementId, c.category);
  const sizes = new Map(groups.map((g) => [sameKey(g), Number(g.n)]));
  const open = (await viewsOf(db, openRows)).map((view, index) => {
    const row = openRows[index];
    const size = row ? (sizes.get(sameKey(row)) ?? 1) : 1;
    return { ...view, alsoSuggestedBy: Math.max(0, size - 1) };
  });
  return ok({
    ready: true,
    open,
    decided: await viewsOf(db, decidedRows),
    openCount: Number(total[0]?.n ?? 0),
  });
}

const ALLOWED_FROM: Readonly<Record<CorrectionDecision, readonly CorrectionStatus[]>> = {
  IN_REVIEW: ['RECEIVED'],
  DISMISSED: ['RECEIVED', 'IN_REVIEW'],
  ACCEPTED_FOR_DRAFT: ['RECEIVED', 'IN_REVIEW'],
};

/**
 * Records an editor's decision on one suggestion. Accept for Draft records the decision only: the
 * change is then written as a draft version in Pack Studio and goes through its author and
 * reviewer steps. Nothing here touches a pack.
 */
export async function reviewChecklistCorrection(
  db: Db,
  staff: StaffScope<'PACK_MANAGE'>,
  input: {
    readonly correctionId: string;
    readonly decision: CorrectionDecision;
    readonly note?: string;
  },
): Promise<Result<{ readonly id: string; readonly status: CorrectionStatus }, ServiceError>> {
  const problem = staffProblem(staff);
  if (problem) return err(problem);
  if (!isUuid(input.correctionId)) return err(keyedError('not_found', 'umpe_correction_service.suggestion_not_found'));
  const allowedFrom = (ALLOWED_FROM as Readonly<Record<string, readonly CorrectionStatus[]>>)[
    input.decision
  ];
  if (!allowedFrom) return err(keyedError('invalid', 'umpe_collection_response_review.choose_a_decision'));
  const note = cleanDetail(input.note);
  if (note !== null && typeof note === 'object') {
    return err(keyedError('invalid', 'umpe_correction_service.keep_the_note_under_1_000'));
  }
  if (!(await correctionTablesPresent(db)))
    return err(keyedError('stale', 'umpe_correction_service.checklist_corrections_can_be_used_once'));
  return db.transaction(async (tx) => {
    const c = schema.umpeChecklistCorrections;
    const row = first(
      await tx
        .update(c)
        .set({
          status: input.decision,
          reviewerAccountId: staff.accountId,
          reviewedAt: new Date(),
          // An empty note keeps the one written at Mark in Review.
          reviewNote: note ?? sql`${c.reviewNote}`,
        })
        .where(and(eq(c.id, input.correctionId), inArray(c.status, [...allowedFrom])))
        .returning({ id: c.id }),
    );
    if (!row) {
      return err(keyedError('stale', 'umpe_correction_service.this_suggestion_was_already_decided_refresh'));
    }
    await appendAuditEvent(tx, {
      eventType: 'CHECKLIST_CORRECTION_REVIEWED',
      actorAccountId: staff.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'checklist_correction',
      resourceId: row.id,
      metadata: { decision: input.decision, withNote: note !== null },
    });
    return ok({ id: row.id, status: input.decision });
  });
}
