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
    const { isPaymentProviderConfigured, paymentMode, paymentPorts } = await import('./providers');
    const { onlineOffers } = await import('./payment-providers');

    const on = expected === 'LIVE' || expected === 'TEST';
    expect(getPlatformCapabilities().payments).toBe(CAPABILITY[expected]);
    expect(paymentMode()).toBe(on ? expected : null);
    expect(isPaymentProviderConfigured()).toBe(on);
    expect(
      paymentPorts()
        .configured()
        .map((port) => port.mode),
    ).toEqual(on ? [expected] : []);
    expect({ ...onlineOffers(process.env) }).toEqual(
      on ? { BDT: { provider: 'sslcommerz', mode: expected } } : {},
    );
    const row = describeProviderOperations({}, process.env).find(
      (item) => item.label === 'Online Payments: SSLCOMMERZ',
    );
    expect(row?.reading).toBe(READING[expected]);
    expect(row?.standing).toBe(on ? 'Set Up' : 'Not Set Up');
  });
});
