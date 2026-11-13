import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer } from '../../../../../lib/next-mocks.test-support';
import { missingBengali } from '../../agency-bn.test-support';

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

const mocks = vi.hoisted(() => ({ loadOrgAccess: vi.fn(), list: vi.fn() }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listAgencyAiConnections: (...args: unknown[]) => mocks.list(...args),
}));
vi.mock('../console-data', () => ({ loadOrgAccess: mocks.loadOrgAccess }));
vi.mock('../ai-actions', () => ({ turnOffAgencyAiConnectionAction: vi.fn() }));

const { default: Page } = await import('./page');

async function draw(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  return renderServer(Page({ params: Promise.resolve({ orgId: 'o1' }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1/ai-connections';
  mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: true, member: true });
  mocks.list.mockResolvedValue({ ok: true, value: { available: true, connections: [] } });
});

describe('AI connections under Bengali', () => {
  it('with no app connected: the heading, what each app reads and the empty state', async () => {
    const html = await draw('bn');
    expect(html).not.toMatch(/appAgency\./);
    expect(
      missingBengali(html, [
        'appAgencyOrgidAiConnectionsPage.aiConnections',
        'appAgencyOrgidAiConnectionsPage.eachAppReadsForEachCase',
        'appAgencyOrgidAiConnectionsPage.noAiAppsConnected',
        'appAgencyOrgidAiConnectionsPage.anOwnerOrAdminCanConnect',
      ]),
    ).toEqual([]);
    expect(html).not.toContain('No AI Apps Connected');
  });

  it('keeps the English page as it was', async () => {
    const html = await draw('en');
    expect(html).toContain('No AI Apps Connected');
    expect(html).not.toMatch(/[ঀ-৿]/);
  });
});
