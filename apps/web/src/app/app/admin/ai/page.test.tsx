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
vi.mock('./forms', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { AiFeatureForm: stub('AiFeatureForm') };
});

const { default: Page } = await import('./page');

const feature = {
  feature: 'ai_app_suggestions',
  name: 'AI App Suggestions',
  description: 'Lets the AI apps people connect leave suggestions.',
  enabled: false,
  adminDailyLimit: null,
  planDailyLimit: 15,
  ready: true,
  updatedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
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
  });

  it('says plainly when the switches are not available yet', async () => {
    mocks.listAiFeatureSettings.mockResolvedValue({
      ok: true,
      value: { available: false, features: [feature] },
    });
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('every AI feature listed here stays off');
    expect(text).not.toContain('Change AI App Suggestions');
  });
});

describe('after a fresh sign-in check', () => {
  it('hands the typed values back to that feature’s form, unsaved', async () => {
    const first = await renderServer(
      Page({
        searchParams: Promise.resolve({
          retry_feature: 'ai_app_suggestions',
          retry_on: '1',
          retry_limit: '10',
        }),
      }),
    );
    expect(stubProps(first, 'AiFeatureForm')[0]).toMatchObject({
      retry: { enabled: true, dailyLimit: '10' },
    });
    const other = await renderServer(
      Page({ searchParams: Promise.resolve({ retry_feature: 'unknown' }) }),
    );
    expect(stubProps(other, 'AiFeatureForm')[0]).not.toHaveProperty('retry');
  });
});
