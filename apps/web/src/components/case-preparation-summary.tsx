import {
  CANONICAL_CASE_STATES,
  LEGACY_ONLY_MISSION_STATES,
  type MissionState,
} from '@visastack/core';
import type { Readiness } from '@visastack/services';
import type { ReactNode } from 'react';
import { componentsMoreCatalog } from '../i18n/components-more';
import { getT } from '../lib/i18n-server';
import { progressRingPercent } from '../lib/readiness-words';
import { NO_REQUIRED_LABEL, NO_REQUIRED_LINE } from './progress-ring';
import { ProgressMeter, StepBar } from './ui-lift';

/**
 * The case's stages with the current one marked. `nextStates` are the stages the page offers as
 * buttons; when cancelling is offered from the page's More menu instead (`cancelInMore`), the line
 * below says so rather than listing it as a next stage. Only the current stage is marked: the page
 * keeps no history of finished stages, so an earlier stage is never ticked.
 */
export async function CaseStageTracker({
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
  const t = await getT(componentsMoreCatalog);
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
      ariaLabel={t('componentsMore.casePreparationSummary.actualCaseWorkflowState')}
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

/** Most urgent first: an unmet group of alternatives is counted under the first state it has. */
const STATE_URGENCY: readonly Readiness['requirementResults'][number]['state'][] = [
  'CRITICAL_GAP',
  'CONFLICTING',
  'EXPIRING_STALE',
  'UNVERIFIED',
  'ATTENTION',
  'SATISFIED',
  'NOT_APPLICABLE',
];

type State = Readiness['requirementResults'][number]['state'];

/** The six counts of Evidence Progress, each an item (a group of alternatives is one item). */
export interface RequirementItemCounts {
  readonly satisfied: number;
  readonly missing: number;
  readonly review: number;
  readonly unknown: number;
  readonly notApplicable: number;
  readonly optionalMissing: number;
}

/**
 * Counts the case's items by state, once, for every place that shows them. A group of alternatives
 * (UMPE P1) is one item however many alternatives it lists: an alternative another member already
 * covers is not counted, and an unmet group counts once, under its most urgent state. Every other
 * requirement counts as itself.
 */
export function countRequirementItems(
  results: readonly Readiness['requirementResults'][number][],
): RequirementItemCounts {
  const itemState = new Map<string, State>();
  for (const r of results) {
    if (r.coveredByAlternative) continue;
    const key = r.groupKey ? `group:${r.groupKey}` : r.packRequirementId;
    const seen = itemState.get(key);
    if (seen === undefined || STATE_URGENCY.indexOf(r.state) < STATE_URGENCY.indexOf(seen)) {
      itemState.set(key, r.state);
    }
  }
  const count = (match: (state: State) => boolean) => [...itemState.values()].filter(match).length;
  return {
    satisfied: count((state) => state === 'SATISFIED'),
    missing: count((state) => state === 'CRITICAL_GAP'),
    review: count((state) => state === 'CONFLICTING' || state === 'EXPIRING_STALE'),
    unknown: count((state) => state === 'UNVERIFIED'),
    notApplicable: count((state) => state === 'NOT_APPLICABLE'),
    optionalMissing: count((state) => state === 'ATTENTION'),
  };
}

/**
 * Evidence Progress: how many required items are on file as one big number and a bar, what that
 * means in a word and a sentence (`children`), the six counts and how it is counted. Exact computed requirement states; no score or probability is invented.
 */
export async function CasePreparationSummary({
  readiness,
  children,
  explain,
}: {
  readonly readiness: Readiness;
  /** The overall state and its sentence, shown right under the bar. */
  readonly children?: ReactNode;
  /** The sentence and the confirmation line, folded with the counts under "How This Is Counted". */
  readonly explain?: ReactNode;
}) {
  const t = await getT(componentsMoreCatalog);
  const counts = countRequirementItems(readiness.requirementResults);
  const { requiredCount, satisfiedRequired } = readiness;
  const unit = 'required items on file';
  const shortUnit = 'required on file';
  return (
    <section
      className="lift-progress"
      aria-label={t('componentsMore.casePreparationSummary.evidencePreparationCompleteness')}
    >
      <h2 className="lift-progress-kicker">
        {t.node('componentsMore.casePreparationSummary.evidenceProgress')}
      </h2>
      {requiredCount > 0 ? (
        <>
          <p className="lift-progress-figure">
            <span className="lift-progress-numeral">
              {t.node('componentsMore.casePreparationSummary.satisfiedrequiredOfRequiredcount', {
                satisfiedRequired,
                requiredCount,
              })}
            </span>
            <span className="lift-progress-unit">{shortUnit}</span>
          </p>
          <ProgressMeter
            value={satisfiedRequired}
            max={requiredCount}
            label={unit}
            valueText={`${progressRingPercent(satisfiedRequired, requiredCount)}%`}
          />
        </>
      ) : (
        <>
          <p className="lift-progress-figure">
            <span className="lift-progress-numeral">{NO_REQUIRED_LABEL}</span>
          </p>
          <p className="lift-progress-empty">{NO_REQUIRED_LINE}</p>
        </>
      )}
      {children}
      <details className="lift-help">
        <summary>{t.node('componentsMore.casePreparationSummary.howThisIsCounted')}</summary>
        <div className="lift-help-body">
          {explain}
          <dl className="lift-counts">
            {(
              [
                ['On File', counts.satisfied],
                ['Missing', counts.missing],
                ['Out of Date or Two Values', counts.review],
                ['To Confirm', counts.unknown],
                ['Not Applicable', counts.notApplicable],
                ['Optional Not Provided', counts.optionalMissing],
              ] as const
            ).map(([label, count]) => (
              <div
                key={label}
                className={count === 0 ? 'lift-count lift-count-zero' : 'lift-count'}
              >
                <dt>{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <p>{t.node('componentsMore.casePreparationSummary.theBarCountsRequiredItemsThat')}</p>
          <p>
            {t.node('componentsMore.casePreparationSummary.completenessIsNotAnApprovalProbability')}
          </p>
          <p>
            {t.node('componentsMore.casePreparationSummary.readinessIsCompletenessOnlyNeverAn')}
          </p>
        </div>
      </details>
    </section>
  );
}
