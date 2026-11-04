import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  recoverPersonPayment: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  revalidatePath: vi.fn(),
  paymentPorts: vi.fn(() => ({ ports: 'configured' })),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  recoverPersonPayment: mocks.recoverPersonPayment,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner', email: 'owner@example.com' }),
}));
vi.mock('../../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: mocks.staffPrincipal,
}));
vi.mock('../../../../../lib/providers', () => ({ paymentPorts: mocks.paymentPorts }));
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
const { recoverTravellerPaymentAction } = await import('./recover-action');

const PAGE = '/app/admin/billing/travellers';
const SCOPE = { kind: 'staff', platformAction: 'BILLING_REFUND_MANAGE' };
const INITIAL = { ok: true, message: '' };
const ACCOUNT = '0f8b6c1e-2d3a-4b5c-8d6e-7f8091a2b3c4';
const PLAN = 'traveller_plus';
const TRAN = 'VSP0123456789abcdef0123456789';

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  const all = {
    code: ACCOUNT.replace(/-/g, '').toUpperCase(),
    planKey: PLAN,
    transactionId: TRAN,
    ...fields,
  };
  for (const [key, value] of Object.entries(all)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'satisfied' });
  mocks.recoverPersonPayment.mockResolvedValue({
    ok: true,
    value: {
      invoiceId: 'inv',
      invoiceRef: 'TP-0F8B6C1E-1',
      amountMinorUnits: 49_900,
      currency: 'BDT',
    },
  });
});

describe('Recover a Payment (owner tool)', () => {
  it('recovers with the owner scope after a fresh sign-in, from the code the restore report gives', async () => {
    const result = await recoverTravellerPaymentAction(INITIAL, form());
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Payment recovered:');
    expect(result.message).toContain('TP-0F8B6C1E-1');
    expect(result.values).toEqual({});
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('BILLING_REFUND_MANAGE');
    expect(mocks.tryEstablishStepUp.mock.calls[0]).toEqual([
      { accountId: 'synthetic-owner', action: 'TRAVELLER_PAYMENT_RECOVER', resourceId: TRAN },
      PAGE,
    ]);
    // The code, with or without dashes and in any case, is the traveller's account.
    expect(mocks.recoverPersonPayment.mock.calls[0]?.[2]).toBe(SCOPE);
    expect(mocks.recoverPersonPayment.mock.calls[0]?.[3]).toEqual({
      accountId: ACCOUNT,
      planKey: PLAN,
      merchantTranId: TRAN,
      stepUpSatisfied: true,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(PAGE);
  });

  it('points at the box with the problem before asking anything, keeping what was typed', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ code: 'A1B2C3D4' }, 'code'],
      [{ planKey: 'Not A Plan!' }, 'planKey'],
      [{ transactionId: 'TX-123' }, 'transactionId'],
    ];
    const replies = new Set<string | undefined>();
    for (const [fields, field] of cases) {
      const result = await recoverTravellerPaymentAction(INITIAL, form(fields));
      expect(result).toMatchObject({ ok: false, field });
      expect(result.values).toMatchObject(fields);
      replies.add(result.replyId);
    }
    // Every reply is new, so the form draws its boxes again with what was typed.
    expect(replies.size).toBe(cases.length);
    expect(replies.has(undefined)).toBe(false);
    expect(mocks.staffPrincipal).not.toHaveBeenCalled();
    expect(mocks.recoverPersonPayment).not.toHaveBeenCalled();
  });

  it('refuses anyone but the platform owner, and asks for nothing else', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const result = await recoverTravellerPaymentAction(INITIAL, form());
    expect(result).toMatchObject({
      ok: false,
      message: 'Only the platform owner can recover a payment.',
    });
    expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
    expect(mocks.recoverPersonPayment).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('sends the owner to sign in again when the sign-in is not fresh, recovering nothing yet', async () => {
    mocks.tryEstablishStepUp.mockResolvedValue({
      kind: 'reauth_required',
      reauthUrl: '/auth/reauth',
    });
    await expect(recoverTravellerPaymentAction(INITIAL, form())).rejects.toThrow(
      'NEXT_REDIRECT:/auth/reauth',
    );
    expect(mocks.recoverPersonPayment).not.toHaveBeenCalled();
    mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'not_configured' });
    expect(await recoverTravellerPaymentAction(INITIAL, form())).toMatchObject({
      ok: false,
      message: 'Step-up is not configured here.',
    });
  });

  it("says the payment provider's answer in plain words and marks the box it is about", async () => {
    mocks.recoverPersonPayment.mockResolvedValue({
      ok: false,
      error: {
        code: 'invalid',
        reason: 'recovery_transaction',
        message:
          'The payment provider does not show this transaction as paid, so nothing was recorded.',
      },
    });
    const result = await recoverTravellerPaymentAction(INITIAL, form());
    expect(result).toMatchObject({ ok: false, field: 'transactionId' });
    expect(result.message).toContain('nothing was recorded');
    expect(result.values).toMatchObject({ transactionId: TRAN });
  });
});
