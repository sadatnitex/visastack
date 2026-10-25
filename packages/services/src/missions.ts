import { createHash } from 'node:crypto';
import type { FactStatus, MissionState } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { orgGrantPermits } from './agency';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { isDocumentVersionUsable } from './documents';
import { checkCaseCreationEntitlement } from './entitlement-enforcement';
import { activeOrVerifiedErasureStorageObjectIds } from './erasure';
import { type ServiceError, serviceError } from './errors';
import { type StalenessClassification, classifyStaleness, parseDocumentDate } from './expiry';
import { getLiveAcknowledgement, incrementMaterialRevision } from './material-revision';
import { cancelQueuedNotificationsForResource } from './notifications';
import { type PackRequirement, listRequirements } from './packs';
import { elapsedSeconds, recordProductEvent } from './product-events';
import {
  type EvaluationContext,
  type RuleConditionResult,
  evaluateCondition,
  isValidRuleCondition,
} from './rule-conditions';

/**
 * Mission Workspaces (Build Spec §4.3; PRD §4).
 *
 * A mission assembles an applicant's evidence against a PUBLISHED requirement
 * pack version. Readiness is pure completeness — which requirements are
 * satisfied — and NEVER an approval probability (Build Spec §4.3). The reviewer
 * workflow is a guarded state machine; only legal transitions are allowed.
 * Snapshots are immutable, checksummed point-in-time captures.
 */

export type Mission = typeof schema.missions.$inferSelect;
export type MissionSnapshot = typeof schema.missionSnapshots.$inferSelect;

// Legal reviewer-workflow transitions (Build Spec §4.3; extended by CAS-07,
// master directive Part 7 §6). Every legacy-only move (IN_PROGRESS through
// LOCKED) is kept byte-for-byte unchanged from before CAS-07 -- additive
// migration, never a rewrite -- with exactly one new bridge: LOCKED ->
// SUBMISSION_READY, the one the directive names explicitly ("Legacy
// locked: ... requires real acknowledgement for future submission-ready
// claim"). DRAFT gains INTAKE as an additional legal next state, since it
// is the one shared starting point between both vocabularies. SUBMITTED is
// deliberately absent from every list below -- see CANONICAL_CASE_STATES's
// own doc comment (packages/core/src/domain.ts) for why.
const TRANSITIONS: Readonly<Record<MissionState, readonly MissionState[]>> = {
  DRAFT: ['INTAKE', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['READY_FOR_REVIEW', 'CANCELLED'],
  READY_FOR_REVIEW: ['UNDER_REVIEW', 'IN_PROGRESS', 'CANCELLED'],
  UNDER_REVIEW: ['READY_TO_EXPORT', 'IN_PROGRESS', 'CANCELLED'],
  READY_TO_EXPORT: ['LOCKED', 'IN_PROGRESS', 'CANCELLED'],
  // SUBMISSION_READY is LEGAL here, but transitionMission additionally
  // requires a live acknowledgement before actually allowing it (below) --
  // "legal" and "currently permitted" are deliberately different questions.
  LOCKED: ['CLOSED', 'SUBMISSION_READY'],
  CLOSED: [],
  CANCELLED: [],

  // Canonical case states (CAS-07).
  INTAKE: ['IN_REVIEW', 'CANCELLED'],
  IN_REVIEW: ['AWAITING_APPLICANT', 'INTAKE', 'CANCELLED'],
  AWAITING_APPLICANT: ['SUBMISSION_READY', 'IN_REVIEW', 'CANCELLED'],
  // Same acknowledgement gate as LOCKED's own bridge above.
  SUBMISSION_READY: ['CLOSED', 'IN_REVIEW', 'CANCELLED'],
  // Not reachable via transitionMission today (see above); still a real,
  // necessary entry (every MissionState needs one) describing what CAN
  // happen once TRU-04 lands a mission here some other way.
  SUBMITTED: ['CLOSED'],
};

async function ownedMission(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<Mission, ServiceError>> {
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'case not found'));
  const applicant = await getApplicant(db, mission.applicantId);
  if (!applicant || applicant.ownerAccountId !== actorAccountId) {
    return err(serviceError('forbidden', 'not authorized for this case'));
  }
  return ok(mission);
}

/** List an applicant's missions (owner-scoped). */
export async function listMissions(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<Result<Mission[], ServiceError>> {
  const applicant = await getApplicant(db, applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== actorAccountId) {
    return err(serviceError('forbidden', 'not authorized for this applicant'));
  }
  const rows = await db
    .select()
    .from(schema.missions)
    .where(eq(schema.missions.applicantId, applicantId));
  return ok(rows);
}

/** Load one mission, owner-scoped. */
export async function getMissionForOwner(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<Mission, ServiceError>> {
  return ownedMission(db, actorAccountId, missionId);
}

/** Immutable snapshots for a mission, newest version first (owner-scoped). */
export async function listMissionSnapshots(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<MissionSnapshot[], ServiceError>> {
  const owned = await ownedMission(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  const rows = await db
    .select()
    .from(schema.missionSnapshots)
    .where(eq(schema.missionSnapshots.missionId, missionId));
  const sorted = [...rows].sort((a, b) => b.version - a.version);
  return ok(sorted);
}

/** Load one immutable snapshot by id, owner-scoped via its parent mission. */
export async function getMissionSnapshot(
  db: Db,
  actorAccountId: string,
  missionId: string,
  snapshotId: string,
): Promise<Result<MissionSnapshot, ServiceError>> {
  const owned = await ownedMission(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  const snapshot = first(
    await db
      .select()
      .from(schema.missionSnapshots)
      .where(
        and(
          eq(schema.missionSnapshots.id, snapshotId),
          eq(schema.missionSnapshots.missionId, missionId),
        ),
      )
      .limit(1),
  );
  if (!snapshot) return err(serviceError('not_found', 'snapshot not found'));
  return ok(snapshot);
}

/**
 * The states that mean "this case is ready" for OPS-04's intake-to-ready time:
 * the canonical submission-ready state, and the legacy reviewer workflow's
 * ready-to-export state, which is what it means there.
 */
const READY_STATES: readonly MissionState[] = ['SUBMISSION_READY', 'READY_TO_EXPORT'];

/** The legal next states from a given mission state (for UI affordances). */
export function legalTransitions(from: MissionState): readonly MissionState[] {
  return TRANSITIONS[from] ?? [];
}

export async function createMission(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly applicantId: string;
    readonly title: string;
    readonly destination?: string;
    readonly purpose?: string;
    /** IAM-04: an optional free-text label linking this mission to other missions as one family trip. Display/reference only, never an access mechanism (see `itineraryRef`'s own schema comment). */
    readonly itineraryRef?: string;
    /** CAS-01 case-creation fields (Commercial V1 Part 4 §8). All optional and purely descriptive: none of them gate any authorization decision anywhere else. */
    readonly jurisdiction?: string;
    readonly serviceCategory?: string;
    readonly travelStartDate?: Date;
    readonly travelEndDate?: Date;
    readonly targetDeadline?: Date;
    readonly ownerOrganizationId?: string;
    readonly manualMode?: boolean;
  },
): Promise<Result<Mission, ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized for this applicant'));
  }
  if (input.title.trim().length === 0) return err(serviceError('invalid', 'a title is required'));
  if (!(await hasConsent(db, applicant.ownerAccountId, 'CORE_PROCESSING'))) {
    return err(serviceError('consent_required', 'Core processing consent is required'));
  }

  return db.transaction(async (tx) => {
    // An individual traveller's own case has no organization to check a cap
    // against; the directive's cases-per-period/concurrent-open-cases
    // entitlements are org-scoped (see plans.ts's own doc comment), and
    // Traveller Free's seeded plan leaves both NULL (unlimited) besides.
    if (input.ownerOrganizationId) {
      const caseCheck = await checkCaseCreationEntitlement(tx, input.ownerOrganizationId);
      if (!caseCheck.ok) return err(caseCheck.error);
    }

    const mission = required(
      first(
        await tx
          .insert(schema.missions)
          .values({
            applicantId: input.applicantId,
            title: input.title.trim(),
            destination: input.destination ?? null,
            purpose: input.purpose ?? null,
            itineraryRef: input.itineraryRef?.trim() || null,
            jurisdiction: input.jurisdiction?.trim() || null,
            serviceCategory: input.serviceCategory?.trim() || null,
            travelStartDate: input.travelStartDate ?? null,
            travelEndDate: input.travelEndDate ?? null,
            targetDeadline: input.targetDeadline ?? null,
            ownerOrganizationId: input.ownerOrganizationId ?? null,
            manualMode: input.manualMode ?? false,
          })
          .returning(),
      ),
      'mission',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      missionId: mission.id,
      resourceType: 'mission',
      resourceId: mission.id,
    });
    await recordProductEvent(tx, {
      eventType: 'MISSION_CREATED',
      accountId: input.actorAccountId,
      organizationId: mission.ownerOrganizationId,
    });
    // OPS-04 activation: an account is activated by its first case, the unit
    // of value the product exists to produce. `onceFor` makes every later case
    // a no-op, and the metric is how long after sign-up that first case came.
    const account = first(
      await tx
        .select({ createdAt: schema.accounts.createdAt })
        .from(schema.accounts)
        .where(eq(schema.accounts.id, input.actorAccountId))
        .limit(1),
    );
    await recordProductEvent(tx, {
      eventType: 'ACCOUNT_ACTIVATED',
      accountId: input.actorAccountId,
      organizationId: mission.ownerOrganizationId,
      dimension: mission.ownerOrganizationId ? 'AGENCY' : 'TRAVELLER',
      ...(account ? { metricValue: elapsedSeconds(account.createdAt) } : {}),
      onceFor: input.actorAccountId,
    });
    return ok(mission);
  });
}

/**
 * Set or clear a mission's itinerary reference (mission owner only), for
 * when the family-trip link is only decided after the mission already
 * exists. An empty string clears it. Never touches any grant, note, or
 * other permission: linking is purely this one display field.
 */
export async function setMissionItineraryRef(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly missionId: string;
    readonly itineraryRef: string;
  },
): Promise<Result<Mission, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;
  const updated = required(
    first(
      await db
        .update(schema.missions)
        .set({ itineraryRef: input.itineraryRef.trim() || null, updatedAt: new Date() })
        .where(eq(schema.missions.id, input.missionId))
        .returning(),
    ),
    'mission',
  );
  return ok(updated);
}

/**
 * Update a mission's CAS-01 case-creation fields after the fact (mission
 * owner only) - most of these are rarely all known at creation time
 * (jurisdiction, service category, exact travel dates, a target deadline,
 * or which org is the case's primary owner). Every field is optional and
 * only touched when explicitly provided; omitting a field leaves it
 * unchanged, never clears it (unlike `setMissionItineraryRef`, this is a
 * partial update, not a set-or-clear-one-value call, since callers here
 * are expected to update one or two fields at a time from a settings form,
 * not resend the whole case every time). Purely descriptive: none of these
 * fields gate any authorization decision anywhere else in this codebase.
 */
