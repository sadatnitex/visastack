import type { OverallReadinessState, Readiness } from './missions';

/**
 * A finished case (submitted, closed or cancelled) keeps showing what was in force when it
 * finished. Selections point at a record, not at one version of it, so reading live would show
 * today's answers on a case that was sent months ago. The copy taken while the case was open is
 * the only exact record of that moment, so a finished case reads its readiness from it.
 *
 * Which copy (chosen in `missions.ts`, next to the queries):
 *  - A case that was submitted (still submitted, or closed afterwards): the copy the confirmed
 *    submission was made from. It is what was sent whatever happened to the record since.
 *  - A case closed or cancelled without a submission: the latest copy taken before it finished,
 *    but only while the case has not changed since that copy (same revision). A copy that is
 *    already behind the case does not describe how it ended.
 *  - Otherwise nothing is pinned. The caller reads live and says so (`savedCopy: 'NONE'`).
 *
 * This file holds only the pure part (reading a stored value safely) and the plain line. It reads
 * no table, so it stays outside the applicant-data access ratchet. Types only are imported from
 * `missions.ts`, so there is no cycle.
 */

/** The plain line shown beside a finished case that has no copy to read from. */
export const NO_SAVED_COPY = 'No saved copy from when it finished.';

/** A stored readiness: everything `Readiness` holds except the marker added when it is read. */
export type SavedReadiness = Omit<Readiness, 'savedCopy'>;

/** Written as a record so adding a state to the union without adding it here fails to compile. */
const OVERALL_STATES: Readonly<Record<OverallReadinessState, true>> = {
  MANUAL_ONLY: true,
  NEEDS_ACTION: true,
  NEEDS_REVIEW: true,
  READY_FOR_APPLICANT_REVIEW: true,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The readiness stored in a copy, only when it has every part the screens read and was read
 * against the checklist the case uses now. An older copy that lacks a part (for example the
 * overall state) is not used, so a screen never meets a half-filled value.
 */
export function readStoredReadiness(
  stored: unknown,
  copiedPackVersionId: unknown,
  packVersionId: string | null,
): SavedReadiness | null {
  if (!isObject(stored) || copiedPackVersionId !== packVersionId) return null;
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
    !Object.hasOwn(OVERALL_STATES, overallState)
  ) {
    return null;
  }
  return stored as unknown as SavedReadiness;
}
