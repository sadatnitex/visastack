import {
  CANONICAL_CASE_STATES,
  LEGACY_ONLY_MISSION_STATES,
  type MissionState,
} from '@visastack/core';

/**
 * The compact stage line of the case status panel (WP-WALD3): the Now line, the position in words
 * and the strip of segments, for a person who has not opened more detail. It reads the same stage
 * path as the step bar (`CaseStageTrackerView`) so the words never differ, and it carries no list
 * and no `aria-current`: the step bar below keeps those for Browse and Everything. Only the
 * current stage is named. Both lines carry a label class: they are a stage name and a position,
 * not sentences, so they do not count toward the 30 words of explanation. Nothing earlier is called done, because the page keeps no stage history.
 */
export function stagePath(state: MissionState): readonly MissionState[] {
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
  // Cancelling is not a step along the way, so it is not part of the path.
  return stages.filter((stage) => stage !== 'CANCELLED');
}

export function CaseStageGlance({
  state,
  labels,
}: {
  readonly state: MissionState;
  readonly labels: Readonly<Record<string, string>>;
}) {
  const path = stagePath(state);
  const at = path.indexOf(state);
  return (
    <>
      <p className="lift-steps-now lift-glance-label">Now: {labels[state] ?? state}</p>
      <p className="lift-steps-position lift-glance-label">
        {at >= 0 ? `Stage ${at + 1} of ${path.length}` : 'This case was cancelled'}
      </p>
      {at >= 0 ? (
        <div className="lift-steps-strip" aria-hidden="true">
          {path.map((stage) => (
            <span
              key={stage}
              className={`lift-strip-part${stage === state ? ' lift-strip-part-current' : ''}`}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