export async function updateMissionCaseDetails(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly missionId: string;
    readonly jurisdiction?: string;
    readonly serviceCategory?: string;
    readonly travelStartDate?: Date | null;
    readonly travelEndDate?: Date | null;
    readonly targetDeadline?: Date | null;
    readonly ownerOrganizationId?: string | null;
    readonly manualMode?: boolean;
  },
): Promise<Result<Mission, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;
  // TRU-03 (Part 7 §4): jurisdiction/serviceCategory/dates/ownerOrganization/
  // manualMode are all case-identity/scope data the directive's own material
  // list means to cover ("itinerary; destination; purpose" and siblings) --
  // presence-triggered (was a field provided at all), matching the same
  // granularity `updateTask`'s own "no-op when nothing is supplied" already
  // uses elsewhere, not a before/after value diff.
  const anyFieldProvided =
    input.jurisdiction !== undefined ||
    input.serviceCategory !== undefined ||
    input.travelStartDate !== undefined ||
    input.travelEndDate !== undefined ||
    input.targetDeadline !== undefined ||
    input.ownerOrganizationId !== undefined ||
    input.manualMode !== undefined;

  return db.transaction(async (tx) => {
    if (anyFieldProvided) await incrementMaterialRevision(tx, input.missionId);
    const updated = required(
      first(
        await tx
          .update(schema.missions)
          .set({
            ...(input.jurisdiction !== undefined
              ? { jurisdiction: input.jurisdiction.trim() || null }
              : {}),
            ...(input.serviceCategory !== undefined
              ? { serviceCategory: input.serviceCategory.trim() || null }
              : {}),
            ...(input.travelStartDate !== undefined
              ? { travelStartDate: input.travelStartDate }
              : {}),
            ...(input.travelEndDate !== undefined ? { travelEndDate: input.travelEndDate } : {}),
            ...(input.targetDeadline !== undefined ? { targetDeadline: input.targetDeadline } : {}),
            ...(input.ownerOrganizationId !== undefined
              ? { ownerOrganizationId: input.ownerOrganizationId }
              : {}),
            ...(input.manualMode !== undefined ? { manualMode: input.manualMode } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.missions.id, input.missionId))
          .returning(),
      ),
      'mission',
    );
    return ok(updated);
  });
}

/**
 * Every mission of the caller's OWN applicants sharing the given itinerary
 * reference (exact match, trimmed): the "linked family cases" view.
 * Deliberately scoped to the actor's own applicants only, never a
 * cross-account lookup: the PRD is explicit that a shared itinerary
 * reference is a display convenience, and "household permissions never
 * replace per-subject authorisation." A different account using the same
 * reference string is invisible here and always will be; nothing before
 * this ever exposes another account's missions by a matched label.
 */
export async function listMissionsByItineraryRef(
  db: Db,
  input: { readonly actorAccountId: string; readonly itineraryRef: string },
): Promise<Mission[]> {
  const ref = input.itineraryRef.trim();
  if (ref.length === 0) return [];
  const rows = await db
    .select({ mission: schema.missions })
    .from(schema.missions)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.missions.applicantId))
    .where(
      and(
        eq(schema.applicants.ownerAccountId, input.actorAccountId),
        eq(schema.missions.itineraryRef, ref),
      ),
    );
  return rows.map((r) => r.mission);
}

/** Attach a PUBLISHED pack version to a mission. */
export async function attachPackVersion(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly missionId: string;
    readonly packVersionId: string;
  },
): Promise<Result<Mission, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;
  const packVersion = first(
    await db
      .select()
      .from(schema.packVersions)
      .where(eq(schema.packVersions.id, input.packVersionId))
      .limit(1),
  );
  if (!packVersion) return err(serviceError('not_found', 'pack version not found'));
  if (packVersion.status !== 'PUBLISHED') {
    return err(serviceError('invalid', 'only a PUBLISHED pack version can be attached'));
  }

  return db.transaction(async (tx) => {
    await incrementMaterialRevision(tx, input.missionId);
    const mission = required(
      first(
        await tx
          .update(schema.missions)
          .set({ packVersionId: input.packVersionId, updatedAt: new Date() })
          .where(eq(schema.missions.id, input.missionId))
          .returning(),
      ),
      'mission',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_PACK_ATTACHED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: mission.id,
      resourceType: 'mission',
      resourceId: mission.id,
      metadata: { packVersionId: input.packVersionId },
    });
    return ok(mission);
  });
}

export interface MissingRequirement {
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly key: string;
  readonly optional: boolean;
  /** Distinguishes "never provided" from "provided but not currently trustworthy" from "provided but too old for this route (NTF-01)". */
  readonly reason: 'not_provided' | 'unresolved_conflict' | 'stale_evidence';
}

/**
 * The seven per-requirement outcomes RUL-04 names (master directive Part 6
 * §5). A requirement with no `condition` (every pre-existing pack, since
 * none has ever set one) can only ever resolve to SATISFIED, CONFLICTING,
 * EXPIRING_STALE, ATTENTION, or CRITICAL_GAP, the exact same five outcomes
 * the pre-RUL-04 satisfied/reason logic already distinguished, just named
 * richly instead of collapsed into a boolean. NOT_APPLICABLE and UNVERIFIED
 * are reachable only once a requirement actually carries a condition.
 */
export type RequirementResultState =
  | 'SATISFIED'
  | 'ATTENTION'
  | 'CRITICAL_GAP'
  | 'UNVERIFIED'
  | 'CONFLICTING'
  | 'EXPIRING_STALE'
  | 'NOT_APPLICABLE';

/** The four case-level outcomes RUL-04 names (master directive Part 6 §5), never an average of the per-requirement states. */
export type OverallReadinessState =
  | 'MANUAL_ONLY'
  | 'NEEDS_ACTION'
  | 'NEEDS_REVIEW'
  | 'READY_FOR_APPLICANT_REVIEW';

export interface RequirementResultSummary {
  readonly packRequirementId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly key: string;
  readonly optional: boolean;
  readonly state: RequirementResultState;
}

export interface Readiness {
  readonly total: number;
  readonly requiredCount: number;
  readonly satisfiedRequired: number;
  readonly missing: readonly MissingRequirement[];
  /** Completeness only — never an approval likelihood. */
  readonly ready: boolean;
  /** RUL-04: every requirement's richer result state, including NOT_APPLICABLE ones (never excluded, since a case-not-applicable verdict is itself something a reviewer needs to see, not silently dropped). */
  readonly requirementResults: readonly RequirementResultSummary[];
  readonly overallState: OverallReadinessState;
}

export interface MissionUsingField {
  readonly missionId: string;
  readonly title: string;
  readonly state: MissionState;
}

/**
 * Which of an applicant's missions currently rely on a given field (master
 * directive §7 "PR 8" — every fact must support "mission use"). "Rely on"
 * means the mission's attached pack version has a FIELD requirement for this
 * key — readiness always evaluates the CURRENT fact value, so this is a live
 * relationship, not tied to a specific historical fact version.
 */
export async function listMissionsUsingField(
  db: Db,
  actorAccountId: string,
  applicantId: string,
  fieldKey: string,
): Promise<Result<MissionUsingField[], ServiceError>> {
  const applicant = await getApplicant(db, applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== actorAccountId) {
    return err(serviceError('forbidden', 'not authorized for this applicant'));
  }

  const rows = await db
    .select({ id: schema.missions.id, title: schema.missions.title, state: schema.missions.state })
    .from(schema.missions)
    .innerJoin(
      schema.packRequirements,
      eq(schema.packRequirements.packVersionId, schema.missions.packVersionId),
    )
    .where(
      and(
        eq(schema.missions.applicantId, applicantId),
        eq(schema.packRequirements.kind, 'FIELD'),
        eq(schema.packRequirements.fieldKey, fieldKey),
      ),
    );
  // A mission can have more than one requirement for the same field (e.g.
  // cited under two different sections) — de-duplicate by mission.
  const seen = new Map<string, MissionUsingField>();
  for (const row of rows) {
    seen.set(row.id, { missionId: row.id, title: row.title, state: row.state });
  }
  return ok([...seen.values()]);
}

export interface MissionOnPackVersion {
  readonly missionId: string;
  readonly title: string;
  readonly state: MissionState;
  readonly applicantId: string;
  readonly ownerOrganizationId: string | null;
}

/**
 * Every mission currently attached to a specific pack version, across every
 * applicant and organization (RUL-05 "active-case impact list": an admin
 * deciding whether to withdraw or supersede a version needs to see who
 * currently relies on it before acting). Admin-scoped, unlike
 * `listMissionsUsingField` above (owner-scoped) or `attachPackVersion`
 * (which writes this same column): the caller is expected to gate on
 * `hasPlatformPermission(..., 'PACK_MANAGE')` first, the same discipline
 * every function in `packs.ts` already relies on its own Server Action
 * caller for, rather than checking authorization itself.
 */
export async function listMissionsByPackVersion(
  db: Db,
  packVersionId: string,
): Promise<MissionOnPackVersion[]> {
  return db
    .select({
      missionId: schema.missions.id,
      title: schema.missions.title,
      state: schema.missions.state,
      applicantId: schema.missions.applicantId,
      ownerOrganizationId: schema.missions.ownerOrganizationId,
    })
    .from(schema.missions)
    .where(eq(schema.missions.packVersionId, packVersionId));
}

/**
 * Fact statuses that must NOT be treated as confirmed for readiness purposes
 * (master directive §7 "PR 10": readiness must ignore conflicted facts AND
 * "missing confirmations" — an extracted-but-never-confirmed or stale value
 * is present but not currently trustworthy, so it must not count as
 * satisfying a requirement, the same "consistency" principle Build Spec
 * §4.5 already applied to CONFLICTED alone).
 */
const UNCONFIRMED_FACT_STATUSES: ReadonlySet<FactStatus> = new Set([
  'CONFLICTED',
  'EXTRACTED_PENDING',
  'STALE',
  'SUPERSEDED',
]);

/**
 * Whether a fact version's status is confirmed enough to satisfy a
 * requirement — the single source of truth for this check (readiness,
 * snapshots, and the evidence-selection UI all defer to it, rather than
 * each re-deriving the exclusion list and risking drift).
 */
export function isFactStatusEligible(status: FactStatus): boolean {
  return !UNCONFIRMED_FACT_STATUSES.has(status);
}

export interface FactInstance {
  readonly factId: string;
  readonly factVersionId: string | null;
  readonly repeatingRecordKey: string | null;
  readonly value: string | null;
  readonly status: FactStatus;
  readonly evidenceLinkIds: readonly string[];
}

