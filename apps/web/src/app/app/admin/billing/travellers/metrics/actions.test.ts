import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  getTravellerHealthSettings: vi.fn(),
  updateTravellerHealthSettings: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  getTravellerHealthSettings: mocks.getTravellerHealthSettings,
  updateTravellerHealthSettings: mocks.updateTravellerHealthSettings,
}));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner', email: 'owner@example.com' }),
}));
vi.mock('../../../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: mocks.staffPrincipal,
}));
vi.mock('../../../../../../lib/step-up', () => ({
  tryEstablishStepUp: mocks.tryEstablishStepUp,
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Step-up is not configured here.',
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
const { TRAVELLER_HEALTH_UNAVAILABLE } = await import('@visastack/services');
const { saveTravellerThresholdsAction } = await import('./actions');

const PATH = '/app/admin/billing/travellers/metrics';
const SCOPE = { kind: 'staff', platformAction: 'PLANS_MANAGE' };
const INITIAL = { ok: true, message: '' };
const TYPED = {
  checkoutSuccessMinPercent: '60',
  confirmationMaxMinutes: '20',
  stuckConfirmingMax: '1',
  needsCheckMax: '2',
};
const NUMBERS = {
  checkoutSuccessMinPercent: 60,
  confirmationMaxMinutes: 20,
  stuckConfirmingMax: 1,
  needsCheckMax: 2,
};
const CURRENT = {
  checkoutSuccessMinPercent: 50,
  confirmationMaxMinutes: 15,
  stuckConfirmingMax: 0,
  needsCheckMax: 0,
  available: true,
  updatedAt: null,
};
const saved = { ok: true, value: { changed: true, settings: { ...CURRENT, ...NUMBERS } } };
const stepUpNeeded = { ok: false, error: { code: 'step_up_required', message: 'x' } };

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...TYPED, ...fields })) data.set(key, value);
  return data;
}

beforeEach(() => {
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.getTravellerHealthSettings.mockResolvedValue({ ok: true, value: CURRENT });
  mocks.updateTravellerHealthSettings.mockResolvedValue(saved);
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'satisfied' });
});
afterEach(() => {
  vi.resetAllMocks();
});

