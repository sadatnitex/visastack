import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stubProps, textOf } from '../../../../../lib/next-mocks.test-support';

/** UMPE P10: the Official Sources page. Made-up sources, pages and dates only. */

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  overview: vi.fn(),
  listPacks: vi.fn(),
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../../lib/admin', () => ({ hasPlatformPermission: mocks.permission }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  sourceMonitorOverview: (...args: unknown[]) => mocks.overview(...args),
  listPacks: (...args: unknown[]) => mocks.listPacks(...args),
}));
vi.mock('./source-forms', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return {
    AUTHORITY_TIER_LABELS: {
      GOVERNMENT: 'Government',
      CONSULATE: 'Consulate or Embassy',
      OFFICIAL_APPLICATION: 'Official Application Site',
      AUTHORIZED_VAC: 'Authorized Visa Centre',
    },
    CandidateDecisionForm: stub('CandidateDecisionForm'),
    CheckNowButton: stub('CheckNowButton'),
    DeactivateSourceButton: stub('DeactivateSourceButton'),
    RegisterSourceForm: stub('RegisterSourceForm'),
  };
});

const { default: Page } = await import('./page');

const source = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  jurisdiction: 'GB',
  route: 'visit',
  purpose: null,
  url: 'https://visas.synthetic-gov.example/visit',
  title: 'Synthetic Visit Page',
  publisher: 'Synthetic Authority',
  authorityTier: 'GOVERNMENT',
  packId: null,
  packName: null,
  active: true,
  lastFetchedAt: new Date('2026-11-07T03:00:00Z'),
  lastOutcome: 'FETCHED',
  lastAttemptAt: new Date('2026-11-07T03:00:00Z'),
  lastVerifiedAt: null,
  ...overrides,
});

const overview = {
  ready: true,
  sources: [
    source(),
    source({
      id: 's2',
      title: 'Synthetic Blocked Page',
      packId: 'p1',
      packName: 'GB Visit',
      lastFetchedAt: null,
      lastOutcome: 'BLOCKED',
      lastVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    }),
  ],
  openCandidates: [
    {
      id: 'c1',
      sourceId: 's2',
      sourceTitle: 'Synthetic Blocked Page',
      sourceUrl: 'https://visas.synthetic-gov.example/fees',
      jurisdiction: 'GB',
      packId: 'p1',
      status: 'NEW',
      oldExcerpt: 'Fee 100',
      newExcerpt: 'Fee 120',
      detectedAt: new Date('2026-11-07T03:00:00Z'),
    },
  ],
  reviewedCount: 4,
  lastManualRun: null,
  lastScheduledRun: {
    trigger: 'SCHEDULED',
    startedAt: new Date('2026-11-07T03:00:00Z'),
    finishedAt: new Date('2026-11-07T03:00:20Z'),
    sourcesDue: 2,
    checked: 1,
    changed: 1,
    blocked: 1,
    failed: 0,
    unsupported: 0,
    deferred: 0,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.overview.mockResolvedValue(overview);
  mocks.listPacks.mockResolvedValue([{ id: 'p1', name: 'GB Visit', key: 'gb.visit' }]);
});

describe('Pack Studio > Official Sources', () => {
  it('needs pack management rights and shows nothing else without them', async () => {
    mocks.permission.mockResolvedValue(false);
    const html = await render();
    expect(textOf(html)).toContain('restricted to people who manage packs');
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(mocks.permission.mock.calls[0]?.[2]).toBe('PACK_MANAGE');
  });

  it('says plainly when the database is not updated yet', async () => {
    mocks.overview.mockResolvedValue({ ...overview, ready: false, sources: [] });
    const html = await render();
    expect(textOf(html)).toContain('Source monitoring can be used once the database is updated.');
    expect(html).not.toContain('data-stub="RegisterSourceForm"');
  });

  it('keeps Last Fetched apart from Last Verified by a Person, and shows exceptions honestly', async () => {
    const text = textOf(await render());
    expect(text).toContain('Last Fetched');
    expect(text).toContain('Last Verified by a Person');
    expect(text).toContain('Not Verified Yet');
    expect(text).toContain('Not Fetched Yet');
    expect(text).toContain('Blocked by the Site');
  });

  it('shows the latest counts and the changes waiting, with the old and new text', async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Changes Reviewed');
    // The weekly run and Check Now are shown apart.
    expect(text).toContain('Saturday Check');
    expect(text).toContain('Last Check Now');
    expect(text).toContain('Check Now has not been used yet.');
    expect(text).toContain('Left for the Next Run');
    expect(text).toContain('Fee 100');
    expect(text).toContain('Fee 120');
    expect(html).toContain('href="/app/admin/packs/p1"');
    expect(stubProps<{ candidateId: string }>(html, 'CandidateDecisionForm')[0]?.candidateId).toBe(
      'c1',
    );
    expect(stubProps(html, 'CheckNowButton')).toHaveLength(3);
    expect(stubProps<{ packs: unknown[] }>(html, 'RegisterSourceForm')[0]?.packs).toEqual([
      { id: 'p1', name: 'GB Visit' },
    ]);
  });
});

function render() {
  return renderServer(Page());
}