/**
 * Load every current fact instance, grouped by field key. A repeating field
 * (facts.repeatingRecordKey) can have more than one instance sharing the
 * same field key — this must return every instance distinctly. A plain
 * Map<key, status> or Record<key, value> silently collides them, which is
 * exactly the bug master directive §7 "PR 10" calls out: "Repeating facts
 * must never overwrite each other in snapshots" (and the same collision
 * would also corrupt readiness for any repeating FIELD requirement).
 */
async function loadFactInstancesByKey(
  db: Db,
  applicantId: string,
): Promise<Map<string, FactInstance[]>> {
  const rows = await db
    .select({
      key: schema.fieldDefinitions.key,
      factId: schema.facts.id,
      factVersionId: schema.facts.currentVersionId,
      repeatingRecordKey: schema.facts.repeatingRecordKey,
      value: schema.factVersions.value,
      status: schema.factVersions.status,
    })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
    )
    .innerJoin(schema.factVersions, eq(schema.factVersions.id, schema.facts.currentVersionId))
    .where(eq(schema.facts.applicantId, applicantId));

  const factVersionIds = rows.map((r) => r.factVersionId).filter((id): id is string => id !== null);
  const links =
    factVersionIds.length > 0
      ? await db
          .select({
            id: schema.evidenceLinks.id,
            factVersionId: schema.evidenceLinks.factVersionId,
          })
          .from(schema.evidenceLinks)
          .where(inArray(schema.evidenceLinks.factVersionId, factVersionIds))
      : [];
  const linkIdsByFactVersion = new Map<string, string[]>();
  for (const link of links) {
    const list = linkIdsByFactVersion.get(link.factVersionId) ?? [];
    list.push(link.id);
    linkIdsByFactVersion.set(link.factVersionId, list);
  }

  const map = new Map<string, FactInstance[]>();
  for (const row of rows) {
    const list = map.get(row.key) ?? [];
    list.push({
      factId: row.factId,
      factVersionId: row.factVersionId,
      repeatingRecordKey: row.repeatingRecordKey,
      value: row.value,
      status: row.status,
      evidenceLinkIds: row.factVersionId ? (linkIdsByFactVersion.get(row.factVersionId) ?? []) : [],
    });
    map.set(row.key, list);
  }
  return map;
}

export interface DocumentInstance {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly docType: string | null;
  readonly displayName: string;
  readonly sha256: string | null;
  readonly safetyStatus: string;
  readonly processingStatus: string;
  /** Master directive §7 "PR 10": readiness must ignore unsafe, expired, or still-processing/rejected documents. */
  readonly eligible: boolean;
  /** Raw `documents.documentDate` (`YYYY-MM-DD` or `null`) - parse with `expiry.ts`'s `parseDocumentDate`. Requirement-agnostic, like every other field here; per-requirement staleness is computed separately in `buildRequirementMapping`/`getEvidenceCandidates`, since `maxAgeDays` lives on the requirement, not the document. */
  readonly documentDate: string | null;
}

/** A document candidate plus the requirement-specific staleness verdict (NTF-01) - never folded into `DocumentInstance.eligible`, which stays intrinsic-only ("track separately"). */
export interface DocumentCandidateWithStaleness extends DocumentInstance {
  readonly staleness: StalenessClassification;
}

/**
 * Groups an unclassified document (`docType: null`) in `loadDocumentInstancesByType`'s
 * returned map (finding #30, post-programme defect register). A `symbol`,
 * not a string: `docType` is completely free text on BOTH write sites —
 * `packs.ts`'s `addRequirement` (a DOCUMENT requirement only requires
 * *non-empty*, not membership in `classifyDocumentText`'s output
 * vocabulary) and `documents.ts`'s `registerDocument` (owner-supplied at
 * registration, no validation at all). A string sentinel like
 * `'__unclassified__'` is therefore reachable as a genuine `docType` on
 * either side — an admin could author a requirement with exactly that
 * `docType`, or an applicant could register a document with it — and
 * `buildRequirementMapping`'s lookup (`documentsByType.get(req.docType)`)
 * would then match every genuinely-unclassified document against it,
 * wrongly satisfying the requirement (Codex review, PR-D1, round 1). A
 * `symbol` closes this structurally rather than by convention: `req.docType`
 * is always a plain `string`, and a `string` key can never `===` a
 * `symbol` key in a `Map`, so this group is unreachable from any real
 * requirement's lookup no matter what free-text value `docType` takes on
 * either write site, now or in the future — no validation needs to be
 * added to (or kept in sync across) `packs.ts` and `documents.ts` at all.
 */
const UNCLASSIFIED_DOCUMENT_GROUP = Symbol('unclassified-document-group');

/**
 * A document group key is either a real `docType` string or the
 * unclassified sentinel above — never confusable with each other, since a
 * `string` and a `symbol` can never be `===`.
 */
type DocumentGroupKey = string | typeof UNCLASSIFIED_DOCUMENT_GROUP;

/**
 * Load the latest version of every document, grouped by docType. Only the
 * latest version of each document is considered — an older, superseded
 * version can never satisfy a requirement. `eligible` folds together every
 * document-side readiness exclusion the directive requires: unsafe
 * (safetyStatus !== CLEAN), still-processing or rejected, erased or being
 * erased (`isDocumentVersionUsable` — the same one canonical definition
 * `documents.ts` uses for preview/download, never a second one that could
 * drift; Codex review, PR-B2, round 4 — this eligibility check used to
 * carry its own partial copy of that logic with no erasure awareness at
 * all, so a version whose bytes were already gone or actively being erased
 * could still satisfy a requirement and be captured into a snapshot), and
 * expired (documents.expiresAt, if ever populated by a future feature — no
 * current path sets it, but readiness honors it defensively regardless).
 *
 * An unclassified document (`docType: null` — awaiting or never receiving a
 * confident `classifyDocumentText` result) is grouped under
 * `UNCLASSIFIED_DOCUMENT_GROUP` rather than skipped (finding #30): a document
 * with a current, otherwise-eligible version used to be silently dropped
 * from this map entirely — and therefore from `content.documents` in every
 * future snapshot, permanently absent from the immutable evidentiary record
 * even though its bytes and metadata were never actually lost.
 */
async function loadDocumentInstancesByType(
  db: Db,
  applicantId: string,
): Promise<Map<DocumentGroupKey, DocumentInstance[]>> {
  const rows = await db
    .select({
      documentId: schema.documents.id,
      docType: schema.documents.docType,
      originalName: schema.documents.originalName,
      approvedName: schema.documents.approvedName,
      expiresAt: schema.documents.expiresAt,
      documentDate: schema.documents.documentDate,
      documentVersionId: schema.documentVersions.id,
      versionNumber: schema.documentVersions.versionNumber,
      sha256: schema.documentVersions.sha256,
      safetyStatus: schema.documentVersions.safetyStatus,
      processingStatus: schema.documentVersions.processingStatus,
      storageObjectId: schema.documentVersions.storageObjectId,
    })
    .from(schema.documents)
    .innerJoin(schema.documentVersions, eq(schema.documentVersions.documentId, schema.documents.id))
    .where(eq(schema.documents.applicantId, applicantId));

  const latestByDocument = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const existing = latestByDocument.get(row.documentId);
    if (!existing || row.versionNumber > existing.versionNumber) {
      latestByDocument.set(row.documentId, row);
    }
  }

  // One bulk query for every latest version's erasure state, not one per
  // document (Codex review, PR-B2, round 4) — avoids an N+1 while still
  // sharing the exact same predicate `accessDocument` uses for a single
  // version.
  const erasedStorageObjectIds = await activeOrVerifiedErasureStorageObjectIds(
    db,
    [...latestByDocument.values()].map((row) => row.storageObjectId),
  );

  const now = Date.now();
  const map = new Map<DocumentGroupKey, DocumentInstance[]>();
  for (const row of latestByDocument.values()) {
    const groupKey = row.docType ?? UNCLASSIFIED_DOCUMENT_GROUP;
    const eligible =
      isDocumentVersionUsable({
        safetyStatus: row.safetyStatus,
        processingStatus: row.processingStatus,
        erased: erasedStorageObjectIds.has(row.storageObjectId),
      }) &&
      (row.expiresAt === null || row.expiresAt.getTime() > now);
    const list = map.get(groupKey) ?? [];
    list.push({
      documentId: row.documentId,
      documentVersionId: row.documentVersionId,
      docType: row.docType,
      displayName: row.approvedName ?? row.originalName,
      sha256: row.sha256,
      safetyStatus: row.safetyStatus,
      processingStatus: row.processingStatus,
      eligible,
      documentDate: row.documentDate,
    });
    map.set(groupKey, list);
  }
  return map;
}

/**
 * Explicit selections for every requirement on a mission, keyed by
 * packRequirementId (master directive §7 "PR 10": readiness must ignore
 * unselected evidence). Once at least one selection exists for a
 * requirement, `buildRequirementMapping` restricts that requirement to ONLY
 * the selected instance(s) — other eligible-but-unselected candidates no
 * longer count. A requirement with NO selection yet falls back to "any
 * eligible instance" (this pass's pre-existing, tested behavior) rather
 * than blocking readiness outright — selection narrows an ambiguous choice
 * among candidates, it isn't a prerequisite for the common single-candidate
 * case. See the boundary-map doc for the reasoning.
 */
interface SelectionSets {
  readonly factIdsByRequirement: ReadonlyMap<string, ReadonlySet<string>>;
  readonly documentIdsByRequirement: ReadonlyMap<string, ReadonlySet<string>>;
}

async function loadSelectionsByRequirement(db: Db, missionId: string): Promise<SelectionSets> {
  const rows = await db
    .select({
      packRequirementId: schema.selectedEvidence.packRequirementId,
      factId: schema.selectedEvidence.factId,
      documentId: schema.selectedEvidence.documentId,
    })
    .from(schema.selectedEvidence)
    .where(eq(schema.selectedEvidence.missionId, missionId));

  const factIdsByRequirement = new Map<string, Set<string>>();
  const documentIdsByRequirement = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.factId) {
      const set = factIdsByRequirement.get(row.packRequirementId) ?? new Set<string>();
      set.add(row.factId);
      factIdsByRequirement.set(row.packRequirementId, set);
    }
    if (row.documentId) {
      const set = documentIdsByRequirement.get(row.packRequirementId) ?? new Set<string>();
      set.add(row.documentId);
      documentIdsByRequirement.set(row.packRequirementId, set);
    }
  }
  return { factIdsByRequirement, documentIdsByRequirement };
}

