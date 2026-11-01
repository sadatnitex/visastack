import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  requestRefund: vi.fn(),
  recordManualRefund: vi.fn(),
  applyHeldPaymentCredit: vi.fn(),
  checkRefundsNow: vi.fn(),
  sendPort: vi.fn(),
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
vi.mock('../../../../../lib/refund-gateway', () => ({
  REFUNDS_IN_PANEL: 'Refunds are made in the merchant panel.',
  refundSendPort: mocks.sendPort,
  refundCheckPorts: () => ({ configured: () => [] }),
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
  mocks.sendPort.mockReturnValue({ configured: true, provider: 'sslcommerz' });
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
    }); // WP-SB9: after the check, back to the Refunds part of the organization page.
    expect(mocks.tryEstablishStepUp.mock.calls[0]?.[1]).toMatch(
      /^\/app\/admin\/organizations\/[^?]+\?tab=refunds$/,
    );
  });

  it('send the typed amount with the step-up proved, and say what happens next', async () => {
    const result = await requestRefundAction(INITIAL, form({}));
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toContain('once the gateway confirms');
    expect(mocks.requestRefund.mock.calls[0]?.[3]).toMatchObject({
      organizationId: ORG,
      source: { kind: 'entry', invoicePaymentId: 'e1' },
      amountText: '1500.00',
      stepUpSatisfied: true,
    });
  });

  it('never let a currency named by the form decide how the amount is read (S30)', async () => {
    // The service reads "1500.00" in the payment's own stored currency; a tampered field is ignored.
    mocks.recordManualRefund.mockResolvedValue({
      ok: true,
      value: { code: 'recorded', request: { ...REQUEST, method: 'MANUAL', status: 'CONFIRMED' } },
    });
    await requestRefundAction(INITIAL, form({ currency: 'JPY' }));
    await recordManualRefundAction(
      INITIAL,
      form({ currency: 'BHD', reference: 'BANK-1', refundedOn: '2026-10-29' }),
    );
    // requestRefund(db, port, staff, input) and recordManualRefund(db, staff, input).
    const inputs = [
      mocks.requestRefund.mock.calls[0]?.[3],
      mocks.recordManualRefund.mock.calls[0]?.[2],
    ] as Record<string, unknown>[];
    for (const input of inputs) {
      expect(input).toHaveProperty('amountText', '1500.00');
      expect(input).not.toHaveProperty('amountMinorUnits');
      expect(input).not.toHaveProperty('currency');
    }
  });

  it("point at the amount from the service's typed reason, not its wording (S30)", async () => {
    mocks.requestRefund.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', reason: 'amount_over_balance', message: 'Too much.' },
    });
    expect(await requestRefundAction(INITIAL, form({}))).toMatchObject({
      ok: false,
      field: 'amount',
      message: 'Too much.',
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
        leftForLater: 0,
      },
    });
    const result = await checkRefundsAction(INITIAL, form({}));
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toContain('1 refunded, 1 still on the way');
    mocks.checkRefundsNow.mockResolvedValue({
      ok: true,
      value: {
        available: true,
        configured: true,
        checked: 3,
        confirmed: 0,
        failed: 0,
        stillProcessing: 0,
        unavailable: 2,
        needsCheck: 1,
        awaitingCheck: 0,
        leftForLater: 0,
      },
    });
    const mixed = await checkRefundsAction(INITIAL, form({}));
    expect(mixed.message).toContain('1 needs a check, 2 could not be asked');
    expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
  });

  it('tell staff a sent refund is waiting on a payment method switched off now (S19 step 0 round 2)', async () => {
    const summary = (overrides: Record<string, unknown>) => ({
      ok: true,
      value: {
        available: true,
        configured: true,
        checked: 0,
        confirmed: 0,
        failed: 0,
        stillProcessing: 0,
        unavailable: 0,
        needsCheck: 0,
        awaitingCheck: 0,
        leftForLater: 0,
        providerNotConfigured: 0,
        ...overrides,
      },
    });
    // No gateway on at all: the stranded refund is still counted and named.
    mocks.checkRefundsNow.mockResolvedValue(
      summary({ configured: false, providerNotConfigured: 1 }),
    );
    expect(await checkRefundsAction(INITIAL, form({}))).toMatchObject({
      ok: false,
      message:
        "1 sent refund is waiting on a payment method that is switched off now, so VisaStack cannot ask about it. Check it in that payment method's own panel, then record what happened.",
    });
    // Another gateway on, nothing of its own waiting.
    mocks.checkRefundsNow.mockResolvedValue(summary({ providerNotConfigured: 2 }));
    expect((await checkRefundsAction(INITIAL, form({}))).message).toBe(
      "2 sent refunds are waiting on a payment method that is switched off now, so VisaStack cannot ask about them. Check them in that payment method's own panel, then record what happened.",
    );
    // Alongside what the gateway that is on answered.
    mocks.checkRefundsNow.mockResolvedValue(
      summary({ checked: 1, confirmed: 1, providerNotConfigured: 1 }),
    );
    const both = await checkRefundsAction(INITIAL, form({}));
    expect(both.ok).toBe(false);
    expect(both.message).toMatch(
      /^Checked with the payment gateway: 1 refunded\. 1 sent refund is waiting/,
    );
    // Every refund the gateway that is on was asked about went unanswered: both are said (round 3).
    mocks.checkRefundsNow.mockResolvedValue(
      summary({ checked: 2, unavailable: 2, providerNotConfigured: 1 }),
    );
    expect((await checkRefundsAction(INITIAL, form({}))).message).toBe(
      "The payment gateway could not be reached, so 2 refunds were not asked about. Try again later. 1 sent refund is waiting on a payment method that is switched off now, so VisaStack cannot ask about it. Check it in that payment method's own panel, then record what happened.",
    );
    // Nothing on and nothing stranded: the plain "not set up".
    mocks.checkRefundsNow.mockResolvedValue(summary({ configured: false }));
    expect((await checkRefundsAction(INITIAL, form({}))).message).toBe(
      'The payment gateway is not set up here.',
    );
  });

  it('offer only recording a refund made outside VisaStack while the gateway switch is off (S18 round 2)', async () => {
    mocks.sendPort.mockReturnValue(null);
    const result = await requestRefundAction(INITIAL, form({}));
    expect(result).toMatchObject({ ok: false, message: 'Refunds are made in the merchant panel.' });
    expect(mocks.requestRefund).not.toHaveBeenCalled();
    expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
  });

  it('refresh the page after a send that was refused or not confirmed, and start the form afresh with a new key', async () => {
    mocks.requestRefund.mockResolvedValue({
      ok: true,
      value: { code: 'refused', request: { ...REQUEST, status: 'FAILED' } },
    });
    const refused = await requestRefundAction(INITIAL, form({}));
    expect(refused.ok).toBe(false);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/app/admin/organizations/${ORG}`);
    expect(refused.nextKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(refused.values).toEqual({});
    expect(refused.focusId).toBe('refund-line-r1');
    const again = await requestRefundAction(INITIAL, form({}));
    expect(again.nextKey).not.toBe(refused.nextKey);
  });

  it('keep what was typed when the answer is a problem with the form', async () => {
    const result = await recordManualRefundAction(
      INITIAL,
      form({ reference: 'BANK-9', refundedOn: '2026-02-30', amount: '12.50' }),
    );
    expect(result).toMatchObject({ ok: false, field: 'refundedOn' });
    expect(result.values).toMatchObject({
      amount: '12.50',
      reference: 'BANK-9',
      reason: 'Agency overpaid',
    });
  });

  it('word a repeated send by what the earlier refund really became', async () => {
    for (const [status, words] of [
      ['FAILED', 'did not go through'],
      ['CANCELLED', 'was cancelled'],
      ['CONFIRMED', 'already made'],
      ['SUBMITTED', 'already sent'],
    ] as const) {
      mocks.requestRefund.mockResolvedValue({
        ok: true,
        value: { code: 'already_requested', request: { ...REQUEST, status } },
      });
      const result = await requestRefundAction(INITIAL, form({}));
      expect(result.message, status).toContain(words);
      expect(result.message, status).not.toContain('already asked for');
    }
  });
});
