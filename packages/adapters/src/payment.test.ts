import { PaymentProviderUnavailableError } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { NullPaymentPort, SslcommerzPaymentPort, normalizeSslcommerzRecord } from './payment';
import { FakeSslcommerzGateway } from './payment-fake-gateway';

const get = (record: Readonly<Record<string, string>> | null | undefined, name: string) =>
  record?.[name];

const STORE_ID = 'visastacktest001';
const PASSWORD = 'store-password-that-must-never-leak';
const TRAN = 'VSP0123456789abcdef0123456789';

const checkout = (merchantTranId = TRAN, amountMinorUnits = 125050) => ({
  merchantTranId,
  amountMinorUnits,
  currency: 'BDT',
  invoiceRef: 'INV-100',
  customer: { name: 'Acme Travel', email: 'billing@acme.example' },
  urls: {
    success: 'https://app.example.test/success',
    fail: 'https://app.example.test/fail',
    cancel: 'https://app.example.test/cancel',
    ipn: 'https://app.example.test/ipn',
  },
});

function build(options: { mode?: 'sandbox' | 'live'; fetch?: typeof fetch } = {}) {
  const gateway = new FakeSslcommerzGateway({ storeId: STORE_ID, storePassword: PASSWORD });
  const urls: string[] = [];
  const baseFetch = options.fetch ?? gateway.fetch;
  const recording: typeof fetch = async (input, init) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return baseFetch(input, init);
  };
  const port = new SslcommerzPaymentPort({
    storeId: STORE_ID,
    storePassword: PASSWORD,
    mode: options.mode ?? 'sandbox',
    fetch: recording,
    sessionTimeoutMs: 200,
    validationTimeoutMs: 200,
  });
  return { port, gateway, urls };
}

const replyWith =
  (body: unknown, status = 200): typeof fetch =>
  async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

async function messageOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(PaymentProviderUnavailableError);
    return (error as Error).message;
  }
  throw new Error('expected the call to fail');
}

describe('NullPaymentPort', () => {
  it('is unconfigured, refuses every call and never accepts a signature', async () => {
    const port = new NullPaymentPort();
    expect(port.configured).toBe(false);
    await expect(port.createCheckout()).rejects.toThrow(/no payment provider/);
    await expect(port.validatePayment()).rejects.toThrow(/no payment provider/);
    await expect(port.queryByMerchantTranId()).rejects.toThrow(/no payment provider/);
    expect(port.verifyIpnSignature()).toBe(false);
  });
});