/** Compute completeness of a mission against its attached pack version. */
export async function computeReadiness(
  db: Db,
  missionId: string,
  now: Date = new Date(),
): Promise<Result<Readiness, ServiceError>> {
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'case not found'));
  if (!mission.packVersionId) {
    return err(serviceError('invalid', 'case has no attached pack version'));
  }

  const requirements = await listRequirements(db, mission.packVersionId);
  const factsByKey = await loadFactInstancesByKey(db, mission.applicantId);
  const documentsByType = await loadDocumentInstancesByType(db, mission.applicantId);
  const selections = await loadSelectionsByRequirement(db, missionId);
  const context = buildFactEvaluationContext(factsByKey, now);
  const mapping = buildRequirementMapping(
    requirements,
    factsByKey,
    documentsByType,
    selections,
    now,
    context,
  );

  const missing: MissingRequirement[] = [];
  const requirementResults: RequirementResultSummary[] = [];
  let requiredCount = 0;
  let satisfiedRequired = 0;
  for (const entry of mapping) {
    requirementResults.push({
      packRequirementId: entry.packRequirementId,
      kind: entry.kind,
      key: entry.key,
      optional: entry.optional,
      state: entry.resultState,
    });
    // A NOT_APPLICABLE requirement never counts toward "what must still be
    // done": it is not required, not missing, not satisfied; it simply
    // does not apply to this case (RUL-04). `total` below stays the full
    // pack-defined count regardless, so a UI can still say "N total, M not
    // applicable to your case."
    if (entry.resultState === 'NOT_APPLICABLE') continue;
    if (!entry.optional) {
      requiredCount++;
      if (entry.satisfied) satisfiedRequired++;
    }
    if (!entry.satisfied) {
      const anyConflicted =
        entry.kind === 'FIELD' && (entry.facts ?? []).some((f) => f.status === 'CONFLICTED');
      const anyStale =
        entry.kind === 'DOCUMENT' &&
        (entry.documents ?? []).some((d) => d.eligible && d.staleness.status === 'stale');
      missing.push({
        kind: entry.kind,
        key: entry.key,
        optional: entry.optional,
        reason: anyConflicted
          ? 'unresolved_conflict'
          : anyStale
            ? 'stale_evidence'
            : 'not_provided',
      });
    }
  }

  const ready = requiredCount > 0 && satisfiedRequired === requiredCount;
  return ok({
    total: mapping.length,
    requiredCount,
    satisfiedRequired,
    missing,
    ready,
    requirementResults,
    overallState: deriveOverallReadinessState({
      manualMode: mission.manualMode,
      requirementResults,
      ready,
    }),
  });
}

export interface EvidenceCandidateEntry {
  readonly packRequirementId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly key: string;
  readonly citation: string;
  readonly optional: boolean;
  readonly factCandidates: readonly FactInstance[];
  readonly documentCandidates: readonly DocumentCandidateWithStaleness[];
  readonly selectedFactIds: readonly string[];
  readonly selectedDocumentIds: readonly string[];
}

/**
 * Every candidate fact/document instance for each requirement — unlike
 * `buildRequirementMapping` (used for readiness/snapshots, which narrows to
 * only the selection once one exists), this always lists every candidate so
 * the evidence-selection UI can show what's currently chosen alongside what
 * else is available to switch to.
 */
export async function getEvidenceCandidates(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<EvidenceCandidateEntry[], ServiceError>> {
  const owned = await ownedMission(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  const mission = owned.value;
  if (!mission.packVersionId) return ok([]);

  const requirements = await listRequirements(db, mission.packVersionId);
  const factsByKey = await loadFactInstancesByKey(db, mission.applicantId);
  const documentsByType = await loadDocumentInstancesByType(db, mission.applicantId);
  const selections = await loadSelectionsByRequirement(db, missionId);
  const now = new Date();

  return ok(
    requirements.map((req) => ({
      packRequirementId: req.id,
      kind: req.kind,
      key: req.kind === 'FIELD' ? (req.fieldKey ?? '') : (req.docType ?? ''),
      citation: req.citation,
      optional: req.optional,
      factCandidates: factsByKey.get(req.fieldKey ?? '') ?? [],
      documentCandidates: (documentsByType.get(req.docType ?? '') ?? []).map((d) => ({
        ...d,
        staleness: classifyStaleness(parseDocumentDate(d.documentDate), req.maxAgeDays, now),
      })),
      selectedFactIds: [...(selections.factIdsByRequirement.get(req.id) ?? [])],
      selectedDocumentIds: [...(selections.documentIdsByRequirement.get(req.id) ?? [])],
    })),
  );
}

/** Move a mission through the reviewer workflow; only legal transitions. */
export async function transitionMission(
  db: Db,
  input: { readonly actorAccountId: string; readonly missionId: string; readonly to: MissionState },
): Promise<Result<Mission, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;
  const from = owned.value.state;
  if (!(TRANSITIONS[from] ?? []).includes(input.to)) {
    return err(serviceError('invalid', `illegal transition ${from} → ${input.to}`));
  }
  // CAS-07 (Part 7 §6): "Legacy locked: ... requires real acknowledgement
  // for future submission-ready claim" -- applied uniformly to every path
  // reaching SUBMISSION_READY, not just the legacy-LOCKED one, since
  // "submission-ready" is meant to mean "acknowledged," closing the exact
  // gap TRU-02 exists to close. getLiveAcknowledgement is by construction
  // always for a still-current case state (TRU-03 auto-invalidates it the
  // moment anything material changes), so "a live one exists" is already
  // the complete check.
  if (input.to === 'SUBMISSION_READY') {
    const live = await getLiveAcknowledgement(db, input.missionId);
    if (!live) {
      return err(
        serviceError(
          'invalid',
          'this case needs a live applicant acknowledgement before it can become submission-ready',
        ),
      );
    }
  }

  const isTerminal = input.to === 'CLOSED' || input.to === 'CANCELLED';
  return db.transaction(async (tx) => {
    const mission = required(
      first(
        await tx
          .update(schema.missions)
          .set({
            state: input.to,
            updatedAt: new Date(),
            // PRV-02 (Part 7 §11): set once, on first arrival at either
            // terminal state. `TRANSITIONS[CLOSED] = TRANSITIONS[CANCELLED]
            // = []` already makes a second arrival unreachable, but the
            // explicit `isTerminal` guard documents the "set once" invariant
            // here rather than leaning solely on that being true elsewhere.
            ...(isTerminal ? { closedAt: new Date() } : {}),
          })
          .where(eq(schema.missions.id, input.missionId))
          .returning(),
      ),
      'mission',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_STATE_CHANGE',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: mission.id,
      resourceType: 'mission',
      resourceId: mission.id,
      metadata: { from, to: input.to },
    });
    await recordProductEvent(tx, {
      eventType: 'MISSION_STAGE_CHANGED',
      accountId: input.actorAccountId,
      organizationId: mission.ownerOrganizationId,
      dimension: input.to,
    });
    // OPS-04 intake-to-ready: the first time a case reaches a ready state, how
    // long after it was created. `onceFor` keeps a case that bounces out of and
    // back into ready from counting twice.
    if (READY_STATES.includes(input.to)) {
      await recordProductEvent(tx, {
        eventType: 'MISSION_READY_REACHED',
        accountId: input.actorAccountId,
        organizationId: mission.ownerOrganizationId,
        metricValue: elapsedSeconds(mission.createdAt),
        onceFor: mission.id,
      });
    }
    return ok(mission);
  });
}

/** Deterministic JSON string with sorted keys (for a stable checksum). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export interface RequirementMappingEntry {
  readonly packRequirementId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly key: string;
  readonly citation: string;
  readonly optional: boolean;
  readonly satisfied: boolean;
  /** RUL-04's richer outcome for this one requirement, per `resolveRequirementResultState`'s cascade. */
  readonly resultState: RequirementResultState;
  readonly facts?: ReadonlyArray<{
    readonly factId: string;
    readonly factVersionId: string | null;
    readonly repeatingRecordKey: string | null;
    readonly value: string | null;
    readonly status: FactStatus;
    readonly eligible: boolean;
    readonly evidenceLinkIds: readonly string[];
  }>;
  readonly documents?: ReadonlyArray<{
    readonly documentId: string;
    readonly documentVersionId: string;
    readonly docType: string | null;
    readonly displayName: string;
    readonly sha256: string | null;
    readonly eligible: boolean;
    /** NTF-01: this requirement's `maxAgeDays` rule applied to this document's own date, kept separate from `eligible` (intrinsic-only). */
    readonly staleness: StalenessClassification;
  }>;
}

/**
 * One `EvaluationContext` built once per readiness computation (RUL-03/04),
 * shared by every requirement's `condition`. A condition's `field` always
 * references an applicant fact by key, FIELD and DOCUMENT requirements
 * alike, since a condition describes when the requirement applies, never a
 * property of the requirement's own evidence. For a repeating field, the
 * first ELIGIBLE instance's value stands in for "the field's value", a
 * pragmatic, documented choice, since a condition referencing a genuinely
 * repeating fact is an edge case the directive doesn't specify further. A
 * field with no eligible instance (never provided, or every instance
 * conflicted/stale/unconfirmed) resolves to `undefined`, which
 * `evaluateCondition` already treats as `'unknown'`, never `'false'`.
 */
function buildFactEvaluationContext(
  factsByKey: ReadonlyMap<string, readonly FactInstance[]>,
  now: Date,
): EvaluationContext {
  return {
    now,
    getValue(field) {
      const eligible = (factsByKey.get(field) ?? []).find((i) => isFactStatusEligible(i.status));
      return eligible?.value ?? undefined;
    },
  };
}

/**
 * The RUL-04 cascade deciding one requirement's richer result state, given
 * what the pre-existing satisfied/reason logic already establishes plus the
 * new condition tri-state. Order matters and is deliberate:
 *
 * 1. `condition` evaluates `'false'` → NOT_APPLICABLE, unconditionally:
 *    a requirement that structurally does not apply to this case must never
 *    read as blocking or needing evidence, whatever evidence happens to
 *    exist.
 * 2. A genuine conflict/staleness among this requirement's OWN evidence
 *    outranks an otherwise-satisfied verdict. A repeating field can have
 *    one clean instance and one CONFLICTED instance simultaneously
 *    (`satisfied` only requires ONE eligible instance), and silently
 *    reporting SATISFIED while hiding that would bury exactly the kind of
 *    conflict RUL-03/04 exists to surface, not paper over.
 * 3. `satisfied` (the existing, unchanged existence check) → SATISFIED.
 *    Evidence that is genuinely present and eligible is never wrong to
 *    report as satisfied, regardless of whether this requirement's OWN
 *    condition happens to also be unknown (that uncertainty belongs to
 *    whichever OTHER requirement tracks the condition's referenced field,
 *    if any; this module never invents a dependency it can't observe).
 * 4. `condition` evaluates `'unknown'` (and evidence is NOT satisfied) →
 *    UNVERIFIED. We cannot yet tell whether this requirement even applies,
 *    so demanding evidence for it now (CRITICAL_GAP) would overstate the
 *    actual next action; "answer the condition's field first" is.
 * 5. Otherwise: ATTENTION for an optional gap, CRITICAL_GAP for a required
 *    one, the pre-existing required/optional split, now named.
 */
