import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  navigationState,
  renderServer,
  stubProps,
  textOf,
} from '../../../../../lib/next-mocks.test-support';

/** WP-SB7: one version open at a time, compact requirement rows, 25 at a time. Made-up rules only. */

const mocks = vi.hoisted(() => ({
  isPlatformAdmin: vi.fn(),
  getPack: vi.fn(),
  listPackVersions: vi.fn(),
  listRequirements: vi.fn(),
  listMissionsByPackVersion: vi.fn(),
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../../lib/admin', () => ({ isPlatformAdmin: mocks.isPlatformAdmin }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getPack: (...args: unknown[]) => mocks.getPack(...args),
  listPackVersions: (...args: unknown[]) => mocks.listPackVersions(...args),
  listRequirements: (...args: unknown[]) => mocks.listRequirements(...args),
  listMissionsByPackVersion: (...args: unknown[]) => mocks.listMissionsByPackVersion(...args),
}));
vi.mock('../pack-forms', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return {
    AddRequirementForm: stub('AddRequirementForm'),
    PublicTrustContentForm: stub('PublicTrustContentForm'),
    RequirementSourceReviewForm: stub('RequirementSourceReviewForm'),
    VerifyChecksumForm: stub('VerifyChecksumForm'),
  };
});
vi.mock('../pack-version-buttons', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return {
    ApproveVersionButton: stub('ApproveVersionButton'),
    OfficialFeeStaleButton: stub('OfficialFeeStaleButton'),
    OpenVersionButton: stub('OpenVersionButton'),
    PublicTrustPublishButton: stub('PublicTrustPublishButton'),
    PublishVersionButton: stub('PublishVersionButton'),
    SourceInaccessibleButton: stub('SourceInaccessibleButton'),
    WithdrawVersionButton: stub('WithdrawVersionButton'),
  };
});

const { default: Page } = await import('./page');

const PACK = {
  id: 'pk1',
  key: 'bd-uk-visit',
  name: 'UK Visit',
  authoritative: true,
  description: '',
};

function version(n: number, status: string) {
  return {
    id: `v${n}`,
    version: n,
    status,
    checksum: null,
    withdrawnAt: null,
    withdrawnReason: null,
    nextReviewDate: null,
    routeDescription: null,
    officialFeeMinorUnits: null,
    officialFeeCurrency: null,
    officialFeeStaleAt: null,
    officialChannelName: null,
    officialChannelUrl: null,
    officialReportingUrl: null,
    publicTrustPublishedAt: null,
  };
}

function requirement(i: number) {
  return {
    id: `r${i}`,
    kind: 'DOCUMENT',
    docType: `DOC_${String(i).padStart(3, '0')}`,
    fieldKey: null,
    optional: i % 2 === 0,
    citation: `Rule ${i}`,
    sourceUrl: i === 0 ? 'https://gov.example/rules' : null,
    sourceTitle: null,
    publisher: null,
    observedDate: null,
    maxAgeDays: null,
    sourceInaccessibleAt: i === 1 ? new Date('2026-10-01') : null,
  };
}

const render = (query: Record<string, string> = {}) =>
  renderServer(
    Page({ params: Promise.resolve({ packId: 'pk1' }), searchParams: Promise.resolve(query) }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin/packs/pk1';
  mocks.isPlatformAdmin.mockResolvedValue(true);
  mocks.getPack.mockResolvedValue(PACK);
  // Worst case: 14 versions, the newest a draft, and 140 requirements on each.
  mocks.listPackVersions.mockResolvedValue(
    Array.from({ length: 14 }, (_, i) => version(14 - i, i === 0 ? 'DRAFT' : 'PUBLISHED')),
  );
  mocks.listRequirements.mockResolvedValue(Array.from({ length: 140 }, (_, i) => requirement(i)));
  mocks.listMissionsByPackVersion.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
});

describe('Platform > Rules > one pack', () => {
  it('opens only the newest version and reads only its requirements', async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Version 14');
    expect(mocks.listRequirements).toHaveBeenCalledTimes(1);
    expect(mocks.listRequirements).toHaveBeenCalledWith({}, 'v14');
    // A draft never has cases attached, so that read is skipped.
    expect(mocks.listMissionsByPackVersion).not.toHaveBeenCalled();
    expect(stubProps(html, 'AddRequirementForm')).toHaveLength(1);
  });

  it('shows 25 requirements as compact rows, with Show More to the next 25', async () => {
    const html = await render();
    expect(html.match(/id="pack-requirement-\d+"/g)).toHaveLength(25);
    expect(textOf(html)).toContain('Showing 25 of 140 requirements.');
    expect(html).toContain('href="/app/admin/packs/pk1?show=50#pack-requirement-25"');
    // Source details and the review form are folded inside each row.
    expect(html.match(/<details class="sb7-fold">/g)?.length).toBeGreaterThanOrEqual(25);
    expect(textOf(html)).toContain('Source inaccessible since');
    expect(stubProps(html, 'SourceInaccessibleButton')).toHaveLength(25);
  });

  it('reaches every requirement past 100 rows, since the list is read whole', async () => {
    const html = await render({ show: '125' });
    expect(html.match(/id="pack-requirement-\d+"/g)).toHaveLength(125);
    expect(html).toContain('href="/app/admin/packs/pk1?show=150#pack-requirement-125"');
    const all = await render({ show: '150' });
    expect(all.match(/id="pack-requirement-\d+"/g)).toHaveLength(140);
    expect(textOf(all)).toContain('Showing all 140 requirements.');
  });

  it('lists the other versions as short rows, 10 at a time, each opening that version', async () => {
    const html = await render();
    expect(html.match(/id="pack-version-row-\d+"/g)).toHaveLength(10);
    expect(html).toContain('href="/app/admin/packs/pk1?version=v13#pack-open-version"');
    expect(textOf(html)).toContain('Showing 10 of 13 other versions.');
    expect(html).toContain('href="/app/admin/packs/pk1?versions=20#pack-version-row-10"');
  });

  it('opens the version the address names, with its attached cases counted', async () => {
    const html = await render({ version: 'v3', show: '50' });
    expect(mocks.listRequirements).toHaveBeenCalledWith({}, 'v3');
    expect(textOf(html)).toContain('2 cases currently attached to this version.');
    expect(stubProps(html, 'WithdrawVersionButton')).toEqual([
      { packId: 'pk1', packVersionId: 'v3' },
    ]);
    // Opening another version starts its requirement list from the top again.
    expect(html).toContain('href="/app/admin/packs/pk1?version=v14#pack-open-version"');
  });

  it('keeps each requirement in a fixed place whatever order the read returns', async () => {
    mocks.listRequirements.mockResolvedValue(
      Array.from({ length: 140 }, (_, i) => requirement(i)).reverse(),
    );
    const html = await render();
    expect(textOf(html).indexOf('DOC_000')).toBeLessThan(textOf(html).indexOf('DOC_001'));
    expect(textOf(html)).not.toContain('DOC_139');
  });

  it('falls back to the newest version for an unknown one', async () => {
    await render({ version: 'not-here' });
    expect(mocks.listRequirements).toHaveBeenCalledWith({}, 'v14');
  });

  it('keeps every version in the compare form', async () => {
    const html = await render();
    expect(html.match(/<option value="v\d+">/g)).toHaveLength(28);
  });

  it('refuses anyone who is not a platform administrator, reading nothing', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    const html = await render();
    expect(textOf(html)).toContain('restricted to platform administrators');
    expect(mocks.getPack).not.toHaveBeenCalled();
  });
});
