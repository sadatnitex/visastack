import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkout: vi.fn(),
  pay: vi.fn(),
  renewal: vi.fn(),
  revalidate: vi.fn(),
}));
const SELF = { kind: 'self', accountId: 'acct-1' };
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  startPersonCheckout: mocks.checkout,
  startPersonPayment: mocks.pay,
  setPlanRenewal: mocks.renewal,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com', self: SELF }),
}));
vi.mock('../../../../lib/providers', () => ({ paymentPorts: () => ({ ports: 'configured' }) }));
vi.mock('../../../../lib/admin-emails', () => ({
  bootstrapAdminEmails: () => ['owner@example.com'],
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
import { buyPlanAction, payPurchaseAction, setRenewalAction } from './actions';

const PLAN = '00000000-0000-4000-8000-0000000000aa';
const INVOICE = '00000000-0000-4000-8000-0000000000bb';
const INITIAL = { ok: true, message: '' };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buying a paid plan (ADR 0025 T3c)', () => {
  it("makes the purchase with the session's own scope and shows it to confirm", async () => {
    mocks.checkout.mockResolvedValue({ ok: true, value: { invoiceId: INVOICE } });
    await expect(buyPlanAction(INITIAL, form({ planId: PLAN }))).rejects.toThrow(
      `NEXT_REDIRECT:/app/account/plan?purchase=${INVOICE}#confirm-purchase-title`,
    );
    expect(mocks.checkout.mock.calls[0]?.[1]).toBe(SELF);
    expect(mocks.checkout.mock.calls[0]?.[2]).toEqual({ planId: PLAN });
  });

  it('says why a purchase was refused, and refuses an address that is not a plan id', async () => {
    mocks.checkout.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'Paid plans are not on sale yet.', reason: 'selling_off' },
    });
    expect(await buyPlanAction(INITIAL, form({ planId: PLAN }))).toEqual({
      ok: false,
      message: 'Paid plans are not on sale yet.',
    });
    expect(await buyPlanAction(INITIAL, form({ planId: 'nope' }))).toMatchObject({ ok: false });
    expect(mocks.checkout).toHaveBeenCalledTimes(1);
  });

  it('opens the payment page for the confirmed purchase, with the session email for test mode', async () => {
    mocks.pay.mockResolvedValue({
      ok: true,
      value: { kind: 'redirect', attemptId: 'a', redirectUrl: 'https://sandbox.example/pay' },
    });
    await expect(payPurchaseAction(INITIAL, form({ invoiceId: INVOICE }))).rejects.toThrow(
      'NEXT_REDIRECT:https://sandbox.example/pay',
    );
    expect(mocks.pay.mock.calls[0]?.[2]).toBe(SELF);
    expect(mocks.pay.mock.calls[0]?.[3]).toMatchObject({
      invoiceId: INVOICE,
      startAnother: false,
      actorEmail: 'traveller@example.com',
      bootstrapEmails: ['owner@example.com'],
    });
  });

  it('asks the person to wait when a payment was started minutes ago, and words a missing purchase plainly', async () => {
    mocks.pay.mockResolvedValueOnce({
      ok: true,
      value: { kind: 'recent_attempt', attemptId: 'a', startedAt: new Date() },
    });
    const recent = await payPurchaseAction(INITIAL, form({ invoiceId: INVOICE }));
    expect(recent.message).toContain('you do not need to pay again');
    expect(recent.recent).toBe(true);
    // Start Another Payment sends startAnother.
    mocks.pay.mockResolvedValueOnce({
      ok: true,
      value: { kind: 'redirect', attemptId: 'b', redirectUrl: 'https://sandbox.example/pay2' },
    });
    await expect(
      payPurchaseAction(recent, form({ invoiceId: INVOICE, startAnother: 'yes' })),
    ).rejects.toThrow('NEXT_REDIRECT:https://sandbox.example/pay2');
    expect(mocks.pay.mock.calls[1]?.[3]).toMatchObject({ startAnother: true });
    mocks.pay.mockResolvedValueOnce({
      ok: false,
      error: { code: 'not_found', message: 'invoice not found' },
    });
    expect(await payPurchaseAction(INITIAL, form({ invoiceId: INVOICE }))).toEqual({
      ok: false,
      message: 'We could not find this purchase. Start it again below.',
    });
  });

  it("puts refusals in a traveller's words, never an agency's", async () => {
    mocks.pay.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'invalid',
        message: 'Online payment is not open to agencies yet.',
        reason: 'test_mode_owner_only',
      },
    });
    const testMode = await payPurchaseAction(INITIAL, form({ invoiceId: INVOICE }));
    expect(testMode.message).toContain('still being tested');
    expect(testMode.message).not.toMatch(/agenc/i);
    mocks.pay.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid', message: 'This invoice is already paid.' },
    });
    expect((await payPurchaseAction(INITIAL, form({ invoiceId: INVOICE }))).message).toBe(
      'This purchase is already paid.',
    );
    mocks.checkout.mockResolvedValueOnce({
      ok: false,
      error: { code: 'not_found', message: 'account not found' },
    });
    expect((await buyPlanAction(INITIAL, form({ planId: PLAN }))).message).toBe(
      'This plan is not for sale.',
    );
  });
});

describe('Stop Renewing and Keep Renewing (ADR 0025 T4)', () => {
  it("changes only the session's own plan, and says what happens next", async () => {
    mocks.renewal.mockResolvedValue({ ok: true, value: { renews: false } });
    const stopped = await setRenewalAction(INITIAL, form({ renews: 'no' }));
    expect(mocks.renewal.mock.calls[0]?.[1]).toBe(SELF);
    expect(mocks.renewal.mock.calls[0]?.[2]).toEqual({ renews: false });
    expect(stopped).toEqual({
      ok: true,
      message: 'Renewing is off. Your plan still covers you until it ends, and nothing is charged.',
    });
    expect(mocks.revalidate).toHaveBeenCalledWith('/app/account/plan');
    mocks.renewal.mockResolvedValue({ ok: true, value: { renews: true } });
    expect((await setRenewalAction(INITIAL, form({ renews: 'yes' }))).ok).toBe(true);
    expect(mocks.renewal.mock.calls[1]?.[2]).toEqual({ renews: true });
  });

  it('refuses a choice that is not one of the two, and words a missing plan plainly', async () => {
    expect((await setRenewalAction(INITIAL, form({ renews: 'maybe' }))).ok).toBe(false);
    expect(mocks.renewal).not.toHaveBeenCalled();
    mocks.renewal.mockResolvedValue({
      ok: false,
      error: { code: 'not_found', message: 'no paid plan' },
    });
    expect(await setRenewalAction(INITIAL, form({ renews: 'no' }))).toEqual({
      ok: false,
      message: 'You have no paid plan to renew.',
    });
  });
});
