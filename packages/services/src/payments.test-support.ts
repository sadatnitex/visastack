import {
  type CreateCheckoutInput,
  PaymentProviderUnavailableError,
  type PaymentValidation,
  type RefundProviderStatus,
  type RefundStatusReport,
  type RefundSubmission,
  type RefundSubmissionResult,
  type RefundingPaymentPort,
} from './ports';

/**
 * Test-only (not exported from the package index): a programmable payment gateway for the
 * service tests. It answers `validatePayment` and `queryByMerchantTranId` from what a test
 * has set up, can be made unreachable, and counts every call, so a test can prove the service
 * asked the gateway (and did not just believe a callback).
 */
export class FakePaymentPort implements RefundingPaymentPort {
  readonly configured = true;
  readonly provider = 'sslcommerz';
  /** S29: LIVE unless a test sets TEST (in test mode only the platform owner can start a payment). */
  mode: 'TEST' | 'LIVE' = 'LIVE';
  readonly storeId: string | null = 'teststore';
  readonly checkouts: CreateCheckoutInput[] = [];
  readonly validationCalls: string[] = [];
  readonly queryCalls: string[] = [];
  outage = false;
  checkoutBehaviour: 'ok' | 'throw' | 'hang' = 'ok';
  signatureValid = true;
  /** What the gateway says about each transaction id (a query returns this). */
  readonly byTran = new Map<string, PaymentValidation>();
  /** What the gateway says about each validation id. */
  readonly byVal = new Map<string, PaymentValidation>();

  async createCheckout(input: CreateCheckoutInput) {
    this.checkouts.push(input);
    if (this.checkoutBehaviour === 'throw') throw new PaymentProviderUnavailableError();
    if (this.checkoutBehaviour === 'hang') return new Promise<never>(() => undefined);
    return {
      redirectUrl: `https://sandbox.sslcommerz.com/gwprocess/v4/gw.php?Q=PAY&SESSIONKEY=S${this.checkouts.length}`,
      sessionKey: `S${this.checkouts.length}`,
    };
  }

  async validatePayment(input: { readonly valId: string }): Promise<PaymentValidation> {
    this.validationCalls.push(input.valId);
    if (this.outage) throw new PaymentProviderUnavailableError();
    return (
      this.byVal.get(input.valId) ?? {
        status: 'INVALID',
        merchantTranId: null,
        valId: null,
        amountMinorUnits: null,
        currency: null,
        bankTranId: null,
        riskLevel: null,
        storeId: null,
      }
    );
  }

  async queryByMerchantTranId(merchantTranId: string): Promise<PaymentValidation> {
    this.queryCalls.push(merchantTranId);
    if (this.outage) throw new PaymentProviderUnavailableError();
    return (
      this.byTran.get(merchantTranId) ?? {
        status: 'UNATTEMPTED',
        merchantTranId,
        valId: null,
        amountMinorUnits: null,
        currency: null,
        bankTranId: null,
        riskLevel: null,
        storeId: null,
      }
    );
  }

  verifyIpnSignature(): boolean {
    return this.signatureValid;
  }

  // --- Refunds (S18) ---
  readonly refundCalls: RefundSubmission[] = [];
  readonly refundQueries: string[] = [];
  /** How the next refund calls are answered. */
  refundBehaviour: 'accept' | 'refuse' | 'throw' = 'accept';
  /** What the gateway says about each refund reference. */
  readonly refundStatus = new Map<string, RefundProviderStatus>();
  refundQueryOutage = false;

  async refund(input: RefundSubmission): Promise<RefundSubmissionResult> {
    this.refundCalls.push(input);
    if (this.refundBehaviour === 'throw') throw new PaymentProviderUnavailableError();
    if (this.refundBehaviour === 'refuse') return { kind: 'refused', code: 'provider_refused' };
    const refundRefId = `RR${input.refundId.replace(/-/g, '').slice(0, 12)}`;
    if (!this.refundStatus.has(refundRefId)) this.refundStatus.set(refundRefId, 'PROCESSING');
    return { kind: 'accepted', refundRefId };
  }

  async queryRefund(refundRefId: string): Promise<RefundStatusReport> {
    this.refundQueries.push(refundRefId);
    if (this.refundQueryOutage) throw new PaymentProviderUnavailableError();
    const status = this.refundStatus.get(refundRefId) ?? 'UNKNOWN';
    return { status, refundedAt: status === 'REFUNDED' ? new Date('2026-10-30T09:30:00Z') : null };
  }

  /** The gateway reports a successful payment for a transaction (and under its validation id). */
  succeed(
    merchantTranId: string,
    amountMinorUnits: number,
    overrides: Partial<PaymentValidation> = {},
  ): PaymentValidation {
    const record: PaymentValidation = {
      status: 'VALID',
      merchantTranId,
      valId: `VAL${merchantTranId.slice(3, 15)}`,
      amountMinorUnits,
      currency: 'BDT',
      bankTranId: `BANK${merchantTranId.slice(3, 11)}`,
      riskLevel: 0,
      storeId: 'teststore',
      ...overrides,
    };
    this.byTran.set(merchantTranId, record);
    if (record.valId) this.byVal.set(record.valId, record);
    return record;
  }

  /** The gateway reports a payment that ended without money. */
  end(merchantTranId: string, status: 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'PENDING'): void {
    this.byTran.set(merchantTranId, {
      status,
      merchantTranId,
      valId: null,
      amountMinorUnits: null,
      currency: null,
      bankTranId: null,
      riskLevel: null,
      storeId: null,
    });
  }
}
