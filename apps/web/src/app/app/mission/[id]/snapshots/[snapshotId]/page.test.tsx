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

const render = async () =>
  new (await import('jsdom')).JSDOM(
    await renderServer(
      await SnapshotPage({
        params: Promise.resolve({ id: 'synthetic-case', snapshotId: 'snap-1' }),
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
    expect(groups[1]?.querySelectorAll('.row')).toHaveLength(40);
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
 * WP-SB11: an open part draws its first 8 rows, then Show All inside the part reveals the rest.
 * Every row stays on the page (folded, not left out), so find-in-page and the confirmation below
 * still cover the whole snapshot.
 */
describe('a snapshot part shows 8 rows, then Show All', () => {
  /** The rows drawn before Show All (not inside the folded rest). */
  const visible = (part: Element | null) =>
    [...(part?.querySelectorAll('.row') ?? [])].filter(
      (row) => !row.closest('.snapshot-rows-more'),
    );

  it('draws 8 rows of each part and folds the rest, all still on the page', async () => {
    mocks.getMissionSnapshot.mockResolvedValue(
      ok({ id: 'snap-1', version: 3, checksum: 'abc', content: content(60) }),
    );
    const page = await render();
    for (const [key, total, label] of [
      ['requirements', 60, 'Requirements'],
      ['facts', 40, 'Facts'],
      ['documents', 30, 'Documents'],
    ] as const) {
      const part = page.getElementById(`snapshot-${key}`);
      expect(part?.querySelectorAll('.row')).toHaveLength(total);
      expect(visible(part)).toHaveLength(8);
      const more = part?.querySelector('details.snapshot-rows-more');
      expect(more?.hasAttribute('open')).toBe(false);
      expect(more?.querySelectorAll('.row')).toHaveLength(total - 8);
      expect(more?.querySelector('summary .snapshot-rows-more-closed')?.textContent).toBe(
        `Show All ${total} ${label}`,
      );
      expect(more?.querySelector('summary .snapshot-rows-more-open')?.textContent).toBe(
        `Show Fewer ${label}`,
      );
    }
  });

  it('has no Show All when a part holds 8 rows or fewer', async () => {
    const short = content(8);
    mocks.getMissionSnapshot.mockResolvedValue(
      ok({
        id: 'snap-1',
        version: 3,
        checksum: 'abc',
        content: { ...short, facts: short.facts.slice(0, 3), documents: [] },
      }),
    );
    const page = await render();
    expect(page.querySelectorAll('#snapshot-requirements .row')).toHaveLength(8);
    expect(page.querySelector('.snapshot-rows-more')).toBeNull();
    expect(page.querySelectorAll('#snapshot-facts .row')).toHaveLength(3);
  });
});
