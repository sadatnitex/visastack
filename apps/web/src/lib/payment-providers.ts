import 'server-only';
import { type PaymentProviderFailure, SslcommerzPaymentPort } from '@visastack/adapters';
import {
  type PaymentPort,
  type PaymentPortResolver,
  isRefundingPaymentPort,
  paymentPortResolver,
} from '@visastack/services';

/**
 * The payment provider registry (S19 step 0, ADR 0020 amendment): every online payment provider
 * VisaStack can use, in one place. Adding a provider is one entry here plus its adapter in
 * packages/adapters; the invoice ledger, the services and the pages stay as they are. The owner
 * guide is "Adding a Payment Provider" in docs/operations/online-payments.md.
 *
 * Which providers are on, and in what order, is read from two settings:
 *
 * - `PAYMENT_PROVIDERS`: provider names separated by commas, earlier first (an earlier provider
 *   wins a currency two providers both take). Each name is trimmed; empty names are ignored; a
 *   name is matched exactly (lower case, as in this registry); a repeated name counts once;
 *   `none` adds nothing. A name this registry does not have is not used, and the readiness check
 *   reports it. Set to only `none`, nothing is on. Unset, or blank after trimming, the older
 *   setting below decides.
 * - `PAYMENT_PROVIDER` (the single-provider setting, read exactly as before): exactly a registry
 *   name chooses that one provider; anything else chooses none.
 *
 * A chosen provider is on only once every one of its own settings is present and valid
 * (`isConfigured`); a half-set provider is off, never guessed into a mode. Nothing here throws.
 */

export type ProviderEnv = Readonly<Record<string, string | undefined>>;
export type PaymentGatewayMode = 'TEST' | 'LIVE';

/** What a gateway callback names: its fields (for the signature check) and the payment. */
export interface PaymentCallback {
  readonly fields: Readonly<Record<string, string>>;
  /** The VisaStack transaction id the callback is about, when it names one. */
  readonly merchantTranId: string | null;
  /** The gateway's own id for the payment, when the callback carries one. */
  readonly valId: string | null;
}

export interface PaymentProviderEntry {
  /** How the provider is named on screens. */
  readonly name: string;
  /** Upper-case ISO 4217 codes of the invoice currencies this provider takes. */
  readonly currencies: readonly string[];
  /** True when its adapter can send and check refunds (a `RefundingPaymentPort`). */
  readonly supportsRefunds: boolean;
  /** Its settings that are not secret (each listed in .env.example). */
  readonly settingNames: readonly string[];
  /**
   * Its settings that must never reach a log, an error or a page (each listed in .env.example and
   * blanked by `withoutPaymentSecrets`).
   */
  readonly secretNames: readonly string[];
  /** Where its callbacks arrive: `/api/payments/<name>`, then `/ipn` and `/return`. */
  readonly callbackPath: string;
  /** TEST or LIVE once fully configured; null otherwise. There is no default mode. */
  mode(env: ProviderEnv): PaymentGatewayMode | null;
  /** True when every setting it needs is present and valid. */
  isConfigured(env: ProviderEnv): boolean;
  /** Its port. Only called once `isConfigured` is true. */
  create(env: ProviderEnv, onFailure: (event: PaymentProviderFailure) => void): PaymentPort;
  /** What a callback body names, or null when the body is not one of its callbacks. */
  readCallback(input: {
    readonly contentType: string | null;
    readonly raw: string;
  }): PaymentCallback | null;
}

