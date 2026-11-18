import {
  CANONICAL_CASE_STATES,
  LEGACY_ONLY_MISSION_STATES,
  type MissionState,
} from '@visastack/core';

/**
 * The stages a case is shown along, in order, for the stage bar and for the compact stage line.
 * One place decides them, so the two never disagree. A case in a legacy-only stage gets the legacy
 * path. Cancelling is not a step along the way: it is returned apart, at the end.
 */
export function caseStagePath(state: MissionState): {
  readonly path: readonly MissionState[];
  readonly apart: readonly MissionState[];
} {
  const legacy = (LEGACY_ONLY_MISSION_STATES as readonly string[]).includes(state);
  const stages: readonly MissionState[] = legacy
    ? [
        'DRAFT',
        ...LEGACY_ONLY_MISSION_STATES,
        'SUBMISSION_READY',
        'SUBMITTED',
        'CLOSED',
        'CANCELLED',
      ]
    : CANONICAL_CASE_STATES;
  return {
    path: stages.filter((stage) => stage !== 'CANCELLED'),
    apart: stages.filter((stage) => stage === 'CANCELLED'),
  };
}

/** Where the case is, in words: "Stage 2 of 7", or that it was cancelled. */
export function caseStagePosition(path: readonly MissionState[], state: MissionState): string {
  const at = path.indexOf(state);
  return at >= 0 ? `Stage ${at + 1} of ${path.length}` : 'This case was cancelled';
}
