import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  loadOrgAccess: vi.fn(),
  loadMembers: vi.fn(),
  loadCaseActivity: vi.fn(),
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'member@example.com' }),
}));
vi.mock('../console-data', () => mocks);

const { default: Page } = await import('./page');

const props = (query: Record<string, string> = {}) => ({
  params: Promise.resolve({ orgId: 'o1' }),
  searchParams: Promise.resolve(query),
});

const notes = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    createdAt: new Date(Date.UTC(2026, 9, 20, 12, 0) - i * 60_000),
    body: `Note body ${i}`,
    caseTitle: `Case ${i % 3}`,
    missionId: `m${i % 3}`,
    authorEmail: i % 2 === 0 ? 'author@example.com' : null,
  }));

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1/activity';
  mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: true, member: true });
  mocks.loadMembers.mockResolvedValue([{ accountId: 'a1', email: 'author@example.com' }]);
  mocks.loadCaseActivity.mockResolvedValue({
    cases: [0, 1, 2].map((i) => ({ missionId: `m${i}`, title: `Case ${i}` })),
    caseLimitReached: true,
    nextCursor: 'older-page',
    notes: notes(50),
  });
});

describe('agency Case Activity (WP-SB5)', () => {
  it('puts 50 notes in the fixed log panel with its filters and a named scrolling region', async () => {
    const html = await renderServer(Page(props()));
    expect(html).toContain('class="activity-log-scroll"');
    expect(html).toMatch(/aria-label="Case Activity Entries"/);
    expect(html.match(/class="row activity-log-row"/g)).toHaveLength(50);
    const text = textOf(html);
    expect(text).toContain('Note body 0');
    expect(text).toContain('Showing notes from the ten most recently updated accessible cases.');
  });

  it('offers Show Older Entries with the server cursor, and the way back once older', async () => {
    const html = await renderServer(Page(props()));
    expect(html).toContain('href="/app/agency/o1/activity?before=older-page#case-activity"');
    expect(mocks.loadCaseActivity).toHaveBeenCalledWith(
      {},
      'acct-1',
      'o1',
      [{ accountId: 'a1', email: 'author@example.com' }],
      { before: undefined },
    );
    const older = await renderServer(Page(props({ before: 'older-page' })));
    expect(mocks.loadCaseActivity.mock.calls[1]?.[4]).toEqual({ before: 'older-page' });
    expect(older).toContain('href="/app/agency/o1/activity#case-activity"');
  });

  it('ignores a cursor that is not shaped like one', async () => {
    await renderServer(Page(props({ before: '"><script>' })));
    expect(mocks.loadCaseActivity.mock.calls[0]?.[4]).toEqual({ before: undefined });
  });

  it('links each case in the activity to its workspace', async () => {
    const html = await renderServer(Page(props()));
    for (const i of [0, 1, 2]) {
      expect(html).toContain(`href="/app/agency/o1/cases?case=m${i}#mission-m${i}"`);
    }
  });

  it('says so when nothing has been recorded, and renders nothing for someone with no role', async () => {
    mocks.loadCaseActivity.mockResolvedValue({
      cases: [],
      caseLimitReached: false,
      nextCursor: null,
      notes: [],
    });
    expect(textOf(await renderServer(Page(props())))).toContain('No Case Activity Recorded');
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: false });
    expect(await renderServer(Page(props()))).toBe('');
  });
});
