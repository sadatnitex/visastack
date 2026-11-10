import { and, desc, eq, lte } from 'drizzle-orm';
import { type Db, schema } from './db';
import type { Mission, Readiness } from './missions';

/**
 * A finished case (submitted, closed or cancelled) keeps showing what was in force when it
 * finished. Selections point at a record, not at one version of it, so reading live would show
 * today's answers on a case that was sent months ago. The copy taken while the case was open is
 * the only exact record of that moment, so a finished case reads its readiness from it.
 *
 * Which copy:
 *  - A case that was submitted (still submitted, or closed afterwards): the copy the confirmed
 *    submission was made from. It is what was sent whatever happened to the record since.
 *  - A case closed or cancelled without a submission: the latest copy taken before it finished,
 *    but only while the case has not changed since that copy (same revision). A copy that is
 *    already behind the case does not describe how it ended.
 *  - Otherwise nothing is pinned. The caller reads live and says so (`savedCopy: 'NONE'`).
 *
 * Lives apart from `missions.ts` (types only are imported from it, so there is no cycle).
 */

/** The plain line shown beside a finished case that has no copy to read from. */
export const NO_SAVED_COPY = 'No saved copy from when it finished.';

type SavedReadiness = Omit<Readiness, 'savedCopy'>;

const OVERALL_STATES: readonly string[] = [
  'MANUAL_ONLY',
  'NEEDS_ACTION',
  'NEEDS_REVIEW',
  'READY_FOR_APPLICANT_REVIEW',
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The stored readiness of a copy, only when it has every part the screens read. An older copy
 * that lacks one (for example the overall state) is not used, so a screen never meets a
 * half-filled value.
 */
function readStoredReadiness(
  content: unknown,
  packVersionId: string | null,
): SavedReadiness | null {
  if (!isObject(content)) return null;
  const { readiness: stored, packVersion: copiedPack } = content;
  if (!isObject(stored) || !isObject(copiedPack)) return null;
  // The checklist the case uses now must be the one the copy was read against.
  const { id: copiedPackId } = copiedPack;
  if (copiedPackId !== packVersionId) return null;
  const { total, requiredCount, satisfiedRequired, ready, missing, requirementResults } = stored;
  const { overallState } = stored;
  if (
    typeof total !== 'number' ||
    typeof requiredCount !== 'number' ||
    typeof satisfiedRequired !== 'number' ||
    typeof ready !== 'boolean' ||
    !Array.isArray(missing) ||
    !Array.isArray(requirementResults) ||
    typeof overallState !== 'string' ||
    !OVERALL_STATES.includes(overallState)
  ) {
    return null;
  }
  return stored as unknown as SavedReadiness;
}

async function snapshotContent(db: Db, snapshotId: string, missionId: string): Promise<unknown> {
  const [row] = await db
    .select({ content: schema.missionSnapshots.content })
    .from(schema.missionSnapshots)
    .where(
      and(
        eq(schema.missionSnapshots.id, snapshotId),
        eq(schema.missionSnapshots.missionId, missionId),
      ),
    )
    .limit(1);
  return row?.content;
}

/** The readiness a finished case had when it finished, or null when there is no copy to trust. */
export async function savedReadinessForFinishedCase(
  db: Db,
  mission: Mission,
): Promise<SavedReadiness | null> {
  const [submission] = await db
    .select({ snapshotId: schema.missionSubmissions.snapshotId })
    .from(schema.missionSubmissions)
    .where(eq(schema.missionSubmissions.missionId, mission.id))
    .orderBy(desc(schema.missionSubmissions.createdAt))
    .limit(1);
  if (submission) {
    return readStoredReadiness(
      await snapshotContent(db, submission.snapshotId, mission.id),
      mission.packVersionId,
    );
  }
  if (!mission.closedAt) return null;
  const [latest] = await db
    .select({
      content: schema.missionSnapshots.content,
      revision: schema.missionSnapshots.materialRevisionAtCapture,
    })
    .from(schema.missionSnapshots)
    .where(
      and(
        eq(schema.missionSnapshots.missionId, mission.id),
        lte(schema.missionSnapshots.createdAt, mission.closedAt),
      ),
    )
    .orderBy(desc(schema.missionSnapshots.version))
    .limit(1);
  if (!latest || latest.revision !== mission.materialRevision) return null;
  return readStoredReadiness(latest.content, mission.packVersionId);
}
