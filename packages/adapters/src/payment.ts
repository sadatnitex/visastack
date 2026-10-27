import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type CheckoutSession,
  type CreateCheckoutInput,
  type PaymentPort,
  PaymentProviderUnavailableError,
  type PaymentValidation,
  type PaymentValidationStatus,
  formatMinorUnits,
  parseDecimalToMinorUnits,
} from '@visastack/services';

/**
 * The default payment provider: there isn't one. `configured: false` lets a caller check before
 * attempting a checkout, matching `getPlatformCapabilities()`'s `payments: 'unconfigured'`
 * entry. Every method throws rather than returning something that could be mistaken for a
 * payment: nothing should be able to confuse "no provider" with "a checkout that always fails
 * downstream", and `verifyIpnSignature` can never say yes.
 */
export class NullPaymentPort implements PaymentPort {
  readonly configured = false;
  readonly provider = 'none';
  readonly storeId = null;

  async createCheckout(): Promise<never> {
    throw new Error('no payment provider is configured in this deployment');
  }

  async validatePayment(): Promise<never> {
    throw new Error('no payment provider is configured in this deployment');
  }

  async queryByMerchantTranId(): Promise<never> {
    throw new Error('no payment provider is configured in this deployment');
  }

  verifyIpnSignature(): boolean {
    return false;
  }
}

// --- SSLCOMMERZ (hosted Bangladesh gateway, ADR 0020) -------------------------------------
//
// Built from the v4 integration as widely documented (session API, IPN, Order Validation API,
// Transaction Query API). The official documentation host could not be reached when this was
// written, so the field names below must be re-checked against the official v4 documentation
// before the sandbox account is used (see docs/adr/0020 and the S11 evidence notes). Every
// gateway address is a constant chosen by `mode`; no address, host or path ever comes from a
// request, a form or a gateway reply except the checkout page address, which is held to the
// gateway's own domain before anyone is sent there.

export type SslcommerzMode = 'sandbox' | 'live';

const HOSTS: Readonly<Record<SslcommerzMode, string>> = {
  sandbox: 'https://sandbox.sslcommerz.com',
  live: 'https://securepay.sslcommerz.com',
};

const SESSION_PATH = '/gwprocess/v4/api.php';
const VALIDATION_PATH = '/validator/api/validationserverAPI.php';
const QUERY_PATH = '/validator/api/merchantTransIDvalidationAPI.php';

/** The longest reply read from the gateway; a larger one is treated as unreadable. */
const MAX_REPLY_BYTES = 262_144;
const SESSION_TIMEOUT_MS = 15_000;
const VALIDATION_TIMEOUT_MS = 10_000;
/** What the gateway's own validation ids look like: letters and digits only. */
const VAL_ID_PATTERN = /^[A-Za-z0-9]{6,64}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{32}$/;
/** More signed field names than this is not a gateway callback. */
const MAX_SIGNED_FIELDS = 64;

export interface SslcommerzPaymentPortOptions {
  readonly storeId: string;
  /** The store password. Used only to authenticate to the gateway and to check callback signatures; never logged, stored or returned. */
  readonly storePassword: string;
  readonly mode: SslcommerzMode;
  /** Injected in tests; defaults to the global fetch. */
  readonly fetch?: typeof fetch;
  readonly sessionTimeoutMs?: number;
  readonly validationTimeoutMs?: number;
  /**
   * Told, with fixed words only, each time the gateway could not be used, so a wrong store
   * credential or a wrong mode shows up in the operational logs instead of looking like an
   * ordinary outage. Never receives an address, a reply or a credential.
   */
  readonly onFailure?: (event: PaymentProviderFailure) => void;
}

export interface PaymentProviderFailure {
  readonly operation: 'checkout' | 'validation' | 'query';
  readonly reason:
    | 'unreachable'
    | 'error_status'
    | 'unreadable'
    | 'too_large'
    | 'not_accepted'
    | 'unexpected_address';
}

