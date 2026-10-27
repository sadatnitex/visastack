import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startOnlinePayment: vi.fn(),
  refreshInvoicePaymentAttempts: vi.fn(),
  submitManualPaymentClaim: vi.fn(),
  createPaymentPort: vi.fn(),
}));

vi.mock('@visastack/services', async () => {
  // The amount helpers are the real ones; only what talks to the database or the gateway is replaced.
  const real = await vi.importActual<typeof import('@visastack/services')>('@visastack/services');
  return {
    PROOF_FILE_MAX_BYTES: real.PROOF_FILE_MAX_BYTES,
    formatAmountForCurrency: real.formatAmountForCurrency,
    parseAmountForCurrency: real.parseAmountForCurrency,
    startOnlinePayment: mocks.startOnlinePayment,
    refreshInvoicePaymentAttempts: mocks.refreshInvoicePaymentAttempts,
    submitManualPaymentClaim: mocks.submitManualPaymentClaim,
  };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock('../../../../../../lib/base-url', () => ({
  resolveBaseUrl: () => 'https://vs.example.test',
}));
vi.mock('../../../../../../lib/providers', () => ({
  createPaymentPort: mocks.createPaymentPort,
  createMalwareScanner: () => ({ scanner: true }),
}));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: { db: true }, accountId: 'acct-1' }),
}));
vi.mock('../../../../../../lib/storage', () => ({ createStorage: () => ({ storage: true }) }));

const { checkPaymentAction, startPaymentAction, submitClaimAction } = await import('./actions');

const ORG = '11111111-2222-4333-8444-555555555555';
const INVOICE = '66666666-7777-4888-8999-000000000000';
const INITIAL = { ok: true, message: '' };

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const claimFields = (overrides: Record<string, string | File> = {}) => ({
  organizationId: ORG,
  invoiceId: INVOICE,
  currency: 'BDT',
  method: 'BANK_TRANSFER',
  reference: 'TRX-1',
  amount: '1250.50',
  paidOn: '2026-10-25',
  note: '',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createPaymentPort.mockReturnValue({ configured: true, provider: 'sslcommerz' });
});

describe('starting a payment', () => {
  it('refuses a malformed invoice or agency without calling the service', async () => {
    const result = await startPaymentAction(
      INITIAL,
      form({ organizationId: 'x', invoiceId: INVOICE }),
    );
    expect(result).toEqual({ ok: false, message: 'We could not find this invoice.' });
    expect(mocks.startOnlinePayment).not.toHaveBeenCalled();
  });

  it('sends the person to the payment page the service opened, as this person, for this invoice', async () => {
    mocks.startOnlinePayment.mockResolvedValue({
      ok: true,
      value: {
        kind: 'redirect',
        attemptId: 'a',
        redirectUrl: 'https://sandbox.example.test/pay?x=1',
      },
    });
    await expect(
      startPaymentAction(INITIAL, form({ organizationId: ORG, invoiceId: INVOICE })),
    ).rejects.toThrow('NEXT_REDIRECT:https://sandbox.example.test/pay?x=1');
    const input = mocks.startOnlinePayment.mock.calls[0]?.[2];
    expect(input).toMatchObject({
      actorAccountId: 'acct-1',
      invoiceId: INVOICE,
      startAnother: false,
    });
    expect(input.urlFor('ipn', 'VSP1')).toBe('https://vs.example.test/api/payments/sslcommerz/ipn');
  });

  it('asks again on purpose: only an explicit "yes" starts another payment', async () => {
    mocks.startOnlinePayment.mockResolvedValue({ ok: true, value: { kind: 'recent_attempt' } });
    const result = await startPaymentAction(
      INITIAL,
      form({ organizationId: ORG, invoiceId: INVOICE, startAnother: 'true' }),
    );
    expect(mocks.startOnlinePayment.mock.calls[0]?.[2].startAnother).toBe(false);
    expect(result.message).toMatch(/Check it before paying again/);
  });

  it('passes on a plain refusal from the service, and says "not available yet" when payments are off', async () => {
    mocks.startOnlinePayment.mockResolvedValue({
      ok: false,
      error: { code: 'not_found', message: 'invoice not found' },
    });
    expect(
      await startPaymentAction(INITIAL, form({ organizationId: ORG, invoiceId: INVOICE })),
    ).toEqual({ ok: false, message: 'invoice not found' });
    mocks.createPaymentPort.mockImplementation(() => {
      throw new Error('PAYMENT_PROVIDER=sslcommerz requires SSLCOMMERZ_STORE_PASSWORD');
    });
    const off = await startPaymentAction(
      INITIAL,
      form({ organizationId: ORG, invoiceId: INVOICE }),
    );
    expect(off.message).toBe('Online payment is not available yet. Please try again later.');
    // The configuration problem is never shown to the person.
    expect(JSON.stringify(off)).not.toMatch(/SSLCOMMERZ|PASSWORD/);
  });
});