function resolveRequirementResultState(input: {
  readonly satisfied: boolean;
  readonly optional: boolean;
  readonly conditionResult: RuleConditionResult | null;
  readonly hasConflict: boolean;
  readonly hasStale: boolean;
}): RequirementResultState {
  if (input.conditionResult === 'false') return 'NOT_APPLICABLE';
  if (input.hasConflict) return 'CONFLICTING';
  if (input.hasStale) return 'EXPIRING_STALE';
  if (input.satisfied) return 'SATISFIED';
  if (input.conditionResult === 'unknown') return 'UNVERIFIED';
  return input.optional ? 'ATTENTION' : 'CRITICAL_GAP';
}

/**
 * The RUL-04 case-level cascade: "do not average scores; one blocking
 * requirement remains visible" (master directive Part 6 §5). A manual-mode
 * mission (CAS-01: an unsupported/manual route) is MANUAL_ONLY regardless of
 * what the requirement states below would otherwise say. It deliberately
 * receives no automated assessment at all, per RUL-04's "still usable,
 * visibly not officially assessed." Otherwise: any REQUIRED requirement in a
 * hard-gap state (CRITICAL_GAP/CONFLICTING/EXPIRING_STALE) blocks outright
 * (NEEDS_ACTION); short of that, any required UNVERIFIED requirement still
 * needs a human answer before the case can be called complete (NEEDS_REVIEW,
 * distinct from a hard block); only once neither applies does `ready` (the
 * pre-existing, unchanged completeness check) decide
 * READY_FOR_APPLICANT_REVIEW. A NOT_APPLICABLE requirement can never match
 * any of these state checks (they are mutually exclusive), so it needs no
 * separate exclusion here.
 */
function deriveOverallReadinessState(input: {
  readonly manualMode: boolean;
  readonly requirementResults: readonly RequirementResultSummary[];
  readonly ready: boolean;
}): OverallReadinessState {
  if (input.manualMode) return 'MANUAL_ONLY';
  const required = input.requirementResults.filter((r) => !r.optional);
  if (
    required.some(
      (r) =>
        r.state === 'CRITICAL_GAP' || r.state === 'CONFLICTING' || r.state === 'EXPIRING_STALE',
    )
  ) {
    return 'NEEDS_ACTION';
  }
  if (required.some((r) => r.state === 'UNVERIFIED')) return 'NEEDS_REVIEW';
  if (input.ready) return 'READY_FOR_APPLICANT_REVIEW';
  // Edge case: e.g. requiredCount === 0 (no required requirements at all).
  // `ready` is deliberately false for that today (unchanged), and there is
  // no more honest bucket among the four named states than "not yet
  // reviewable," so this conservative fallback never claims a false green.
  return 'NEEDS_ACTION';
}

/** This requirement's condition result, or `null` for the (today, universal) case of no condition at all: never evaluated, never NOT_APPLICABLE/UNVERIFIED. An unparseable stored value (should never happen; `addRequirement` validates before storing) fails open the same way, rather than throwing. */
function evaluateRequirementCondition(
  req: PackRequirement,
  context: EvaluationContext,
): RuleConditionResult | null {
  if (req.condition == null || !isValidRuleCondition(req.condition)) return null;
  return evaluateCondition(req.condition, context);
}

/**
 * Resolve each of a pack version's requirements to the EXACT fact/document
 * instance(s) that satisfy it (Build Spec §4.5's "requirement mapping";
 * master directive §7 "PR 10": "exact selected evidence, exact FactVersion
 * references, exact DocumentVersion references"). A repeating field can
 * resolve to more than one instance — a requirement is satisfied if AT LEAST
 * ONE instance is eligible (not conflicted/unconfirmed/stale); every
 * instance is still listed, not just the satisfying one, so a reviewer can
 * see the full picture. Takes already-loaded data rather than re-fetching
 * per requirement.
 *
 * A DOCUMENT instance additionally satisfies its requirement only when it is
 * NOT confirmed `stale` (NTF-01) - a route-specific freshness rule, distinct
 * from `eligible`'s intrinsic-only expiry check. `unknown` staleness (no
 * rule, or a rule but no recorded document date) does not block
 * satisfaction: "unknown expiry remains unknown" reads as a display
 * obligation, not a readiness gate, and retroactively failing every
 * already-uploaded document the moment an admin adds a freshness rule (with
 * no bulk way to backfill dates) would be a harsh, silent regression. Only a
 * CONFIRMED-stale document - a real, known date past the window - blocks
 * satisfaction, the same "fail open on missing data, fail closed on a
 * confirmed problem" posture `computeReadiness` already applies to a
 * CONFLICTED fact vs. one simply not yet provided.
 *
 * `context` (RUL-03/04) resolves each requirement's optional `condition`
 * against the same applicant facts, feeding `resolveRequirementResultState`.
 * A requirement with no condition (every pre-existing pack) evaluates
 * exactly as before; this parameter changes nothing for it.
 */
function buildRequirementMapping(
  requirements: readonly PackRequirement[],
  factsByKey: ReadonlyMap<string, readonly FactInstance[]>,
  documentsByType: ReadonlyMap<DocumentGroupKey, readonly DocumentInstance[]>,
  selections: SelectionSets,
  now: Date,
  context: EvaluationContext,
): RequirementMappingEntry[] {
  return requirements.map((req): RequirementMappingEntry => {
    const conditionResult = evaluateRequirementCondition(req, context);
    if (req.kind === 'FIELD') {
      const key = req.fieldKey ?? '';
      let instances = factsByKey.get(key) ?? [];
      const selectedFactIds = selections.factIdsByRequirement.get(req.id);
      if (selectedFactIds && selectedFactIds.size > 0) {
        instances = instances.filter((i) => selectedFactIds.has(i.factId));
      }
      const facts = instances.map((i) => ({
        factId: i.factId,
        factVersionId: i.factVersionId,
        repeatingRecordKey: i.repeatingRecordKey,
        value: i.value,
        status: i.status,
        eligible: isFactStatusEligible(i.status),
        evidenceLinkIds: i.evidenceLinkIds,
      }));
      const satisfied = facts.some((f) => f.eligible);
      return {
        packRequirementId: req.id,
        kind: 'FIELD',
        key,
        citation: req.citation,
        optional: req.optional,
        satisfied,
        resultState: resolveRequirementResultState({
          satisfied,
          optional: req.optional,
          conditionResult,
          hasConflict: facts.some((f) => f.status === 'CONFLICTED'),
          hasStale: false,
        }),
        facts,
      };
    }
    const key = req.docType ?? '';
    let instances = documentsByType.get(key) ?? [];
    const selectedDocumentIds = selections.documentIdsByRequirement.get(req.id);
    if (selectedDocumentIds && selectedDocumentIds.size > 0) {
      instances = instances.filter((d) => selectedDocumentIds.has(d.documentId));
    }
    const documents = instances.map((d) => ({
      documentId: d.documentId,
      documentVersionId: d.documentVersionId,
      docType: d.docType,
      displayName: d.displayName,
      sha256: d.sha256,
      eligible: d.eligible,
      staleness: classifyStaleness(parseDocumentDate(d.documentDate), req.maxAgeDays, now),
    }));
    const satisfied = documents.some((d) => d.eligible && d.staleness.status !== 'stale');
    return {
      packRequirementId: req.id,
      kind: 'DOCUMENT',
      key,
      citation: req.citation,
      optional: req.optional,
      satisfied,
      resultState: resolveRequirementResultState({
        satisfied,
        optional: req.optional,
        conditionResult,
        hasConflict: false,
        hasStale: documents.some((d) => d.eligible && d.staleness.status === 'stale'),
      }),
      documents,
    };
  });
}

/**
 * The evidence a case uses right now: its requirement mapping, and the fact
 * and document instances a snapshot taken now would hold. One rule for both
 * the snapshot writer and anything that compares a snapshot with today
 * (WP-V3 part 3), so the two can never disagree about what is in the case.
 */
async function loadCaseEvidence(db: Db, mission: Mission) {
  const factsByKey = await loadFactInstancesByKey(db, mission.applicantId);
  const documentsByType = await loadDocumentInstancesByType(db, mission.applicantId);
  const selections = await loadSelectionsByRequirement(db, mission.id);

  let requirementMapping: RequirementMappingEntry[] = [];
  let packVersionSnapshot: { id: string; version: number; checksum: string | null } | null = null;
  if (mission.packVersionId) {
    const packVersion = first(
      await db
        .select({
          id: schema.packVersions.id,
          version: schema.packVersions.version,
          checksum: schema.packVersions.checksum,
        })
        .from(schema.packVersions)
        .where(eq(schema.packVersions.id, mission.packVersionId))
        .limit(1),
    );
    const requirements = await listRequirements(db, mission.packVersionId);
    const snapshotNow = new Date();
    requirementMapping = buildRequirementMapping(
      requirements,
      factsByKey,
      documentsByType,
      selections,
      snapshotNow,
      buildFactEvaluationContext(factsByKey, snapshotNow),
    );
    packVersionSnapshot = packVersion ?? null;
  }

  // Directive Part 7 §1 ("repair snapshot scope"): a disclosure snapshot must
  // include ONLY this case's own selected/candidate evidence, never the
  // applicant's entire wallet. `requirementMapping` already resolves each
  // requirement to the exact fact/document instances that are candidates for
  // IT specifically (narrowed to an explicit selection once one exists, per
  // `buildRequirementMapping`'s own established semantics) -- the union of
  // every instance referenced anywhere in it is exactly "this case's
  // disclosure," reusing that already-correct, already-tested scoping rather
  // than inventing a second one.
  //
  // A manual-mode/no-pack mission has no requirement-driven selection
  // mechanism at all yet (`selectedEvidence.packRequirementId` is a
  // NOT NULL FK -- there is no way to select evidence without a pack),
  // so there is no case-scoped subset to derive here. Rather than silently
  // keep the old, wrong, whole-wallet behavior indistinguishable from a
  // correctly-scoped snapshot, it is explicitly labelled
  // `evidenceScope: 'all_applicant_evidence'` so any reader (the snapshot
  // viewer, a future export) can tell the difference and render/handle it
  // honestly. Building real evidence selection for manual mode is a
  // separate, still-open gap (known-issues.md) -- out of this structural
  // fix's scope.
  const usedFactIds = new Set<string>();
  const usedDocumentVersionIds = new Set<string>();
  for (const entry of requirementMapping) {
    for (const f of entry.facts ?? []) usedFactIds.add(f.factId);
    for (const d of entry.documents ?? []) usedDocumentVersionIds.add(d.documentVersionId);
  }
  const evidenceScope: 'case_selected' | 'all_applicant_evidence' = mission.packVersionId
    ? 'case_selected'
    : 'all_applicant_evidence';

  // An unclassified document (`docType` null -- AI classification never ran,
  // or stayed below the confidence threshold) can never appear in
  // `requirementMapping` at all: no requirement's docType can match null, by
  // the exact same reasoning the unclassified-group sentinel guard
  // (Codex review, PR-D1) already established. Its case-relevance is
  // genuinely unknown -- nothing in the data model records which case an
  // upload was originally meant for -- so it belongs in neither "this
  // case's own evidence" nor "unrelated" outright. Finding #30's own
  // guarantee ("not silently dropped") still holds: when this case needs
  // ANY document evidence at all, an unclassified one is exactly what a
  // reviewer needs to see and manually triage, so it is included whenever
  // the pack has at least one DOCUMENT-kind requirement; a pack needing no
  // documents at all correctly excludes it, since it could not possibly be
  // relevant there.
  const packNeedsDocuments = requirementMapping.some((entry) => entry.kind === 'DOCUMENT');

  // Arrays, not key->value objects — a repeating field's multiple instances
  // (or a doc type's multiple documents) are never collapsed into one slot.
  const facts = [...factsByKey.entries()]
    .flatMap(([fieldKey, instances]) => instances.map((i) => ({ fieldKey, ...i })))
    .filter((f) => evidenceScope === 'all_applicant_evidence' || usedFactIds.has(f.factId));
  const documents = [...documentsByType.values()]
    .flat()
    .filter(
      (d) =>
        evidenceScope === 'all_applicant_evidence' ||
        usedDocumentVersionIds.has(d.documentVersionId) ||
        (d.docType === null && packNeedsDocuments),
    );

  return { requirementMapping, packVersionSnapshot, facts, documents, evidenceScope };
}

