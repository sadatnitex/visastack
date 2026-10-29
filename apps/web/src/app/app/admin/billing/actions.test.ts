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
const ON = { ...OFF, overdueHandlingEnabled: true, graceAfterDays: 7, suspendAfterDays: 30 };
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
const previewed = (grace: string, suspend: string) => ({
  confirmed: 'yes',
  previewGraceAfterDays: grace,
  previewSuspendAfterDays: suspend,
});

beforeEach(() => {
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.getBillingSettings.mockResolvedValue({ ok: true, value: OFF });
  mocks.previewOverdueHandling.mockResolvedValue({
    ok: true,
    value: { toGrace: 2, toSuspended: 1 },
  });
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
    expect(result).toMatchObject({
      ok: false,
      message: 'Only the platform owner can change the billing rules.',
    });
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('BILLING_SETTINGS_MANAGE');
    expect(mocks.updateBillingSettings).not.toHaveBeenCalled();
  });

  it('points at the box with the problem before asking the server anything, keeping what was typed', async () => {
    expect(await saveBillingRulesAction(INITIAL, form({ dueDays: '' }))).toMatchObject({
      ok: false,
      field: 'dueDays',
      values: { dueDays: '', overdueHandling: 'off' },
    });
    expect(
      await saveBillingRulesAction(INITIAL, form({ ...turnOn, suspendAfterDays: '7' })),
    ).toMatchObject({
      ok: false,
      field: 'suspendAfterDays',
      values: { graceAfterDays: '7', suspendAfterDays: '7', overdueHandling: 'on' },
    });
    expect(await saveBillingRulesAction(INITIAL, form({ overdueHandling: 'on' }))).toMatchObject({
      ok: false,
      field: 'graceAfterDays',
    });
    expect(mocks.staffPrincipal).not.toHaveBeenCalled();
  });

  it('answers turning it on with a preview of exactly those day counts (not a failure), and saves only once that preview is confirmed', async () => {
    const first = await saveBillingRulesAction(INITIAL, form(turnOn));
    expect(first).toEqual({
      ok: true,
      message: '',
      values: { dueDays: '7', overdueHandling: 'on', graceAfterDays: '7', suspendAfterDays: '30' },
      preview: { graceAfterDays: 7, suspendAfterDays: 30, toGrace: 2, toSuspended: 1 },
    });
    expect(mocks.previewOverdueHandling.mock.calls[0]?.[1]).toBe(SCOPE);
    expect(mocks.previewOverdueHandling.mock.calls[0]?.[2]).toEqual({
      graceAfterDays: 7,
      suspendAfterDays: 30,
    });
    expect(mocks.updateBillingSettings).not.toHaveBeenCalled();

    // Saved again for the same day counts without ticking the box: that is the problem to show.
    const unticked = await saveBillingRulesAction(
      INITIAL,
      form({ ...turnOn, previewGraceAfterDays: '7', previewSuspendAfterDays: '30' }),
    );
    expect(unticked).toMatchObject({
      ok: false,
      message: 'Tick the box to confirm, then save again.',
      field: 'confirmed',
      preview: { graceAfterDays: 7, suspendAfterDays: 30 },
    });
    expect(mocks.updateBillingSettings).not.toHaveBeenCalled();

    mocks.updateBillingSettings.mockResolvedValueOnce(stepUpNeeded).mockResolvedValueOnce(saved);
    const confirmed = await saveBillingRulesAction(
      INITIAL,
      form({ ...turnOn, ...previewed('7', '30') }),
    );
    expect(confirmed).toMatchObject({
      ok: true,
      message:
        'Saved. From the next daily check, unpaid agencies move to Grace and then Suspended.',
    });
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

  it('refuses a ticked box without a preview, or for other day counts than the ones previewed', async () => {
    // Grace 1 and Suspend 2 typed and saved in one go, box ticked, never previewed.
    const blind = await saveBillingRulesAction(
      INITIAL,
      form({ overdueHandling: 'on', graceAfterDays: '1', suspendAfterDays: '2', confirmed: 'yes' }),
    );
    expect(blind).toMatchObject({ ok: true, preview: { graceAfterDays: 1, suspendAfterDays: 2 } });
    // Previewed 7 and 30, then changed to 3 and 30 before saving: a fresh preview, no save.
    const changed = await saveBillingRulesAction(
      INITIAL,
      form({ ...turnOn, graceAfterDays: '3', ...previewed('7', '30') }),
    );
    expect(changed).toMatchObject({
      ok: true,
      preview: { graceAfterDays: 3, suspendAfterDays: 30 },
    });
    expect(mocks.updateBillingSettings).not.toHaveBeenCalled();
    // Grace 0 is not a day count (overdue starts the day after the due date).
    expect(
      await saveBillingRulesAction(
        INITIAL,
        form({ overdueHandling: 'on', graceAfterDays: '0', suspendAfterDays: '2' }),
      ),
    ).toMatchObject({ ok: false, field: 'graceAfterDays' });
  });

  it('previews again when the day counts change while it is already on, but not for the due days alone', async () => {
    mocks.getBillingSettings.mockResolvedValue({ ok: true, value: ON });
    const moreStrict = await saveBillingRulesAction(
      INITIAL,
      form({ ...turnOn, suspendAfterDays: '14' }),
    );
    expect(moreStrict).toMatchObject({ ok: true, preview: { suspendAfterDays: 14 } });
    expect(mocks.updateBillingSettings).not.toHaveBeenCalled();
    const dueOnly = await saveBillingRulesAction(INITIAL, form({ ...turnOn, dueDays: '10' }));
    expect(dueOnly.ok).toBe(true);
    expect(mocks.previewOverdueHandling).toHaveBeenCalledTimes(1);
    // Turning it off never needs a preview.
    const off = await saveBillingRulesAction(
      INITIAL,
      form({ graceAfterDays: '7', suspendAfterDays: '30' }),
    );
    expect(off.ok).toBe(true);
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
    mocks.getBillingSettings.mockResolvedValue({ ok: true, value: { ...OFF, available: false } });
    expect(await saveBillingRulesAction(INITIAL, form({ dueDays: '10' }))).toMatchObject({
      ok: false,
      message: 'Billing rules are not available yet. Nothing has changed.',
    });
    expect(mocks.updateBillingSettings).not.toHaveBeenCalled();
  });
});
