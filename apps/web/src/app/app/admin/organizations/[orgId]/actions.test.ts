import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Recording a payment by hand (S30): what is checked before any work, and how a refusal points. */

const mocks = vi.hoisted(() => ({
  recordInvoicePayment: vi.fn(),
  tryEstablishStepUp: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  recordInvoicePayment: mocks.recordInvoicePayment,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'owner-1', email: 'owner@example.com' }),
}));
vi.mock('../../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  isPlatformOwnerAccount: async () => true,
}));
vi.mock('../../../../../lib/step-up', () => ({
  tryEstablishStepUp: mocks.tryEstablishStepUp,
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Step-up is not configured here.',
}));
vi.mock('../../../../../lib/jobs', () => ({ triggerNotificationWorker: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

const { recordInvoicePaymentAction } = await import('./actions');

const INITIAL = { ok: true, message: '' };
function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  const all = {
    organizationId: '11111111-2222-4333-8444-555555555555',
    invoiceId: '66666666-7777-4888-8999-000000000000',
    idempotencyKey: '6f1c2d1e-8a54-4c8f-9d55-0a1b2c3d4e5f',
    amount: '2,500.00',
    currency: 'BDT',
    collectedDate: '2026-10-29',
    paymentReference: 'WIRE-1',
    reason: 'Bank statement',
    ...fields,
  };
  for (const [key, value] of Object.entries(all)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'satisfied' });
  mocks.recordInvoicePayment.mockResolvedValue({ ok: true, value: { status: 'PAID' } });
});

describe('recording a payment by hand', () => {
  it('refuses an amount of the wrong shape before any sign-in check or service call', async () => {
    for (const amount of ['', 'abc', '-5', '12,50', '1.2345', '0']) {
      expect(await recordInvoicePaymentAction(INITIAL, form({ amount })), amount).toMatchObject({
        ok: false,
        field: 'amount',
      });
    }
    expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
    expect(mocks.recordInvoicePayment).not.toHaveBeenCalled();
  });

  it('sends the typed amount for the service to read in the stored invoice currency', async () => {
    const result = await recordInvoicePaymentAction(INITIAL, form({ invoiceCurrency: 'JPY' }));
    expect(result).toMatchObject({ ok: true });
    const input = mocks.recordInvoicePayment.mock.calls[0]?.[1];
    expect(input).toMatchObject({ amountText: '2,500.00', currency: 'BDT' });
    expect(input).not.toHaveProperty('amountMinorUnits');
  });

  it("points at the amount or the currency from the service's typed reason", async () => {
    for (const [reason, field] of [
      ['amount_invalid', 'amount'],
      ['amount_over_balance', 'amount'],
      ['currency_mismatch', 'currency'],
      ['currency_invalid', 'currency'],
    ] as const) {
      mocks.recordInvoicePayment.mockResolvedValueOnce({
        ok: false,
        error: { code: 'invalid', reason, message: 'Refused.' },
      });
      expect(await recordInvoicePaymentAction(INITIAL, form()), reason).toEqual({
        ok: false,
        message: 'Refused.',
        field,
      });
    }
    mocks.recordInvoicePayment.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid', message: 'Enter the amount received, says the wording.' },
    });
    expect(await recordInvoicePaymentAction(INITIAL, form())).not.toHaveProperty('field');
  });
});
