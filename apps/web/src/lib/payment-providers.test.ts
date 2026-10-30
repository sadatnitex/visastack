import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIsoCurrencyCode } from '@visastack/core';
import { isRefundingPaymentPort } from '@visastack/services';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PAYMENT_PROVIDERS,
  PAYMENT_PROVIDER_KEYS,
  type PaymentProviderEntry,
  buildPaymentPorts,
  chosenPaymentProviders,
  configuredPaymentProviders,
  onlineOffers,
  overallPaymentMode,
  unknownListedProviders,
} from './payment-providers';
import { paymentSecretNames, withoutPaymentSecrets } from './payment-secrets';
import { paymentUrlFor } from './payment-urls';

/**
 * S19 step 0: the payment provider registry's contract. Every entry must be complete on its own,
 * so adding a provider is one entry plus its adapter, and nothing else has to know about it.
 */

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const PAYMENTS_ROUTES = join(REPO, 'apps/web/src/app/api/payments');
const ENV_EXAMPLE = readFileSync(join(REPO, '.env.example'), 'utf8');
const noFailure = () => undefined;

/**
 * Every setting an entry lists, filled with a usable value. A provider's mode setting is named
 * `<NAME>_MODE` and takes `sandbox` (test) or `live`, as the owner guide says.
 */
function fullEnv(entry: PaymentProviderEntry): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [...entry.settingNames, ...entry.secretNames]) {
    env[name] = name.endsWith('_MODE') ? 'sandbox' : `synthetic-${name.toLowerCase()}-value`;
  }
  return env;
}

