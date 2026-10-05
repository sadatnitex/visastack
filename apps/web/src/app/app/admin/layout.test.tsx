import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer } from '../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  isPlatformAdmin: vi.fn(),
  hasPlatformPermission: vi.fn(),
}));

vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../lib/admin', () => mocks);

const { default: Layout } = await import('./layout');

function allow(permissions: Record<string, boolean>) {
  mocks.hasPlatformPermission.mockImplementation(
    async (_db: unknown, _ctx: unknown, action: string) => permissions[action] ?? false,
  );
}

const tabLabels = (html: string) =>
  [...html.matchAll(/<a href="[^"]*"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin';
  mocks.isPlatformAdmin.mockResolvedValue(true);
  allow({ AI_SETTINGS_MANAGE: true, COMPLAINT_MANAGE: true });
});

describe('platform section bar', () => {
  it('shows every section, in the directive order, above the page', async () => {
    const html = await renderServer(Layout({ children: <p id="page">the page</p> }));
    expect(tabLabels(html)).toEqual([
      'Organizations',
      'Rules',
      'AI',
      'Operations',
      'Privacy',
      'Audit',
      'Access',
      'Complaints',
    ]);
    expect(html.indexOf('subnav')).toBeLessThan(html.indexOf('id="page"'));
    expect(html).toContain('aria-label="Platform sections"');
  });

  it('marks the section being viewed as current', async () => {
    navigationState.pathname = '/app/admin/audit';
    const html = await renderServer(Layout({ children: null }));
    expect(html).toMatch(/<a href="\/app\/admin\/audit" aria-current="page">Audit<\/a>/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('marks Operations on the landing page and nothing else', async () => {
    navigationState.pathname = '/app/admin';
    const html = await renderServer(Layout({ children: null }));
    expect(html).toMatch(/<a href="\/app\/admin" aria-current="page">Operations<\/a>/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('leaves out AI and Complaints for an administrator who may not use them', async () => {
    allow({});
    const labels = tabLabels(await renderServer(Layout({ children: null })));
    expect(labels).not.toContain('AI');
    expect(labels).not.toContain('Complaints');
    expect(labels).toContain('Operations');
  });

  it('shows no bar, but still the page, to someone who is not a platform administrator', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    const html = await renderServer(Layout({ children: <p id="page">the page</p> }));
    expect(html).not.toContain('subnav');
    expect(html).toContain('id="page"');
    expect(mocks.hasPlatformPermission).not.toHaveBeenCalled();
  });
});
