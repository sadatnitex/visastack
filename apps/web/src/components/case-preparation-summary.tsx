import {
  CANONICAL_CASE_STATES,
  LEGACY_ONLY_MISSION_STATES,
  type MissionState,
} from '@visastack/core';
import type { Readiness } from '@visastack/services';
import { progressRingPercent } from '../lib/readiness-words';
import { NO_REQUIRED_LABEL, NO_REQUIRED_LINE, ProgressRing } from './progress-ring';

/**
 * The case's stages with the current one marked. `nextStates` are the stages the page offers as
 * buttons; when cancelling is offered from the page's More menu instead (`cancelInMore`), the line
 * below says so rather than listing it as a next stage.
 */
export function CaseStageTracker({
  state,
  labels,
  nextStates,
  cancelInMore = false,
}: {
  readonly state: MissionState;
  readonly labels: Readonly<Record<string, string>>;
  readonly nextStates: readonly MissionState[];
  readonly cancelInMore?: boolean;
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
  return (
    <section className="case-stage-region" aria-label="Actual case workflow state">
      <ol className="case-stage-tracker">
        {stages.map((stage) => (
          <li key={stage} aria-current={stage === state ? 'step' : undefined}>
            <span className="case-stage-marker" aria-hidden="true" />
            <span>{labels[stage] ?? stage}</span>
          </li>
        ))}
      </ol>
      <p className="muted">
        Only the current state is marked. This is not a completed-stage history.{' '}
        {nextStates.length
          ? `The workflow allows ${nextStates.map((stage) => labels[stage] ?? stage).join(', ')} next; permissions and traveller confirmation are checked by the existing actions.${cancelLine}`
          : cancelInMore
            ? `There is no further stage from here.${cancelLine}`
            : 'This case is in a terminal state.'}
      </p>
    </section>
  );
}

/** Exact computed requirement states; no score or probability is invented. */
export function CasePreparationSummary({
  readiness,
  acknowledged,
}: {
  readonly readiness: Readiness;
  readonly acknowledged: boolean;
}) {
  // A group of alternatives (UMPE P1) is one item however many alternatives it lists, so each
  // state counts a group once; every other requirement counts as itself, exactly as before.
  const count = (match: (state: Readiness['requirementResults'][number]['state']) => boolean) =>
    new Set(
      readiness.requirementResults
        .filter((r) => match(r.state))
        .map((r) => (r.groupKey ? `group:${r.groupKey}` : r.packRequirementId)),
    ).size;
  const counts = {
    satisfied: count((state) => state === 'SATISFIED'),
    missing: count((state) => state === 'CRITICAL_GAP'),
    review: count((state) => state === 'CONFLICTING' || state === 'EXPIRING_STALE'),
    unknown: count((state) => state === 'UNVERIFIED'),
    notApplicable: count((state) => state === 'NOT_APPLICABLE'),
    optionalMissing: count((state) => state === 'ATTENTION'),
  };
  const progress =
    readiness.requiredCount > 0
      ? progressRingPercent(readiness.satisfiedRequired, readiness.requiredCount)
      : null;
  return (
    <section className="case-preparation-summary" aria-label="Evidence preparation completeness">
      <div className="case-preparation-ring">
        <ProgressRing
          size="lg"
          done={readiness.satisfiedRequired}
          total={readiness.requiredCount}
          centre={progress === null ? 'N/A' : `${progress}%`}
          emptyLabel={NO_REQUIRED_LABEL}
          emptyLine={NO_REQUIRED_LINE}
        />
      </div>
      <div className="case-preparation-counts">
        <h2>Evidence Progress</h2>
        <p className="muted">
          The ring counts required items that are on file. Optional and non-applicable items are
          counted separately.
        </p>
        <dl>
          {(
            [
              ['On file', counts.satisfied],
              ['Missing required', counts.missing],
              ['Needs Review', counts.review],
              ['Unknown applicability', counts.unknown],
              ['Not applicable', counts.notApplicable],
              ['Optional not provided', counts.optionalMissing],
            ] as const
          ).map(([label, count]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
        <p className="case-confirmation-state">
          <strong>Traveller confirmation: </strong>
          {acknowledged ? 'Current snapshot confirmed' : 'Awaiting confirmation'}
        </p>
        <p className="muted">
          Completeness is not an approval probability. Review each requirement below.
        </p>
      </div>
    </section>
  );
}
