import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  navigationState,
  renderServer,
  stubProps,
  textOf,
} from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  isPlatformAdmin: vi.fn(),
  getRetentionPolicies: vi.fn(),
  listActiveLegalHolds: vi.fn(),
  listErasureJobsNeedingAttention: vi.fn(),
  listAllApplicants: vi.fn(),
  staffPrincipal: vi.fn(),
  documentsPastRetention: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  isPlatformAdmin: mocks.isPlatformAdmin,
  bootstrapAdminEmails: () => [],
  staffPrincipal: (...args: unknown[]) => mocks.staffPrincipal(...args),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getRetentionPolicies: (...args: unknown[]) => mocks.getRetentionPolicies(...args),
  listActiveLegalHolds: (...args: unknown[]) => mocks.listActiveLegalHolds(...args),
  listErasureJobsNeedingAttention: (...args: unknown[]) =>
    mocks.listErasureJobsNeedingAttention(...args),
  listAllApplicants: (...args: unknown[]) => mocks.listAllApplicants(...args),
  documentsPastRetention: (...args: unknown[]) => mocks.documentsPastRetention(...args),
}));
vi.mock('../action-buttons', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return {
    ReleaseHoldButton: stub('ReleaseHoldButton'),
    RetryErasureJobButton: stub('RetryErasureJobButton'),
  };
});
vi.mock('../admin-forms', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { LegalHoldForm: stub('LegalHoldForm'), RetentionPolicyForm: stub('RetentionPolicyForm') };
});
vi.mock('./actions', () => ({ searchApplicantsAction: vi.fn() }));
vi.mock('./applicant-picker', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { ApplicantPicker: stub('ApplicantPicker') };
});
vi.mock('../purge-button', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { PurgeButton: stub('PurgeButton') };
});

const { default: Page } = await import('./page');

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin/privacy';
  mocks.isPlatformAdmin.mockResolvedValue(true);
  mocks.getRetentionPolicies.mockResolvedValue([
    { id: 'p1', docType: 'PASSPORT', retentionDays: 365 },
  ]);
  mocks.listActiveLegalHolds.mockResolvedValue({
    items: [
      { id: 'h1', applicantId: 'ap1', reason: 'Court order', reviewAt: new Date('2099-01-01') },
      { id: 'h2', applicantId: 'ap2', reason: 'Dispute', reviewAt: new Date('2020-01-01') },
      { id: 'h3', applicantId: 'ap1', reason: 'Audit', reviewAt: null },
    ],
    nextCursor: null,
  });
  mocks.listErasureJobsNeedingAttention.mockResolvedValue([
    {
      id: 'e1',
      objectKey: 'obj-1',
      status: 'BLOCKED_BY_HOLD',
      attempts: 0,
      maxAttempts: 5,
      reason: 'ACCOUNT_DELETION',
      lastError: null,
    },
    {
      id: 'e2',
      objectKey: 'obj-2',
      status: 'FAILED',
      attempts: 5,
      maxAttempts: 5,
      reason: 'RETENTION_PURGE',
      lastError: 'storage unreachable',
    },
    {
      id: 'e3',
      objectKey: 'obj-3',
      status: 'FAILED',
      attempts: 5,
      maxAttempts: 5,
      reason: 'PROFILE_PHOTO_REMOVAL',
      lastError: null,
    },
  ]);
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: { kind: 'staff' } });
  mocks.listAllApplicants.mockResolvedValue({
    ok: true,
    value: [
      { id: 'ap1', displayName: 'Rahim Uddin' },
      { id: 'ap2', displayName: 'Nusrat Jahan' },
    ],
  });
  mocks.documentsPastRetention.mockResolvedValue([
    { id: 'd1', originalName: 'old-passport.pdf', applicantId: 'ap1' },
  ]);
});

const tab = (name: string, extra: Record<string, string> = {}) =>
  Page({ searchParams: Promise.resolve({ tab: name, ...extra }) });