/** One fact a case uses now, by id only: no value. */
export interface CaseEvidenceFact {
  readonly fieldKey: string;
  readonly factId: string;
  readonly factVersionId: string | null;
  readonly repeatingRecordKey: string | null;
}

/** One document a case uses now, by id only. */
export interface CaseEvidenceDocument {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly docType: string | null;
}

export interface CaseEvidenceIds {
  readonly evidenceScope: 'case_selected' | 'all_applicant_evidence';
  readonly facts: readonly CaseEvidenceFact[];
  readonly documents: readonly CaseEvidenceDocument[];
}

/**
 * The ids of what one case uses right now, by the same rule a snapshot
 * records (`loadCaseEvidence`). Owner only; a proof for one case reaches only that case.
 * Ids, keys and kinds only, never a value.
 */
export async function listCaseEvidenceIds(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  missionId: string,
): Promise<Result<CaseEvidenceIds, ServiceError>> {
  const resource = proof.resource;
  if (
    !AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') ||
    proof.actor.kind !== 'applicant_owner'
  ) {
    return err(serviceError('forbidden', 'Only the owner of this case can see what it uses.'));
  }
  // A proof for one case covers that case only; a proof for the person covers each of their cases.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(missionId) ||
    resource.kind === 'document' ||
    (resource.kind === 'mission' && resource.mission.id !== missionId)
  ) {
    return err(serviceError('not_found', 'That case is not available.'));
  }
  const mission = first(
    await proof.tx
      .select()
      .from(schema.missions)
      .where(
        and(eq(schema.missions.id, missionId), eq(schema.missions.applicantId, proof.applicant.id)),
      )
      .limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'That case is not available.'));
  const evidence = await loadCaseEvidence(proof.tx, mission);
  return ok({
    evidenceScope: evidence.evidenceScope,
    facts: evidence.facts.map((f) => ({
      fieldKey: f.fieldKey,
      factId: f.factId,
      factVersionId: f.factVersionId,
      repeatingRecordKey: f.repeatingRecordKey,
    })),
    documents: evidence.documents.map((d) => ({
      documentId: d.documentId,
      documentVersionId: d.documentVersionId,
      docType: d.docType,
    })),
  });
}

/**
 * Capture an immutable, checksummed snapshot of the mission's current
 * evidence, per-requirement mapping, and readiness. Snapshots are never
 * mutated; versions increment. Every fact instance - including every
 * repeating-record instance (master directive §7 "PR 10") - and every
 * current document version is captured by its exact id, never collapsed
 * into a single overwritable slot. Once a mission has reached
 * READY_TO_EXPORT or later, this snapshot IS the application packet (Build
 * Spec §4.5's "pack production") - the same immutable, checksummed capture,
 * not a separate artifact.
 */
export async function snapshotMission(
  db: Db,
  input: { readonly actorAccountId: string; readonly missionId: string },
): Promise<Result<MissionSnapshot, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;
  const mission = owned.value;

  const { requirementMapping, packVersionSnapshot, facts, documents, evidenceScope } =
    await loadCaseEvidence(db, mission);
  const readiness = mission.packVersionId ? await computeReadiness(db, mission.id) : null;

  const content = {
    missionId: mission.id,
    state: mission.state,
    packVersion: packVersionSnapshot,
    facts,
    documents,
    evidenceScope,
    requirementMapping,
    readiness: readiness?.ok ? readiness.value : null,
    // TRU-03 (Part 7 §4): "snapshot creation must read consistent material
    // revision." Read once, at the same point in this function every other
    // piece of "current state" here (facts/documents/requirementMapping/
    // readiness) is already read -- not re-verified inside the transaction
    // below, matching this function's own pre-existing consistency model
    // rather than selectively hardening only this one field.
    materialRevision: mission.materialRevision,
    // CAS-01 (Commercial V1 Part 4 §8): "the coverage limitation visible on
    // the case AND EXPORT." A snapshot is the closest thing this codebase
    // has to an export artifact today, so manualMode travels with it,
    // immutably, rather than being knowable only from the live mission row.
    manualMode: mission.manualMode,
    jurisdiction: mission.jurisdiction,
    serviceCategory: mission.serviceCategory,
    travelStartDate: mission.travelStartDate?.toISOString() ?? null,
    travelEndDate: mission.travelEndDate?.toISOString() ?? null,
    targetDeadline: mission.targetDeadline?.toISOString() ?? null,
  };
  const checksum = createHash('sha256').update(stableStringify(content)).digest('hex');

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ version: schema.missionSnapshots.version })
      .from(schema.missionSnapshots)
      .where(eq(schema.missionSnapshots.missionId, mission.id));
    const nextVersion = existing.reduce((max, r) => Math.max(max, r.version), 0) + 1;

    const snapshot = required(
      first(
        await tx
          .insert(schema.missionSnapshots)
          .values({
            missionId: mission.id,
            version: nextVersion,
            content,
            checksum,
            materialRevisionAtCapture: mission.materialRevision,
            createdByAccountId: input.actorAccountId,
          })
          .returning(),
      ),
      'mission snapshot',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_SNAPSHOT_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: mission.id,
      resourceType: 'mission_snapshot',
      resourceId: snapshot.id,
      metadata: { version: nextVersion, checksum },
    });
    // OPS-04 detected gaps: what the readiness check found at the moment a
    // prepared file was captured, as a count of required items still unmet and
    // the overall state, never which requirements.
    if (readiness?.ok) {
      await recordProductEvent(tx, {
        eventType: 'READINESS_GAPS_DETECTED',
        accountId: input.actorAccountId,
        organizationId: mission.ownerOrganizationId,
        dimension: readiness.value.overallState,
        metricValue: readiness.value.missing.filter((m) => !m.optional).length,
      });
    }
    return ok(snapshot);
  });
}

// --- Explicit evidence selection (master directive §7 "PR 10": "exact
// selected evidence"; readiness must ignore unselected evidence) ------------

export type SelectedEvidence = typeof schema.selectedEvidence.$inferSelect;

async function loadOwnedRequirement(
  db: Db,
  actorAccountId: string,
  missionId: string,
  packRequirementId: string,
): Promise<Result<{ mission: Mission; requirement: PackRequirement }, ServiceError>> {
  const owned = await ownedMission(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  const mission = owned.value;
  if (!mission.packVersionId) {
    return err(serviceError('invalid', 'case has no attached pack version'));
  }
  const requirement = first(
    await db
      .select()
      .from(schema.packRequirements)
      .where(
        and(
          eq(schema.packRequirements.id, packRequirementId),
          eq(schema.packRequirements.packVersionId, mission.packVersionId),
        ),
      )
      .limit(1),
  );
  if (!requirement) {
    return err(serviceError('not_found', "requirement not found on this case's attached pack"));
  }
  return ok({ mission, requirement });
}

/**
 * Explicitly select one fact or document instance as the evidence for a
 * requirement. Idempotent — selecting the same instance twice is a no-op,
 * not an error (the unique constraints on selected_evidence enforce this at
 * the database level). Refuses an instance that doesn't belong to the
 * mission's own applicant (cross-applicant selection), AND refuses one that
 * doesn't actually match the requirement's own field key / document type
 * (finding #34, post-programme defect register) — ownership alone used to
 * be the only check, so a selection request could attach any of the
 * applicant's facts/documents to any requirement regardless of relevance,
 * corrupting `buildRequirementMapping`'s per-requirement candidate lists
 * (which key strictly by field key / doc type) with a `selected_evidence`
 * row those lists were never built to expect.
 */
export async function selectEvidence(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly missionId: string;
    readonly packRequirementId: string;
    readonly factId?: string;
    readonly documentId?: string;
  },
): Promise<Result<SelectedEvidence, ServiceError>> {
  const loaded = await loadOwnedRequirement(
    db,
    input.actorAccountId,
    input.missionId,
    input.packRequirementId,
  );
  if (!loaded.ok) return loaded;
  const { mission, requirement } = loaded.value;

  if (requirement.kind === 'FIELD') {
    if (!input.factId || input.documentId) {
      return err(serviceError('invalid', 'a FIELD requirement is satisfied by exactly one factId'));
    }
    const fact = first(
      await db
        .select({
          applicantId: schema.facts.applicantId,
          fieldKey: schema.fieldDefinitions.key,
        })
        .from(schema.facts)
        .innerJoin(
          schema.fieldDefinitions,
          eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
        )
        .where(eq(schema.facts.id, input.factId))
        .limit(1),
    );
    if (!fact || fact.applicantId !== mission.applicantId) {
      return err(serviceError('not_found', 'fact not found for this case'));
    }
    if (fact.fieldKey !== requirement.fieldKey) {
      return err(serviceError('invalid', "this fact does not match the requirement's field"));
    }
  } else {
    if (!input.documentId || input.factId) {
      return err(
        serviceError('invalid', 'a DOCUMENT requirement is satisfied by exactly one documentId'),
      );
    }
    const document = first(
      await db
        .select({ applicantId: schema.documents.applicantId, docType: schema.documents.docType })
        .from(schema.documents)
        .where(eq(schema.documents.id, input.documentId))
        .limit(1),
    );
    if (!document || document.applicantId !== mission.applicantId) {
      return err(serviceError('not_found', 'document not found for this case'));
    }
    if (document.docType !== requirement.docType) {
      return err(
        serviceError('invalid', "this document does not match the requirement's document type"),
      );
    }
  }

  return db.transaction(async (tx) => {
    const existing = first(
      await tx
        .select()
        .from(schema.selectedEvidence)
        .where(
          and(
            eq(schema.selectedEvidence.missionId, mission.id),
            eq(schema.selectedEvidence.packRequirementId, requirement.id),
            input.factId
              ? eq(schema.selectedEvidence.factId, input.factId)
              : eq(schema.selectedEvidence.documentId, input.documentId as string),
          ),
        )
        .limit(1),
    );
    if (existing) return ok(existing);

    await incrementMaterialRevision(tx, mission.id);
    const selection = required(
      first(
        await tx
          .insert(schema.selectedEvidence)
          .values({
            missionId: mission.id,
            packRequirementId: requirement.id,
            factId: input.factId ?? null,
            documentId: input.documentId ?? null,
            selectedByAccountId: input.actorAccountId,
          })
          .returning(),
      ),
      'selected evidence',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_EVIDENCE_SELECTED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: mission.id,
      resourceType: 'selected_evidence',
      resourceId: selection.id,
      metadata: {
        packRequirementId: requirement.id,
        factId: input.factId,
        documentId: input.documentId,
      },
    });
    return ok(selection);
  });
}