function md5Hex(value: string): string {
  // The gateway's own signature scheme is MD5 over the callback fields and the MD5 of the store
  // password, so MD5 is required here for interoperability. It only filters out noise: no money
  // is ever counted from a signature (the gateway's validation call decides).
  return createHash('md5').update(value, 'utf8').digest('hex'); // supply-chain-allow: the gateway's callback signature scheme is MD5; it is a first filter only and never proves a payment.
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One named field of a parsed gateway reply (a variable key, so it satisfies both the compiler and the linter). */
function field(record: Record<string, unknown>, name: string): unknown {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

const STATUS_BY_TEXT: Readonly<Record<string, PaymentValidationStatus>> = {
  VALID: 'VALID',
  VALIDATED: 'VALIDATED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  UNATTEMPTED: 'UNATTEMPTED',
  EXPIRED: 'EXPIRED',
  PENDING: 'PENDING',
};

/**
 * One gateway payment record (a validation reply, or one element of a query reply) in
 * VisaStack's terms. Anything the gateway did not say clearly becomes null, which the service
 * treats as a failed check. A status the gateway uses that is not listed becomes `INVALID`
 * (nothing is counted, nothing is changed).
 */
export function normalizeSslcommerzRecord(raw: Record<string, unknown>): PaymentValidation {
  const statusText = text(field(raw, 'status'))?.toUpperCase() ?? '';
  const status: PaymentValidationStatus = Object.hasOwn(STATUS_BY_TEXT, statusText)
    ? (STATUS_BY_TEXT[statusText] ?? 'INVALID')
    : 'INVALID';
  const amountText = text(field(raw, 'amount'));
  const currencyType = text(field(raw, 'currency_type'))?.toUpperCase() ?? null;
  const currency = text(field(raw, 'currency'))?.toUpperCase() ?? null;
  // When the gateway reports two different currencies the payment was converted, so neither
  // can be compared with the invoice: report none, and the currency check fails.
  const reportedCurrency =
    currencyType !== null && currency !== null && currencyType !== currency
      ? null
      : (currencyType ?? currency);
  const riskText = text(field(raw, 'risk_level'));
  return {
    status,
    merchantTranId: text(field(raw, 'tran_id')),
    valId: text(field(raw, 'val_id')),
    amountMinorUnits: amountText === null ? null : parseDecimalToMinorUnits(amountText),
    currency: reportedCurrency,
    bankTranId: text(field(raw, 'bank_tran_id')),
    riskLevel: riskText !== null && /^[0-9]$/.test(riskText) ? Number(riskText) : null,
    storeId: text(field(raw, 'store_id')),
  };
}

const NOTHING_KNOWN: Omit<PaymentValidation, 'status'> = {
  merchantTranId: null,
  valId: null,
  amountMinorUnits: null,
  currency: null,
  bankTranId: null,
  riskLevel: null,
  storeId: null,
};

export class SslcommerzPaymentPort implements PaymentPort {
  readonly configured = true;
  readonly provider = 'sslcommerz';
  readonly storeId: string;
  readonly #storePassword: string;
  readonly #base: string;
  readonly #fetch: typeof fetch;
  readonly #sessionTimeoutMs: number;
  readonly #validationTimeoutMs: number;
  readonly #onFailure: ((event: PaymentProviderFailure) => void) | undefined;

  constructor(options: SslcommerzPaymentPortOptions) {
    const storeId = options.storeId.trim();
    if (storeId.length === 0 || options.storePassword.length === 0) {
      throw new Error('SslcommerzPaymentPort needs a store id and a store password');
    }
    if (options.mode !== 'sandbox' && options.mode !== 'live') {
      throw new Error('SslcommerzPaymentPort mode must be sandbox or live');
    }
    this.storeId = storeId;
    this.#storePassword = options.storePassword;
    this.#base = HOSTS[options.mode];
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#sessionTimeoutMs = options.sessionTimeoutMs ?? SESSION_TIMEOUT_MS;
    this.#validationTimeoutMs = options.validationTimeoutMs ?? VALIDATION_TIMEOUT_MS;
    this.#onFailure = options.onFailure;
  }

  /** The one way a gateway problem leaves this class: a fixed-text error, after telling the hook. */
  #unavailable(
    operation: PaymentProviderFailure['operation'],
    reason: PaymentProviderFailure['reason'],
    message: string,
  ): PaymentProviderUnavailableError {
    try {
      this.#onFailure?.({ operation, reason });
    } catch {
      // A broken hook must never change what the payment code sees.
    }
    return new PaymentProviderUnavailableError(message);
  }

  /** Hides the store password from any accidental serialization or logging of the port. */
  toJSON(): { provider: string; storeId: string } {
    return { provider: this.provider, storeId: this.storeId };
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const form = new URLSearchParams({
      store_id: this.storeId,
      store_passwd: this.#storePassword,
      total_amount: formatMinorUnits(input.amountMinorUnits),
      currency: input.currency.trim().toUpperCase(),
      tran_id: input.merchantTranId,
      success_url: input.urls.success,
      fail_url: input.urls.fail,
      cancel_url: input.urls.cancel,
      ipn_url: input.urls.ipn,
      cus_name: input.customer.name.trim().slice(0, 50) || 'Agency',
      cus_email: input.customer.email.trim(),
      // The gateway requires an address and phone for every payer. VisaStack collects neither
      // for an agency paying an invoice, so fixed neutral values are sent instead.
      cus_add1: 'Dhaka',
      cus_city: 'Dhaka',
      cus_country: 'Bangladesh',
      cus_phone: '00000000000',
      shipping_method: 'NO',
      product_name: `Invoice ${input.invoiceRef}`.slice(0, 100),
      product_category: 'Subscription',
      product_profile: 'non-physical-goods',
    });
    const reply = await this.#call(
      'checkout',
      `${this.#base}${SESSION_PATH}`,
      { method: 'POST', body: form },
      this.#sessionTimeoutMs,
    );
    const body = asRecord(reply);
    const sessionKey = body ? text(field(body, 'sessionkey')) : null;
    const pageUrl = body ? text(field(body, 'GatewayPageURL')) : null;
    if (
      !body ||
      text(field(body, 'status'))?.toUpperCase() !== 'SUCCESS' ||
      !sessionKey ||
      !pageUrl
    ) {
      throw this.#unavailable(
        'checkout',
        'not_accepted',
        'the payment provider refused to open a session',
      );
    }
    if (!this.#isGatewayPage(pageUrl)) {
      throw this.#unavailable(
        'checkout',
        'unexpected_address',
        'the payment provider sent an unexpected address',
      );
    }
    return { redirectUrl: pageUrl, sessionKey };
  }

  async validatePayment(input: { readonly valId: string }): Promise<PaymentValidation> {
    if (!VAL_ID_PATTERN.test(input.valId)) return { status: 'INVALID', ...NOTHING_KNOWN };
    const reply = await this.#authenticatedGet('validation', VALIDATION_PATH, {
      val_id: input.valId,
    });
    const body = asRecord(reply);
    if (!body || text(field(body, 'APIConnect'))?.toUpperCase() !== 'DONE') {
      throw this.#unavailable(
        'validation',
        'not_accepted',
        'the payment provider could not validate',
      );
    }
    return normalizeSslcommerzRecord(body);
  }

  async queryByMerchantTranId(merchantTranId: string): Promise<PaymentValidation> {
    const reply = await this.#authenticatedGet('query', QUERY_PATH, { tran_id: merchantTranId });
    const body = asRecord(reply);
    if (!body || text(field(body, 'APIConnect'))?.toUpperCase() !== 'DONE') {
      throw this.#unavailable('query', 'not_accepted', 'the payment provider could not be queried');
    }
    const listed = field(body, 'element');
    const elements = Array.isArray(listed)
      ? listed.map(asRecord).filter((e): e is Record<string, unknown> => e !== null)
      : [];
    if (elements.length === 0) {
      return { status: 'UNATTEMPTED', ...NOTHING_KNOWN, merchantTranId };
    }
    const records = elements.map(normalizeSslcommerzRecord);
    // One merchant transaction id can be tried several times at the gateway. A success wins; if
    // there is none, a payment still in progress wins over one that ended.
    const chosen =
      records.find((r) => r.status === 'VALID' || r.status === 'VALIDATED') ??
      records.find((r) => r.status === 'PENDING') ??
      records[0];
    return chosen ?? { status: 'UNATTEMPTED', ...NOTHING_KNOWN, merchantTranId };
  }

  /**
   * The gateway signs each callback: `verify_key` names the fields covered, and `verify_sign` is
   * the MD5 of those fields plus the MD5 of the store password, sorted by name and joined as
   * `name=value&...`. This is a first filter only. It also refuses a signature that does not cover
   * the transaction id (and the validation id when one is sent), because the handler reads those.
   */
  verifyIpnSignature(form: Readonly<Record<string, string>>): boolean {
    const own = (name: string): string | undefined =>
      Object.hasOwn(form, name) && typeof form[name] === 'string' ? form[name] : undefined;
    const sign = own('verify_sign')?.trim().toLowerCase();
    const key = own('verify_key');
    if (!sign || !key || !SIGNATURE_PATTERN.test(sign)) return false;
    const names = key
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    if (names.length === 0 || names.length > MAX_SIGNED_FIELDS) return false;
    if (!names.includes('tran_id')) return false;
    if ((own('val_id') ?? '') !== '' && !names.includes('val_id')) return false;
    const signed = new Map<string, string>();
    for (const name of names) {
      const value = own(name);
      if (value === undefined) return false;
      signed.set(name, value);
    }
    signed.set('store_passwd', md5Hex(this.#storePassword));
    const payload = [...signed.keys()]
      .sort()
      .map((name) => `${name}=${signed.get(name) ?? ''}`)
      .join('&');
    const expected = Buffer.from(md5Hex(payload), 'utf8');
    const presented = Buffer.from(sign, 'utf8');
    return expected.length === presented.length && timingSafeEqual(expected, presented);
  }

  #isGatewayPage(value: string): boolean {
    try {
      const url = new URL(value);
      const baseHost = new URL(this.#base).hostname;
      const parent = baseHost.split('.').slice(-2).join('.');
      return (
        url.protocol === 'https:' &&
        url.username === '' &&
        url.password === '' &&
        (url.hostname === baseHost || url.hostname.endsWith(`.${parent}`))
      );
    } catch {
      return false;
    }
  }

  async #authenticatedGet(
    operation: 'validation' | 'query',
    path: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    const query = new URLSearchParams({
      ...params,
      store_id: this.storeId,
      store_passwd: this.#storePassword,
      format: 'json',
    });
    return this.#call(
      operation,
      `${this.#base}${path}?${query.toString()}`,
      { method: 'GET' },
      this.#validationTimeoutMs,
    );
  }

  /**
   * One call to a constant gateway address. The reply is read as JSON with a size cap that is
   * enforced while reading (a reply that keeps coming is cut off, not buffered); every failure
   * (network, timeout, redirect, error status, oversize, not JSON) becomes the same fixed
   * `PaymentProviderUnavailableError`, carrying neither the address (which can hold the store
   * password) nor the reply nor the underlying error.
   */
  async #call(
    operation: PaymentProviderFailure['operation'],
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init,
        redirect: 'error',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw this.#unavailable(
        operation,
        'unreachable',
        'the payment provider could not be reached',
      );
    }
    if (!response.ok) {
      throw this.#unavailable(operation, 'error_status', 'the payment provider returned an error');
    }
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_REPLY_BYTES) {
      throw this.#unavailable(operation, 'too_large', 'the payment provider reply was too large');
    }
    let raw: string;
    try {
      raw = await readCapped(response, MAX_REPLY_BYTES);
    } catch (error) {
      throw error instanceof ReplyTooLarge
        ? this.#unavailable(operation, 'too_large', 'the payment provider reply was too large')
        : this.#unavailable(
            operation,
            'unreadable',
            'the payment provider reply could not be read',
          );
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw this.#unavailable(
        operation,
        'unreadable',
        'the payment provider reply was not readable',
      );
    }
  }
}

class ReplyTooLarge extends Error {}

/** The reply text, reading no more than `maxBytes` of it: the read stops and is cancelled at the limit. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const whole = await response.text();
    if (whole.length > maxBytes) throw new ReplyTooLarge();
    return whole;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ReplyTooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
