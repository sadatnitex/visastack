import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';

const service = vi.hoisted(() => ({
  listConsentHistory: vi.fn(),
  getPendingDeletion: vi.fn(),
  getDeletionImpactSummary: vi.fn(),
  listActiveLegalHoldsForAccount: vi.fn(),
  listAccountExportJobsForAccount: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../../../lib/ai-usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/ai-usage')>()),
  readAiUsage: async () => null,
}));
vi.mock('./deletion-panel', () => ({ DeletionPanel: () => <div>Deletion panel</div> }));
vi.mock('./large-export-panel', () => ({ LargeExportPanel: () => <div>Export panel</div> }));

const { default: PrivacyPage } = await import('./page');
const page = (search: Record<string, string> = {}) =>
  renderServer(PrivacyPage({ searchParams: Promise.resolve(search) }));

/** Fifty consent changes of an account with five hundred: the worst case the budget uses. */
function worstCase(nextCursor: string | null) {
  return {
    nextCursor,
    items: Array.from({ length: 50 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      accountId: 'owner',
      type: i % 2 === 0 ? 'MARKETING' : 'SHARING',
      grantedAt: i % 3 === 0 ? null : new Date(Date.UTC(2026, 9, 1, 0, 0, 500 - i)),
      revokedAt: i % 3 === 0 ? new Date(Date.UTC(2026, 9, 1, 0, 0, 500 - i)) : null,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, 500 - i)),
    })),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  service.listConsentHistory.mockResolvedValue({ items: [], nextCursor: null });
  service.getPendingDeletion.mockResolvedValue(null);
  service.getDeletionImpactSummary.mockResolvedValue({});
  service.listActiveLegalHoldsForAccount.mockResolvedValue([]);
  service.listAccountExportJobsForAccount.mockResolvedValue([]);
});

describe('Consent history in a fixed log (WP-SB1)', () => {
  it('reads 50 changes of this account and shows them in a scrolling panel with filters', async () => {
    service.listConsentHistory.mockResolvedValue(worstCase('older-cursor'));
    const html = await page();
    expect(service.listConsentHistory).toHaveBeenCalledWith({}, 'owner', { limit: 50 });
    expect(html).toContain('class="activity-log-scroll"');
    expect(html).toContain('aria-label="Consent History Entries"');
    expect(html.match(/class="row activity-log-row"/g)).toHaveLength(50);
    const text = textOf(html);
    for (const label of ['Search', 'What Happened', 'Result', 'When', 'Granted', 'Revoked']) {
      expect(text).toContain(label);
    }
    expect(text).toContain('Show Older Entries');
    expect(html).toContain('href="/app/privacy?consentBefore=older-cursor#consent-history-log"');
  });

  it('passes a well-formed cursor on, offers the newest page, and drops a malformed one', async () => {
    service.listConsentHistory.mockResolvedValue(worstCase(null));
    const html = await page({ consentBefore: 'abc-DEF_1' });
    expect(service.listConsentHistory).toHaveBeenCalledWith({}, 'owner', {
      limit: 50,
      before: 'abc-DEF_1',
    });
    expect(textOf(html)).toContain('Show Newest Entries');
    expect(textOf(html)).not.toContain('Show Older Entries');
    expect(html).toContain('href="/app/privacy#consent-history-log"');

    await page({ consentBefore: 'a b<script>' });
    expect(service.listConsentHistory).toHaveBeenLastCalledWith({}, 'owner', { limit: 50 });
  });

  it('keeps the empty state when nothing changed yet', async () => {
    const text = textOf(await page());
    expect(text).toContain('No Changes Yet');
    expect(text).not.toContain('Show Older Entries');
  });
});