/** One named value of a settings or form record (the names are fixed words, never input). */
function namedValue(record: Readonly<Record<string, string | undefined>>, name: string) {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

/** A callback is a few dozen short form fields; more than this is not one. */
const MAX_FIELDS = 100;
const MAX_FIELD_CHARS = 2_048;

/**
 * The fields of a form-encoded callback, or null when the body is not a form or is oversize. The
 * first value of a repeated name wins, and the record has no prototype, so a field named
 * `__proto__` is only a field.
 */
export function readFormCallbackFields(input: {
  readonly contentType: string | null;
  readonly raw: string;
}): Readonly<Record<string, string>> | null {
  const type = input.contentType?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return null;
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  let count = 0;
  for (const [name, value] of new URLSearchParams(input.raw)) {
    if (Object.hasOwn(fields, name)) continue;
    if (++count > MAX_FIELDS || name.length > 64 || value.length > MAX_FIELD_CHARS) return null;
    fields[name] = value;
  }
  return fields;
}

interface SslcommerzSettings {
  readonly storeId: string;
  readonly storePassword: string;
  readonly mode: 'sandbox' | 'live';
}

/**
 * The SSLCOMMERZ settings, read exactly as before the registry: `SSLCOMMERZ_STORE_ID` trimmed,
 * `SSLCOMMERZ_STORE_PASSWORD` as it is, `SSLCOMMERZ_MODE` trimmed and exactly `sandbox` or `live`.
 */
function sslcommerzSettings(env: ProviderEnv): SslcommerzSettings | null {
  const storeId = namedValue(env, 'SSLCOMMERZ_STORE_ID')?.trim() ?? '';
  const storePassword = namedValue(env, 'SSLCOMMERZ_STORE_PASSWORD') ?? '';
  const mode = namedValue(env, 'SSLCOMMERZ_MODE')?.trim();
  if (storeId === '' || storePassword === '') return null;
  if (mode !== 'sandbox' && mode !== 'live') return null;
  return { storeId, storePassword, mode };
}

const SSLCOMMERZ: PaymentProviderEntry = {
  name: 'SSLCOMMERZ',
  // bKash, Rocket, Nagad and cards are all paid through SSLCOMMERZ's own checkout page.
  currencies: ['BDT'],
  supportsRefunds: true,
  settingNames: ['SSLCOMMERZ_MODE'],
  // The store id is not a password, but it has always been kept out of logs, and still is.
  secretNames: ['SSLCOMMERZ_STORE_ID', 'SSLCOMMERZ_STORE_PASSWORD'],
  callbackPath: '/api/payments/sslcommerz',
  mode(env) {
    const settings = sslcommerzSettings(env);
    if (!settings) return null;
    return settings.mode === 'live' ? 'LIVE' : 'TEST';
  },
  isConfigured(env) {
    return sslcommerzSettings(env) !== null;
  },
  create(env, onFailure) {
    const settings = sslcommerzSettings(env);
    if (!settings) {
      throw new Error(
        'PAYMENT_PROVIDER=sslcommerz requires SSLCOMMERZ_STORE_ID, SSLCOMMERZ_STORE_PASSWORD and SSLCOMMERZ_MODE (sandbox or live)',
      );
    }
    return new SslcommerzPaymentPort({ ...settings, onFailure });
  },
  readCallback(input) {
    const fields = readFormCallbackFields(input);
    if (fields === null) return null;
    return {
      fields,
      merchantTranId: namedValue(fields, 'tran_id') ?? null,
      valId: namedValue(fields, 'val_id') ?? null,
    };
  },
};

/**
 * Every provider this deployment can use. The key is the provider's stored name: it is what each
 * payment and refund records, what `PAYMENT_PROVIDERS` lists, and the folder of its callback
 * addresses. Direct bKash, Nagad or Rocket integrations would be further entries here.
 */
export const PAYMENT_PROVIDERS = {
  sslcommerz: SSLCOMMERZ,
} as const satisfies Readonly<Record<string, PaymentProviderEntry>>;

export type PaymentProviderKey = keyof typeof PAYMENT_PROVIDERS;

export const PAYMENT_PROVIDER_KEYS = Object.keys(
  PAYMENT_PROVIDERS,
) as readonly PaymentProviderKey[];

export function isPaymentProviderKey(value: string): value is PaymentProviderKey {
  return Object.hasOwn(PAYMENT_PROVIDERS, value);
}

/** The setting that lists the providers, in order. */
export const PAYMENT_PROVIDERS_SETTING = 'PAYMENT_PROVIDERS';

function listedNames(env: ProviderEnv): readonly string[] | null {
  const list = namedValue(env, PAYMENT_PROVIDERS_SETTING);
  if (list === undefined || list.trim() === '') return null;
  return list
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/** Names in `PAYMENT_PROVIDERS` this deployment does not have (for the readiness check). */
export function unknownListedProviders(env: ProviderEnv): readonly string[] {
  return (listedNames(env) ?? []).filter((name) => name !== 'none' && !isPaymentProviderKey(name));
}

/** The providers the owner chose, in order, configured or not. */
export function chosenPaymentProviders(env: ProviderEnv): readonly PaymentProviderKey[] {
  const listed = listedNames(env);
  if (listed === null) {
    const single = namedValue(env, 'PAYMENT_PROVIDER');
    return single !== undefined && isPaymentProviderKey(single) ? [single] : [];
  }
  const chosen: PaymentProviderKey[] = [];
  for (const name of listed) {
    if (isPaymentProviderKey(name) && !chosen.includes(name)) chosen.push(name);
  }
  return chosen;
}

export interface ConfiguredPaymentProvider {
  readonly key: PaymentProviderKey;
  readonly entry: PaymentProviderEntry;
  readonly mode: PaymentGatewayMode;
}

/**
 * The one answer to "which online payment providers are on here, in which mode": the chosen
 * providers that are fully configured, in the owner's order. Billing Rules, the status page, the
 * platform overview, the Invoices page, the callbacks, the daily check and refunds all use it.
 */
export function configuredPaymentProviders(env: ProviderEnv): readonly ConfiguredPaymentProvider[] {
  const configured: ConfiguredPaymentProvider[] = [];
  for (const key of chosenPaymentProviders(env)) {
    const entry: PaymentProviderEntry = PAYMENT_PROVIDERS[key];
    const mode = entry.mode(env);
    if (mode !== null && entry.isConfigured(env)) configured.push({ key, entry, mode });
  }
  return configured;
}

/**
 * The payment mode across every configured provider (S29 meaning kept): LIVE when any takes real
 * money, TEST when all are in test mode, null when none is configured.
 */
export function overallPaymentMode(
  configured: readonly ConfiguredPaymentProvider[],
): PaymentGatewayMode | null {
  if (configured.length === 0) return null;
  return configured.some((provider) => provider.mode === 'LIVE') ? 'LIVE' : 'TEST';
}

/**
 * The ports of the configured providers, as the resolver the services take. With
 * `refundsOnly`, only providers whose port can refund.
 */
export function buildPaymentPorts(
  env: ProviderEnv,
  onFailure: (event: PaymentProviderFailure) => void,
  options: { readonly refundsOnly?: boolean } = {},
): PaymentPortResolver {
  const choices = [];
  for (const provider of configuredPaymentProviders(env)) {
    if (options.refundsOnly && !provider.entry.supportsRefunds) continue;
    const port = provider.entry.create(env, onFailure);
    if (options.refundsOnly && !isRefundingPaymentPort(port)) continue;
    choices.push({ port, currencies: provider.entry.currencies });
  }
  return paymentPortResolver(choices);
}

/** What the Invoices page may offer, per invoice currency: the provider that takes it, and its mode. */
export type OnlineOffers = Readonly<
  Record<string, { readonly provider: PaymentProviderKey; readonly mode: PaymentGatewayMode }>
>;

/** Each currency some configured provider takes, with the earliest such provider in the owner's order. */
export function onlineOffers(env: ProviderEnv): OnlineOffers {
  const offers: Record<
    string,
    { readonly provider: PaymentProviderKey; readonly mode: PaymentGatewayMode }
  > = Object.create(null) as Record<
    string,
    { readonly provider: PaymentProviderKey; readonly mode: PaymentGatewayMode }
  >;
  for (const provider of configuredPaymentProviders(env)) {
    for (const currency of provider.entry.currencies) {
      if (!Object.hasOwn(offers, currency)) {
        offers[currency] = { provider: provider.key, mode: provider.mode };
      }
    }
  }
  return offers;
}
