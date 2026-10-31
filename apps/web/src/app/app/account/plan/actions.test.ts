import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkout: vi.fn(),
  pay: vi.fn(),
}));
const SELF = { kind: 'self', accountId: 'acct-1' };
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  startPersonCheckout: mocks.checkout,
  startPersonPayment: mocks.pay,
}));
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
import { buyPlanAction, payPurchaseAction } from './actions';

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
      `NEXT_REDIRECT:/app/account/plan?purchase=${INVOICE}#confirm-purchase`,
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
    mocks.pay.mockResolvedValueOnce({
      ok: false,
      error: { code: 'not_found', message: 'invoice not found' },
    });
    expect(await payPurchaseAction(INITIAL, form({ invoiceId: INVOICE }))).toEqual({
      ok: false,
      message: 'We could not find this purchase. Start it again below.',
    });
  });
});
