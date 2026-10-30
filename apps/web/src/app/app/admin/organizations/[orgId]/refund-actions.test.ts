import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  requestRefund: vi.fn(),
  recordManualRefund: vi.fn(),
  applyHeldPaymentCredit: vi.fn(),
  checkRefundsNow: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  requestRefund: mocks.requestRefund,
  recordManualRefund: mocks.recordManualRefund,
  applyHeldPaymentCredit: mocks.applyHeldPaymentCredit,
  checkRefundsNow: mocks.checkRefundsNow,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner', email: 'owner@example.com' }),
}));
vi.mock('../../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: mocks.staffPrincipal,
}));
vi.mock('../../../../../lib/providers', () => ({
  createPaymentPort: () => ({ configured: true, provider: 'sslcommerz' }),
}));
vi.mock('../../../../../lib/step-up', () => ({
  tryEstablishStepUp: mocks.tryEstablishStepUp,
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Step-up is not configured here.',
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
const { applyCreditAction, checkRefundsAction, recordManualRefundAction, requestRefundAction } =
  await import('./refund-actions');

const ORG = '11111111-2222-4333-8444-555555555555';
const SCOPE = { kind: 'staff', platformAction: 'BILLING_REFUND_MANAGE' };
const INITIAL = { ok: true, message: '' };
const REQUEST = {
  id: 'r1',
  invoiceId: 'i1',
  invoiceRef: 'INV-1',
  method: 'PROVIDER',
  status: 'SUBMITTED',
  amountMinorUnits: 150000,
  currency: 'BDT',
  fromHeldPayment: false,
  reason: 'x',
  reference: 'RR1',
  failureCode: null,
  createdAt: new Date(),
  confirmedAt: null,
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  const all = {
    organizationId: ORG,
    sourceKind: 'entry',
    sourceId: 'e1',
    currency: 'BDT',
    idempotencyKey: '6f1c2d1e-8a54-4c8f-9d55-0a1b2c3d4e5f',
    amount: '1500.00',
    reason: 'Agency overpaid',
    ...fields,
  };
  for (const [key, value] of Object.entries(all)) data.set(key, value);
  return data;
}

beforeEach(() => {
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'satisfied' });
  mocks.requestRefund.mockResolvedValue({ ok: true, value: { code: 'sent', request: REQUEST } });
});
afterEach(() => {
  vi.resetAllMocks();
});

describe('refund actions (S18)', () => {
  it('refuse anyone but the platform owner, before any check or service call', async () => {
    mocks.staffPrincipal.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'x' },
    });
    for (const action of [
      requestRefundAction,
      recordManualRefundAction,
      applyCreditAction,
      checkRefundsAction,
    ]) {
      const result = await action(
        INITIAL,
        form({ reference: 'BANK-1', refundedOn: '2026-10-29', paymentAttemptId: 'a1' }),
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Only the platform owner');
    }
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('BILLING_REFUND_MANAGE');
    expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
    expect(mocks.requestRefund).not.toHaveBeenCalled();
    expect(mocks.recordManualRefund).not.toHaveBeenCalled();
    expect(mocks.applyHeldPaymentCredit).not.toHaveBeenCalled();
    expect(mocks.checkRefundsNow).not.toHaveBeenCalled();
  });

  it('ask for a fresh sign-in check before any money moves, and send the person to it', async () => {
    mocks.tryEstablishStepUp.mockResolvedValue({
      kind: 'reauth_required',
      reauthUrl: '/auth/reauth?returnTo=x',
    });
    await expect(requestRefundAction(INITIAL, form({}))).rejects.toThrow(
      'NEXT_REDIRECT:/auth/reauth?returnTo=x',
    );
    expect(mocks.requestRefund).not.toHaveBeenCalled();
    expect(mocks.tryEstablishStepUp.mock.calls[0]?.[0]).toMatchObject({
      action: 'INVOICE_REFUND_REQUEST',
    });
  });

  it('send the exact amount in minor units with the step-up proved, and say what happens next', async () => {
    const result = await requestRefundAction(INITIAL, form({}));
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toContain('once the gateway confirms');
    expect(mocks.requestRefund.mock.calls[0]?.[3]).toMatchObject({
      organizationId: ORG,
      source: { kind: 'entry', invoicePaymentId: 'e1' },
      amountMinorUnits: 150000,
      stepUpSatisfied: true,
    });
  });

  it('point at the field at fault, and never ask for a sign-in check for a typing mistake', async () => {
    expect(await requestRefundAction(INITIAL, form({ amount: '15,00' }))).toMatchObject({
      ok: false,
      field: 'amount',
    });
    expect(
      await recordManualRefundAction(INITIAL, form({ reference: 'R', refundedOn: '2026-02-30' })),
    ).toMatchObject({ ok: false, field: 'refundedOn' });
    expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
  });

  it('tell staff to check the gateway panel when the sending could not be confirmed', async () => {
    mocks.requestRefund.mockResolvedValue({
      ok: true,
      value: { code: 'unconfirmed', request: { ...REQUEST, status: 'REQUESTED' } },
    });
    const result = await requestRefundAction(INITIAL, form({}));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('We could not confirm the refund was sent');
  });

  it('check sent refunds without a sign-in check, since only what the gateway confirms is recorded', async () => {
    mocks.checkRefundsNow.mockResolvedValue({
      ok: true,
      value: {
        available: true,
        configured: true,
        checked: 2,
        confirmed: 1,
        failed: 0,
        stillProcessing: 1,
        unavailable: 0,
        needsCheck: 0,
        awaitingCheck: 0,
      },
    });
    const result = await checkRefundsAction(INITIAL, form({}));
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toContain('1 refunded, 1 still on the way');
    expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
  });
});
