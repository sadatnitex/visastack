import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  navigationState,
  renderServer,
  stubProps,
  textOf,
} from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  listAiFeatureSettings: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'owner@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: (...args: unknown[]) => mocks.staffPrincipal(...args),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listAiFeatureSettings: (...args: unknown[]) => mocks.listAiFeatureSettings(...args),
}));
/** The cookies this request carries. */
const requestCookies = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      requestCookies.has(name) ? { name, value: requestCookies.get(name) } : undefined,
  }),
}));
vi.mock('./forms', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { AiFeatureForm: stub('AiFeatureForm') };
});
vi.mock('./provider-settings', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return {
    loadAiProviderSettings: async () => ({ hasAny: false }),
    AiProvidersSection: stub('AiProvidersSection'),
    DataTermsSection: stub('DataTermsSection'),
    AiAppsSection: stub('AiAppsSection'),
  };
});

const { default: Page } = await import('./page');
const { AI_FEATURE_RETRY_COOKIE, encodeAiFeatureRetry } = await import(
  '../../../../lib/ai-feature-retry'
);

const feature = {
  feature: 'ai_app_suggestions',
  name: 'AI App Suggestions',
  description: 'Lets the AI apps people connect leave suggestions.',
  kind: 'connector',
  enabled: false,
  planIncluded: true,
  adminDailyLimit: null,
  planDailyLimit: 15,
  ready: true,
  updatedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  requestCookies.clear();
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'x'.repeat(64));
  navigationState.pathname = '/app/admin/ai';
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: { kind: 'staff' } });
  mocks.listAiFeatureSettings.mockResolvedValue({
    ok: true,
    value: { available: true, features: [feature] },
  });
});

describe('Platform > AI Features', () => {
  it('lists each registered feature with its switch, its limit and what turning it off does', async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text).toContain('AI Features');
    expect(text).toContain('AI App Suggestions');
    expect(text).toContain('Off');
    expect(text).toContain('Daily Limit per Person');
    expect(text).toContain('15 a day (the plan’s limit)');
    expect(text).toContain('It never removes anything people already have');
    expect(text).toContain('Everything else in VisaStack keeps working.');
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('AI_FEATURES_MANAGE');
    expect(mocks.listAiFeatureSettings.mock.calls[0]?.[1]).toEqual({ kind: 'staff' });
    // S28: one AI area, the provider sections beside the features.
    expect(text).toContain('AI Settings');
    expect(text).toContain('limits start again at 6 AM Bangladesh time');
    expect(stubProps(html, 'AiProvidersSection')).toHaveLength(1);
    expect(stubProps(html, 'DataTermsSection')).toHaveLength(1);
    expect(stubProps(html, 'AiAppsSection')).toHaveLength(1);
  });

  it('shows a security admin the providers, data terms and AI apps, never the feature switches', async () => {
    mocks.staffPrincipal.mockImplementation(
      async (_db: unknown, _actor: unknown, action: string) =>
        action === 'AI_SETTINGS_MANAGE'
          ? { ok: true, value: { kind: 'staff' } }
          : { ok: false, error: { code: 'forbidden' } },
    );
    const html = await renderServer(Page());
    expect(mocks.listAiFeatureSettings).not.toHaveBeenCalled();
    expect(textOf(html)).not.toContain('What Turning a Feature Off Does');
    expect(stubProps(html, 'AiProvidersSection')).toHaveLength(1);
  });

  it('marks a feature the traveller plan leaves out', async () => {
    mocks.listAiFeatureSettings.mockResolvedValue({
      ok: true,
      value: { available: true, features: [{ ...feature, planIncluded: false }] },
    });
    expect(textOf(await renderServer(Page()))).toContain('Not in the Traveller Plan');
  });

  it('shows a lowered limit and a feature that is on', async () => {
    mocks.listAiFeatureSettings.mockResolvedValue({
      ok: true,
      value: {
        available: true,
        features: [{ ...feature, enabled: true, adminDailyLimit: 5, updatedAt: new Date() }],
      },
    });
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('5 a day (lowered from the plan’s 15)');
    expect(text).toContain('Last changed on');
  });

  it('is restricted to the platform owner', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const text = textOf(await renderServer(Page()));
    expect(mocks.listAiFeatureSettings).not.toHaveBeenCalled();
    expect(text).not.toContain('AI App Suggestions');
    expect(text).toContain('restricted');
  });

  it('says plainly when the switches are not available yet', async () => {
    mocks.listAiFeatureSettings.mockResolvedValue({
      ok: true,
      value: { available: false, features: [feature] },
    });
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('each AI feature keeps its standard setting');
    expect(text).not.toContain('Change AI App Suggestions');
  });
});

