import type { FieldInsightsReport } from '@visastack/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDateOnly } from '../../../../lib/format-date';
import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ staffPrincipal: vi.fn(), getFieldInsights: vi.fn() }));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'quality@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: (...args: unknown[]) => mocks.staffPrincipal(...args),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getFieldInsights: (...args: unknown[]) => mocks.getFieldInsights(...args),
}));

const { default: Page } = await import('./page');

const shown = (value: number) => ({ shown: true as const, value });
const hidden = { shown: false as const, reason: 'SMALL' as const };

const report: FieldInsightsReport = {
  generatedAt: '2026-11-03T06:00:00.000Z',
  periodMonths: 12,
  from: '2025-11-03',
  thresholds: { minCell: 10, minPeople: 5, maxShare: 0.7 },
  funnel: [
    { key: 'SUBMITTED_TO_AGENCY', unit: 'AGENCY_SUBMISSIONS', cell: shown(14) },
    { key: 'ACCEPTED_BY_AGENCY', unit: 'AGENCY_SUBMISSIONS', cell: shown(11) },
    { key: 'REPORTED_TO_AUTHORITY', unit: 'ATTEMPTS', cell: shown(22) },
    { key: 'APPROVAL_RECORDED', unit: 'ATTEMPTS', cell: shown(12) },
    { key: 'UNKNOWN', unit: 'ATTEMPTS', cell: shown(10) },
    { key: 'REFUSAL_RECORDED', unit: 'ATTEMPTS', cell: hidden },
  ],
  missingOutcome: { reported: shown(22), unknown: shown(10), pending: shown(0) },
  byRouteAndPeriod: [
    {
      route: null,
      period: '2026-Q4',
      attempts: shown(22),
    },
  ],
  authorityRequests: {
    total: shown(12),
    bySource: [{ source: 'EMBASSY_OR_CONSULATE', cell: shown(12) }],
    byDocType: [{ docType: 'BANK_STATEMENT', cell: shown(12) }],
  },
  correctionCauses: {
    checklistSuggestions: [{ category: 'OUTDATED', cell: hidden }],
    agencyCorrectionRequests: shown(0),
  },
  coverageGaps: {
    requestsCompared: shown(12),
    requestsWithoutChecklist: shown(0),
    byDocType: [{ docType: 'BANK_STATEMENT', cell: shown(12) }],
  },
  dataQuality: {
    olderReportsNotAttempts: shown(0),
    attemptsWithoutPackageRecord: hidden,
    caseDecisionsNotTiedToAttempt: shown(0),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: { kind: 'staff' } });
  mocks.getFieldInsights.mockResolvedValue({ ok: true, value: report });
});

describe('Field Insights', () => {
  it('asks for the existing quality permission and labels every pattern as observed', async () => {
    const html = await renderServer(Page({ searchParams: Promise.resolve({ period: '6' }) }));
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('FEEDBACK_VIEW');
    expect(mocks.getFieldInsights.mock.calls[0]?.[2]).toEqual({ periodMonths: 6 });
    const text = textOf(html);
    expect(text).toContain('Observed in VisaStack Cases');
    expect(text).toContain('Accepted by Agency (Not a Visa Decision)');
    expect(text).toContain('Reported as Submitted to Authority');
    expect(text).toContain('Hidden');
    expect(text).not.toMatch(/Mostly One Agency|Small Group|Protects Another/);
    expect(text).toContain('Bank Statement');
    // Disclaimers say what this is not; nothing claims a rate, a chance or an official rule.
    expect(text).not.toMatch(
      /success rate|approval probability|chance of|likely to be|raises your/i,
    );
    expect(text).not.toContain('Official Requirement');
  });

  it('shows the restricted notice to anyone without the permission', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const html = await renderServer(Page({ searchParams: Promise.resolve({}) }));
    expect(mocks.getFieldInsights).not.toHaveBeenCalled();
    expect(textOf(html)).not.toContain('Case Journey');
    expect(textOf(html)).toContain('This view is for a Quality Admin or a platform owner.');
  });

  it('keeps the note to three short sentences with the date written for people', async () => {
    const html = await renderServer(Page({ searchParams: Promise.resolve({}) }));
    const note = /<output class="notice u-mb-150">([\s\S]*?)<\/output>/.exec(html)?.[1] ?? '';
    const sentences = textOf(note).split('. ').filter(Boolean);
    expect(sentences).toHaveLength(3);
    expect(textOf(note)).toContain(
      `Observed in VisaStack Cases from ${formatDateOnly('2025-11-03')}.`,
    );
    expect(textOf(note)).not.toContain('2025-11-03');
  });

  it('says how many numbers are hidden and how a number comes to show, without naming which', async () => {
    const text = textOf(await renderServer(Page({ searchParams: Promise.resolve({}) })));
    expect(text).toContain('Hidden Numbers');
    expect(text).toContain('3 of 21 numbers on this page are hidden.');
    expect(text).toContain(
      'a number is hidden when it is under 10, from fewer than 5 people, or more than 70 percent from one agency.',
    );
    expect(text).not.toContain('Nothing can be shown yet');
  });

  it('explains plainly that nothing can be shown yet when every number is hidden or zero', async () => {
    const quiet: FieldInsightsReport = {
      ...report,
      funnel: report.funnel.map((row) => ({ ...row, cell: hidden })),
      missingOutcome: { reported: hidden, unknown: hidden, pending: shown(0) },
      byRouteAndPeriod: [],
      authorityRequests: { total: hidden, bySource: [], byDocType: [] },
      correctionCauses: { checklistSuggestions: [], agencyCorrectionRequests: shown(0) },
      coverageGaps: { requestsCompared: hidden, requestsWithoutChecklist: shown(0), byDocType: [] },
      dataQuality: {
        olderReportsNotAttempts: shown(0),
        attemptsWithoutPackageRecord: hidden,
        caseDecisionsNotTiedToAttempt: shown(0),
      },
    };
    mocks.getFieldInsights.mockResolvedValue({ ok: true, value: quiet });
    const html = await renderServer(Page({ searchParams: Promise.resolve({}) }));
    const text = textOf(html);
    expect(text).toContain('Nothing can be shown yet because every group is still small.');
    expect(text).toContain('This is expected while the pilot is small.');
    // Only the totals are said: never which number, never why that one.
    expect(text).not.toMatch(/Mostly One Agency|Small Group|Protects Another/);
  });
});
