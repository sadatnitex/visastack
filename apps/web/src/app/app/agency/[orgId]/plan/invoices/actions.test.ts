import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startOnlinePayment: vi.fn(),
  refreshInvoicePaymentAttempts: vi.fn(),
  submitManualPaymentClaim: vi.fn(),
  paymentPorts: vi.fn(),
}));

vi.mock('@visastack/services', async () => {
  // The amount helpers are the real ones; only what talks to the database or the gateway is replaced.
  const real = await vi.importActual<typeof import('@visastack/services')>('@visastack/services');
  return {
    PROOF_FILE_MAX_BYTES: real.PROOF_FILE_MAX_BYTES,
    formatAmountForCurrency: real.formatAmountForCurrency,
    CLAIM_AMOUNT_PROBLEM: real.CLAIM_AMOUNT_PROBLEM,
    PAYMENT_METHOD_OFF: real.PAYMENT_METHOD_OFF,
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
  paymentPorts: mocks.paymentPorts,
  createMalwareScanner: () => ({ scanner: true }),
  createImageSanitizer: () => ({ images: true }),
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
  mocks.paymentPorts.mockReturnValue({
    configured: () => [{ configured: true, provider: 'sslcommerz' }],
  });
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
    expect(input.urlFor('ipn', 'VSP1', 'sslcommerz')).toBe(
      'https://vs.example.test/api/payments/sslcommerz/ipn',
    );
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

  it('passes on a plain refusal from the service, including the one for a switched-off payment method', async () => {
    mocks.startOnlinePayment.mockResolvedValue({
      ok: false,
      error: { code: 'not_found', message: 'invoice not found' },
    });
    expect(
      await startPaymentAction(INITIAL, form({ organizationId: ORG, invoiceId: INVOICE })),
    ).toEqual({ ok: false, message: 'invoice not found' });
    const PAYMENT_METHOD_OFF =
      'Your earlier payment was started with a payment method that is switched off now. Contact us before paying again, so you are not charged twice.';
    mocks.startOnlinePayment.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', reason: 'provider_not_configured', message: PAYMENT_METHOD_OFF },
    });
    expect(
      await startPaymentAction(
        INITIAL,
        form({ organizationId: ORG, invoiceId: INVOICE, startAnother: 'yes' }),
      ),
    ).toEqual({ ok: false, message: PAYMENT_METHOD_OFF });
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
      providerNotConfigured: 0,
      strandedPayment: false,
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

  it('tells the payer an earlier payment is open with a payment method switched off now (S19 step 0 round 2)', async () => {
    const off =
      'Your earlier payment was started with a payment method that is switched off now. Contact us before paying again, so you are not charged twice.';
    // Whether other providers are on or none is.
    for (const configured of [true, false]) {
      mocks.refreshInvoicePaymentAttempts.mockResolvedValue(
        summary({ configured, checked: 0, providerNotConfigured: 1, strandedPayment: true }),
      );
      expect(await run(), String(configured)).toEqual({ ok: false, message: off });
    }
    // Round 3: only the service's stranded answer counts; an old payment left with a switched-off
    // provider (counted for staff) does not stop the payer.
    mocks.refreshInvoicePaymentAttempts.mockResolvedValue(
      summary({ checked: 0, providerNotConfigured: 1, strandedPayment: false }),
    );
    expect((await run()).message).toMatch(/no open payment/);
    // Good news about another payment of the invoice still comes first.
    mocks.refreshInvoicePaymentAttempts.mockResolvedValue(
      summary({ recorded: 1, providerNotConfigured: 1, strandedPayment: true }),
    );
    expect((await run()).message).toBe('Your payment was received. Thank you.');
    // With nothing configured and nothing stranded, online payment is simply not available.
    mocks.refreshInvoicePaymentAttempts.mockResolvedValue(
      summary({ configured: false, checked: 0, providerNotConfigured: 0 }),
    );
    expect((await run()).message).toBe(
      'Online payment is not available yet. Please try again later.',
    );
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

  it('sends the typed amount, to be read in the invoice currency, as this person', async () => {
    mocks.submitManualPaymentClaim.mockResolvedValue({
      ok: true,
      value: { amountMinorUnits: 125050, currency: 'BDT' },
    });
    const result = await run({ note: ' paid by the accountant ' });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('BDT\u00a01,250.50');
    expect(result.message).toMatch(/nothing is counted until VisaStack confirms it/);
    const [, ports, input] = mocks.submitManualPaymentClaim.mock.calls[0] ?? [];
    // No file attached, so storage and the scanner are not even set up.
    expect(ports).toBeNull();
    expect(input).toMatchObject({
      actorAccountId: 'acct-1',
      invoiceId: INVOICE,
      method: 'BANK_TRANSFER',
      reference: 'TRX-1',
      amountText: '1250.50',
      note: 'paid by the accountant',
    });
    // The amount is read by the service in the invoice's own stored currency (S30).
    expect(input).not.toHaveProperty('amountMinorUnits');
    expect(input).not.toHaveProperty('currency');
    expect(input.paidOn.toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(input.proofFile).toBeUndefined();
  });

  it('names the field at fault for a bad amount, a bad date and a file that is too big, before any work', async () => {
    // Separators in the right places are read since S30 ("1,250"); misplaced ones are not. More
    // places than any currency has fail here; places the invoice currency lacks fail in the service.
    for (const amount of ['', 'abc', '-5', '12.5051', '12,50', '0']) {
      expect(await run({ amount }), amount).toMatchObject({ ok: false, field: 'amount' });
    }
    expect(await run({ paidOn: '25/10/2026' })).toMatchObject({ ok: false, field: 'paidOn' });
    expect(await run({ paidOn: '' })).toMatchObject({ ok: false, field: 'paidOn' });
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'slip.pdf', {
      type: 'application/pdf',
    });
    expect(await run({ proof: big })).toMatchObject({ ok: false, field: 'proof' });
    expect(mocks.submitManualPaymentClaim).not.toHaveBeenCalled();
  });

  it("points at the amount or the currency from the service's typed reason, and ignores a tampered currency (S30)", async () => {
    mocks.submitManualPaymentClaim.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid', reason: 'amount_invalid', message: 'Enter the amount you paid.' },
    });
    expect(await run({ amount: '12.505', currency: 'BHD' })).toMatchObject({
      ok: false,
      field: 'amount',
    });
    const input = mocks.submitManualPaymentClaim.mock.calls[0]?.[2];
    expect(input).toMatchObject({ amountText: '12.505' });
    expect(input).not.toHaveProperty('currency');
    mocks.submitManualPaymentClaim.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid', reason: 'amount_over_balance', message: 'More than owed.' },
    });
    expect(await run()).toMatchObject({ ok: false, field: 'amount' });
  });

  it("points at the report field the service's typed reason names, and at nothing without one", async () => {
    const cases = [
      ['claim_method_invalid', 'method'],
      ['claim_reference_invalid', 'reference'],
      ['claim_note_invalid', 'note'],
      ['claim_date_invalid', 'paidOn'],
      ['claim_proof_invalid', 'proof'],
    ] as const;
    for (const [reason, field] of cases) {
      mocks.submitManualPaymentClaim.mockResolvedValueOnce({
        ok: false,
        error: { code: 'invalid', reason, message: 'Not accepted.' },
      });
      expect(await run(), reason).toMatchObject({ ok: false, field });
    }
    mocks.submitManualPaymentClaim.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid', message: 'This invoice was cancelled. There is nothing to pay.' },
    });
    expect(await run()).not.toHaveProperty('field');
  });

  it('gives back what was typed (not the file) with every refusal, so the form can keep it', async () => {
    const typed = {
      method: 'BKASH',
      reference: 'TRX-9',
      amount: 'abc',
      paidOn: '2026-10-25',
      note: 'a note',
    };
    const result = await run(typed);
    expect(result).toMatchObject({ ok: false, field: 'amount', values: typed });
    mocks.submitManualPaymentClaim.mockResolvedValue({
      ok: false,
      error: {
        code: 'invalid',
        message: 'A payment report for this invoice is already waiting for confirmation.',
      },
    });
    const refused = await run({ ...typed, amount: '10' });
    expect(refused).toMatchObject({ ok: false, values: { ...typed, amount: '10' } });
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
    const [, ports, input] = mocks.submitManualPaymentClaim.mock.calls[0] ?? [];
    expect(ports).toEqual({
      storage: { storage: true },
      scanner: { scanner: true },
      images: { images: true },
    });
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
    expect(await run()).toMatchObject({
      ok: false,
      message: 'This invoice is already paid. There is nothing left to report.',
    });
  });
});
