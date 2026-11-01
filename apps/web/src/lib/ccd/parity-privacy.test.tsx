import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';

/** Privacy & Consent (screen 12): see parity-kit.test-support.ts for how the comparison works. */

const state = vi.hoisted(() => ({
  history: [] as unknown[],
  pending: null as unknown,
  jobs: [] as unknown[],
  depth: 'auto',
  /** AI Use Today (S28); null makes the read fail, so the card is left out. */
  aiUsage: [] as unknown[] | null,
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listConsentHistory: async () => ({ items: state.history, nextCursor: null }),
  getPendingDeletion: async () => state.pending,
  getDeletionImpactSummary: async () => ({ applicants: 1, documents: 2 }),
  listActiveLegalHoldsForAccount: async () => [],
  listAccountExportJobsForAccount: async () => state.jobs,
  getAiUsageToday: async () => {
    if (state.aiUsage === null) throw new Error('unreadable');
    return { features: state.aiUsage, startsAgainAt: new Date('2026-10-31T00:00:00Z') };
  },
}));
vi.mock('../ai', () => ({ resolveAiExtractionAvailability: async () => 'available' }));
vi.mock('../server-error', () => ({ reportServerError: () => undefined }));
vi.mock('../session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('./depth.server', () => ({ readDepth: async () => state.depth }));
vi.mock('../../app/app/privacy/deletion-panel', () => ({ DeletionPanel: stub('DeletionPanel') }));
vi.mock('../../app/app/privacy/large-export-panel', () => ({
  LargeExportPanel: stub('LargeExportPanel'),
}));

const { default: PrivacyPage } = await import('../../app/app/privacy/page');

registerParity({
  name: 'privacy',
  reset: () => {
    state.history = [];
    state.pending = null;
    state.jobs = [];
    state.depth = 'auto';
    state.aiUsage = [];
  },
  render: async () => await renderServer(PrivacyPage()),
  states: [
    { name: 'no consent changes yet', setup: () => undefined },
    {
      name: 'consent history and a deletion scheduled',
      setup: () => {
        const at = new Date('2026-10-01T08:00:00Z');
        state.history = [
          { type: 'CORE_PROCESSING', grantedAt: at, revokedAt: null, createdAt: at },
          { type: 'MARKETING', grantedAt: null, revokedAt: at, createdAt: at },
        ];
        state.pending = { scheduledFor: new Date('2026-11-04T08:00:00Z') };
      },
    },
  ],
});

describe('privacy levels', () => {
  const levelOf = async (id: string) => {
    const doc = new JSDOM(await renderServer(PrivacyPage())).window.document;
    return doc.getElementById(id)?.getAttribute('data-level') ?? 'glance';
  };
  beforeEach(() => {
    state.pending = null;
    state.jobs = [];
  });

  it('keeps the downloads at Glance and account deletion at Everything', async () => {
    expect(await levelOf('export-data')).toBe('glance');
    expect(await levelOf('consent-history')).toBe('browse');
    expect(await levelOf('delete-account')).toBe('everything');
  });

  it('never hides a deletion already scheduled, so cancelling it stays one look away', async () => {
    state.pending = { scheduledFor: new Date('2026-11-04T08:00:00Z') };
    expect(await levelOf('delete-account')).toBe('glance');
  });

  it('never hides a large export on its way or ready to download', async () => {
    expect(await levelOf('large-export')).toBe('everything');
    const at = new Date('2026-10-28T08:00:00Z');
    const job = { id: 'j1', createdAt: at, readyAt: null, expiresAt: null, lastError: null };
    for (const status of ['PENDING', 'CLAIMED', 'READY']) {
      state.jobs = [{ ...job, status }];
      expect(await levelOf('large-export')).toBe('glance');
    }
    state.jobs = [{ ...job, status: 'EXPIRED' }];
    expect(await levelOf('large-export')).toBe('everything');
  });
});

describe('AI Use Today (S28)', () => {
  const row = (overrides: Record<string, unknown>) => ({
    feature: 'ai_document_reading',
    name: 'Read with AI',
    unit: 'files',
    used: 0,
    dailyLimit: null,
    available: true,
    reason: null,
    ...overrides,
  });
  beforeEach(() => {
    state.aiUsage = [];
  });

  it('shows each feature with its state and today’s count, and when limits start again', async () => {
    state.aiUsage = [
      row({ used: 1 }),
      row({
        feature: 'ai_consistency_checks',
        name: 'Consistency Checks',
        unit: 'checks',
        used: 3,
        dailyLimit: 3,
        available: false,
        reason: 'daily_limit',
      }),
      row({
        feature: 'ai_explanations',
        name: 'Gap Explanations',
        unit: 'explanations',
        available: false,
        reason: 'turned_off',
      }),
    ];
    const html = await renderServer(PrivacyPage());
    const doc = new JSDOM(html).window.document;
    const card = doc.getElementById('ai-use-today');
    expect(card?.getAttribute('data-level')).toBe('browse');
    const text = card?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('AI Use Today');
    expect(text).toContain('Read with AI');
    expect(text).toContain('1 file today');
    expect(text).toContain('3 of 3 checks today');
    expect(text).toContain('Limit Reached');
    expect(text).toContain('0 explanations today');
    expect(text).toContain('Off');
    expect(text).toContain('Daily limits start again at 6 AM Bangladesh time.');
    expect(text).not.toContain('UTC');
  });

  it('leaves the card out, and the rest of the page as it is, when the counts cannot be read', async () => {
    state.aiUsage = null;
    const html = await renderServer(PrivacyPage());
    expect(html).not.toContain('AI Use Today');
    expect(html).toContain('Consent History');
  });
});
