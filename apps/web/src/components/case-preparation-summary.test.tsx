import type { Readiness } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CasePreparationSummary, CaseStageTracker } from './case-preparation-summary';
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
  it('uses required-item completeness and distinguishes recorded evidence states and applicant confirmation', () => {
    const html = renderToStaticMarkup(
      <CasePreparationSummary readiness={readiness} acknowledged={false} />,
    );
    expect(html).toContain('25%');
    for (const text of [
      'Missing required',
      'Needs Review',
      'Unknown applicability',
      'Not applicable',
      'Optional not provided',
      'Awaiting confirmation',
      'not an approval probability',
    ])
      expect(html).toContain(text);
    expect(html).toContain('<dt>Needs Review</dt><dd>2</dd>');
    expect(html).toContain('<dt>Not applicable</dt><dd>1</dd>');
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
        acknowledged={false}
      />,
    );
    expect(html).toContain('<dt>Missing required</dt><dd>1</dd>');
    expect(html).toContain('<dt>Unknown applicability</dt><dd>0</dd>');
    expect(html).toContain('<dt>Optional not provided</dt><dd>0</dd>');
  });
  it('does not claim 100 percent when no required items exist', () => {
    const html = renderToStaticMarkup(
      <CasePreparationSummary
        readiness={{ ...readiness, requiredCount: 0, satisfiedRequired: 0 }}
        acknowledged
      />,
    );
    expect(html).toContain('N/A');
    expect(html).not.toContain('100%');
    expect(html).toContain('Current snapshot confirmed');
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
    expect(html).toContain(
      'aria-current="step"><span class="case-stage-marker" aria-hidden="true"></span><span>Under Review',
    );
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
    const line = html.slice(html.indexOf('<p class="muted">'));
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