describe('SslcommerzPaymentPort', () => {
  describe('construction', () => {
    it('needs a store, a password and a known mode', () => {
      const base = { storeId: STORE_ID, storePassword: PASSWORD, mode: 'sandbox' as const };
      expect(() => new SslcommerzPaymentPort({ ...base, storeId: ' ' })).toThrow();
      expect(() => new SslcommerzPaymentPort({ ...base, storePassword: '' })).toThrow();
      expect(
        () => new SslcommerzPaymentPort({ ...base, mode: 'production' as unknown as 'live' }),
      ).toThrow();
    });

    it('never shows the password when the port is printed or serialized', () => {
      const { port } = build();
      expect(JSON.stringify(port)).not.toContain(PASSWORD);
      expect(JSON.stringify({ nested: port })).not.toContain(PASSWORD);
    });
  });

  describe('opening a payment page', () => {
    it('sends the exact amount as decimal text and returns the gateway page and session', async () => {
      const { port, gateway, urls } = build();
      const session = await port.createCheckout(checkout());
      expect(session.sessionKey).toMatch(/^SESSION/);
      expect(new URL(session.redirectUrl).hostname).toBe('sandbox.sslcommerz.com');
      expect(gateway.transactions.get(TRAN)).toMatchObject({
        amount: '1250.50',
        currency: 'BDT',
      });
      expect(urls[0]).toBe('https://sandbox.sslcommerz.com/gwprocess/v4/api.php');
    });

    it('talks to the live gateway only when the mode says live', async () => {
      const { port, urls } = build({ mode: 'live' });
      await port.createCheckout(checkout()).catch(() => undefined);
      expect(urls[0]).toBe('https://securepay.sslcommerz.com/gwprocess/v4/api.php');
    });

    it('turns a refusal, an error status, an unreadable or oversize reply into the same fixed failure', async () => {
      const replies: Array<typeof fetch> = [
        replyWith({ status: 'FAILED', failedreason: `Store ${STORE_ID} ${PASSWORD} is inactive` }),
        replyWith('<html>down</html>'),
        replyWith({ status: 'SUCCESS' }),
        replyWith('', 500),
        replyWith(`{"pad":"${'x'.repeat(300_000)}"}`),
        async () => {
          throw new TypeError(`connect ECONNREFUSED ?store_passwd=${PASSWORD}`);
        },
      ];
      for (const fetchImpl of replies) {
        const { port } = build({ fetch: fetchImpl });
        const message = await messageOf(port.createCheckout(checkout()));
        expect(message).not.toContain(PASSWORD);
        expect(message).not.toContain(STORE_ID);
        expect(message).not.toContain('http');
      }
    });

    it('refuses to send anyone to an address that is not the gateway own', async () => {
      for (const page of [
        'https://evil.example/pay',
        'https://sandbox.sslcommerz.com.evil.example/pay',
        'http://sandbox.sslcommerz.com/pay',
        'https://user:pass@sandbox.sslcommerz.com/pay',
        'javascript:alert(1)',
        'not a url',
      ]) {
        const { port } = build({
          fetch: replyWith({ status: 'SUCCESS', sessionkey: 'S1', GatewayPageURL: page }),
        });
        await messageOf(port.createCheckout(checkout()));
      }
    });

    it('gives up after the timeout when the gateway never answers', async () => {
      const hang: typeof fetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('x', 'AbortError')),
          );
        });
      const { port } = build({ fetch: hang });
      await messageOf(port.createCheckout(checkout()));
    });

    it('fails when the store credentials are wrong, without saying what they were', async () => {
      const gateway = new FakeSslcommerzGateway({ storeId: STORE_ID, storePassword: 'other' });
      const { port } = build({ fetch: gateway.fetch });
      const message = await messageOf(port.createCheckout(checkout()));
      expect(message).not.toContain(PASSWORD);
    });
  });

  describe('asking the gateway about a payment', () => {
    it('reads a confirmed payment exactly: amount in minor units, currency, ids and risk', async () => {
      const { port, gateway, urls } = build();
      await port.createCheckout(checkout());
      const paid = gateway.pay(TRAN);
      const v = await port.validatePayment({ valId: paid.valId ?? '' });
      expect(v).toEqual({
        status: 'VALID',
        merchantTranId: TRAN,
        valId: paid.valId,
        amountMinorUnits: 125050,
        currency: 'BDT',
        bankTranId: paid.bankTranId,
        riskLevel: 0,
        storeId: null,
      });
      expect(urls.at(-1)).toContain('/validator/api/validationserverAPI.php');
    });

    it('says INVALID for an id the gateway does not know, and does not even ask for a malformed one', async () => {
      const { port, urls } = build();
      expect((await port.validatePayment({ valId: 'NOSUCHPAYMENT1' })).status).toBe('INVALID');
      const before = urls.length;
      for (const bad of ['', 'a b', "x'; drop", 'short', 'x'.repeat(65), '../../etc']) {
        expect((await port.validatePayment({ valId: bad })).status).toBe('INVALID');
      }
      expect(urls.length).toBe(before);
    });

    it('fails closed (never a verdict) when the gateway cannot answer or does not accept the request', async () => {
      const { port } = build({ fetch: replyWith({ APIConnect: 'INACTIVE' }) });
      await messageOf(port.validatePayment({ valId: 'VALID1234567' }));
      await messageOf(port.queryByMerchantTranId(TRAN));
      const down = build();
      down.gateway.setOutage(true);
      await messageOf(down.port.validatePayment({ valId: 'VALID1234567' }));
      await messageOf(down.port.queryByMerchantTranId(TRAN));
      const wrongStore = build({
        fetch: new FakeSslcommerzGateway({ storeId: STORE_ID, storePassword: 'other' }).fetch,
      });
      await messageOf(wrongStore.port.validatePayment({ valId: 'VALID1234567' }));
    });

    it('queries by merchant transaction id and reports each ending', async () => {
      const { port, gateway } = build();
      expect((await port.queryByMerchantTranId(TRAN)).status).toBe('UNATTEMPTED');
      await port.createCheckout(checkout());
      expect((await port.queryByMerchantTranId(TRAN)).status).toBe('PENDING');
      gateway.cancel(TRAN);
      expect((await port.queryByMerchantTranId(TRAN)).status).toBe('CANCELLED');
      gateway.fail(TRAN);
      expect((await port.queryByMerchantTranId(TRAN)).status).toBe('FAILED');
      gateway.expire(TRAN);
      expect((await port.queryByMerchantTranId(TRAN)).status).toBe('EXPIRED');
      gateway.pay(TRAN);
      expect(await port.queryByMerchantTranId(TRAN)).toMatchObject({
        status: 'VALID',
        amountMinorUnits: 125050,
      });
    });

    it('prefers a success over earlier failed tries of the same transaction id', async () => {
      const reply = {
        APIConnect: 'DONE',
        no_of_trans_found: 3,
        element: [
          { status: 'FAILED', tran_id: TRAN, amount: '1250.50', currency_type: 'BDT' },
          {
            status: 'VALID',
            tran_id: TRAN,
            val_id: 'VALID1234567',
            amount: '1250.50',
            risk_level: '0',
            currency_type: 'BDT',
          },
          { status: 'CANCELLED', tran_id: TRAN },
        ],
      };
      const { port } = build({ fetch: replyWith(reply) });
      expect((await port.queryByMerchantTranId(TRAN)).status).toBe('VALID');
    });
  });

  describe('normalizing what the gateway says', () => {
    const record = (over: Record<string, unknown>) =>
      normalizeSslcommerzRecord({
        status: 'VALID',
        tran_id: TRAN,
        val_id: 'VAL1234567',
        amount: '10.00',
        currency_type: 'BDT',
        risk_level: '0',
        ...over,
      });

    it('reads amounts exactly and refuses anything that is not a plain decimal', () => {
      expect(record({ amount: '1250.50' }).amountMinorUnits).toBe(125050);
      expect(record({ amount: '1250.5000' }).amountMinorUnits).toBe(125050);
      expect(record({ amount: '1250' }).amountMinorUnits).toBe(125000);
      expect(record({ amount: 10 }).amountMinorUnits).toBe(1000);
      for (const bad of [
        '1250.505',
        '1e3',
        '-5',
        '',
        'abc',
        '1,250.00',
        '99999999999999.00',
        null,
      ]) {
        expect(record({ amount: bad }).amountMinorUnits, String(bad)).toBeNull();
      }
    });

    it('reports a currency only when the gateway is consistent about it', () => {
      expect(record({ currency_type: 'bdt' }).currency).toBe('BDT');
      expect(record({ currency_type: undefined, currency: 'BDT' }).currency).toBe('BDT');
      expect(record({ currency_type: 'USD', currency: 'BDT' }).currency).toBeNull();
      expect(record({ currency_type: undefined }).currency).toBeNull();
    });

    it('maps unknown or odd statuses to INVALID and reads the risk flag as a single digit', () => {
      expect(record({ status: 'INVALID_TRANSACTION' }).status).toBe('INVALID');
      expect(record({ status: 'SOMETHING_NEW' }).status).toBe('INVALID');
      expect(record({ status: '__proto__' }).status).toBe('INVALID');
      expect(record({ status: undefined }).status).toBe('INVALID');
      expect(record({ risk_level: '1' }).riskLevel).toBe(1);
      expect(record({ risk_level: 'high' }).riskLevel).toBeNull();
      expect(record({ risk_level: undefined }).riskLevel).toBeNull();
    });
  });

  describe('checking a notification signature', () => {
    const fields = (over: Record<string, string> = {}) => ({
      status: 'VALID',
      tran_id: TRAN,
      val_id: 'VAL1234567',
      amount: '1250.50',
      currency: 'BDT',
      ...over,
    });

    it('accepts what the gateway signed, whatever the case of the signature', () => {
      const { port, gateway } = build();
      const signed = gateway.sign(fields());
      expect(port.verifyIpnSignature(signed)).toBe(true);
      expect(
        port.verifyIpnSignature({
          ...signed,
          verify_sign: get(signed, 'verify_sign')?.toUpperCase() ?? '',
        }),
      ).toBe(true);
    });

    it('refuses a changed signed field, a wrong password, a missing or malformed signature', () => {
      const { port, gateway } = build();
      const signed = gateway.sign(fields());
      expect(port.verifyIpnSignature({ ...signed, amount: '1.00' })).toBe(false);
      expect(port.verifyIpnSignature({ ...signed, tran_id: 'VSPother' })).toBe(false);
      const stranger = new FakeSslcommerzGateway({ storeId: STORE_ID, storePassword: 'guess' });
      expect(port.verifyIpnSignature(stranger.sign(fields()))).toBe(false);
      for (const drop of ['verify_sign', 'verify_key']) {
        const copy: Record<string, string> = { ...signed };
        delete copy[drop];
        expect(port.verifyIpnSignature(copy)).toBe(false);
      }
      expect(port.verifyIpnSignature({ ...signed, verify_sign: 'not-hex' })).toBe(false);
      expect(port.verifyIpnSignature({ ...signed, verify_sign: '' })).toBe(false);
      expect(port.verifyIpnSignature({})).toBe(false);
    });

    it('refuses a signature that does not cover the fields the handler reads', () => {
      const { port, gateway } = build();
      // Signed, but the transaction id is not among the signed fields.
      const noTran = gateway.sign({ status: 'VALID', amount: '1250.50' });
      expect(port.verifyIpnSignature({ ...noTran, tran_id: TRAN })).toBe(false);
      // Signed, but a validation id was added afterwards outside the signature.
      const noVal = gateway.sign({ status: 'VALID', tran_id: TRAN });
      expect(port.verifyIpnSignature(noVal)).toBe(true);
      expect(port.verifyIpnSignature({ ...noVal, val_id: 'ATTACKERCHOSEN1' })).toBe(false);
      // The key names a field that is not there.
      const signed = gateway.sign(fields());
      expect(
        port.verifyIpnSignature({ ...signed, verify_key: `${get(signed, 'verify_key')},ghost` }),
      ).toBe(false);
    });

    it('is not fooled by hostile field names or an enormous key list', () => {
      const { port, gateway } = build();
      const signed = gateway.sign(fields());
      const polluted = JSON.parse(
        `{"__proto__": "x", "verify_sign": "${get(signed, 'verify_sign')}", "verify_key": "__proto__,${get(signed, 'verify_key')}"}`,
      ) as Record<string, string>;
      expect(
        port.verifyIpnSignature({
          ...signed,
          ...polluted,
          verify_key: `__proto__,${get(signed, 'verify_key')}`,
        }),
      ).toBe(false);
      const many = Array.from({ length: 200 }, (_, i) => `f${i}`).join(',');
      expect(port.verifyIpnSignature({ ...signed, verify_key: `tran_id,${many}` })).toBe(false);
    });
  });
});
