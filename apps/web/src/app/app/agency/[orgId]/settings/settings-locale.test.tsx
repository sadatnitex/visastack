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
  getOrganizationBrandingForDisplay: vi.fn(),
  getPlatformCapabilities: vi.fn(),
  getOrganizationAiSetting: vi.fn(),
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
  getOrganizationAiSetting: (...args: unknown[]) => mocks.getOrganizationAiSetting(...args),
}));
vi.mock('../agency-ai-setting-form', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { AgencyAiSettingForm: stub('AgencyAiSettingForm') };
});
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
const aiSetting = (enabled: boolean) => ({
  available: true,
  enabled,
  updatedAt: null,
  canChange: true,
  feature: { feature: 'ai_agency_tools', available: true, reason: null, dailyLimit: 500 },
});

async function draw(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  return renderServer(Page(props));
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1/settings';
  mocks.loadOrgAccess.mockResolvedValue({
    org: {
      id: 'o1',
      name: 'Dhaka Visa Desk',
      accentColor: '#1a56db',
      requireDifferentReviewer: true,
    },
    admin: true,
    member: true,
  });
  mocks.getOrganizationBrandingForDisplay.mockResolvedValue(undefined);
  mocks.getPlatformCapabilities.mockReturnValue({ bulkExport: 'available' });
  mocks.getOrganizationAiSetting.mockResolvedValue({ ok: true, value: aiSetting(true) });
});

describe('the agency settings page under Bengali', () => {
  it('draws the export card and the on state of the AI setting in Bengali', async () => {
    const html = await draw('bn');
    expect(html).not.toMatch(/appAgency\./);
    expect(
      missingBengali(html, ['appAgencyOrgidSettingsPage.export', 'appAgencyOrgidSettingsPage.on']),
    ).toEqual([]);
  });

  it('draws the off state of the AI setting in Bengali', async () => {
    mocks.getOrganizationAiSetting.mockResolvedValue({ ok: true, value: aiSetting(false) });
    const html = await draw('bn');
    expect(missingBengali(html, ['appAgencyOrgidSettingsPage.off'])).toEqual([]);
    expect(html).not.toMatch(/appAgency\./);
  });

  it('tells a member who is not an administrator that settings are limited, in Bengali', async () => {
    mocks.loadOrgAccess.mockResolvedValue({
      org: {
        id: 'o1',
        name: 'Dhaka Visa Desk',
        accentColor: null,
        requireDifferentReviewer: false,
      },
      admin: false,
      member: true,
    });
    const html = await draw('bn');
    expect(
      missingBengali(html, ['appAgencyOrgidSettingsPage.settingsAreLimitedToThisOrganization']),
    ).toEqual([]);
    expect(html).not.toContain('Settings are limited to');
  });

  it('keeps the English page as it was', async () => {
    const html = await draw('en');
    expect(html).toContain('Bulk Export');
  });
});