describe('Platform > Privacy', () => {
  it('opens on Retention with the four sections as tabs, and only the policies showing', async () => {
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(text).toContain('Document Retention Policies');
    expect(text).toContain('Passport');
    expect(text).not.toContain('PASSPORT');
    expect(text).toContain('365 days');
    expect(html).toContain('aria-label="Privacy Sections"');
    expect(html).toMatch(/href="\/app\/admin\/privacy" aria-current="page"/);
    for (const name of ['holds', 'erasure', 'purge']) {
      expect(html).toContain(`href="/app/admin/privacy?tab=${name}"`);
    }
    // Waiting erasure work is counted on every tab, so it is never hidden behind one.
    expect(text).toContain('Erasure (3)');
    expect(text).not.toContain('Court order');
    expect(text).not.toContain('obj-1');
    // Only the open tab's list is read; no applicant is named on Retention, so no name either.
    expect(mocks.listActiveLegalHolds).not.toHaveBeenCalled();
    expect(mocks.documentsPastRetention).not.toHaveBeenCalled();
    expect(mocks.listAllApplicants).not.toHaveBeenCalled();
    expect(mocks.listErasureJobsNeedingAttention).toHaveBeenCalledWith({}, 50);
  });

  it('shows every active legal hold with the applicant named, in a fixed scrolling panel', async () => {
    const html = await renderServer(tab('holds'));
    const text = textOf(html);
    expect(text).toContain('Rahim Uddin');
    expect(text).toContain('Nusrat Jahan');
    expect(text).toContain('Court order');
    expect(html).toMatch(/class="activity-log-scroll[^"]*" aria-label="Active holds" tabindex="0"/);
    expect(stubProps<{ holdId: string }>(html, 'ReleaseHoldButton').map((p) => p.holdId)).toEqual([
      'h1',
      'h2',
      'h3',
    ]);
    expect(mocks.listActiveLegalHolds).toHaveBeenCalledWith({}, { limit: 25 });
    expect(mocks.listAllApplicants).toHaveBeenCalledWith(
      {},
      { kind: 'staff' },
      {
        ids: ['ap1', 'ap2', 'ap1'],
      },
    );
  });

  it('reads holds 25 at a time and offers older ones, with a way back to the newest', async () => {
    mocks.listActiveLegalHolds.mockResolvedValue({
      items: [{ id: 'h9', applicantId: 'ap2', reason: 'Older', reviewAt: null }],
      nextCursor: 'next_holds',
    });
    const html = await renderServer(tab('holds', { before: 'prev_holds' }));
    expect(mocks.listActiveLegalHolds).toHaveBeenCalledWith(
      {},
      { limit: 25, before: 'prev_holds' },
    );
    expect(html).toContain('href="/app/admin/privacy?tab=holds&amp;before=next_holds#admin-holds"');
    expect(textOf(html)).toContain('Show Older Holds');
    expect(html).toContain('href="/app/admin/privacy?tab=holds#admin-holds"');
    expect(mocks.getRetentionPolicies).not.toHaveBeenCalled();
    expect(mocks.documentsPastRetention).not.toHaveBeenCalled();
  });

  it('treats an unknown tab as Retention and ignores a cursor outside the holds tab', async () => {
    const html = await renderServer(
      Page({ searchParams: Promise.resolve({ tab: 'nope', before: 'abc' }) }),
    );
    expect(textOf(html)).toContain('Document Retention Policies');
    expect(mocks.listActiveLegalHolds).not.toHaveBeenCalled();
  });

  it('says 50+ on the Erasure tab when the bounded read is full', async () => {
    mocks.listErasureJobsNeedingAttention.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({
        id: `e${i}`,
        objectKey: `obj-${i}`,
        status: 'FAILED',
        attempts: 5,
        maxAttempts: 5,
        reason: 'RETENTION_PURGE',
        lastError: null,
      })),
    );
    expect(textOf(await renderServer(Page({})))).toContain('Erasure (50+)');
  });

  it('flags a hold with no review date and one whose review is overdue', async () => {
    const text = textOf(await renderServer(tab('holds')));
    expect(text).toContain('no review date set');
    expect(text).toContain('review overdue since');
    expect(text).toContain('review by');
  });

  it('gives the legal hold form the search-as-you-type picker, never a list of applicants', async () => {
    const html = await renderServer(tab('holds'));
    const [form] = stubProps<Record<string, unknown>>(html, 'LegalHoldForm');
    expect(form).toBeDefined();
    expect(form).not.toHaveProperty('applicants');
    expect(form).toHaveProperty('applicantPicker');
    // The page itself never reads the whole directory.
    for (const call of mocks.listAllApplicants.mock.calls) expect(call).toHaveLength(3);
  });

  it('separates a job blocked by a hold from one that failed', async () => {
    const html = await renderServer(tab('erasure'));
    const text = textOf(html);
    expect(text).toContain('Blocked by Hold');
    expect(text).toContain('5/5 attempts');
    expect(text).toContain('Account Deletion');
    expect(text).toContain('Retention Purge');
    expect(text).toContain('Photo Removal');
    expect(text).toContain('storage unreachable');
    expect(html).toContain('id="admin-deletion"');
    expect(html).toContain('aria-label="Erasure jobs needing attention"');
    expect(stubProps<{ jobId: string }>(html, 'RetryErasureJobButton').map((p) => p.jobId)).toEqual(
      ['e1', 'e2', 'e3'],
    );
  });

  it('lists documents past retention with the applicant, and offers the purge', async () => {
    const html = await renderServer(tab('purge'));
    expect(textOf(html)).toContain('old-passport.pdf');
    expect(textOf(html)).toContain('Rahim Uddin');
    expect(html).toContain('aria-label="Documents eligible for purge"');
    expect(stubProps(html, 'PurgeButton')).toEqual([{ eligibleCount: 1 }]);
  });

  it('says so, and offers no purge, when nothing is past retention', async () => {
    mocks.documentsPastRetention.mockResolvedValue([]);
    const html = await renderServer(tab('purge'));
    expect(textOf(html)).toContain('No documents are currently past their retention policy');
    expect(stubProps(html, 'PurgeButton')).toHaveLength(0);
  });

  it('refuses anyone who is not a platform administrator, without reading any of it', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    const text = textOf(await renderServer(tab('holds')));
    expect(text).toContain('restricted to platform administrators');
    expect(mocks.listAllApplicants).not.toHaveBeenCalled();
    expect(mocks.listActiveLegalHolds).not.toHaveBeenCalled();
  });

  it('tells a role without the directory that the page is not available, and reads nothing', async () => {
    mocks.staffPrincipal.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'no role' },
    });
    const text = textOf(await renderServer(tab('purge')));
    expect(text).toContain('Not available for your role');
    expect(text).not.toContain('Rahim Uddin');
    expect(text).not.toContain('old-passport.pdf');
    expect(mocks.listAllApplicants).not.toHaveBeenCalled();
    expect(mocks.listActiveLegalHolds).not.toHaveBeenCalled();
    expect(mocks.documentsPastRetention).not.toHaveBeenCalled();
  });

  it('keeps going and names the section when one read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.listErasureJobsNeedingAttention.mockRejectedValue(new Error('relation does not exist'));
    const text = textOf(await renderServer(tab('holds')));
    expect(text).toContain('Some Sections Could Not Be Loaded');
    expect(text).toContain('erasure jobs');
    expect(text).toContain('Court order');
  });

  it('falls back to the applicant id when a name cannot be looked up', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.listAllApplicants.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'no' },
    });
    const text = textOf(await renderServer(tab('holds')));
    expect(text).toContain('applicant names');
    expect(text).toContain('ap1');
    expect(text).toContain('Court order');
  });
});
