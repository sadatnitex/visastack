import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  getBillingSettings: vi.fn(),
  previewOverdueHandling: vi.fn(),
  updateBillingSettings: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  getBillingSettings: mocks.getBillingSettings,
  previewOverdueHandling: mocks.previewOverdueHandling,
  updateBillingSettings: mocks.updateBillingSettings,
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
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
import { saveBillingRulesAction } from './actions';

const SCOPE = { kind: 'staff', platformAction: 'BILLING_SETTINGS_MANAGE' };
const INITIAL = { ok: true, message: '' };
const OFF = {
  available: true,
  dueDays: 7,
  overdueHandlingEnabled: false,
  graceAfterDays: null,
  suspendAfterDays: null,
};
const saved = { ok: true, value: { changed: true, settings: OFF } };
const stepUpNeeded = { ok: false, error: { code: 'step_up_required', message: 'x' } };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ dueDays: '7', overdueHandling: 'off', ...fields })) {
    data.set(key, value);
  }
  return data;
}

const turnOn = { overdueHandling: 'on', graceAfterDays: '7', suspendAfterDays: '30' };

beforeEach(() => {
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.getBillingSettings.mockResolvedValue(OFF);
  mocks.previewOverdueHandling.mockResolvedValue({ toGrace: 2, toSuspended: 1 });
  mocks.updateBillingSettings.mockResolvedValue(saved);
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'satisfied' });
});
afterEach(() => {
  vi.resetAllMocks();
});

describe('saveBillingRulesAction', () => {
  it('refuses anyone but the platform owner', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const result = await saveBillingRulesAction(INITIAL, form({}));
    expect(result).toEqual({
      ok: false,
      message: 'Only the platform owner can change the billing rules.',
    });
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('BILLING_SETTINGS_MANAGE');
    expect(mocks.updateBillingSettings).not.toHaveBeenCalled();
  });

  it('points at the box with the problem before asking the server anything', async () => {
    expect(await saveBillingRulesAction(INITIAL, form({ dueDays: '' }))).toMatchObject({
      ok: false,
      field: 'dueDays',
    });
    expect(
      await saveBillingRulesAction(INITIAL, form({ ...turnOn, suspendAfterDays: '7' })),
    ).toMatchObject({ ok: false, field: 'suspendAfterDays' });
    expect(await saveBillingRulesAction(INITIAL, form({ overdueHandling: 'on' }))).toMatchObject({
      ok: false,
      field: 'graceAfterDays',
    });
    expect(mocks.staffPrincipal).not.toHaveBeenCalled();
  });

  it('shows how many agencies turning it on moves today, and saves only once confirmed', async () => {
    const first = await saveBillingRulesAction(INITIAL, form(turnOn));
    expect(first).toEqual({
      ok: false,
      message:
        'Turning this on today moves 2 agencies to Grace and 1 agency to Suspended. Tick the box to confirm, then save again.',
      field: 'confirmed',
    });
    expect(mocks.previewOverdueHandling.mock.calls[0]?.[1]).toEqual({
      graceAfterDays: 7,
      suspendAfterDays: 30,
    });
    expect(mocks.updateBillingSettings).not.toHaveBeenCalled();

    mocks.updateBillingSettings.mockResolvedValueOnce(stepUpNeeded).mockResolvedValueOnce(saved);
    const confirmed = await saveBillingRulesAction(INITIAL, form({ ...turnOn, confirmed: 'yes' }));
    expect(confirmed.ok).toBe(true);
    expect(mocks.tryEstablishStepUp.mock.calls[0]?.[0]).toEqual({
      accountId: 'synthetic-owner',
      action: 'BILLING_SETTINGS_UPDATE',
      resourceId: 'billing-rules',
    });
    expect(mocks.updateBillingSettings.mock.calls[1]?.[2]).toEqual({
      dueDays: 7,
      overdueHandlingEnabled: true,
      graceAfterDays: 7,
      suspendAfterDays: 30,
      stepUpSatisfied: true,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/admin/billing');
  });

  it('sends the owner to sign in again when the check needs it', async () => {
    mocks.updateBillingSettings.mockResolvedValue(stepUpNeeded);
    mocks.tryEstablishStepUp.mockResolvedValue({
      kind: 'reauth_required',
      reauthUrl: '/sign-in?again',
    });
    await expect(saveBillingRulesAction(INITIAL, form({ dueDays: '10' }))).rejects.toThrow(
      'NEXT_REDIRECT:/sign-in?again',
    );
  });

  it('says plainly when the rules are not available yet', async () => {
    mocks.getBillingSettings.mockResolvedValue({ ...OFF, available: false });
    expect(await saveBillingRulesAction(INITIAL, form({ dueDays: '10' }))).toEqual({
      ok: false,
      message: 'Billing rules are not available yet. Nothing has changed.',
    });
    expect(mocks.updateBillingSettings).not.toHaveBeenCalled();
  });
});
