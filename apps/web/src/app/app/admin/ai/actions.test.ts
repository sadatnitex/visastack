import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  updateAiFeatureSetting: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  updateAiFeatureSetting: mocks.updateAiFeatureSetting,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner', email: 'owner@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: mocks.staffPrincipal,
}));
vi.mock('../../../../lib/step-up', () => ({
  tryEstablishStepUp: mocks.tryEstablishStepUp,
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Step-up is not configured here.',
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
/** The browser's cookie jar for this page. */
const jar = new Map<string, { value: string; options: unknown }>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)?.value } : undefined),
    set: (name: string, value: string, options: unknown) => {
      jar.set(name, { value, options });
    },
    delete: (options: { name: string; path?: string }) => {
      expect(options.path).toBe('/app/admin/ai');
      jar.delete(options.name);
    },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
import { AI_FEATURE_RETRY_COOKIE, decodeAiFeatureRetry } from '../../../../lib/ai-feature-retry';
import { saveAiFeatureAction } from './actions';

const SCOPE = { kind: 'staff', platformAction: 'AI_FEATURES_MANAGE' };
const INITIAL = { ok: true, message: '' };
const stepUpNeeded = { ok: false, error: { code: 'step_up_required', message: 'x' } };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ feature: 'ai_app_suggestions', ...fields })) {
    data.set(key, value);
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  jar.clear();
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'x'.repeat(64));
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.updateAiFeatureSetting.mockResolvedValue({ ok: true, value: { changed: true } });
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'satisfied' });
});

describe('saving an AI feature', () => {
  it('asks for a fresh sign-in check, then saves the switch and the limit', async () => {
    mocks.updateAiFeatureSetting
      .mockResolvedValueOnce(stepUpNeeded)
      .mockResolvedValueOnce({ ok: true, value: { changed: true } });
    const result = await saveAiFeatureAction(INITIAL, form({ enabled: 'on', dailyLimit: '10' }));
    expect(result).toMatchObject({ ok: true, message: 'Saved. AI App Suggestions is on.' });
    expect(mocks.updateAiFeatureSetting.mock.calls.map((call) => call[2])).toEqual([
      { feature: 'ai_app_suggestions', enabled: true, dailyLimit: 10, stepUpSatisfied: false },
      { feature: 'ai_app_suggestions', enabled: true, dailyLimit: 10, stepUpSatisfied: true },
    ]);
    expect(mocks.tryEstablishStepUp.mock.calls[0]?.[0]).toMatchObject({
      action: 'AI_FEATURES_UPDATE',
      resourceId: 'ai_app_suggestions',
    });
    // The return address carries nothing typed (S21 round 3).
    expect(mocks.tryEstablishStepUp.mock.calls[0]?.[1]).toBe('/app/admin/ai');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/admin/ai');
  });

  it('keeps what was typed across the sign-in check in a signed cookie, and a successful save clears it', async () => {
    mocks.updateAiFeatureSetting.mockResolvedValueOnce(stepUpNeeded);
    mocks.tryEstablishStepUp.mockResolvedValueOnce({
      kind: 'reauth_required',
      reauthUrl: '/auth/sign-in?step_up=1',
    });
    await expect(
      saveAiFeatureAction(INITIAL, form({ enabled: 'on', dailyLimit: '10' })),
    ).rejects.toThrow('NEXT_REDIRECT:/auth/sign-in?step_up=1');
    const kept = jar.get(AI_FEATURE_RETRY_COOKIE);
    expect(kept?.options).toMatchObject({ httpOnly: true, path: '/app/admin/ai', maxAge: 900 });
    expect(decodeAiFeatureRetry(kept?.value, 'synthetic-owner')).toEqual({
      feature: 'ai_app_suggestions',
      enabled: true,
      dailyLimit: '10',
    });
    // Back from the check, the owner saves again: the remembered values are gone.
    const saved = await saveAiFeatureAction(INITIAL, form({ enabled: 'on', dailyLimit: '10' }));
    expect(saved).toMatchObject({ ok: true });
    expect(jar.has(AI_FEATURE_RETRY_COOKIE)).toBe(false);
  });

  it('keeps the remembered values when the save is refused', async () => {
    jar.set(AI_FEATURE_RETRY_COOKIE, { value: 'kept', options: {} });
    mocks.updateAiFeatureSetting.mockResolvedValue({
      ok: false,
      error: { code: 'internal', message: 'x' },
    });
    expect((await saveAiFeatureAction(INITIAL, form({ enabled: 'on' }))).ok).toBe(false);
    expect(jar.has(AI_FEATURE_RETRY_COOKIE)).toBe(true);
  });

  it('says that turning it off keeps what people have', async () => {
    const result = await saveAiFeatureAction(INITIAL, form({ dailyLimit: '' }));
    expect(result.message).toBe(
      'Saved. AI App Suggestions is off. What people already have stays, and everything else works as usual.',
    );
    expect(mocks.updateAiFeatureSetting.mock.calls[0]?.[2]).toMatchObject({
      enabled: false,
      dailyLimit: null,
    });
  });

  it('refuses a limit outside 1 to 1000 at its box, keeping what was typed', async () => {
    for (const limit of ['0', '1001', '2.5', 'ten']) {
      const result = await saveAiFeatureAction(INITIAL, form({ enabled: 'on', dailyLimit: limit }));
      expect(result).toMatchObject({ ok: false, field: 'dailyLimit' });
      expect(result.values).toEqual({ enabled: true, dailyLimit: limit });
    }
    expect(mocks.updateAiFeatureSetting).not.toHaveBeenCalled();
  });

  it('is for the platform owner only, and only for registered features', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect((await saveAiFeatureAction(INITIAL, form({ enabled: 'on' }))).message).toBe(
      'Only the platform owner can change AI features.',
    );
    mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
    expect(
      (await saveAiFeatureAction(INITIAL, form({ feature: 'automatic_reading', enabled: 'on' })))
        .ok,
    ).toBe(false);
    expect(mocks.updateAiFeatureSetting).not.toHaveBeenCalled();
  });
});
