import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  navigationState,
  renderServer,
  stubProps,
  textOf,
} from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  loadOrgAccess: vi.fn(),
  getOrganizationBrandingForDisplay: vi.fn(),
  getPlatformCapabilities: vi.fn(),
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../../lib/storage', () => ({ createStorage: () => ({}) }));
vi.mock('../../../../../lib/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../lib/capabilities')>()),
  getPlatformCapabilities: () => mocks.getPlatformCapabilities(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getOrganizationBrandingForDisplay: (...args: unknown[]) =>
    mocks.getOrganizationBrandingForDisplay(...args),
}));
vi.mock('../console-data', () => ({ loadOrgAccess: mocks.loadOrgAccess }));
vi.mock('../branding-form', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { BrandingForm: stub('BrandingForm') };
});
vi.mock('../require-different-reviewer-toggle', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { RequireDifferentReviewerToggle: stub('RequireDifferentReviewerToggle') };
});

const { default: Page } = await import('./page');

const props = { params: Promise.resolve({ orgId: 'o1' }) };
const org = {
  id: 'o1',
  name: 'Dhaka Visa Desk',
  accentColor: '#1a56db',
  requireDifferentReviewer: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1/settings';
  mocks.loadOrgAccess.mockResolvedValue({ org, admin: true, member: true });
  mocks.getOrganizationBrandingForDisplay.mockResolvedValue({
    accentColor: '#1a56db',
    logoUrl: '/api/branding/logo/o1?v=abc',
  });
  mocks.getPlatformCapabilities.mockReturnValue({ bulkExport: 'available' });
});

describe('agency Settings', () => {
  it('shows the review policy with its current value', async () => {
    const html = await renderServer(Page(props));
    expect(textOf(html)).toContain('Require a different reviewer');
    expect(stubProps(html, 'RequireDifferentReviewerToggle')).toEqual([
      { organizationId: 'o1', required: true },
    ]);
  });

  it('gives the branding form the current name, colour and logo', async () => {
    const [form] = stubProps(await renderServer(Page(props)), 'BrandingForm');
    expect(form).toEqual({
      organizationId: 'o1',
      name: 'Dhaka Visa Desk',
      accentColor: '#1a56db',
      logoUrl: '/api/branding/logo/o1?v=abc',
    });
  });

  it('passes no logo when the organization has none', async () => {
    mocks.getOrganizationBrandingForDisplay.mockResolvedValue(undefined);
    const [form] = stubProps<{ logoUrl: string | null }>(
      await renderServer(Page(props)),
      'BrandingForm',
    );
    expect(form?.logoUrl).toBeNull();
  });

  it('offers the bulk export as a download when it is available', async () => {
    const html = await renderServer(Page(props));
    expect(html).toContain('href="/app/agency/o1/export?purpose=agency_review"');
    expect(html).toContain('download');
  });

  it('disables the bulk export, and says why, when it is not available', async () => {
    mocks.getPlatformCapabilities.mockReturnValue({ bulkExport: 'disabled' });
    const html = await renderServer(Page(props));
    expect(html).not.toContain('/export?purpose=agency_review');
    expect(html).toContain('disabled');
    expect(textOf(html)).toContain('not currently available in the controlled pilot');
  });

  it('tells a member who is not an administrator, and reads no branding for them', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org, admin: false, member: true });
    const html = await renderServer(Page(props));
    expect(textOf(html)).toContain("limited to this organization's owners and admins");
    expect(mocks.getOrganizationBrandingForDisplay).not.toHaveBeenCalled();
    expect(stubProps(html, 'BrandingForm')).toHaveLength(0);
  });

  it('renders nothing for someone with no role', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org, admin: false, member: false });
    expect(await renderServer(Page(props))).toBe('');
  });
});