describe('checking a payment', () => {
  const summary = (overrides: Record<string, unknown> = {}) => ({
    ok: true,
    value: {
      available: true,
      configured: true,
      checked: 1,
      recorded: 0,
      held: 0,
      closed: 0,
      stillPending: 0,
      unavailable: 0,
      awaitingReview: 0,
      ...overrides,
    },
  });
  const run = () => checkPaymentAction(INITIAL, form({ organizationId: ORG, invoiceId: INVOICE }));

  it('asks the gateway now, for this person and invoice, and tells the result in plain words', async () => {
    mocks.refreshInvoicePaymentAttempts.mockResolvedValue(summary({ recorded: 1 }));
    expect((await run()).message).toBe('Your payment was received. Thank you.');
    expect(mocks.refreshInvoicePaymentAttempts.mock.calls[0]?.[2]).toMatchObject({
      actorAccountId: 'acct-1',
      organizationId: ORG,
      invoiceId: INVOICE,
      minAgeMs: 0,
    });
    mocks.refreshInvoicePaymentAttempts.mockResolvedValue(summary({ held: 1 }));
    expect((await run()).message).toMatch(/needs a check/);
    mocks.refreshInvoicePaymentAttempts.mockResolvedValue(summary({ stillPending: 1 }));
    expect((await run()).message).toMatch(/still confirming/);
    mocks.refreshInvoicePaymentAttempts.mockResolvedValue(summary({ closed: 1 }));
    expect((await run()).message).toMatch(/Nothing was charged/);
    mocks.refreshInvoicePaymentAttempts.mockResolvedValue(summary());
    expect((await run()).message).toMatch(/no open payment/);
  });

  it('says it cannot find the invoice for a refused reader', async () => {
    mocks.refreshInvoicePaymentAttempts.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'not allowed to see the payments of this invoice' },
    });
    expect(await run()).toEqual({ ok: false, message: 'We could not find this invoice.' });
  });
});

describe('reporting a payment made another way', () => {
  const run = (fields: Record<string, string | File> = {}) =>
    submitClaimAction(INITIAL, form(claimFields(fields)));

  it('reads the amount exactly in the invoice currency and sends the report as this person', async () => {
    mocks.submitManualPaymentClaim.mockResolvedValue({
      ok: true,
      value: { amountMinorUnits: 125050, currency: 'BDT' },
    });
    const result = await run({ note: ' paid by the accountant ' });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('BDT 1250.50');
    expect(result.message).toMatch(/nothing is counted until VisaStack confirms it/);
    const [, ports, input] = mocks.submitManualPaymentClaim.mock.calls[0] ?? [];
    expect(ports).toEqual({ storage: { storage: true }, scanner: { scanner: true } });
    expect(input).toMatchObject({
      actorAccountId: 'acct-1',
      invoiceId: INVOICE,
      method: 'BANK_TRANSFER',
      reference: 'TRX-1',
      amountMinorUnits: 125050,
      currency: 'BDT',
      note: 'paid by the accountant',
    });
    expect(input.paidOn.toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(input.proofFile).toBeUndefined();
  });

  it('names the field at fault for a bad amount, a bad date and a file that is too big, before any work', async () => {
    for (const amount of ['', 'abc', '-5', '12.505', '1,250', '0']) {
      expect(await run({ amount }), amount).toMatchObject({ ok: false, field: 'amount' });
    }
    expect(await run({ paidOn: '25/10/2026' })).toMatchObject({ ok: false, field: 'paidOn' });
    expect(await run({ paidOn: '' })).toMatchObject({ ok: false, field: 'paidOn' });
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'slip.pdf', {
      type: 'application/pdf',
    });
    expect(await run({ proof: big })).toMatchObject({ ok: false, field: 'proof' });
    expect(mocks.submitManualPaymentClaim).not.toHaveBeenCalled();
  });

  it('hands the proof file to the service with its type and bytes', async () => {
    mocks.submitManualPaymentClaim.mockResolvedValue({
      ok: true,
      value: { amountMinorUnits: 125050, currency: 'BDT' },
    });
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'slip.pdf', {
      type: 'application/pdf',
    });
    await run({ proof: file });
    const input = mocks.submitManualPaymentClaim.mock.calls[0]?.[2];
    expect(input.proofFile.contentType).toBe('application/pdf');
    expect(Array.from(input.proofFile.bytes)).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
  });

  it('shows the service refusal as it is (already paid, not an owner or admin, report waiting)', async () => {
    mocks.submitManualPaymentClaim.mockResolvedValue({
      ok: false,
      error: {
        code: 'invalid',
        message: 'This invoice is already paid. There is nothing left to report.',
      },
    });
    expect(await run()).toEqual({
      ok: false,
      message: 'This invoice is already paid. There is nothing left to report.',
    });
  });
});
