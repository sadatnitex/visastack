import type { Readiness } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CasePreparationSummary,
  CaseStageTracker,
  countRequirementItems,
} from './case-preparation-summary';
const readiness: Readiness = {
  total: 7,
  requiredCount: 4,
  satisfiedRequired: 1,
  missing: [],
  ready: false,
  overallState: 'NEEDS_ACTION',
  requirementResults: [
    'SATISFIED',
    'CRITICAL_GAP',
    'CONFLICTING',
    'EXPIRING_STALE',
    'UNVERIFIED',
    'NOT_APPLICABLE',
    'ATTENTION',
  ].map((state, index) => ({
    packRequirementId: String(index),
    kind: 'DOCUMENT',
    key: String(index),
    optional: index > 3,
    state: state as Readiness['requirementResults'][number]['state'],
  })),
};
describe('case progress represents preparation and actual workflow state', () => {
  it('uses required-item completeness and distinguishes recorded evidence states', () => {
    const html = renderToStaticMarkup(<CasePreparationSummary readiness={readiness} />);
    // One big number and a bar named in words; the number is the count, never a score.
    expect(html).toContain('1 of 4');
    expect(html).toContain('aria-label="1 of 4 required items on file"');
    expect(html).toContain('25%');
    for (const text of [
      'On File',
      'Missing',
      'Out of Date or Two Values',
      'To Confirm',
      'Not Applicable',
      'Optional Not Provided',
      'How This Is Counted',
      'The bar counts required items that are on file.',
      'not an approval probability',
    ])
      expect(html).toContain(text);
    expect(html).toContain('<dt>Out of Date or Two Values</dt><dd>2</dd>');
    expect(html).toContain('<dt>Not Applicable</dt><dd>1</dd>');
    // The ring is gone from the case page.
    expect(html).not.toContain('progress-ring');
  });

  it('counts each state once for every place that shows the numbers', () => {
    const counts = countRequirementItems(readiness.requirementResults);
    expect(counts).toEqual({
      satisfied: 1,
      missing: 1,
      review: 2,
      unknown: 1,
      notApplicable: 1,
      optionalMissing: 1,
    });
    // What the Next Step calls "to fix" is the missing and the out-of-date or two-valued items.
    expect(counts.missing + counts.review).toBe(3);
  });
  it('UMPE P1: counts a group of alternatives once, and never a covered alternative', () => {
    const row = (
      id: string,
      state: Readiness['requirementResults'][number]['state'],
      extra: Partial<Readiness['requirementResults'][number]> = {},
    ): Readiness['requirementResults'][number] => ({
      packRequirementId: id,
      kind: 'DOCUMENT',
      key: id,
      optional: false,
      state,
      ...extra,
    });
    const html = renderToStaticMarkup(
      <CasePreparationSummary
        readiness={{
          ...readiness,
          requirementResults: [
            // Met: one alternative on file, the other covered by it.
            row('a1', 'SATISFIED', { groupKey: 'funds' }),
            row('a2', 'ATTENTION', {
              groupKey: 'funds',
              optional: true,
              coveredByAlternative: true,
            }),
            // Unmet: counted once, under its most urgent state.
            row('b1', 'CRITICAL_GAP', { groupKey: 'id' }),
            row('b2', 'UNVERIFIED', { groupKey: 'id' }),
          ],
        }}
      />,
    );
    expect(html).toContain('<dt>Missing</dt><dd>1</dd>');
    expect(html).toContain('<dt>To Confirm</dt><dd>0</dd>');
    expect(html).toContain('<dt>Optional Not Provided</dt><dd>0</dd>');
  });
  it('does not claim 100 percent when no required items exist', () => {
    const html = renderToStaticMarkup(
      <CasePreparationSummary
        readiness={{ ...readiness, requiredCount: 0, satisfiedRequired: 0 }}
      />,
    );
    expect(html).toContain('No required items');
    expect(html).toContain('This checklist has no required items to count.');
    expect(html).not.toContain('100%');
    expect(html).not.toContain('0 of 0');
  });
  it('marks only the actual legacy state and retains the real permitted-next description', () => {
    const html = renderToStaticMarkup(
      <CaseStageTracker
        state="UNDER_REVIEW"
        labels={{
          UNDER_REVIEW: 'Under Review',
          IN_PROGRESS: 'In Progress',
          READY_TO_EXPORT: 'Ready to Export',
          CANCELLED: 'Cancelled',
        }}
        nextStates={['READY_TO_EXPORT', 'IN_PROGRESS', 'CANCELLED']}
      />,
    );
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('aria-current="step"><span>Under Review</span>');
    // Where the case is, in words; the numbers on the steps come from the stylesheet, not the text.
    expect(html).toMatch(/Stage \d+ of \d+/);
    expect(html).toContain('About Stages');
    // Cancelling is not a step along the way: it sits apart at the end.
    expect(html).toMatch(/lift-step-apart[^>]*><span>Cancelled<\/span>/);
    expect(html).not.toMatch(/<li[^>]*>\d/);
    expect(html).toContain('Ready to Export, In Progress, Cancelled next');
    expect(html).toContain('not a completed-stage history');
    expect(html).not.toContain('<button');
  });

  it('lists only the stage buttons as next steps and points to More for cancelling', () => {
    const html = renderToStaticMarkup(
      <CaseStageTracker
        state="UNDER_REVIEW"
        labels={{ READY_TO_EXPORT: 'Ready to Export', CANCELLED: 'Cancelled' }}
        nextStates={['READY_TO_EXPORT']}
        cancelInMore
      />,
    );
    const line = html.slice(html.indexOf('<div class="lift-help-body">'));
    expect(line).toContain('allows Ready to Export next;');
    expect(line).not.toContain('Cancelled');
    expect(html).toContain('To stop the case, use More at the top of the page.');
    const last = renderToStaticMarkup(
      <CaseStageTracker state="SUBMITTED" labels={{}} nextStates={[]} cancelInMore />,
    );
    expect(last).toContain('There is no further stage from here.');
    expect(last).not.toContain('terminal state');
  });
});
