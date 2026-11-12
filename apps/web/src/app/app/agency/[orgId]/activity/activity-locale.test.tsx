import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer } from '../../../../../lib/next-mocks.test-support';
import { missingBengali } from '../../agency-bn.test-support';

// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));
vi.mock('server-only', () => ({}));

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

const props = { params: Promise.resolve({ orgId: 'o1' }), searchParams: Promise.resolve({}) };

async function draw(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  return renderServer(Page(props));
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1/activity';
  mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: true, member: true });
  mocks.loadMembers.mockResolvedValue([]);
});

describe('the case activity page under Bengali', () => {
  it('draws the log with notes in Bengali', async () => {
    mocks.loadCaseActivity.mockResolvedValue({
      cases: [{ missionId: 'm0', title: 'Case 0' }],
      caseLimitReached: true,
      nextCursor: 'older-page',
      notes: [
        {
          id: 'n0',
          createdAt: new Date(Date.UTC(2026, 9, 20, 12, 0)),
          body: 'Note body',
          caseTitle: 'Case 0',
          missionId: 'm0',
          authorEmail: 'author@example.com',
        },
      ],
    });
    const html = await draw('bn');
    expect(html).not.toMatch(/appAgency\./);
    expect(missingBengali(html, ['appAgencyOrgidActivityPage.caseActivity'])).toEqual([]);
  });

  it('says in Bengali that nothing has been recorded when the log is empty', async () => {
    mocks.loadCaseActivity.mockResolvedValue({
      cases: [],
      caseLimitReached: false,
      nextCursor: null,
      notes: [],
    });
    const html = await draw('bn');
    expect(html).not.toMatch(/appAgency\./);
    expect(missingBengali(html, ['appAgencyOrgidActivityPage.noCaseActivityRecorded'])).toEqual([]);
  });

  it('keeps the English page as it was', async () => {
    mocks.loadCaseActivity.mockResolvedValue({
      cases: [],
      caseLimitReached: false,
      nextCursor: null,
      notes: [],
    });
    expect(await draw('en')).toContain('No Case Activity Recorded');
  });
});