describe('after a fresh sign-in check (S21 round 3: never from the address)', () => {
  const typed = { feature: 'ai_app_suggestions', enabled: true, dailyLimit: '10' } as const;

  it('a crafted link fills nothing and shows no notice', async () => {
    const page = Page as unknown as (props: unknown) => ReturnType<typeof Page>;
    const html = await renderServer(
      page({
        searchParams: Promise.resolve({
          retry_feature: 'ai_app_suggestions',
          retry_on: '1',
          retry_limit: '10',
        }),
      }),
    );
    expect(stubProps(html, 'AiFeatureForm')[0]).not.toHaveProperty('retry');
  });

  it('a valid cookie signed for this account hands the typed values back, unsaved', async () => {
    requestCookies.set(AI_FEATURE_RETRY_COOKIE, encodeAiFeatureRetry(typed, 'acct-1') ?? '');
    const html = await renderServer(Page());
    expect(stubProps(html, 'AiFeatureForm')[0]).toMatchObject({
      retry: { enabled: true, dailyLimit: '10' },
    });
    // The fold with the typed values starts open, so they are not hidden.
    expect(html).toMatch(/<details class="sb7-fold" open="">/);
  });

  it('ignores a cookie for another account, a forged one or an expired one', async () => {
    for (const value of [
      encodeAiFeatureRetry(typed, 'someone-else') ?? '',
      `${Buffer.from(JSON.stringify({ f: 'ai_app_suggestions', o: true, l: '10', a: 'acct-1', x: 9e9 })).toString('base64url')}.forged`,
      encodeAiFeatureRetry(typed, 'acct-1', new Date('2020-01-01T00:00:00Z')) ?? '',
    ]) {
      requestCookies.set(AI_FEATURE_RETRY_COOKIE, value);
      expect(stubProps(await renderServer(Page()), 'AiFeatureForm')[0]).not.toHaveProperty('retry');
    }
  });
});

describe('Platform > AI Features grouped and folded (WP-SB7)', () => {
  const agencyFeature = {
    ...feature,
    feature: 'ai_agency_tools',
    name: 'Agency AI Tools',
    description: 'Lets agency owners connect an AI app.',
  };

  it('groups features by audience, travellers first, and folds each form under Change', async () => {
    mocks.listAiFeatureSettings.mockResolvedValue({
      ok: true,
      value: { available: true, features: [agencyFeature, feature] },
    });
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text.indexOf('For Travellers')).toBeGreaterThan(-1);
    expect(text.indexOf('For Agencies')).toBeGreaterThan(text.indexOf('AI App Suggestions'));
    expect(text.indexOf('Agency AI Tools')).toBeGreaterThan(text.indexOf('For Agencies'));
    expect(html.match(/<details class="sb7-fold">/g)).toHaveLength(2);
    expect(text).toContain('Change AI App Suggestions');
    expect(text).toContain('Change Agency AI Tools');
    expect(stubProps(html, 'AiFeatureForm')).toHaveLength(2);
  });

  it('leaves out a group with no features', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('For Travellers');
    expect(text).not.toContain('For Agencies');
  });
});
