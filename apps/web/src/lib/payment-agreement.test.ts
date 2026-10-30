import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * S19 step 0: one configured answer. The status page (capabilities), the platform overview
 * (provider operations), Billing Rules and the Invoices page (providers.ts and the registry) must
 * agree about online payments for every combination of settings.
 */

const ENV_KEYS = [
  'PAYMENT_PROVIDER',
  'PAYMENT_PROVIDERS',
  'SSLCOMMERZ_STORE_ID',
  'SSLCOMMERZ_STORE_PASSWORD',
  'SSLCOMMERZ_MODE',
  'OTHERPAY_KEY',
  'OTHERPAY_MODE',
  'DEPLOYMENT_MODE',
] as const;
const ORIGINAL: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    ORIGINAL[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

const STORE = { SSLCOMMERZ_STORE_ID: 'store-1', SSLCOMMERZ_STORE_PASSWORD: 'synthetic-password' };

type Expected = 'LIVE' | 'TEST' | 'INCOMPLETE' | 'OFF';

const TABLE: readonly (readonly [string, Record<string, string>, Expected])[] = [
  ['nothing set', {}, 'OFF'],
  ['store settings without choosing a provider', { ...STORE, SSLCOMMERZ_MODE: 'live' }, 'OFF'],
  [
    'PAYMENT_PROVIDER, sandbox',
    { PAYMENT_PROVIDER: 'sslcommerz', ...STORE, SSLCOMMERZ_MODE: 'sandbox' },
    'TEST',
  ],
  [
    'PAYMENT_PROVIDER, live',
    { PAYMENT_PROVIDER: 'sslcommerz', ...STORE, SSLCOMMERZ_MODE: 'live' },
    'LIVE',
  ],
  ['PAYMENT_PROVIDER, no mode', { PAYMENT_PROVIDER: 'sslcommerz', ...STORE }, 'INCOMPLETE'],
  [
    'PAYMENT_PROVIDER, mode in capitals',
    { PAYMENT_PROVIDER: 'sslcommerz', ...STORE, SSLCOMMERZ_MODE: 'LIVE' },
    'INCOMPLETE',
  ],
  [
    'PAYMENT_PROVIDER, no password',
    { PAYMENT_PROVIDER: 'sslcommerz', SSLCOMMERZ_STORE_ID: 'store-1', SSLCOMMERZ_MODE: 'live' },
    'INCOMPLETE',
  ],
  [
    'PAYMENT_PROVIDERS alone, live',
    { PAYMENT_PROVIDERS: ' sslcommerz ', ...STORE, SSLCOMMERZ_MODE: 'live' },
    'LIVE',
  ],
  [
    'PAYMENT_PROVIDERS none over PAYMENT_PROVIDER',
    {
      PAYMENT_PROVIDERS: 'none',
      PAYMENT_PROVIDER: 'sslcommerz',
      ...STORE,
      SSLCOMMERZ_MODE: 'live',
    },
    'OFF',
  ],
  [
    'PAYMENT_PROVIDERS with an unknown name only',
    { PAYMENT_PROVIDERS: 'stripe', ...STORE, SSLCOMMERZ_MODE: 'live' },
    'OFF',
  ],
];

const CAPABILITY: Record<Expected, string> = {
  LIVE: 'available',
  TEST: 'degraded',
  INCOMPLETE: 'unconfigured',
  OFF: 'unconfigured',
};
const READING: Record<Expected, string> = {
  LIVE: 'Live payments',
  TEST: 'Test payments only',
  INCOMPLETE: 'Chosen; settings incomplete',
  OFF: 'Not configured',
};

describe('online payments, one answer everywhere', () => {
  it.each(TABLE)('%s', async (_name, env, expected) => {
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    const { getPlatformCapabilities } = await import('./capabilities');
    const { describeProviderOperations } = await import('./provider-operations');
    const { incompletePaymentSettings, paymentMode, paymentPorts } = await import('./providers');
    const { onlineOffers } = await import('./payment-providers');

    const on = expected === 'LIVE' || expected === 'TEST';
    expect(getPlatformCapabilities().payments).toBe(CAPABILITY[expected]);
    expect(paymentMode()).toBe(on ? expected : null);
    expect(incompletePaymentSettings().length > 0).toBe(expected === 'INCOMPLETE');
    expect(
      paymentPorts()
        .configured()
        .map((port) => port.mode),
    ).toEqual(on ? [expected] : []);
    expect({ ...onlineOffers(process.env) }).toEqual(
      on ? { BDT: { provider: 'sslcommerz', mode: expected } } : {},
    );
    const row = describeProviderOperations({}, process.env).find(
      (item) => item.label === 'Online Payments',
    );
    expect(row?.reading).toBe(READING[expected]);
    expect(row?.standing).toBe(on ? 'Set Up' : 'Not Set Up');
  });
});

describe('a second provider in another mode (S19 step 0 round 2)', () => {
  /**
   * A made-up second registry entry taking US dollars, added for this test only, so every screen's
   * reading of "some live, some in test mode" is checked against the one registry answer.
   */
  async function withOtherPay(run: () => Promise<void>) {
    const { PAYMENT_PROVIDERS, PAYMENT_PROVIDER_KEYS, readFormCallbackFields } = await import(
      './payment-providers'
    );
    const keys = PAYMENT_PROVIDER_KEYS as string[];
    type Env = Readonly<Record<string, string | undefined>>;
    const KEY = 'OTHERPAY_KEY';
    const MODE = 'OTHERPAY_MODE';
    const modeOf = (env: Env) => {
      if (!env[KEY]) return null;
      if (env[MODE] === 'live') return 'LIVE';
      return env[MODE] === 'sandbox' ? 'TEST' : null;
    };
    Reflect.set(PAYMENT_PROVIDERS, 'otherpay', {
      name: 'OtherPay',
      currencies: ['USD'],
      supportsRefunds: false,
      settingNames: [MODE],
      secretNames: [KEY],
      callbackPath: '/api/payments/otherpay',
      missingSettings: (env: Env) => [
        ...(env[KEY] ? [] : [KEY]),
        ...(env[MODE] === 'sandbox' || env[MODE] === 'live' ? [] : [MODE]),
      ],
      mode: modeOf,
      create: (env: Env) => ({
        configured: true,
        provider: 'otherpay',
        mode: modeOf(env),
        storeId: null,
      }),
      readCallback: (input: { contentType: string | null; raw: string }) => {
        const fields = readFormCallbackFields(input);
        return fields === null ? null : { fields, merchantTranId: null, valId: null };
      },
    });
    keys.push('otherpay');
    try {
      await run();
    } finally {
      keys.pop();
      Reflect.deleteProperty(PAYMENT_PROVIDERS, 'otherpay');
    }
  }

  it('never says every payment is real while one provider is still in test mode', async () => {
    await withOtherPay(async () => {
      Object.assign(process.env, {
        PAYMENT_PROVIDERS: 'sslcommerz,otherpay',
        ...STORE,
        SSLCOMMERZ_MODE: 'live',
        OTHERPAY_KEY: 'synthetic-key',
        OTHERPAY_MODE: 'sandbox',
      });
      const { getPlatformCapabilities } = await import('./capabilities');
      const { describeProviderOperations } = await import('./provider-operations');
      const { paymentMode, paymentCurrenciesByMode } = await import('./providers');
      const { mixedPaymentsNote } = await import('./payment-providers');

      expect(paymentMode()).toBe('MIXED');
      expect(getPlatformCapabilities().payments).toBe('degraded');
      expect(paymentCurrenciesByMode()).toEqual({ live: ['BDT'], test: ['USD'] });
      expect(mixedPaymentsNote(process.env)).toBe(
        'Online payment takes real money for invoices in Bangladeshi taka. Invoices in US dollars can only take test payments for now.',
      );

      // The owner overview: one "Online Payments" row per provider, each named by its currency.
      const rows = describeProviderOperations({}, process.env).filter((row) =>
        row.label.startsWith('Online Payments'),
      );
      expect(rows.map((row) => [row.label, row.reading])).toEqual([
        ['Online Payments in Bangladeshi Taka', 'Live payments'],
        ['Online Payments in US Dollars', 'Test payments only'],
      ]);
      expect(rows[0]?.headline).toBe(
        'Agencies can pay invoices in Bangladeshi taka online with real money.',
      );
      expect(rows[1]?.headline).toBe(
        'Online payment for invoices in US dollars is in test mode. Only you can make a test payment; agencies cannot pay those online yet.',
      );
      expect(rows[1]?.detail).toContain('Through OtherPay, for invoices in US dollars.');

      // Both live: LIVE, available, and no note.
      Object.assign(process.env, { OTHERPAY_MODE: 'live' });
      expect(paymentMode()).toBe('LIVE');
      expect(getPlatformCapabilities().payments).toBe('available');
      expect(mixedPaymentsNote(process.env)).toBeNull();
      // Both in test mode: TEST, exactly as with one provider.
      Object.assign(process.env, { SSLCOMMERZ_MODE: 'sandbox', OTHERPAY_MODE: 'sandbox' });
      expect(paymentMode()).toBe('TEST');
      expect(mixedPaymentsNote(process.env)).toBeNull();
    });
  });
});