describe('saveTravellerThresholdsAction', () => {
  it('refuses anyone but the platform owner, and changes nothing', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const result = await saveTravellerThresholdsAction(INITIAL, form());
    expect(result).toEqual({
      ok: false,
      message: 'Only the platform owner can change the alert thresholds.',
      values: TYPED,
    });
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('PLANS_MANAGE');
    expect(mocks.updateTravellerHealthSettings).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    // A refusal the service itself makes reads the same.
    mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
    mocks.updateTravellerHealthSettings.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'x' },
    });
    expect(await saveTravellerThresholdsAction(INITIAL, form())).toMatchObject({
      ok: false,
      message: 'Only the platform owner can change the alert thresholds.',
    });
  });

  it('points at the box with the problem in plain words before asking the server anything, keeping what was typed', async () => {
    expect(
      await saveTravellerThresholdsAction(INITIAL, form({ confirmationMaxMinutes: '2.5' })),
    ).toEqual({
      ok: false,
      message: 'Enter time to confirm as a whole number of minutes from 1 to 1440.',
      field: 'confirmationMaxMinutes',
      values: { ...TYPED, confirmationMaxMinutes: '2.5' },
    });
    expect(await saveTravellerThresholdsAction(INITIAL, form({ needsCheckMax: '' }))).toMatchObject(
      { ok: false, field: 'needsCheckMax' },
    );
    expect(
      await saveTravellerThresholdsAction(INITIAL, form({ checkoutSuccessMinPercent: '101' })),
    ).toMatchObject({
      ok: false,
      message: 'Checkout success must be a whole number from 0 to 100.',
      field: 'checkoutSuccessMinPercent',
    });
    expect(
      await saveTravellerThresholdsAction(INITIAL, form({ confirmationMaxMinutes: '0' })),
    ).toMatchObject({ ok: false, field: 'confirmationMaxMinutes' });
    expect(
      await saveTravellerThresholdsAction(INITIAL, form({ stuckConfirmingMax: '1001' })),
    ).toMatchObject({
      ok: false,
      message: 'Counts must be whole numbers from 0 to 1000.',
      field: 'stuckConfirmingMax',
    });
    expect(
      await saveTravellerThresholdsAction(INITIAL, form({ needsCheckMax: '5000' })),
    ).toMatchObject({ ok: false, field: 'needsCheckMax' });
    expect(mocks.staffPrincipal).not.toHaveBeenCalled();
    expect(mocks.updateTravellerHealthSettings).not.toHaveBeenCalled();
  });

  it('says plainly when thresholds cannot be saved yet, before asking for a sign-in', async () => {
    mocks.getTravellerHealthSettings.mockResolvedValue({
      ok: true,
      value: { ...CURRENT, available: false },
    });
    expect(await saveTravellerThresholdsAction(INITIAL, form())).toEqual({
      ok: false,
      message: `${TRAVELLER_HEALTH_UNAVAILABLE} Nothing has changed.`,
      values: TYPED,
    });
    expect(mocks.updateTravellerHealthSettings).not.toHaveBeenCalled();
    expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
  });

  it('asks for a fresh sign-in, then saves with it and refreshes the page', async () => {
    mocks.updateTravellerHealthSettings
      .mockResolvedValueOnce(stepUpNeeded)
      .mockResolvedValueOnce(saved);
    const result = await saveTravellerThresholdsAction(INITIAL, form());
    expect(result).toEqual({
      ok: true,
      message: 'Saved. The health signals are now checked against these thresholds.',
      values: TYPED,
    });
    expect(mocks.updateTravellerHealthSettings.mock.calls[0]?.[1]).toBe(SCOPE);
    expect(mocks.updateTravellerHealthSettings.mock.calls[0]?.[2]).toEqual({
      ...NUMBERS,
      stepUpSatisfied: false,
    });
    expect(mocks.tryEstablishStepUp.mock.calls[0]).toEqual([
      {
        accountId: 'synthetic-owner',
        action: 'TRAVELLER_THRESHOLDS_UPDATE',
        resourceId: 'traveller-thresholds',
      },
      PATH,
    ]);
    expect(mocks.updateTravellerHealthSettings.mock.calls[1]?.[2]).toEqual({
      ...NUMBERS,
      stepUpSatisfied: true,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(PATH);
  });

  it('sends the owner to sign in again when the sign-in is not fresh, saving nothing yet', async () => {
    mocks.updateTravellerHealthSettings.mockResolvedValue(stepUpNeeded);
    mocks.tryEstablishStepUp.mockResolvedValue({
      kind: 'reauth_required',
      reauthUrl: '/auth/reauth?next=metrics',
    });
    await expect(saveTravellerThresholdsAction(INITIAL, form())).rejects.toThrow(
      'NEXT_REDIRECT:/auth/reauth?next=metrics',
    );
    expect(mocks.updateTravellerHealthSettings).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('says plainly when the extra sign-in check is not available here', async () => {
    mocks.updateTravellerHealthSettings.mockResolvedValue(stepUpNeeded);
    mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'not_configured' });
    expect(await saveTravellerThresholdsAction(INITIAL, form())).toEqual({
      ok: false,
      message: 'Step-up is not configured here.',
      values: TYPED,
    });
    expect(mocks.updateTravellerHealthSettings).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('says when nothing changed, and words every other refusal plainly', async () => {
    mocks.updateTravellerHealthSettings.mockResolvedValue({
      ok: true,
      value: { changed: false, settings: CURRENT },
    });
    expect(await saveTravellerThresholdsAction(INITIAL, form())).toMatchObject({
      ok: true,
      message: 'Nothing to change. These are already the alert thresholds.',
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    mocks.updateTravellerHealthSettings.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: TRAVELLER_HEALTH_UNAVAILABLE },
    });
    expect(await saveTravellerThresholdsAction(INITIAL, form())).toMatchObject({
      ok: false,
      message: `${TRAVELLER_HEALTH_UNAVAILABLE} Nothing has changed.`,
    });

    mocks.updateTravellerHealthSettings.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'Counts must be whole numbers from 0 to 1000.' },
    });
    expect(await saveTravellerThresholdsAction(INITIAL, form())).toMatchObject({
      ok: false,
      message: 'Counts must be whole numbers from 0 to 1000.',
    });

    mocks.updateTravellerHealthSettings.mockResolvedValue({
      ok: false,
      error: { code: 'conflict', message: 'duplicate key value violates unique constraint' },
    });
    const failed = await saveTravellerThresholdsAction(INITIAL, form());
    expect(failed).toEqual({
      ok: false,
      message: 'The thresholds could not be saved. Reload the page and try again.',
      values: TYPED,
    });
    expect(JSON.stringify(failed)).not.toContain('constraint');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
