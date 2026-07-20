import { createHash } from 'node:crypto';
import type { MissionState } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

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
}

export interface Readiness {
  readonly total: number;
  readonly requiredCount: number;
  readonly satisfiedRequired: number;
  readonly missing: readonly MissingRequirement[];
  /** Completeness only — never an approval likelihood. */
  readonly ready: boolean;
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

  const requirements = await db
    .select()
    .from(schema.packRequirements)
    .where(eq(schema.packRequirements.packVersionId, mission.packVersionId));

  // Approved field keys for this applicant (a fact with a current version).
  const factKeys = new Set(
    (
      await db
        .select({ key: schema.fieldDefinitions.key })
        .from(schema.facts)
        .innerJoin(
          schema.fieldDefinitions,
          eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
        )
        .where(
          and(
            eq(schema.facts.applicantId, mission.applicantId),
            isNotNull(schema.facts.currentVersionId),
          ),
        )
    ).map((r) => r.key),
  );
  const docTypes = new Set(
    (
      await db
        .select({ docType: schema.documents.docType })
        .from(schema.documents)
        .where(eq(schema.documents.applicantId, mission.applicantId))
    )
      .map((r) => r.docType)
      .filter((d): d is string => d !== null),
  );

  const missing: MissingRequirement[] = [];
  let requiredCount = 0;
  let satisfiedRequired = 0;
  for (const req of requirements) {
    const key = req.kind === 'FIELD' ? (req.fieldKey ?? '') : (req.docType ?? '');
    const satisfied = req.kind === 'FIELD' ? factKeys.has(key) : docTypes.has(key);
    if (!req.optional) {
      requiredCount++;
      if (satisfied) satisfiedRequired++;
    }
    if (!satisfied) missing.push({ kind: req.kind, key, optional: req.optional });
  }

  return ok({
    total: requirements.length,
    requiredCount,
    satisfiedRequired,
    missing,
    ready: requiredCount > 0 && satisfiedRequired === requiredCount,
  });
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

/**
 * Capture an immutable, checksummed snapshot of the mission's current evidence
 * and readiness. Snapshots are never mutated; versions increment.
 */
export async function snapshotMission(
  db: Db,
  input: { readonly actorAccountId: string; readonly missionId: string },
): Promise<Result<MissionSnapshot, ServiceError>> {
  const owned = await ownedMission(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;
  const mission = owned.value;

  const factRows = await db
    .select({ key: schema.fieldDefinitions.key, value: schema.factVersions.value })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
    )
    .innerJoin(schema.factVersions, eq(schema.factVersions.id, schema.facts.currentVersionId))
    .where(eq(schema.facts.applicantId, mission.applicantId));
  const facts: Record<string, string | null> = {};
  for (const row of factRows) facts[row.key] = row.value;

  const documents = await db
    .select({
      id: schema.documents.id,
      docType: schema.documents.docType,
      originalName: schema.documents.originalName,
      approvedName: schema.documents.approvedName,
    })
    .from(schema.documents)
    .where(eq(schema.documents.applicantId, mission.applicantId));

  const readiness = mission.packVersionId ? await computeReadiness(db, mission.id) : null;
  const content = {
    missionId: mission.id,
    state: mission.state,
    packVersionId: mission.packVersionId,
    facts,
    documents,
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