/** Remove a selection (owner-scoped) — the requirement reverts to "no evidence explicitly selected". */
export async function unselectEvidence(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly missionId: string;
    readonly selectionId: string;
  },
): Promise<Result<void, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;

  return db.transaction(async (tx) => {
    const deleted = first(
      await tx
        .delete(schema.selectedEvidence)
        .where(
          and(
            eq(schema.selectedEvidence.id, input.selectionId),
            eq(schema.selectedEvidence.missionId, input.missionId),
          ),
        )
        .returning(),
    );
    if (!deleted) return err(serviceError('not_found', 'selection not found'));
    await incrementMaterialRevision(tx, input.missionId);
    await appendAuditEvent(tx, {
      eventType: 'MISSION_EVIDENCE_UNSELECTED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'selected_evidence',
      resourceId: input.selectionId,
    });
    return ok(undefined);
  });
}

/** Every current evidence selection for a mission (owner-scoped). */
export async function listSelectedEvidence(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<SelectedEvidence[], ServiceError>> {
  const owned = await ownedMission(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  const rows = await db
    .select()
    .from(schema.selectedEvidence)
    .where(eq(schema.selectedEvidence.missionId, missionId));
  return ok(rows);
}

/**
 * Every current evidence selection for a mission, for an org that currently
 * holds a MANAGE grant covering it: the org-scoped sibling of
 * `listSelectedEvidence` (owner-scoped), mirroring
 * `listMissionRequirementsForOrg`'s exact authorization shape. Lets a case
 * manager's UI resolve "which fact/document already backs this requirement"
 * (e.g. to record an issuer confirmation against it, EVI-05) without
 * needing owner-level mission access. Empty (not an error) if nothing is
 * selected yet.
 */
export async function listSelectedEvidenceForOrg(
  db: Db,
  organizationId: string,
  missionId: string,
): Promise<Result<SelectedEvidence[], ServiceError>> {
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'case not found'));
  if (!(await orgGrantPermits(db, organizationId, mission.applicantId, 'MANAGE', mission.id))) {
    return err(
      serviceError('forbidden', 'this organization has no current grant covering that case'),
    );
  }
  const rows = await db
    .select()
    .from(schema.selectedEvidence)
    .where(eq(schema.selectedEvidence.missionId, missionId));
  return ok(rows);
}

// --- Mission tasks (master directive §7 "PR 10") ---------------------------

export type MissionTask = typeof schema.missionTasks.$inferSelect;

/** Add a lightweight, completable checklist item to a mission — optionally tied to one requirement. */
export async function createTask(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly missionId: string;
    readonly description: string;
    readonly packRequirementId?: string;
    readonly assigneeAccountId?: string;
    readonly dueDate?: Date;
    readonly dueTimezone?: string;
    readonly priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  },
): Promise<Result<MissionTask, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;
  const description = input.description.trim();
  if (description.length === 0) return err(serviceError('invalid', 'a description is required'));

  // Same cross-case check `loadOwnedRequirement` already applies for
  // `selectEvidence`/`recordMissionDecision` (finding #34, post-programme
  // defect register): without it, a task could attach to a requirement from
  // a completely unrelated pack/case, not just an unrelated document/fact.
  if (input.packRequirementId) {
    const requirement = await loadOwnedRequirement(
      db,
      input.actorAccountId,
      input.missionId,
      input.packRequirementId,
    );
    if (!requirement.ok) return requirement;
  }

  return db.transaction(async (tx) => {
    const task = required(
      first(
        await tx
          .insert(schema.missionTasks)
          .values({
            missionId: input.missionId,
            packRequirementId: input.packRequirementId ?? null,
            description,
            assigneeAccountId: input.assigneeAccountId ?? null,
            dueDate: input.dueDate ?? null,
            dueTimezone: input.dueTimezone ?? null,
            ...(input.priority ? { priority: input.priority } : {}),
          })
          .returning(),
      ),
      'mission task',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_TASK_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'mission_task',
      resourceId: task.id,
    });
    return ok(task);
  });
}

// Commercial V1 Part 4 §11: "States: OPEN, IN_PROGRESS, DONE, CANCELLED."
// DONE/CANCELLED are terminal; IN_PROGRESS is an optional, skippable
// waypoint (a task may go straight from OPEN to DONE) that itself only
// signals work has started, never a distinct completion.
const TASK_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  OPEN: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

/** Move a task through its state machine (owner-scoped): OPEN -> IN_PROGRESS -> DONE/CANCELLED. */
export async function decideTask(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly missionId: string;
    readonly taskId: string;
    readonly status: 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  },
): Promise<Result<MissionTask, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;

  return db.transaction(async (tx) => {
    const task = first(
      await tx
        .select()
        .from(schema.missionTasks)
        .where(
          and(
            eq(schema.missionTasks.id, input.taskId),
            eq(schema.missionTasks.missionId, input.missionId),
          ),
        )
        .limit(1),
    );
    if (!task) return err(serviceError('not_found', 'task not found'));
    if (!(TASK_TRANSITIONS[task.status] ?? []).includes(input.status)) {
      return err(
        serviceError('invalid', `cannot move a task from ${task.status} to ${input.status}`),
      );
    }
    const updated = required(
      first(
        await tx
          .update(schema.missionTasks)
          .set({
            status: input.status,
            completedAt:
              input.status === 'DONE' || input.status === 'CANCELLED' ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(schema.missionTasks.id, input.taskId))
          .returning(),
      ),
      'mission task',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_TASK_DECIDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'mission_task',
      resourceId: task.id,
      metadata: { from: task.status, status: input.status },
    });
    if (input.status === 'CANCELLED') {
      // Part 5 §4: a cancelled task invalidates its own still-QUEUED
      // TASK_DEADLINE reminders (NTF-04's sweep), if any are still pending.
      await cancelQueuedNotificationsForResource(tx, task.id);
    }
    return ok(updated);
  });
}

export interface UpdateTaskInput {
  readonly actorAccountId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly assigneeAccountId?: string | null;
  readonly dueDate?: Date | null;
  readonly dueTimezone?: string | null;
  readonly priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

/**
 * Change a task's assignee, due date/timezone, or priority (owner-scoped).
 * Commercial V1 Part 4 §11: "Reassignment/deadline changes: audit" -- every
 * field this call actually changes is captured in one audit event alongside
 * its PRIOR value, never a silent overwrite with no trace. A field omitted
 * from `input` (as opposed to explicitly passed, even as `null`) is left
 * untouched, the same partial-update discipline `updateMissionCaseDetails`
 * already established for case details.
 */
export async function updateTask(
  db: Db,
  input: UpdateTaskInput,
): Promise<Result<MissionTask, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;

  return db.transaction(async (tx) => {
    const task = first(
      await tx
        .select()
        .from(schema.missionTasks)
        .where(
          and(
            eq(schema.missionTasks.id, input.taskId),
            eq(schema.missionTasks.missionId, input.missionId),
          ),
        )
        .limit(1),
    );
    if (!task) return err(serviceError('not_found', 'task not found'));

    let changes: Record<string, { readonly before: unknown; readonly after: unknown }> = {};
    if (input.assigneeAccountId !== undefined) {
      changes = {
        ...changes,
        assigneeAccountId: { before: task.assigneeAccountId, after: input.assigneeAccountId },
      };
    }
    if (input.dueDate !== undefined) {
      changes = {
        ...changes,
        dueDate: {
          before: task.dueDate?.toISOString() ?? null,
          after: input.dueDate?.toISOString() ?? null,
        },
      };
    }
    if (input.dueTimezone !== undefined) {
      changes = {
        ...changes,
        dueTimezone: { before: task.dueTimezone, after: input.dueTimezone },
      };
    }
    if (input.priority !== undefined) {
      changes = { ...changes, priority: { before: task.priority, after: input.priority } };
    }
    if (Object.keys(changes).length === 0) return ok(task);

    const updated = required(
      first(
        await tx
          .update(schema.missionTasks)
          .set({
            ...(input.assigneeAccountId !== undefined
              ? { assigneeAccountId: input.assigneeAccountId }
              : {}),
            ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
            ...(input.dueTimezone !== undefined ? { dueTimezone: input.dueTimezone } : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.missionTasks.id, input.taskId))
          .returning(),
      ),
      'mission task',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_TASK_UPDATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'mission_task',
      resourceId: task.id,
      metadata: { changes },
    });
    return ok(updated);
  });
}

