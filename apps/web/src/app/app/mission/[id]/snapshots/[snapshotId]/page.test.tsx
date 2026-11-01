import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub } from '../../../../../../lib/next-mocks.test-support';

/**
 * WP-SB2: a snapshot's requirement mapping, facts and documents each sit in a group that opens and
 * closes, with its count in the title; the first one starts open and the confirmation panel stays
 * in view below them.
 */

const mocks = vi.hoisted(() => ({
  getMissionForOwner: vi.fn(),
  getMissionSnapshot: vi.fn(),
  listAcknowledgementsForMission: vi.fn(),
}));
vi.mock('@visastack/services', () => mocks);
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner' }),
}));
vi.mock('./acknowledgement-panel', () => ({ AcknowledgementPanel: stub('AcknowledgementPanel') }));

const { default: SnapshotPage } = await import('./page');

const ok = <T,>(value: T) => ({ ok: true as const, value });

function content(requirements: number) {
  return {
    missionId: 'synthetic-case',
    state: 'IN_PROGRESS',
    packVersion: null,
    evidenceScope: 'case_selected',
    facts: Array.from({ length: 40 }, (_, i) => ({
      factId: `fact-${i}`,
      fieldKey: 'given_name',
      value: `Value ${i}`,
      repeatingRecordKey: null,
    })),
    documents: Array.from({ length: 30 }, (_, i) => ({
      documentId: `doc-${i}`,
      documentVersionId: `version-${i}`,
      docType: null,
      displayName: `Document ${i}`,
      sha256: null,
      eligible: true,
    })),
    requirementMapping: Array.from({ length: requirements }, (_, i) => ({
      kind: 'DOCUMENT',
      key: `requirement_${i}`,
      citation: 'rule',
      optional: false,
      satisfied: true,
    })),
    readiness: null,
  };
}

const render = async (query: Record<string, string> = {}) =>
  new (await import('jsdom')).JSDOM(
    await renderServer(
      await SnapshotPage({
        params: Promise.resolve({ id: 'synthetic-case', snapshotId: 'snap-1' }),
        searchParams: Promise.resolve(query),
      }),
    ),
  ).window.document;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMissionForOwner.mockResolvedValue(ok({ id: 'synthetic-case', title: 'Japan visa' }));
  mocks.listAcknowledgementsForMission.mockResolvedValue(ok([]));
});

describe('a snapshot in groups', () => {
  it('puts the mapping, facts and documents in counted groups with the mapping open', async () => {
    mocks.getMissionSnapshot.mockResolvedValue(
      ok({ id: 'snap-1', version: 3, checksum: 'abc', content: content(60) }),
    );
    const page = await render();
    const groups = [...page.querySelectorAll('details.collapsible-group')];
    expect(groups.map((g) => g.id)).toEqual([
      'snapshot-requirements',
      'snapshot-facts',
      'snapshot-documents',
    ]);
    expect(groups.map((g) => g.querySelector('.collapsible-group-title')?.textContent)).toEqual([
      'What Satisfies Each Requirement',
      'Facts at This Snapshot',
      'Documents at This Snapshot',
    ]);
    expect(groups.map((g) => g.querySelector('.collapsible-group-count')?.textContent)).toEqual([
      '60',
      '40',
      '30',
    ]);
    expect(groups.map((g) => g.hasAttribute('open'))).toEqual([true, false, false]);
    expect(groups[1]?.querySelectorAll('.row')).toHaveLength(8);
    expect(page.querySelector('[data-stub="AcknowledgementPanel"]')).not.toBeNull();
  });

  it('opens the facts first when the snapshot has no mapping', async () => {
    mocks.getMissionSnapshot.mockResolvedValue(
      ok({ id: 'snap-1', version: 1, checksum: 'abc', content: content(0) }),
    );
    const page = await render();
    const groups = [...page.querySelectorAll('details.collapsible-group')];
    expect(groups.map((g) => g.id)).toEqual(['snapshot-facts', 'snapshot-documents']);
    expect(groups.map((g) => g.hasAttribute('open'))).toEqual([true, false]);
  });
});

/**
 * WP-SB11: an open part shows 8 rows, then Show More inside it adds 8 more and keeps that part
 * open, up to the part's own length, so no row is ever out of reach.
 */
describe('a snapshot part shows 8 rows, then Show More', () => {
  const PATH = '/app/mission/synthetic-case/snapshots/snap-1';

  beforeEach(() => {
    mocks.getMissionSnapshot.mockResolvedValue(
      ok({ id: 'snap-1', version: 3, checksum: 'abc', content: content(60) }),
    );
  });

  it('caps each part at 8 rows with a Show More link that opens the same part', async () => {
    const page = await render();
    for (const [key, total, noun] of [
      ['requirements', 60, 'requirements'],
      ['facts', 40, 'facts'],
      ['documents', 30, 'documents'],
    ] as const) {
      const group = page.getElementById(`snapshot-${key}`);
      expect(group?.querySelectorAll('.row')).toHaveLength(8);
      expect(group?.querySelector('.show-more-count')?.textContent).toBe(
        `Showing 8 of ${total} ${noun}.`,
      );
      expect(group?.querySelector('a.show-more-link')?.getAttribute('href')).toBe(
        `${PATH}?${key}=16&open=${key}#snapshot-${key}-row-8`,
      );
      expect(group?.querySelector(`#snapshot-${key}-row-7`)).not.toBeNull();
    }
  });

  it('opens the part named by its Show More and grows only that part', async () => {
    const page = await render({ facts: '16', open: 'facts' });
    const groups = [...page.querySelectorAll('details.collapsible-group')];
    expect(groups.map((g) => g.hasAttribute('open'))).toEqual([false, true, false]);
    expect(page.querySelectorAll('#snapshot-facts .row')).toHaveLength(16);
    expect(page.querySelectorAll('#snapshot-requirements .row')).toHaveLength(8);
    expect(page.getElementById('snapshot-facts-row-8')).not.toBeNull();
  });

  it('reaches every row of the longest part and then offers no more', async () => {
    const page = await render({ requirements: '64' });
    expect(page.querySelectorAll('#snapshot-requirements .row')).toHaveLength(60);
    expect(page.querySelector('#snapshot-requirements a.show-more-link')).toBeNull();
    expect(page.querySelector('#snapshot-requirements .show-more-count')?.textContent).toBe(
      'Showing all 60 requirements.',
    );
  });

  it('keeps a part longer than 100 rows fully reachable', async () => {
    mocks.getMissionSnapshot.mockResolvedValue(
      ok({ id: 'snap-1', version: 3, checksum: 'abc', content: content(137) }),
    );
    const page = await render({ requirements: '140' });
    expect(page.querySelectorAll('#snapshot-requirements .row')).toHaveLength(137);
    expect(page.querySelector('#snapshot-requirements a.show-more-link')).toBeNull();
  });

  it('falls back to 8 rows and the first part for anything malformed in the address', async () => {
    const page = await render({ requirements: '-5', facts: 'many', open: 'everything' });
    const groups = [...page.querySelectorAll('details.collapsible-group')];
    expect(groups.map((g) => g.hasAttribute('open'))).toEqual([true, false, false]);
    expect(page.querySelectorAll('#snapshot-requirements .row')).toHaveLength(8);
    expect(page.querySelectorAll('#snapshot-facts .row')).toHaveLength(8);
  });
});
