import { createHash } from 'node:crypto';
import type { FactStatus, MissionState } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { isServableProcessingState } from './documents';
import { type ServiceError, serviceError } from './errors';
import { type PackRequirement, listRequirements } from './packs';
import { recordProductEvent } from './product-events';

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

// Legal reviewer-workflow transitions (Build Spec §4.3).
const TRANSITIONS: Readonly<Record<MissionState, readonly MissionState[]>> = {
  DRAFT: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['READY_FOR_REVIEW', 'CANCELLED'],
  READY_FOR_REVIEW: ['UNDER_REVIEW', 'IN_PROGRESS', 'CANCELLED'],
  UNDER_REVIEW: ['READY_TO_EXPORT', 'IN_PROGRESS', 'CANCELLED'],
  READY_TO_EXPORT: ['LOCKED', 'IN_PROGRESS', 'CANCELLED'],
  LOCKED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

async function ownedMission(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<Mission, ServiceError>> {
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'mission not found'));
  const applicant = await getApplicant(db, mission.applicantId);
  if (!applicant || applicant.ownerAccountId !== actorAccountId) {
    return err(serviceError('forbidden', 'not authorized for this mission'));
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
  },
): Promise<Result<Mission, ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized for this applicant'));
  }
  if (input.title.trim().length === 0) return err(serviceError('invalid', 'a title is required'));
  if (!(await hasConsent(db, applicant.ownerAccountId, 'CORE_PROCESSING'))) {
    return err(serviceError('consent_required', 'CORE_PROCESSING consent is required'));
  }

  return db.transaction(async (tx) => {
    const mission = required(
      first(
        await tx
          .insert(schema.missions)
          .values({
            applicantId: input.applicantId,
            title: input.title.trim(),
            destination: input.destination ?? null,
            purpose: input.purpose ?? null,
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
    });
    return ok(mission);
  });
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
  /** Distinguishes "never provided" from "provided but not currently trustworthy". */
  readonly reason: 'not_provided' | 'unresolved_conflict';
}

export interface Readiness {
  readonly total: number;
  readonly requiredCount: number;
  readonly satisfiedRequired: number;
  readonly missing: readonly MissingRequirement[];
  /** Completeness only — never an approval likelihood. */
  readonly ready: boolean;
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
}

/**
 * Load the latest version of every document, grouped by docType. Only the
 * latest version of each document is considered — an older, superseded
 * version can never satisfy a requirement. `eligible` folds together every
 * document-side readiness exclusion the directive requires: unsafe
 * (safetyStatus !== CLEAN), still-processing or rejected (the same
 * isServableProcessingState gate documents.ts uses for preview/download —
 * one canonical definition, never a second one that could drift), and
 * expired (documents.expiresAt, if ever populated by a future feature — no
 * current path sets it, but readiness honors it defensively regardless).
 */
async function loadDocumentInstancesByType(
  db: Db,
  applicantId: string,
): Promise<Map<string, DocumentInstance[]>> {
  const rows = await db
    .select({
      documentId: schema.documents.id,
      docType: schema.documents.docType,
      originalName: schema.documents.originalName,
      approvedName: schema.documents.approvedName,
      expiresAt: schema.documents.expiresAt,
      documentVersionId: schema.documentVersions.id,
      versionNumber: schema.documentVersions.versionNumber,
      sha256: schema.documentVersions.sha256,
      safetyStatus: schema.documentVersions.safetyStatus,
      processingStatus: schema.documentVersions.processingStatus,
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

  const now = Date.now();
  const map = new Map<string, DocumentInstance[]>();
  for (const row of latestByDocument.values()) {
    if (!row.docType) continue;
    const eligible =
      row.safetyStatus === 'CLEAN' &&
      isServableProcessingState(row.processingStatus) &&
      (row.expiresAt === null || row.expiresAt.getTime() > now);
    const list = map.get(row.docType) ?? [];
    list.push({
      documentId: row.documentId,
      documentVersionId: row.documentVersionId,
      docType: row.docType,
      displayName: row.approvedName ?? row.originalName,
      sha256: row.sha256,
      safetyStatus: row.safetyStatus,
      processingStatus: row.processingStatus,
      eligible,
    });
    map.set(row.docType, list);
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
): Promise<Result<Readiness, ServiceError>> {
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'mission not found'));
  if (!mission.packVersionId) {
    return err(serviceError('invalid', 'mission has no attached pack version'));
  }

  const requirements = await listRequirements(db, mission.packVersionId);
  const factsByKey = await loadFactInstancesByKey(db, mission.applicantId);
  const documentsByType = await loadDocumentInstancesByType(db, mission.applicantId);
  const selections = await loadSelectionsByRequirement(db, missionId);
  const mapping = buildRequirementMapping(requirements, factsByKey, documentsByType, selections);

  const missing: MissingRequirement[] = [];
  let requiredCount = 0;
  let satisfiedRequired = 0;
  for (const entry of mapping) {
    if (!entry.optional) {
      requiredCount++;
      if (entry.satisfied) satisfiedRequired++;
    }
    if (!entry.satisfied) {
      const anyConflicted =
        entry.kind === 'FIELD' && (entry.facts ?? []).some((f) => f.status === 'CONFLICTED');
      missing.push({
        kind: entry.kind,
        key: entry.key,
        optional: entry.optional,
        reason: anyConflicted ? 'unresolved_conflict' : 'not_provided',
      });
    }
  }

  return ok({
    total: mapping.length,
    requiredCount,
    satisfiedRequired,
    missing,
    ready: requiredCount > 0 && satisfiedRequired === requiredCount,
  });
}

export interface EvidenceCandidateEntry {
  readonly packRequirementId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly key: string;
  readonly citation: string;
  readonly optional: boolean;
  readonly factCandidates: readonly FactInstance[];
  readonly documentCandidates: readonly DocumentInstance[];
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

  return ok(
    requirements.map((req) => ({
      packRequirementId: req.id,
      kind: req.kind,
      key: req.kind === 'FIELD' ? (req.fieldKey ?? '') : (req.docType ?? ''),
      citation: req.citation,
      optional: req.optional,
      factCandidates: factsByKey.get(req.fieldKey ?? '') ?? [],
      documentCandidates: documentsByType.get(req.docType ?? '') ?? [],
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

  return db.transaction(async (tx) => {
    const mission = required(
      first(
        await tx
          .update(schema.missions)
          .set({ state: input.to, updatedAt: new Date() })
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
  }>;
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
 */
function buildRequirementMapping(
  requirements: readonly PackRequirement[],
  factsByKey: ReadonlyMap<string, readonly FactInstance[]>,
  documentsByType: ReadonlyMap<string, readonly DocumentInstance[]>,
  selections: SelectionSets,
): RequirementMappingEntry[] {
  return requirements.map((req): RequirementMappingEntry => {
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
      return {
        packRequirementId: req.id,
        kind: 'FIELD',
        key,
        citation: req.citation,
        optional: req.optional,
        satisfied: facts.some((f) => f.eligible),
        facts,
      };
    }
    const key = req.docType ?? '';
    let instances = documentsByType.get(key) ?? [];
    const selectedDocumentIds = selections.documentIdsByRequirement.get(req.id);
    if (selectedDocumentIds && selectedDocumentIds.size > 0) {
      instances = instances.filter((d) => selectedDocumentIds.has(d.documentId));
    }
    return {
      packRequirementId: req.id,
      kind: 'DOCUMENT',
      key,
      citation: req.citation,
      optional: req.optional,
      satisfied: instances.some((d) => d.eligible),
      documents: instances.map((d) => ({
        documentId: d.documentId,
        documentVersionId: d.documentVersionId,
        docType: d.docType,
        displayName: d.displayName,
        sha256: d.sha256,
        eligible: d.eligible,
      })),
    };
  });
}

/**
 * Capture an immutable, checksummed snapshot of the mission's current
 * evidence, per-requirement mapping, and readiness. Snapshots are never
 * mutated; versions increment. Every fact instance — including every
 * repeating-record instance (master directive §7 "PR 10") — and every
 * current document version is captured by its exact id, never collapsed
 * into a single overwritable slot. Once a mission has reached
 * READY_TO_EXPORT or later, this snapshot IS the application packet (Build
 * Spec §4.5's "pack production") — the same immutable, checksummed capture,
 * not a separate artifact.
 */
export async function snapshotMission(
  db: Db,
  input: { readonly actorAccountId: string; readonly missionId: string },
): Promise<Result<MissionSnapshot, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;
  const mission = owned.value;

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
    requirementMapping = buildRequirementMapping(
      requirements,
      factsByKey,
      documentsByType,
      selections,
    );
    packVersionSnapshot = packVersion ?? null;
  }
  const readiness = mission.packVersionId ? await computeReadiness(db, mission.id) : null;

  // Arrays, not key->value objects — a repeating field's multiple instances
  // (or a doc type's multiple documents) are never collapsed into one slot.
  const facts = [...factsByKey.entries()].flatMap(([fieldKey, instances]) =>
    instances.map((i) => ({ fieldKey, ...i })),
  );
  const documents = [...documentsByType.values()].flat();

  const content = {
    missionId: mission.id,
    state: mission.state,
    packVersion: packVersionSnapshot,
    facts,
    documents,
    requirementMapping,
    readiness: readiness?.ok ? readiness.value : null,
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
    return err(serviceError('invalid', 'mission has no attached pack version'));
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
    return err(serviceError('not_found', "requirement not found on this mission's attached pack"));
  }
  return ok({ mission, requirement });
}

/**
 * Explicitly select one fact or document instance as the evidence for a
 * requirement. Idempotent — selecting the same instance twice is a no-op,
 * not an error (the unique constraints on selected_evidence enforce this at
 * the database level). Refuses an instance that doesn't belong to the
 * mission's own applicant (cross-applicant selection).
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
        .select({ applicantId: schema.facts.applicantId })
        .from(schema.facts)
        .where(eq(schema.facts.id, input.factId))
        .limit(1),
    );
    if (!fact || fact.applicantId !== mission.applicantId) {
      return err(serviceError('not_found', 'fact not found for this mission'));
    }
  } else {
    if (!input.documentId || input.factId) {
      return err(
        serviceError('invalid', 'a DOCUMENT requirement is satisfied by exactly one documentId'),
      );
    }
    const document = first(
      await db
        .select({ applicantId: schema.documents.applicantId })
        .from(schema.documents)
        .where(eq(schema.documents.id, input.documentId))
        .limit(1),
    );
    if (!document || document.applicantId !== mission.applicantId) {
      return err(serviceError('not_found', 'document not found for this mission'));
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
  },
): Promise<Result<MissionTask, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;
  const description = input.description.trim();
  if (description.length === 0) return err(serviceError('invalid', 'a description is required'));

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

/** Mark a task DONE or CANCELLED (owner-scoped). */
export async function decideTask(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly missionId: string;
    readonly taskId: string;
    readonly status: 'DONE' | 'CANCELLED';
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
    if (task.status !== 'OPEN') {
      return err(serviceError('invalid', 'only an OPEN task can be decided'));
    }
    const updated = required(
      first(
        await tx
          .update(schema.missionTasks)
          .set({ status: input.status, completedAt: new Date(), updatedAt: new Date() })
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
      metadata: { status: input.status },
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
    return err(serviceError('invalid', 'mission has no attached pack version'));
  }

  const requirements = await listRequirements(db, mission.packVersionId);
  const factsByKey = await loadFactInstancesByKey(db, mission.applicantId);
  const documentsByType = await loadDocumentInstancesByType(db, mission.applicantId);
  const selections = await loadSelectionsByRequirement(db, mission.id);
  const mapping = buildRequirementMapping(requirements, factsByKey, documentsByType, selections);
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