/** Every task for a mission, newest first (owner-scoped). */
export async function listTasks(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<MissionTask[], ServiceError>> {
  const owned = await ownedMission(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  const rows = await db
    .select()
    .from(schema.missionTasks)
    .where(eq(schema.missionTasks.missionId, missionId));
  return ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}

// --- Mission appointments (Commercial V1 Part 4 §11) ------------------------

export type MissionAppointment = typeof schema.missionAppointments.$inferSelect;

export interface CreateAppointmentInput {
  readonly actorAccountId: string;
  readonly missionId: string;
  readonly title: string;
  readonly localDateTime: Date;
  readonly timezone: string;
  readonly assigneeAccountId?: string;
  readonly place?: string;
  readonly channel?: string;
}

/** Schedule a meeting tied to a mission -- a local date/time in an explicit timezone, not a checklist item. */
export async function createAppointment(
  db: Db,
  input: CreateAppointmentInput,
): Promise<Result<MissionAppointment, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;
  const title = input.title.trim();
  if (title.length === 0) return err(serviceError('invalid', 'a title is required'));
  const timezone = input.timezone.trim();
  if (timezone.length === 0) return err(serviceError('invalid', 'a timezone is required'));

  return db.transaction(async (tx) => {
    const appointment = required(
      first(
        await tx
          .insert(schema.missionAppointments)
          .values({
            missionId: input.missionId,
            title,
            assigneeAccountId: input.assigneeAccountId ?? null,
            localDateTime: input.localDateTime,
            timezone,
            place: input.place?.trim() || null,
            channel: input.channel?.trim() || null,
          })
          .returning(),
      ),
      'mission appointment',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_APPOINTMENT_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'mission_appointment',
      resourceId: appointment.id,
    });
    return ok(appointment);
  });
}

export interface UpdateAppointmentInput {
  readonly actorAccountId: string;
  readonly missionId: string;
  readonly appointmentId: string;
  readonly assigneeAccountId?: string | null;
  readonly localDateTime?: Date;
  readonly timezone?: string;
  readonly place?: string | null;
  readonly channel?: string | null;
}

/** Reschedule or reassign an appointment (owner-scoped); every changed field is audited with its prior value. */
export async function updateAppointment(
  db: Db,
  input: UpdateAppointmentInput,
): Promise<Result<MissionAppointment, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;

  return db.transaction(async (tx) => {
    const appointment = first(
      await tx
        .select()
        .from(schema.missionAppointments)
        .where(
          and(
            eq(schema.missionAppointments.id, input.appointmentId),
            eq(schema.missionAppointments.missionId, input.missionId),
          ),
        )
        .limit(1),
    );
    if (!appointment) return err(serviceError('not_found', 'appointment not found'));

    let changes: Record<string, { readonly before: unknown; readonly after: unknown }> = {};
    if (input.assigneeAccountId !== undefined) {
      changes = {
        ...changes,
        assigneeAccountId: {
          before: appointment.assigneeAccountId,
          after: input.assigneeAccountId,
        },
      };
    }
    if (input.localDateTime !== undefined) {
      changes = {
        ...changes,
        localDateTime: {
          before: appointment.localDateTime.toISOString(),
          after: input.localDateTime.toISOString(),
        },
      };
    }
    if (input.timezone !== undefined) {
      changes = { ...changes, timezone: { before: appointment.timezone, after: input.timezone } };
    }
    if (input.place !== undefined) {
      changes = { ...changes, place: { before: appointment.place, after: input.place } };
    }
    if (input.channel !== undefined) {
      changes = { ...changes, channel: { before: appointment.channel, after: input.channel } };
    }
    if (Object.keys(changes).length === 0) return ok(appointment);

    const updated = required(
      first(
        await tx
          .update(schema.missionAppointments)
          .set({
            ...(input.assigneeAccountId !== undefined
              ? { assigneeAccountId: input.assigneeAccountId }
              : {}),
            ...(input.localDateTime !== undefined ? { localDateTime: input.localDateTime } : {}),
            ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
            ...(input.place !== undefined ? { place: input.place } : {}),
            ...(input.channel !== undefined ? { channel: input.channel } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.missionAppointments.id, input.appointmentId))
          .returning(),
      ),
      'mission appointment',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_APPOINTMENT_UPDATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'mission_appointment',
      resourceId: appointment.id,
      metadata: { changes },
    });
    return ok(updated);
  });
}

/** Mark an appointment DONE or CANCELLED (owner-scoped). */
export async function decideAppointment(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly missionId: string;
    readonly appointmentId: string;
    readonly status: 'DONE' | 'CANCELLED';
  },
): Promise<Result<MissionAppointment, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;

  return db.transaction(async (tx) => {
    const appointment = first(
      await tx
        .select()
        .from(schema.missionAppointments)
        .where(
          and(
            eq(schema.missionAppointments.id, input.appointmentId),
            eq(schema.missionAppointments.missionId, input.missionId),
          ),
        )
        .limit(1),
    );
    if (!appointment) return err(serviceError('not_found', 'appointment not found'));
    if (appointment.status !== 'OPEN') {
      return err(serviceError('invalid', 'only an OPEN appointment can be decided'));
    }
    const updated = required(
      first(
        await tx
          .update(schema.missionAppointments)
          .set({ status: input.status, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.missionAppointments.id, input.appointmentId))
          .returning(),
      ),
      'mission appointment',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_APPOINTMENT_DECIDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'mission_appointment',
      resourceId: appointment.id,
      metadata: { status: input.status },
    });
    if (input.status === 'CANCELLED') {
      // Part 5 §4: a cancelled appointment invalidates its own still-QUEUED
      // APPOINTMENT_SCHEDULED notice, if the worker hasn't sent it yet.
      await cancelQueuedNotificationsForResource(tx, appointment.id);
    }
    return ok(updated);
  });
}

/** Every appointment for a mission, soonest first (owner-scoped). */
export async function listAppointments(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<MissionAppointment[], ServiceError>> {
  const owned = await ownedMission(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  const rows = await db
    .select()
    .from(schema.missionAppointments)
    .where(eq(schema.missionAppointments.missionId, missionId));
  return ok([...rows].sort((a, b) => a.localDateTime.getTime() - b.localDateTime.getTime()));
}

/** One appointment (owner-scoped) -- backs the "add to calendar" ICS download, which needs exactly one row, not the whole list. */
export async function getAppointment(
  db: Db,
  actorAccountId: string,
  missionId: string,
  appointmentId: string,
): Promise<Result<MissionAppointment, ServiceError>> {
  const owned = await ownedMission(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  const appointment = first(
    await db
      .select()
      .from(schema.missionAppointments)
      .where(
        and(
          eq(schema.missionAppointments.id, appointmentId),
          eq(schema.missionAppointments.missionId, missionId),
        ),
      )
      .limit(1),
  );
  if (!appointment) return err(serviceError('not_found', 'appointment not found'));
  return ok(appointment);
}

// --- Grounded letters (master directive §7 "PR 10") -------------------------
//
// Deterministic and template-based, NOT AI (avoids conflating with the AI
// Gateway's own scope and evaluation requirements — master directive §7 "PR
// 9"). "Grounded" is enforced literally: every line composed here traces to
// one specific satisfied requirement's current fact value or document name,
// and `groundedReferences` cites the exact ids. No translation is generated
// (see generatedOutputs.translatedFromOutputId's doc comment in schema.ts) —
// only the provenance field exists for a future feature to use.

export type GeneratedOutput = typeof schema.generatedOutputs.$inferSelect;

interface GroundedReference {
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly key: string;
  readonly factVersionId?: string;
  readonly documentVersionId?: string;
}

function buildCoverLetterContent(
  mission: Mission,
  mapping: readonly RequirementMappingEntry[],
): { content: string; groundedReferences: GroundedReference[] } {
  const lines: string[] = [
    `Cover letter — ${mission.title}`,
    mission.destination ? `Destination: ${mission.destination}` : '',
    mission.purpose ? `Purpose: ${mission.purpose}` : '',
    '',
    'This letter is grounded strictly in confirmed evidence on file:',
  ].filter((l) => l.length > 0 || l === '');
  const groundedReferences: GroundedReference[] = [];

  for (const entry of mapping) {
    if (!entry.satisfied) continue;
    if (entry.kind === 'FIELD') {
      const fact = (entry.facts ?? []).find((f) => f.eligible);
      if (!fact) continue;
      lines.push(`- ${entry.key}: ${fact.value ?? ''} (${entry.citation})`);
      groundedReferences.push({
        kind: 'FIELD',
        key: entry.key,
        ...(fact.factVersionId ? { factVersionId: fact.factVersionId } : {}),
      });
    } else {
      const doc = (entry.documents ?? []).find((d) => d.eligible);
      if (!doc) continue;
      lines.push(`- ${entry.key}: ${doc.displayName} (${entry.citation})`);
      groundedReferences.push({
        kind: 'DOCUMENT',
        key: entry.key,
        documentVersionId: doc.documentVersionId,
      });
    }
  }

  return { content: lines.join('\n'), groundedReferences };
}

/**
 * Generate a new, versioned cover letter grounded in the mission's current
 * satisfied requirements. Refuses if the mission has no attached pack
 * version, or nothing is satisfied yet — an empty "grounded" letter would
 * just be an invented one.
 */
export async function generateCoverLetter(
  db: Db,
  input: { readonly actorAccountId: string; readonly missionId: string },
): Promise<Result<GeneratedOutput, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;
  const mission = owned.value;
  if (!mission.packVersionId) {
    return err(serviceError('invalid', 'case has no attached pack version'));
  }

  const requirements = await listRequirements(db, mission.packVersionId);
  const factsByKey = await loadFactInstancesByKey(db, mission.applicantId);
  const documentsByType = await loadDocumentInstancesByType(db, mission.applicantId);
  const selections = await loadSelectionsByRequirement(db, mission.id);
  const letterNow = new Date();
  const mapping = buildRequirementMapping(
    requirements,
    factsByKey,
    documentsByType,
    selections,
    letterNow,
    buildFactEvaluationContext(factsByKey, letterNow),
  );
  const { content, groundedReferences } = buildCoverLetterContent(mission, mapping);
  if (groundedReferences.length === 0) {
    return err(serviceError('invalid', 'no satisfied requirements to ground a letter in yet'));
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ version: schema.generatedOutputs.version })
      .from(schema.generatedOutputs)
      .where(
        and(
          eq(schema.generatedOutputs.missionId, mission.id),
          eq(schema.generatedOutputs.kind, 'COVER_LETTER'),
        ),
      );
    const nextVersion = existing.reduce((max, r) => Math.max(max, r.version), 0) + 1;

    await incrementMaterialRevision(tx, mission.id);
    const output = required(
      first(
        await tx
          .insert(schema.generatedOutputs)
          .values({
            missionId: mission.id,
            kind: 'COVER_LETTER',
            version: nextVersion,
            content,
            groundedReferences,
            createdByAccountId: input.actorAccountId,
          })
          .returning(),
      ),
      'generated output',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_LETTER_GENERATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: mission.id,
      resourceType: 'generated_output',
      resourceId: output.id,
      metadata: { version: nextVersion, referenceCount: groundedReferences.length },
    });
    return ok(output);
  });
}

/** Every generated output for a mission, newest first (owner-scoped). */
export async function listGeneratedOutputs(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<GeneratedOutput[], ServiceError>> {
  const owned = await ownedMission(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  const rows = await db
    .select()
    .from(schema.generatedOutputs)
    .where(eq(schema.generatedOutputs.missionId, missionId))
    .orderBy(desc(schema.generatedOutputs.version));
  return ok(rows);
}
