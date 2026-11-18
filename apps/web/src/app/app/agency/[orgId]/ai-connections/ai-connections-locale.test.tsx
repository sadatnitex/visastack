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

  it('with connections: one tile each, its clock, Last Used and Turn Off (WAL5)', async () => {
    const day = 86_400_000;
    const now = Date.now();
    mocks.list.mockResolvedValue({
      ok: true,
      value: {
        available: true,
        connections: [
          {
            id: 'c1',
            clientName: 'Claude',
            clientHost: 'claude.ai',
            connectedBy: 'admin@example.com',
            createdAt: new Date(now - day),
            endsAt: new Date(now + 29 * day + 3_600_000),
            lastUsedAt: null,
            live: true,
          },
          {
            id: 'c2',
            clientName: 'ChatGPT',
            clientHost: 'chatgpt.com',
            connectedBy: 'admin@example.com',
            createdAt: new Date(now - 3 * day),
            endsAt: new Date(now + 4 * day),
            lastUsedAt: new Date(now - day),
            live: false,
          },
        ],
      },
    });
    const html = await draw('en');
    expect(html.match(/data-ai-tile=""/g)).toHaveLength(2);
    const [live = '', ended = ''] = html.split('data-ai-tile=""').slice(1);
    expect(live).toContain('data-state="running"');
    expect(live).toMatch(/29 Days Left|30 Days Left/);
    expect(live).toContain('Not Used Yet');
    expect(live).toContain('<span class="sr-only">What Each Traveller Allowed</span></button>');
    expect(live).toContain('Turn Off');
    // Ended by the services (turned off before its end): the tile says Ended, whatever the end says.
    expect(ended).toContain('data-state="ended"');
    expect(ended).not.toContain('Days Left');
    expect(ended).toContain('admin@example.com');
    const bn = await draw('bn');
    expect(bn).not.toMatch(/appAgency\./);
    expect(bn).not.toMatch(/components\./);
  });
});
