import { summarizeCaseTriage } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';
import { caseTriageView } from './case-triage';
import { CaseTriageSummary } from './case-triage-summary';

const view = (
  overrides: Partial<Parameters<typeof summarizeCaseTriage>[0]> = {},
  requestsIncluded = true,
) =>
  caseTriageView(
    summarizeCaseTriage({
      missionId: 'm1',
      manualMode: false,
      readiness: {
        overallState: 'READY_FOR_APPLICANT_REVIEW',
        requirementResults: [
          {
            packRequirementId: 'q1',
            kind: 'DOCUMENT',
            key: 'PASSPORT',
            optional: true,
            state: 'SATISFIED',
          },
        ],
      },
      decisions: [{ packRequirementId: 'q1', outcome: 'ACCEPTED', createdAt: '2026-10-01' }],
      requests: [],
      ...overrides,
    }),
    { requirementLabels: new Map([['q1', 'Passport']]), requestsIncluded },
  );

describe('where a case stands', () => {
  it('shows the case line, then each group that holds something with its items and notes', async () => {
    const html = await renderServer(<CaseTriageSummary view={view()} headingId="triage-m1" />);
    expect(html).toContain('aria-labelledby="triage-m1"');
    expect(html).toContain('<h3 class="case-triage-title" id="triage-m1">');
    const text = textOf(html);
    expect(text).toContain('Where Things Stand Ready for Review');
    expect(text).toContain('Reviewed 1 Passport Optional');
    expect(text).not.toContain('Missing');
    expect(text).not.toContain('shown to agency administrators');
  });

  it('says plainly when nothing has been asked for, and when requests are left out for this viewer', async () => {
    const empty = view({ readiness: null }, false);
    const text = textOf(await renderServer(<CaseTriageSummary view={empty} headingId="t" />));
    expect(text).toContain('No Checklist Attached');
    expect(text).toContain('Nothing has been asked for or checked yet.');
    expect(text).toContain('Items asked of the traveller are shown to agency administrators.');
  });
});