/** The SSLCOMMERZ settings, complete, in the given mode. */
const sslcommerz = (mode = 'sandbox'): Record<string, string> => ({
  SSLCOMMERZ_STORE_ID: 'store-1',
  SSLCOMMERZ_STORE_PASSWORD: 'synthetic-password',
  SSLCOMMERZ_MODE: mode,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('every registry entry', () => {
  const entries = PAYMENT_PROVIDER_KEYS.map((key) => [key, PAYMENT_PROVIDERS[key]] as const);

  it.each(entries)('%s takes real ISO currencies, in capitals', (_key, entry) => {
    expect(entry.currencies.length).toBeGreaterThan(0);
    for (const code of entry.currencies) {
      expect(isIsoCurrencyCode(code), code).toBe(true);
      expect(code).toBe(code.toUpperCase());
    }
  });

  it.each(entries)(
    '%s has its callbacks under its own name, served by the provider routes',
    (key, entry) => {
      expect(entry.callbackPath).toBe(`/api/payments/${key}`);
      for (const kind of ['ipn', 'return']) {
        expect(existsSync(join(PAYMENTS_ROUTES, '[provider]', kind, 'route.ts')), kind).toBe(true);
      }
      // One set of routes for every provider: no fixed per-provider folder that would shadow it.
      expect(readdirSync(PAYMENTS_ROUTES)).toEqual(['[provider]']);
    },
  );

  it.each(entries)(
    '%s names its secrets: configured with exactly its listed settings, and not without any one secret',
    (_key, entry) => {
      expect(entry.secretNames.length).toBeGreaterThan(0);
      const env = fullEnv(entry);
      expect(entry.isConfigured(env)).toBe(true);
      expect(entry.mode(env)).toBe('TEST');
      for (const name of entry.secretNames) {
        const without = { ...env, [name]: '' };
        expect(entry.isConfigured(without), name).toBe(false);
        expect(entry.mode(without), name).toBeNull();
      }
    },
  );

  it.each(entries)(
    '%s keeps every secret out of logs and lists every setting in .env.example',
    (_key, entry) => {
      const scrubbed = paymentSecretNames();
      for (const name of entry.secretNames) {
        expect(scrubbed, name).toContain(name);
        vi.stubEnv(name, `secret-for-${name}`);
        expect(withoutPaymentSecrets(new Error(`failed with secret-for-${name}`)).message).toBe(
          'failed with [removed]',
        );
      }
      vi.unstubAllEnvs();
      for (const name of [...entry.settingNames, ...entry.secretNames]) {
        expect(ENV_EXAMPLE, name).toMatch(new RegExp(`^${name}=$`, 'm'));
      }
    },
  );

  it.each(entries)('%s can refund exactly when it says so', (_key, entry) => {
    const env = fullEnv(entry);
    expect(isRefundingPaymentPort(entry.create(env, noFailure))).toBe(entry.supportsRefunds);
  });

  it('documents the new settings in .env.example', () => {
    expect(ENV_EXAMPLE).toMatch(/^PAYMENT_PROVIDERS=$/m);
    expect(ENV_EXAMPLE).toMatch(/^PAYMENT_RESULT_SIGNING_SECRET=$/m);
    expect(paymentSecretNames()).toContain('PAYMENT_RESULT_SIGNING_SECRET');
  });
});

describe('the addresses each provider gives its gateway', () => {
  it('are exactly the SSLCOMMERZ addresses registered before the registry', () => {
    const urlFor = paymentUrlFor('https://vs.example.test/');
    expect(urlFor('ipn', 'VSP1', 'sslcommerz')).toBe(
      'https://vs.example.test/api/payments/sslcommerz/ipn',
    );
    expect(urlFor('success', 'VSP1', 'sslcommerz')).toBe(
      'https://vs.example.test/api/payments/sslcommerz/return?o=success&t=VSP1',
    );
    expect(urlFor('cancel', 'VSP1', 'sslcommerz')).toBe(
      'https://vs.example.test/api/payments/sslcommerz/return?o=cancel&t=VSP1',
    );
    expect(() => urlFor('ipn', 'VSP1', 'stripe')).toThrow();
  });
});

describe('which providers are chosen', () => {
  it('reads PAYMENT_PROVIDERS as a trimmed, ordered, exact list, with "none" adding nothing', () => {
    const table: readonly [Record<string, string>, readonly string[]][] = [
      [{}, []],
      [{ PAYMENT_PROVIDERS: 'sslcommerz' }, ['sslcommerz']],
      [{ PAYMENT_PROVIDERS: ' sslcommerz , ' }, ['sslcommerz']],
      [{ PAYMENT_PROVIDERS: 'sslcommerz,sslcommerz' }, ['sslcommerz']],
      [{ PAYMENT_PROVIDERS: 'SSLCOMMERZ' }, []],
      [{ PAYMENT_PROVIDERS: 'stripe,sslcommerz' }, ['sslcommerz']],
      [{ PAYMENT_PROVIDERS: 'none', PAYMENT_PROVIDER: 'sslcommerz' }, []],
      [{ PAYMENT_PROVIDERS: 'none,sslcommerz' }, ['sslcommerz']],
      // Unset or blank: the single-provider setting, read exactly as before (no trimming).
      [{ PAYMENT_PROVIDERS: '  ', PAYMENT_PROVIDER: 'sslcommerz' }, ['sslcommerz']],
      [{ PAYMENT_PROVIDER: 'sslcommerz' }, ['sslcommerz']],
      [{ PAYMENT_PROVIDER: ' sslcommerz' }, []],
      [{ PAYMENT_PROVIDER: 'none' }, []],
      [{ PAYMENT_PROVIDER: 'constructor' }, []],
    ];
    for (const [env, chosen] of table) {
      expect(chosenPaymentProviders(env), JSON.stringify(env)).toEqual(chosen);
    }
    expect(unknownListedProviders({ PAYMENT_PROVIDERS: 'stripe, sslcommerz,none' })).toEqual([
      'stripe',
    ]);
    expect(unknownListedProviders({ PAYMENT_PROVIDER: 'stripe' })).toEqual([]);
  });

  it('turns a chosen provider on only with all its settings, in a mode it names, never by default', () => {
    expect(configuredPaymentProviders(sslcommerz())).toEqual([]);
    const chosen = { PAYMENT_PROVIDERS: 'sslcommerz' };
    expect(configuredPaymentProviders({ ...chosen, ...sslcommerz() })[0]?.mode).toBe('TEST');
    expect(configuredPaymentProviders({ ...chosen, ...sslcommerz('live') })[0]?.mode).toBe('LIVE');
    expect(configuredPaymentProviders({ ...chosen, ...sslcommerz(' live ') })[0]?.mode).toBe(
      'LIVE',
    );
    for (const mode of ['', 'LIVE', 'production', 'true']) {
      expect(configuredPaymentProviders({ ...chosen, ...sslcommerz(mode) }), mode).toEqual([]);
    }
    for (const missing of ['SSLCOMMERZ_STORE_ID', 'SSLCOMMERZ_STORE_PASSWORD', 'SSLCOMMERZ_MODE']) {
      const env: Record<string, string> = { ...chosen, ...sslcommerz('live') };
      delete env[missing];
      expect(configuredPaymentProviders(env), missing).toEqual([]);
    }
  });

  it('gives one overall mode: live when any provider is live, test when all are in test mode', () => {
    const configured = configuredPaymentProviders({
      PAYMENT_PROVIDER: 'sslcommerz',
      ...sslcommerz(),
    });
    expect(overallPaymentMode([])).toBeNull();
    expect(overallPaymentMode(configured)).toBe('TEST');
    const live = configured.map((p) => ({ ...p, mode: 'LIVE' as const }));
    expect(overallPaymentMode([...configured, ...live])).toBe('LIVE');
  });

  it('offers each currency through the earliest configured provider that takes it', () => {
    expect(onlineOffers({})).toEqual({});
    const offers = onlineOffers({ PAYMENT_PROVIDERS: 'sslcommerz', ...sslcommerz('live') });
    expect({ ...offers }).toEqual({ BDT: { provider: 'sslcommerz', mode: 'LIVE' } });
    expect(Object.hasOwn(offers, 'constructor')).toBe(false);
  });
});

describe('the ports the services take', () => {
  it('build only configured providers, in order, with the currencies each takes', () => {
    const none = buildPaymentPorts({}, noFailure);
    expect(none.configured()).toEqual([]);
    const ports = buildPaymentPorts({ PAYMENT_PROVIDER: 'sslcommerz', ...sslcommerz() }, noFailure);
    expect(ports.configured().map((port) => port.provider)).toEqual(['sslcommerz']);
    expect(ports.forCurrency('bdt')?.provider).toBe('sslcommerz');
    expect(ports.forCurrency('USD')).toBeNull();
    expect(ports.forProvider('sslcommerz')?.mode).toBe('TEST');
    expect(ports.forProvider('other')).toBeNull();
    expect(ports.currencyRefusal).toBe('Only invoices in Bangladeshi taka can be paid online.');
  });

  it('leave out, for refunds, a configured provider whose port cannot refund', () => {
    const env = { PAYMENT_PROVIDER: 'sslcommerz', ...sslcommerz() };
    const real = PAYMENT_PROVIDERS.sslcommerz.create(env, noFailure);
    vi.spyOn(PAYMENT_PROVIDERS.sslcommerz, 'create').mockReturnValue({
      configured: real.configured,
      mode: real.mode,
      provider: real.provider,
      storeId: real.storeId,
      createCheckout: real.createCheckout.bind(real),
      validatePayment: real.validatePayment.bind(real),
      queryByMerchantTranId: real.queryByMerchantTranId.bind(real),
      verifyIpnSignature: real.verifyIpnSignature.bind(real),
    });
    expect(buildPaymentPorts(env, noFailure).configured()).toHaveLength(1);
    expect(buildPaymentPorts(env, noFailure, { refundsOnly: true }).configured()).toEqual([]);
  });
});
