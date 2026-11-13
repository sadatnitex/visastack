import {
  CANONICAL_CASE_STATES,
  LEGACY_ONLY_MISSION_STATES,
  type MissionState,
} from '@visastack/core';
import { StepBar } from './ui-lift';

/**
 * The case's stages with the current one marked. `nextStates` are the stages the page offers as
 * buttons; when cancelling is offered from the page's More menu instead (`cancelInMore`), the line
 * below says so rather than listing it as a next stage. Only the current stage is marked: the page
 * keeps no history of finished stages, so an earlier stage is never ticked.
 */
export function CaseStageTrackerView({
  state,
  labels,
  nextStates,
  cancelInMore = false,
  ariaLabel,
}: {
  readonly state: MissionState;
  readonly labels: Readonly<Record<string, string>>;
  readonly nextStates: readonly MissionState[];
  readonly cancelInMore?: boolean;
  /** Already translated by the caller, so this view stays a plain component that also mounts in the browser. */
  readonly ariaLabel: string;
}) {
  const cancelLine = cancelInMore ? ' To stop the case, use More at the top of the page.' : '';
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
  const named = (stage: MissionState) => ({
    label: labels[stage] ?? stage,
    current: stage === state,
  });
  // Cancelling is not a step along the way: it is shown apart, at the end.
  const path: readonly MissionState[] = stages.filter((stage) => stage !== 'CANCELLED');
  const apart = stages.filter((stage) => stage === 'CANCELLED');
  const at = path.indexOf(state);
  return (
    <StepBar
      ariaLabel={ariaLabel}
      steps={path.map(named)}
      apart={apart.map(named)}
      position={at >= 0 ? `Stage ${at + 1} of ${path.length}` : 'This case was cancelled'}
      help={{
        summary: 'About Stages',
        children: (
          <p>
            Only the current state is marked. This is not a completed-stage history.{' '}
            {nextStates.length
              ? `The workflow allows ${nextStates.map((stage) => labels[stage] ?? stage).join(', ')} next; permissions and traveller confirmation are checked by the existing actions.${cancelLine}`
              : cancelInMore
                ? `There is no further stage from here.${cancelLine}`
                : 'This case is in a terminal state.'}
          </p>
        ),
      }}
    />
  );
}
