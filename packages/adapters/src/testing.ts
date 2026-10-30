import { createHash } from 'node:crypto';

/**
 * A sandbox-shaped fake of the SSLCOMMERZ v4 gateway, for tests of `SslcommerzPaymentPort` and of
 * everything built on it. It speaks the same three server-to-server calls (open a session, validate
 * by validation id, query by transaction id) over an injectable `fetch`, checks the store
 * credentials the way the real gateway does, and signs notifications the way the real gateway
 * does. Tests drive it with `pay`, `fail`, `cancel` and `setOutage`.
 *
 * Nothing here talks to a network. It is a test double, never used outside tests.
 */

export interface FakeGatewayOptions {
  readonly storeId: string;
  readonly storePassword: string;
}

export interface FakeGatewayTransaction {
  readonly tranId: string;
  readonly amount: string;
  readonly currency: string;
  readonly sessionKey: string;
  status: 'PENDING' | 'VALID' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  valId: string | null;
  bankTranId: string | null;
  riskLevel: string;
  currencyType: string | null;
  /** Overrides the amount the validation reports, to model a gateway that says something else. */
  reportedAmount: string | null;
  reportedStoreId: string | null;
}

/** One refund the fake gateway took (S18). */
export interface FakeGatewayRefund {
  readonly refundRefId: string;
  readonly refundTransId: string;
  readonly bankTranId: string;
  readonly amount: string;
  status: 'processing' | 'refunded' | 'cancelled';
}

export interface FakeGatewayRequest {
  readonly method: string;
  readonly path: string;
}

function md5(value: string): string {
  return createHash('md5').update(value, 'utf8').digest('hex'); // supply-chain-allow: test double of the gateway's MD5 callback signature scheme.
}

export class FakeSslcommerzGateway {
  readonly transactions = new Map<string, FakeGatewayTransaction>();
  readonly requests: FakeGatewayRequest[] = [];
  /** Refunds by VisaStack's refund id (`refund_trans_id`). */
  readonly refunds = new Map<string, FakeGatewayRefund>();
  /** The next refund asked for is refused with `status: failed`. */
  refuseNextRefund = false;
  #outage = false;
  #sequence = 0;
  readonly #options: FakeGatewayOptions;

  constructor(options: FakeGatewayOptions) {
    this.#options = options;
  }

  /** While true every call fails at the network level, like a gateway that cannot be reached. */
  setOutage(down: boolean): void {
    this.#outage = down;
  }

  /** The customer completes payment at the gateway. */
  pay(
    tranId: string,
    overrides: Partial<
      Pick<
        FakeGatewayTransaction,
        'riskLevel' | 'currencyType' | 'reportedAmount' | 'reportedStoreId' | 'bankTranId'
      >
    > = {},
  ): FakeGatewayTransaction {
    const tx = this.#get(tranId);
    this.#sequence += 1;
    tx.status = 'VALID';
    tx.valId = `2610270000${String(this.#sequence).padStart(6, '0')}AbC`;
    tx.bankTranId = overrides.bankTranId ?? `BANK${String(this.#sequence).padStart(8, '0')}`;
    if (overrides.riskLevel !== undefined) tx.riskLevel = overrides.riskLevel;
    if (overrides.currencyType !== undefined) tx.currencyType = overrides.currencyType;
    if (overrides.reportedAmount !== undefined) tx.reportedAmount = overrides.reportedAmount;
    if (overrides.reportedStoreId !== undefined) tx.reportedStoreId = overrides.reportedStoreId;
    return tx;
  }

  /** The gateway finishes (or cancels) a refund it took. */
  settleRefund(refundRefId: string, status: 'refunded' | 'cancelled'): void {
    const refund = [...this.refunds.values()].find((r) => r.refundRefId === refundRefId);
    if (!refund) throw new Error(`the fake gateway has no refund ${refundRefId}`);
    refund.status = status;
  }

  fail(tranId: string): void {
    this.#get(tranId).status = 'FAILED';
  }

  cancel(tranId: string): void {
    this.#get(tranId).status = 'CANCELLED';
  }

  expire(tranId: string): void {
    this.#get(tranId).status = 'EXPIRED';
  }

