import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../lib/axe.test-support';
import { renderServer } from '../../../../../lib/next-mocks.test-support';

/**
 * WP-SB2: every snapshot of a case, newest first, 25 per load, behind the same owner check as the
 * case page. The cursor in the address is passed through as it is; the service checks it.
 */

const mocks = vi.hoisted(() => ({
  getMissionForOwner: vi.fn(),
  listMissionSnapshots: vi.fn(),
}));
vi.mock('@visastack/services', () => mocks);
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { default: SnapshotsPage } = await import('./page');

const ok = <T,>(value: T) => ({ ok: true as const, value });
const snap = (version: number) => ({
  id: `snap-${version}`,
  version,
  checksum: `checksum-${version}-0123456789`,
  content: { state: version === 60 ? 'LOCKED' : 'IN_PROGRESS' },
  createdAt: new Date('2026-10-20T08:00:00Z'),
});

const render = async (query: Record<string, string | string[]> = {}) =>
  renderServer(
    await SnapshotsPage({
      params: Promise.resolve({ id: 'synthetic-case' }),
      searchParams: Promise.resolve(query),
    }),
  );
const doc = async (html: string) => new (await import('jsdom')).JSDOM(html).window.document;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMissionForOwner.mockResolvedValue(
    ok({ id: 'synthetic-case', title: 'Japan visitor visa' }),
  );
});

describe('All Snapshots', () => {
  it('lists the newest 25 and links to the older ones', async () => {
    mocks.listMissionSnapshots.mockResolvedValue(
      ok({ items: Array.from({ length: 25 }, (_, i) => snap(60 - i)), nextCursor: 'opaque_1' }),
    );
    const html = await render();
    expect(mocks.listMissionSnapshots).toHaveBeenCalledWith(
      {},
      'synthetic-owner',
      'synthetic-case',
      {
        limit: 25,
      },
    );
    const page = await doc(html);
    expect(page.querySelector('h1')?.textContent).toBe('All Snapshots');
    const rows = [...page.querySelectorAll('#snapshots-list a.row')];
    expect(rows).toHaveLength(25);
    expect(rows[0]?.getAttribute('href')).toBe('/app/mission/synthetic-case/snapshots/snap-60');
    expect(rows[0]?.textContent).toContain('Application Packet');
    const older = [...page.querySelectorAll('nav a')].find(
      (a) => a.textContent === 'Show Older Snapshots',
    );
    expect(older?.getAttribute('href')).toBe(
      '/app/mission/synthetic-case/snapshots?before=opaque_1#snapshots-list',
    );
    expect(html).not.toContain('Back to the Newest Snapshots');
    expect(await axeViolations(html)).toEqual([]);
  });

  it('passes a well-shaped cursor on and offers the way back on the last page', async () => {
    mocks.listMissionSnapshots.mockResolvedValue(ok({ items: [snap(1)], nextCursor: null }));
    const html = await render({ before: 'opaque_1' });
    expect(mocks.listMissionSnapshots.mock.calls[0]?.[3]).toEqual({
      limit: 25,
      before: 'opaque_1',
    });
    const page = await doc(html);
    expect(page.querySelector('h1')?.textContent).toBe('Older Snapshots');
    expect(html).not.toContain('Show Older Snapshots');
    expect(html).toContain('These are the oldest snapshots of this case.');
    expect(
      [...page.querySelectorAll('nav a')]
        .find((a) => a.textContent === 'Back to the Newest Snapshots')
        ?.getAttribute('href'),
    ).toBe('/app/mission/synthetic-case/snapshots');
  });

  it('drops a cursor with an impossible shape before it reaches the service', async () => {
    mocks.listMissionSnapshots.mockResolvedValue(ok({ items: [], nextCursor: null }));
    const html = await render({ before: '<script>' });
    expect(mocks.listMissionSnapshots.mock.calls[0]?.[3]).toEqual({ limit: 25 });
    expect(html).toContain('No snapshots yet.');
    expect(html).not.toContain('nav');
  });

  it('shows nothing of a case the reader does not own', async () => {
    mocks.getMissionForOwner.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.listMissionSnapshots).not.toHaveBeenCalled();
  });
});
