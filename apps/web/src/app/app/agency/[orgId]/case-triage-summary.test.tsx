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

describe('one colour per group (WP-V4 colour polish)', () => {
  it('colours each group by the same family the traveller sees, and never uses danger for a group', async () => {
    const mixed = view({
      readiness: {
        overallState: 'NOT_READY',
        requirementResults: [
          {
            packRequirementId: 'q1',
            kind: 'DOCUMENT',
            key: 'PASSPORT',
            optional: false,
            state: 'SATISFIED',
          },
          {
            packRequirementId: 'q2',
            kind: 'DOCUMENT',
            key: 'BANK_STATEMENT',
            optional: false,
            state: 'CRITICAL_GAP',
          },
          {
            packRequirementId: 'q3',
            kind: 'DOCUMENT',
            key: 'PHOTO',
            optional: false,
            state: 'CONFLICTING',
          },
          {
            packRequirementId: 'q4',
            kind: 'DOCUMENT',
            key: 'INSURANCE',
            optional: false,
            state: 'SATISFIED',
          },
        ],
      },
      decisions: [{ packRequirementId: 'q1', outcome: 'ACCEPTED', createdAt: '2026-10-01' }],
    });
    const html = await renderServer(<CaseTriageSummary view={mixed} headingId="t" />);
    const pairs = [
      ...html.matchAll(/case-triage-group-(\w+)"><p class="case-triage-group-name">([^<]+)/g),
    ].map((m) => [m[2]?.trim(), m[1]]);
    expect(pairs).toEqual([
      ['Missing', 'warning'],
      ['Received or Awaiting Confirmation', 'neutral'],
      ['Needs Correction or Clarification', 'warning'],
      ['Reviewed', 'success'],
    ]);
    expect(html).not.toContain('case-triage-group-danger');
  });
});

describe('where a case stands, for someone who cannot see requests (WP-V4 review)', () => {
  it('calls a complete checklist Checklist Complete, never Ready for Review', async () => {
    const member = view({}, false);
    expect(member.state).toBe('READY_FOR_REVIEW');
    expect(member.stateLabel).toBe('Checklist Complete');
    const text = textOf(await renderServer(<CaseTriageSummary view={member} headingId="t" />));
    expect(text).toContain('Checklist Complete');
    expect(text).not.toContain('Ready for Review');
    expect(view({}, true).stateLabel).toBe('Ready for Review');
  });

  it('uses the answered file state, so an unsafe newer version is never Received', () => {
    const triage = view({
      readiness: {
        overallState: 'READY_FOR_APPLICANT_REVIEW',
        requirementResults: [
          {
            packRequirementId: 'q1',
            kind: 'DOCUMENT',
            key: 'PASSPORT',
            optional: false,
            state: 'SATISFIED',
          },
        ],
      },
      decisions: [],
      requests: [
        {
          id: 'r1',
          missionId: 'm1',
          packRequirementId: 'q1',
          kind: 'DOCUMENT',
          fieldKey: null,
          docType: 'PASSPORT',
          status: 'RECEIVED',
          dueDate: null,
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      documentStates: new Map([
        ['r1', { processingStatus: 'NEEDS_ATTENTION', safetyStatus: 'QUARANTINED' } as const],
      ]),
    });
    expect(triage.groups.map((g) => [g.group, g.items[0]?.notes])).toEqual([
      ['NEEDS_CORRECTION', ['Could Not Be Used']],
    ]);
    expect(triage.state).toBe('NOT_READY');
  });
});
