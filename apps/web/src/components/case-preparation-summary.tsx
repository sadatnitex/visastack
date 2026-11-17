import { necessityCanBlock, requirementNecessity } from '@visastack/core';
import type { Readiness } from '@visastack/services';
import type { ComponentProps, ReactNode } from 'react';
import { componentsMoreCatalog } from '../i18n/components-more';
import { humanizeCode } from '../lib/format-code';
import { getT } from '../lib/i18n-server';
import { documentKindLabel } from '../lib/item-names';
import { fieldLabel } from '../lib/master-profile';
import { CaseStageTrackerView } from './case-stage-tracker-view';
import { NO_REQUIRED_LABEL, NO_REQUIRED_LINE } from './progress-ring';
import { type ReadinessSegmentItem, ReadinessSegmentRing } from './readiness-segments';

/**
 * The case's stages with the current one marked. `nextStates` are the stages the page offers as
 * buttons; when cancelling is offered from the page's More menu instead (`cancelInMore`), the line
 * below says so rather than listing it as a next stage. Only the current stage is marked: the page
 * keeps no history of finished stages, so an earlier stage is never ticked.
 */
export async function CaseStageTracker(
  props: Omit<ComponentProps<typeof CaseStageTrackerView>, 'ariaLabel'>,
) {
  const t = await getT(componentsMoreCatalog);
  return (
    <CaseStageTrackerView
      {...props}
      ariaLabel={t('componentsMore.casePreparationSummary.actualCaseWorkflowState')}
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
 * One legend entry per required item, from the results the page already holds (no new read),
 * counted exactly as `computeLiveReadiness` counts `requiredCount`: an item that does not apply
 * (state Not Applicable, or a group none of whose members applies) is skipped, a single item is
 * required when its necessity can block, and a group is one item that is required when any
 * applicable member can block. A covered alternative is not an item of its own. Names come from the
 * same helpers the checklist uses. When the page's counts and this list ever disagree, the ring
 * draws the counts alone (see `filledMask`).
 */
export function segmentItemsFromResults(
  results: readonly Readiness['requirementResults'][number][],
): ReadinessSegmentItem[] {
  const items = new Map<string, ReadinessSegmentItem & { required: boolean }>();
  for (const r of results) {
    if (r.state === 'NOT_APPLICABLE') continue;
    const key = r.groupKey ? `group:${r.groupKey}` : r.packRequirementId;
    const blocks = necessityCanBlock(
      requirementNecessity({ optional: r.optional, necessity: r.necessity ?? null }),
    );
    const seen = items.get(key);
    const ready = r.state === 'SATISFIED';
    if (seen) {
      items.set(key, {
        ...seen,
        ready: seen.ready || ready,
        required: seen.required || blocks,
      });
      continue;
    }
    if (r.coveredByAlternative) continue;
    items.set(key, {
      key,
      label:
        r.kind === 'FIELD' ? (fieldLabel(r.key) ?? humanizeCode(r.key)) : documentKindLabel(r.key),
      type: r.kind === 'DOCUMENT' ? r.key : null,
      ready,
      required: blocks,
    });
  }
  return [...items.values()]
    .filter((item) => item.required)
    .map(({ key, label, type, ready }) => ({ key, label, type, ready }));
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
          <div className="lift-progress-row">
            <p className="lift-progress-figure">
              <span className="lift-progress-numeral">
                {t.node('componentsMore.casePreparationSummary.satisfiedrequiredOfRequiredcount', {
                  satisfiedRequired,
                  requiredCount,
                })}
              </span>
              <span className="lift-progress-unit">{shortUnit}</span>
            </p>
            {/* The ring always shows; its legend sits in a closed fold from Browse, so it adds one row at most. The count beside it carries the words. */}
            <div className="lift-progress-ring">
              <ReadinessSegmentRing
                done={satisfiedRequired}
                total={requiredCount}
                size="sm"
                items={segmentItemsFromResults(readiness.requirementResults)}
                foldedLegend
                decorative
              />
            </div>
          </div>
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
