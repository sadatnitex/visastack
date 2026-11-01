import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../lib/next-mocks.test-support';

/** WP-SB7: Pack Studio lists packs 25 at a time and folds its forms. Made-up packs only. */

const mocks = vi.hoisted(() => ({
  isPlatformAdmin: vi.fn(),
  listPacks: vi.fn(),
  listDocumentExpiryPolicies: vi.fn(),
  listPackVersionsDueForReview: vi.fn(),
  listPublicTrustPublished: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({ isPlatformAdmin: mocks.isPlatformAdmin }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listPacks: (...args: unknown[]) => mocks.listPacks(...args),
  listDocumentExpiryPolicies: (...args: unknown[]) => mocks.listDocumentExpiryPolicies(...args),
  listPackVersionsDueForReview: (...args: unknown[]) => mocks.listPackVersionsDueForReview(...args),
  listPublicTrustPublished: (...args: unknown[]) => mocks.listPublicTrustPublished(...args),
}));
vi.mock('./pack-forms', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return {
    CreatePackForm: stub('CreatePackForm'),
    SetDocumentExpiryPolicyForm: stub('SetDocumentExpiryPolicyForm'),
  };
});

const { default: Page } = await import('./page');

const render = (query: Record<string, string> = {}) =>
  renderServer(Page({ searchParams: Promise.resolve(query) }));

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin/packs';
  mocks.isPlatformAdmin.mockResolvedValue(true);
  mocks.listPacks.mockResolvedValue(
    Array.from({ length: 130 }, (_, i) => ({ id: `p${i}`, key: `route-${i}`, name: `Route ${i}` })),
  );
  mocks.listDocumentExpiryPolicies.mockResolvedValue([
    { id: 'e1', docType: 'PASSPORT', thresholdDays: [90, 30] },
  ]);
  mocks.listPackVersionsDueForReview.mockResolvedValue(
    Array.from({ length: 60 }, (_, i) => ({
      packVersionId: `v${i}`,
      packId: `p${i}`,
      packName: `Route ${i}`,
      version: 1,
      nextReviewDate: new Date('2026-09-01'),
    })),
  );
  mocks.listPublicTrustPublished.mockResolvedValue([{ packKey: 'route-1', packName: 'Route 1' }]);
});

describe('Platform > Rules > Pack Studio', () => {
  it('shows 25 packs with Show More, and reaches every pack past 100', async () => {
    const html = await render();
    expect(html.match(/id="pack-row-\d+"/g)).toHaveLength(25);
    expect(textOf(html)).toContain('Showing 25 of 130 packs.');
    expect(html).toContain('href="/app/admin/packs?show=50#pack-row-25"');
    const deep = await render({ show: '125' });
    expect(deep.match(/id="pack-row-\d+"/g)).toHaveLength(125);
    expect(deep).toContain('href="/app/admin/packs?show=150#pack-row-125"');
    const all = await render({ show: '150' });
    expect(all.match(/id="pack-row-\d+"/g)).toHaveLength(130);
  });

  it('keeps the review queue and the live routes in fixed scrolling panels', async () => {
    const html = await render();
    expect(html).toMatch(
      /class="activity-log-scroll[^"]*" aria-label="Versions due for review" tabindex="0"/,
    );
    expect(html).toContain('aria-label="Routes live on the public trust surface"');
    expect(html.match(/href="\/app\/admin\/packs\/p\d+"/g)?.length).toBe(25 + 60);
  });

  it('folds the two forms, with the count of overrides on the thresholds', async () => {
    const html = await render();
    expect(html).toMatch(/<details class="collapsible-group">\s*<summary[^>]*>.*Create a Pack/s);
    expect(textOf(html)).toContain('Reminder Thresholds by Document Type');
    expect(textOf(html)).toContain('1 override');
    expect(html).toContain('data-stub="CreatePackForm"');
    expect(html).toContain('data-stub="SetDocumentExpiryPolicyForm"');
  });

  it('refuses anyone who is not a platform administrator, reading nothing', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    const html = await render();
    expect(textOf(html)).toContain('restricted to platform administrators');
    expect(mocks.listPacks).not.toHaveBeenCalled();
  });
});
