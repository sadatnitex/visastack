import type { MissionState } from '@visastack/core';
import { caseStagePath, caseStagePosition } from '../../../../components/case-stage-path';

/**
 * The compact stage line of the case status panel (WP-WALD3): the Now line, the position in words
 * and the strip of segments, for a person who has not opened more detail. It reads the same stage
 * path and position words as the step bar (`caseStagePath`), and it carries no list and no
 * `aria-current`: the step bar below keeps those for Browse and Everything. Only the current stage
 * is named. Nothing earlier is called done, because the page keeps no stage history. Both lines
 * carry the label class (`lift-glance-label`), as they are a stage name and a position, not
 * sentences.
 */
export function CaseStageGlance({
  state,
  labels,
}: {
  readonly state: MissionState;
  readonly labels: Readonly<Record<string, string>>;
}) {
  const { path } = caseStagePath(state);
  const at = path.indexOf(state);
  return (
    <>
      <p className="lift-steps-now lift-glance-label">Now: {labels[state] ?? state}</p>
      <p className="lift-steps-position lift-glance-label">{caseStagePosition(path, state)}</p>
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
