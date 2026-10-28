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
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listConsentHistory: async () => state.history,
  getPendingDeletion: async () => state.pending,
  getDeletionImpactSummary: async () => ({ applicants: 1, documents: 2 }),
  listActiveLegalHoldsForAccount: async () => [],
  listAccountExportJobsForAccount: async () => state.jobs,
}));
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