  #get(tranId: string): FakeGatewayTransaction {
    const tx = this.transactions.get(tranId);
    if (!tx) throw new Error(`the fake gateway has no session for ${tranId}`);
    return tx;
  }

  /** The form the real gateway posts to the notification address, signed with the store password. */
  notification(
    tranId: string,
    overrides: Readonly<Record<string, string>> = {},
  ): Record<string, string> {
    const tx = this.#get(tranId);
    const fields: Record<string, string> = {
      status: tx.status === 'PENDING' ? 'FAILED' : tx.status,
      tran_id: tx.tranId,
      val_id: tx.valId ?? '',
      amount: tx.amount,
      currency: tx.currency,
      bank_tran_id: tx.bankTranId ?? '',
      risk_level: tx.riskLevel,
      tran_date: '2026-10-27 10:00:00',
      store_id: this.#options.storeId,
      ...overrides,
    };
    return this.sign(fields);
  }

  /** Adds `verify_key` and `verify_sign` to a set of fields, the way the gateway does. */
  sign(fields: Readonly<Record<string, string>>): Record<string, string> {
    const names = Object.keys(fields);
    const signed = new Map<string, string>(names.map((n) => [n, fields[n] ?? '']));
    signed.set('store_passwd', md5(this.#options.storePassword));
    const payload = [...signed.keys()]
      .sort()
      .map((n) => `${n}=${signed.get(n) ?? ''}`)
      .join('&');
    return { ...fields, verify_key: names.join(','), verify_sign: md5(payload) };
  }

  /** The injectable `fetch`. */
  readonly fetch: typeof fetch = async (input, init) => {
    if (this.#outage) throw new TypeError('fetch failed');
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    this.requests.push({ method, path: url.pathname });
    const params =
      method === 'POST' && init?.body instanceof URLSearchParams ? init.body : url.searchParams;
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    const credentialsOk =
      params.get('store_id') === this.#options.storeId &&
      params.get('store_passwd') === this.#options.storePassword;

    if (url.pathname === '/gwprocess/v4/api.php' && method === 'POST') {
      if (!credentialsOk) return json({ status: 'FAILED', failedreason: 'Store Credential Error' });
      const tranId = params.get('tran_id') ?? '';
      if (this.transactions.has(tranId)) {
        return json({ status: 'FAILED', failedreason: 'Duplicate transaction id' });
      }
      const sessionKey = `SESSION${md5(tranId).slice(0, 24).toUpperCase()}`;
      this.transactions.set(tranId, {
        tranId,
        amount: params.get('total_amount') ?? '',
        currency: params.get('currency') ?? '',
        sessionKey,
        status: 'PENDING',
        valId: null,
        bankTranId: null,
        riskLevel: '0',
        currencyType: null,
        reportedAmount: null,
        reportedStoreId: null,
      });
      return json({
        status: 'SUCCESS',
        sessionkey: sessionKey,
        GatewayPageURL: `https://sandbox.sslcommerz.com/gwprocess/v4/gw.php?Q=PAY&SESSIONKEY=${sessionKey}`,
      });
    }

    if (!credentialsOk) return json({ APIConnect: 'INACTIVE' });

    if (url.pathname === '/validator/api/validationserverAPI.php') {
      const valId = params.get('val_id') ?? '';
      const tx = [...this.transactions.values()].find((t) => t.valId === valId && valId !== '');
      if (!tx) return json({ status: 'INVALID_TRANSACTION', APIConnect: 'DONE' });
      return json({ ...this.#record(tx), APIConnect: 'DONE' });
    }

    if (
      url.pathname === '/validator/api/merchantTransIDvalidationAPI.php' &&
      params.has('refund_ref_id')
    ) {
      const ref = params.get('refund_ref_id') ?? '';
      const refund = [...this.refunds.values()].find((r) => r.refundRefId === ref);
      if (!refund) return json({ APIConnect: 'DONE', status: 'invalid_refund_id' });
      return json({
        APIConnect: 'DONE',
        bank_tran_id: refund.bankTranId,
        refund_ref_id: refund.refundRefId,
        initiated_on: '2026-10-30 10:00:00',
        refunded_on: refund.status === 'refunded' ? '2026-10-30 15:30:00' : '',
        status: refund.status,
        errorReason: '',
      });
    }

    if (
      url.pathname === '/validator/api/merchantTransIDvalidationAPI.php' &&
      params.has('refund_amount')
    ) {
      const bankTranId = params.get('bank_tran_id') ?? '';
      const paid = [...this.transactions.values()].find(
        (t) => t.bankTranId === bankTranId && t.status === 'VALID',
      );
      const transId = params.get('refund_trans_id') ?? '';
      const earlier = this.refunds.get(transId);
      // The same refund id again: the same refund (how the fake models it; not verified live).
      if (earlier) {
        return json({ APIConnect: 'DONE', status: 'success', refund_ref_id: earlier.refundRefId });
      }
      if (!paid || this.refuseNextRefund) {
        this.refuseNextRefund = false;
        return json({ APIConnect: 'DONE', status: 'failed', errorReason: 'Refund not allowed' });
      }
      this.#sequence += 1;
      const refund: FakeGatewayRefund = {
        refundRefId: `RR${String(this.#sequence).padStart(10, '0')}`,
        refundTransId: transId,
        bankTranId,
        amount: params.get('refund_amount') ?? '',
        status: 'processing',
      };
      this.refunds.set(transId, refund);
      return json({
        APIConnect: 'DONE',
        bank_tran_id: bankTranId,
        trans_id: paid.tranId,
        refund_ref_id: refund.refundRefId,
        status: 'success',
        errorReason: '',
      });
    }

    if (url.pathname === '/validator/api/merchantTransIDvalidationAPI.php') {
      const tx = this.transactions.get(params.get('tran_id') ?? '');
      if (!tx) return json({ APIConnect: 'DONE', no_of_trans_found: 0, element: [] });
      return json({ APIConnect: 'DONE', no_of_trans_found: 1, element: [this.#record(tx)] });
    }

    return json({ error: 'unknown' }, 404);
  };

  #record(tx: FakeGatewayTransaction): Record<string, string> {
    return {
      status: tx.status,
      tran_id: tx.tranId,
      val_id: tx.valId ?? '',
      amount: tx.reportedAmount ?? tx.amount,
      currency: tx.currency,
      bank_tran_id: tx.bankTranId ?? '',
      risk_level: tx.riskLevel,
      ...(tx.currencyType ? { currency_type: tx.currencyType } : {}),
      ...(tx.reportedStoreId ? { store_id: tx.reportedStoreId } : {}),
    };
  }
}

// Made-up HEIC photos (flat colours only) for the iPhone photo conversion tests.
export { MADE_UP_HEIC_HUGE, MADE_UP_HEIC_LARGE, MADE_UP_HEIC_SMALL } from './heic-fixtures';
