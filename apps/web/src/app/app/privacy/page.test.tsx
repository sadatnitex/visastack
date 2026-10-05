import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  latinWords,
  localeState,
  renderServer,
  stub,
  stubProps,
  textOf,
} from '../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  getDeletionImpactSummary: vi.fn(),
  getPendingDeletion: vi.fn(),
  listAccountExportJobsForAccount: vi.fn(),
  listActiveLegalHoldsForAccount: vi.fn(),
  listConsentHistory: vi.fn(),
}));

vi.mock('@visastack/services', () => mocks);
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('./deletion-panel', () => ({ DeletionPanel: stub('DeletionPanel') }));
vi.mock('./large-export-panel', () => ({ LargeExportPanel: stub('LargeExportPanel') }));

const { default: Page } = await import('./page');

beforeEach(() => {
  vi.clearAllMocks();
  localeState.value = 'en';
  mocks.listConsentHistory.mockResolvedValue([
    {
      type: 'CORE_PROCESSING',
      grantedAt: new Date('2026-10-05T23:30:00Z'),
      revokedAt: null,
      createdAt: new Date('2026-10-05T23:30:00Z'),
    },
    {
      type: 'MARKETING',
      grantedAt: null,
      revokedAt: new Date('2026-10-04T08:00:00Z'),
      createdAt: new Date('2026-10-04T08:00:00Z'),
    },
  ]);
  mocks.getPendingDeletion.mockResolvedValue({ scheduledFor: new Date('2026-10-12T00:00:00Z') });
  mocks.getDeletionImpactSummary.mockResolvedValue({
    applicants: [],
    missionCount: 0,
    documentCount: 0,
    activePlatformRoleCount: 0,
    authoredMissionNoteCount: 0,
  });
  mocks.listActiveLegalHoldsForAccount.mockResolvedValue([
    {
      id: 'h1',
      applicantDisplayName: 'Karim',
      reason: 'Court order',
      placedAt: new Date('2026-10-01T00:00:00Z'),
      reviewAt: new Date('2026-11-01T00:00:00Z'),
      accessibleTo: [],
      scope: { kind: 'applicant' },
    },
  ]);
  mocks.listAccountExportJobsForAccount.mockResolvedValue([
    {
      id: 'j1',
      status: 'READY',
      createdAt: new Date('2026-10-05T10:00:00Z'),
      readyAt: new Date('2026-10-05T10:05:00Z'),
      expiresAt: new Date('2026-10-06T10:05:00Z'),
      lastError: null,
    },
  ]);
});

describe('Privacy in English', () => {
  it('reads as it always has', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Your data rights');
    expect(text).toContain('Export your data');
    expect(text).toContain('Download export (JSON)');
    expect(text).toContain('Delete your account');
    expect(text).toContain('Consent history');
    expect(text).toContain('Core processing');
    expect(text).toContain('Granted');
    expect(text).toContain('Revoked');
    expect(text).toContain('5 Oct 2026, 23:30 UTC');
  });

  it('shows no translation notice, because there is nothing to translate', async () => {
    expect(textOf(await renderServer(Page()))).not.toContain('legal review');
  });

  it('hands the panels their dates already written, so the browser never formats one', async () => {
    const html = await renderServer(Page());
    const [deletion] = stubProps<{
      scheduledLabel: string;
      holds: Array<{ placedLabel: string; reviewLabel: string }>;
    }>(html, 'DeletionPanel');
    expect(deletion?.scheduledLabel).toBe('12 October 2026');
    expect(deletion?.holds[0]).toMatchObject({
      placedLabel: '1 October 2026',
      reviewLabel: '1 November 2026',
    });
    const [large] = stubProps<{ jobs: Array<{ expiresLabel: string }> }>(html, 'LargeExportPanel');
    expect(large?.jobs[0]?.expiresLabel).toBe('6 Oct 2026, 10:05 UTC');
  });
});

describe('Privacy in Bangla', () => {
  beforeEach(() => {
    localeState.value = 'bn';
  });

  it('is in Bangla with no English interface words, and says the legal review is not done', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('আপনার তথ্যের অধিকার');
    expect(text).toContain('আপনার তথ্য এক্সপোর্ট করুন');
    expect(text).toContain('আপনার অ্যাকাউন্ট মুছে ফেলুন');
    expect(text).toContain('সম্মতির ইতিহাস');
    expect(text).toContain('প্রদত্ত');
    expect(text).toContain('প্রত্যাহৃত');
    expect(text).toContain('পেশাদার আইনি পর্যালোচনা এখনও শেষ হয়নি');
    // JSON, CSV and ZIP are the names of file formats and stay as they are; UTC names the zone of a time.
    expect([...new Set(latinWords(text))].sort()).toEqual(['CSV', 'JSON', 'UTC', 'ZIP']);
  });

  it('writes the consent history dates in Bangla with the zone named', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('৫ অক্টো, ২০২৬, ২৩:৩০ UTC');
  });

  it('hands the panels Bangla dates and Bangla words', async () => {
    const html = await renderServer(Page());
    const [deletion] = stubProps<{ scheduledLabel: string; messages: Record<string, string> }>(
      html,
      'DeletionPanel',
    );
    expect(deletion?.scheduledLabel).toBe('১২ অক্টোবর, ২০২৬');
    expect(deletion?.messages['privacy.deletion.cancel']).toBe('মুছে ফেলা বাতিল করুন');
  });
});
