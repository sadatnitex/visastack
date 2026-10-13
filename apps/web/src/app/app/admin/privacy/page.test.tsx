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
  documentsPastRetention: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({ isPlatformAdmin: mocks.isPlatformAdmin }));
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
  mocks.listActiveLegalHolds.mockResolvedValue([
    { id: 'h1', applicantId: 'ap1', reason: 'Court order', reviewAt: new Date('2099-01-01') },
    { id: 'h2', applicantId: 'ap2', reason: 'Dispute', reviewAt: new Date('2020-01-01') },
    { id: 'h3', applicantId: 'ap1', reason: 'Audit', reviewAt: null },
  ]);
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
  ]);
  mocks.listAllApplicants.mockResolvedValue([
    { id: 'ap1', displayName: 'Rahim Uddin' },
    { id: 'ap2', displayName: 'Nusrat Jahan' },
  ]);
  mocks.documentsPastRetention.mockResolvedValue([
    { id: 'd1', originalName: 'old-passport.pdf', applicantId: 'ap1' },
  ]);
});

describe('Platform > Privacy', () => {
  it('shows retention policies and every active legal hold with the applicant named', async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text).toContain('Document retention policies');
    expect(text).toContain('Passport');
    expect(text).not.toContain('PASSPORT');
    expect(text).toContain('365 days');
    expect(text).toContain('Rahim Uddin');
    expect(text).toContain('Nusrat Jahan');
    expect(text).toContain('Court order');
    expect(stubProps<{ holdId: string }>(html, 'ReleaseHoldButton').map((p) => p.holdId)).toEqual([
      'h1',
      'h2',
      'h3',
    ]);
  });

  it('flags a hold with no review date and one whose review is overdue', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('no review date set');
    expect(text).toContain('review overdue since');
    expect(text).toContain('review by');
  });

  it('hands the legal hold form the applicants it can target', async () => {
    const html = await renderServer(Page());
    const [form] = stubProps<{ applicants: unknown }>(html, 'LegalHoldForm');
    expect(form?.applicants).toEqual([
      { id: 'ap1', displayName: 'Rahim Uddin' },
      { id: 'ap2', displayName: 'Nusrat Jahan' },
    ]);
  });

  it('separates a job blocked by a hold from one that failed', async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text).toContain('Blocked by hold');
    expect(text).toContain('5/5 attempts');
    expect(text).toContain('Account deletion');
    expect(text).toContain('Retention purge');
    expect(text).toContain('storage unreachable');
    expect(stubProps<{ jobId: string }>(html, 'RetryErasureJobButton').map((p) => p.jobId)).toEqual(
      ['e1', 'e2'],
    );
  });

  it('lists documents past retention with the applicant, and offers the purge', async () => {
    const html = await renderServer(Page());
    expect(textOf(html)).toContain('old-passport.pdf');
    expect(stubProps(html, 'PurgeButton')).toEqual([{ eligibleCount: 1 }]);
  });

  it('says so, and offers no purge, when nothing is past retention', async () => {
    mocks.documentsPastRetention.mockResolvedValue([]);
    const html = await renderServer(Page());
    expect(textOf(html)).toContain('No documents are currently past their retention policy');
    expect(stubProps(html, 'PurgeButton')).toHaveLength(0);
  });

  it('refuses anyone who is not a platform administrator, without reading any of it', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('restricted to platform administrators');
    expect(mocks.listAllApplicants).not.toHaveBeenCalled();
    expect(mocks.listActiveLegalHolds).not.toHaveBeenCalled();
  });

  it('keeps going and names the section when one read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.listErasureJobsNeedingAttention.mockRejectedValue(new Error('relation does not exist'));
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Some sections could not be loaded');
    expect(text).toContain('erasure jobs');
    expect(text).toContain('Court order');
  });
});
