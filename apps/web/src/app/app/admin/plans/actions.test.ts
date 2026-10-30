import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  listPlansForAdmin: vi.fn(),
  savePlan: vi.fn(),
  previewPlanRetire: vi.fn(),
  retirePlan: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  listPlansForAdmin: mocks.listPlansForAdmin,
  savePlan: mocks.savePlan,
  previewPlanRetire: mocks.previewPlanRetire,
  retirePlan: mocks.retirePlan,
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
const jar = new Map<string, { value: string; options: unknown }>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)?.value } : undefined),
    set: (name: string, value: string, options: unknown) => {
      jar.set(name, { value, options });
    },
    delete: (options: { name: string; path?: string }) => {
      expect(options.path).toBe('/app/admin/plans');
      jar.delete(options.name);
    },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
import { PLAN_FORM_RETRY_COOKIE, decodePlanFormRetry } from '../../../../lib/plan-form-retry';
import { retirePlanAction, savePlanAction } from './actions';

const PLAN = '00000000-0000-4000-8000-000000000009';
const SCOPE = { kind: 'staff', platformAction: 'PLANS_MANAGE' };
const INITIAL = { ok: true, message: '' };
const stepUpNeeded = { ok: false, error: { code: 'step_up_required', message: 'x' } };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  const base = {
    planId: PLAN,
    name: 'Agency Growth',
    periodDays: '30',
    price: '2,500.00',
    currency: 'BDT',
  };
  for (const [key, value] of Object.entries({ ...base, ...fields })) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  jar.clear();
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'x'.repeat(64));
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.listPlansForAdmin.mockResolvedValue({
    ok: true,
    value: {
      available: true,
      plans: [{ id: PLAN, price: { priceMinorUnits: 250000, currency: 'BDT' } }],
    },
  });
  mocks.savePlan.mockResolvedValue({
    ok: true,
    value: { planId: PLAN, created: false, changed: true, priceChanged: false },
  });
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'satisfied' });
});

describe('saving a plan (S29)', () => {
  it('reads the price in the typed currency, the limits and the AI features, after a fresh sign-in check', async () => {
    mocks.savePlan.mockResolvedValueOnce(stepUpNeeded);
    const result = await savePlanAction(
      INITIAL,
      form({
        'limit.seats': '5',
        'limit.storage_bytes': '2048',
        'on.ai_app_suggestions': 'on',
        'limit.ai.ai_app_suggestions': '10',
      }),
    );
    expect(result).toMatchObject({ ok: true, message: 'Saved.' });
    expect(mocks.savePlan).toHaveBeenCalledTimes(2);
    const input = mocks.savePlan.mock.calls[1]?.[2];
    expect(input.stepUpSatisfied).toBe(true);
    expect(input.draft.price).toEqual({ priceMinorUnits: 250000, currency: 'BDT' });
    expect(input.draft.rules.seats).toEqual({ included: true, limit: 5 });
    expect(input.draft.rules.open_cases).toEqual({ included: true, limit: null });
    expect(input.draft.rules.storage_bytes).toEqual({ included: true, limit: 2048 * 1024 * 1024 });
    expect(input.draft.rules['ai.ai_app_suggestions']).toEqual({ included: true, limit: 10 });
    expect(input.draft.rules['ai.ai_app_original_files']).toEqual({ included: false, limit: null });
    expect(result.values?.['limit.seats']).toBe('5');
  });

  it('shows what a new price means first, and saves it only once the box is ticked', async () => {
    const changed = form({ price: '3,000.00' });
    const first = await savePlanAction(INITIAL, changed);
    expect(first).toMatchObject({ ok: true, message: '', pricePreview: true });
    expect(mocks.savePlan).not.toHaveBeenCalled();
    const unticked = await savePlanAction(
      first,
      form({ price: '3,000.00', pricePreviewed: 'yes' }),
    );
    expect(unticked).toMatchObject({ ok: false, field: 'confirmPrice' });
    expect(mocks.savePlan).not.toHaveBeenCalled();
    mocks.savePlan.mockResolvedValueOnce({
      ok: true,
      value: { planId: PLAN, created: false, changed: true, priceChanged: true },
    });
    const saved = await savePlanAction(
      first,
      form({ price: '3,000.00', pricePreviewed: 'yes', confirmPrice: 'yes' }),
    );
    expect(saved.message).toBe(
      "Saved. The new price applies from each agency's next billing period.",
    );
  });

  it('points at the field at fault and keeps what was typed', async () => {
    const badCurrency = await savePlanAction(INITIAL, form({ currency: 'XYZ' }));
    expect(badCurrency).toMatchObject({ ok: false, field: 'currency' });
    expect(badCurrency.values?.['currency']).toBe('XYZ');
    const badAmount = await savePlanAction(INITIAL, form({ price: '25,00' }));
    expect(badAmount).toMatchObject({ ok: false, field: 'price' });
    const badLimit = await savePlanAction(INITIAL, form({ 'limit.seats': 'ten' }));
    expect(badLimit).toMatchObject({ ok: false, field: 'limit.seats' });
    mocks.savePlan.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid', reason: 'period_locked', message: 'fixed', field: 'periodDays' },
    });
    const locked = await savePlanAction(INITIAL, form({}));
    expect(locked).toMatchObject({ ok: false, field: 'periodDays', message: 'fixed' });
  });

  it('keeps what was typed across the sign-in check in a signed cookie, never in the address', async () => {
    mocks.savePlan.mockResolvedValueOnce(stepUpNeeded);
    mocks.tryEstablishStepUp.mockResolvedValueOnce({
      kind: 'reauth_required',
      reauthUrl: '/reauth?next=%2Fapp%2Fadmin%2Fplans',
    });
    await expect(savePlanAction(INITIAL, form({ 'limit.seats': '7' }))).rejects.toThrow(
      'NEXT_REDIRECT:/reauth?next=%2Fapp%2Fadmin%2Fplans',
    );
    const kept = decodePlanFormRetry(jar.get(PLAN_FORM_RETRY_COOKIE)?.value, 'synthetic-owner');
    expect(kept?.form).toBe(PLAN);
    expect(kept?.fields['limit.seats']).toBe('7');
    expect(decodePlanFormRetry(jar.get(PLAN_FORM_RETRY_COOKIE)?.value, 'someone-else')).toBeNull();
  });

  it('is refused for anyone but the platform owner', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(await savePlanAction(INITIAL, form({}))).toMatchObject({
      ok: false,
      message: 'Only the platform owner can change plans.',
    });
    expect(mocks.savePlan).not.toHaveBeenCalled();
  });
});

describe('retiring a plan (S29)', () => {
  it('shows who keeps it first, then retires it once confirmed', async () => {
    mocks.previewPlanRetire.mockResolvedValue({ ok: true, value: { agenciesOnIt: 2 } });
    const data = new FormData();
    data.set('planId', PLAN);
    const first = await retirePlanAction(INITIAL, data);
    expect(first).toMatchObject({ ok: true, agenciesKeepingIt: 2 });
    expect(mocks.retirePlan).not.toHaveBeenCalled();
    mocks.retirePlan.mockResolvedValue({ ok: true, value: { agenciesKeepingIt: 2 } });
    data.set('retirePreviewed', 'yes');
    data.set('confirmRetire', 'yes');
    const done = await retirePlanAction(first, data);
    expect(done.message).toBe('Retired. Nobody new can be put on this plan; 2 agencies keep it.');
  });
});
