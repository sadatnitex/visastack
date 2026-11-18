import type { MissionState } from '@visastack/core';
import { caseStagePath, caseStagePosition } from './case-stage-path';
import { JourneyTrack } from './journey-track';
import { StepBar } from './ui-lift';

/**
 * The case's stages with the current one marked. `nextStates` are the stages the page offers as
 * buttons; when cancelling is offered from the page's More menu instead (`cancelInMore`), the line
 * below says so rather than listing it as a next stage. Only the current stage is marked: the page
 * keeps no history of finished stages, so an earlier stage is never ticked. With `journey` the
 * picture track above it also marks only the current stage (earlier ones are plain "Before").
 */
export function CaseStageTrackerView({
  state,
  labels,
  nextStates,
  cancelInMore = false,
  ariaLabel,
  journey = false,
}: {
  readonly state: MissionState;
  readonly labels: Readonly<Record<string, string>>;
  readonly nextStates: readonly MissionState[];
  readonly cancelInMore?: boolean;
  /** Already translated by the caller, so this view stays a plain component that also mounts in the browser. */
  readonly ariaLabel: string;
  /** Draws the picture track above the step bar. Off by default, so existing pages are unchanged. */
  readonly journey?: boolean;
}) {
  const cancelLine = cancelInMore ? ' To stop the case, use More at the top of the page.' : '';
  const named = (stage: MissionState) => ({
    label: labels[stage] ?? stage,
    current: stage === state,
  });
  // Cancelling is not a step along the way: it is shown apart, at the end.
  const { path, apart } = caseStagePath(state);
  const at = path.indexOf(state);
  const bar = (
    <StepBar
      ariaLabel={ariaLabel}
      steps={path.map(named)}
      apart={apart.map(named)}
      position={caseStagePosition(path, state)}
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
  if (!journey || at < 0) return bar;
  return (
    <>
      <JourneyTrack
        state={state}
        labels={labels}
        stages={path}
        ariaLabel={`${ariaLabel}: journey`}
      />
      {bar}
    </>
  );
}
