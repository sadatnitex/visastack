import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  loadOrgAccess: vi.fn(),
  getOrganizationBrandingForDisplay: vi.fn(),
  getPlatformCapabilities: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'member@example.com' }),
}));
vi.mock('../../../../lib/storage', () => ({ createStorage: () => ({}) }));
vi.mock('../../../../lib/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/capabilities')>()),
  getPlatformCapabilities: () => mocks.getPlatformCapabilities(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getOrganizationBrandingForDisplay: (...args: unknown[]) =>
    mocks.getOrganizationBrandingForDisplay(...args),
}));
vi.mock('./console-data', () => ({ loadOrgAccess: mocks.loadOrgAccess }));

const { default: Layout } = await import('./layout');

const params = Promise.resolve({ orgId: 'o1' });
const org = { id: 'o1', name: 'Dhaka Visa Desk', status: 'ACTIVE' };
const tabLabels = (html: string) =>
  [...html.matchAll(/<a href="[^"]*"[^>]*>([^<]*)<\/a>/g)]
    .map((m) => (m[1] ?? '').replaceAll('&amp;', '&'))
    .filter((label) => label !== '← Organizations');

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1';
  mocks.loadOrgAccess.mockResolvedValue({ org, admin: true, member: true });
  mocks.getOrganizationBrandingForDisplay.mockResolvedValue({ accentColor: null, logoUrl: null });
  mocks.getPlatformCapabilities.mockReturnValue({ agencyCollaboration: 'available' });
});

describe('agency console layout', () => {
  it('shows the organization, its status and the six sections to an administrator', async () => {
    const html = await renderServer(Layout({ children: <p id="page">the page</p>, params }));
    const text = textOf(html);
    expect(text).toContain('Dhaka Visa Desk');
    expect(text).toContain('Active');
    expect(text).toContain('Agency workspace');
    expect(tabLabels(html)).toEqual([
      'Dashboard',
      'Clients',
      'Cases',
      'Team',
      'Usage & billing',
      'Settings',
    ]);
    expect(html).toContain('id="page"');
    expect(html).toContain('aria-label="Organization sections"');
  });

  it('leaves Clients, Team and Settings out of the bar for a member who is not an administrator', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org, admin: false, member: true });
    const html = await renderServer(Layout({ children: <p id="page">the page</p>, params }));
    expect(tabLabels(html)).toEqual(['Dashboard', 'Cases', 'Usage & billing']);
    expect(html).toContain('id="page"');
  });

  it('shows the current section', async () => {
    navigationState.pathname = '/app/agency/o1/cases';
    const html = await renderServer(Layout({ children: null, params }));
    expect(html).toMatch(/<a href="\/app\/agency\/o1\/cases" aria-current="page">Cases<\/a>/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('tells someone with no role so, and renders neither the bar nor the page', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org, admin: false, member: false });
    const html = await renderServer(Layout({ children: <p id="page">the page</p>, params }));
    expect(textOf(html)).toContain("You don't have a role in this organization");
    expect(html).not.toContain('subnav');
    expect(html).not.toContain('id="page"');
    expect(textOf(html)).toContain('Dhaka Visa Desk');
  });

  it('answers not found for an organization that does not exist', async () => {
    mocks.loadOrgAccess.mockResolvedValue(null);
    await expect(Layout({ children: null, params })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('warns when agency collaboration is switched off, above the bar', async () => {
    mocks.getPlatformCapabilities.mockReturnValue({ agencyCollaboration: 'disabled' });
    const html = await renderServer(Layout({ children: null, params }));
    expect(html).toContain('notice-warn');
    expect(html.indexOf('notice-warn')).toBeLessThan(html.indexOf('subnav'));
  });

  it('shows no warning when collaboration is available', async () => {
    expect(await renderServer(Layout({ children: null, params }))).not.toContain('notice-warn');
  });
});
