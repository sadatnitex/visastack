import {
  CANONICAL_CASE_STATES,
  LEGACY_ONLY_MISSION_STATES,
  type MissionState,
} from '@visastack/core';
import type { Readiness } from '@visastack/services';

export function CaseStageTracker({
  state,
  labels,
  nextStates,
}: {
  readonly state: MissionState;
  readonly labels: Readonly<Record<string, string>>;
  readonly nextStates: readonly MissionState[];
}) {
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
          ? `The workflow allows ${nextStates.map((stage) => labels[stage] ?? stage).join(', ')} next; permissions and applicant confirmation are checked by the existing actions.`
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
  const counts = {
    satisfied: readiness.requirementResults.filter((r) => r.state === 'SATISFIED').length,
    missing: readiness.requirementResults.filter((r) => r.state === 'CRITICAL_GAP').length,
    review: readiness.requirementResults.filter(
      (r) => r.state === 'CONFLICTING' || r.state === 'EXPIRING_STALE',
    ).length,
    unknown: readiness.requirementResults.filter((r) => r.state === 'UNVERIFIED').length,
    notApplicable: readiness.requirementResults.filter((r) => r.state === 'NOT_APPLICABLE').length,
    optionalMissing: readiness.requirementResults.filter((r) => r.state === 'ATTENTION').length,
  };
  const progress =
    readiness.requiredCount > 0
      ? Math.round((readiness.satisfiedRequired / readiness.requiredCount) * 100)
      : null;
  return (
    <section className="case-preparation-summary" aria-label="Evidence preparation completeness">
      <div className="case-preparation-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <path
            d="M60 10 a50 50 0 1 1 0 100 a50 50 0 1 1 0 -100"
            fill="none"
            stroke="var(--hairline-soft)"
            strokeWidth="9"
          />
          {progress !== null ? (
            <path
              d="M60 10 a50 50 0 1 1 0 100 a50 50 0 1 1 0 -100"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="9"
              pathLength="100"
              strokeDasharray={`${progress} ${100 - progress}`}
            />
          ) : null}
        </svg>
        <div>
          <strong>{progress === null ? 'N/A' : `${progress}%`}</strong>
          <span>Required items on file</span>
        </div>
      </div>
      <div className="case-preparation-counts">
        <h3>Preparation status</h3>
        <p className="muted">
          {readiness.satisfiedRequired} of {readiness.requiredCount} required items are satisfied.
          Counts below include optional items and keep non-applicable items separate.
        </p>
        <dl>
          {(
            [
              ['On file', counts.satisfied],
              ['Missing required', counts.missing],
              ['Needs review', counts.review],
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
          <strong>Applicant confirmation: </strong>
          {acknowledged ? 'Current snapshot confirmed' : 'Awaiting confirmation'}
        </p>
        <p className="muted">
          Completeness is not an approval probability. Review the source, applicability and
          assurance of each requirement below.
        </p>
      </div>
    </section>
  );
}
