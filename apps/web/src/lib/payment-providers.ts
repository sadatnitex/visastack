import 'server-only';
import { type PaymentProviderFailure, SslcommerzPaymentPort } from '@visastack/adapters';
import {
  type PaymentPort,
  type PaymentPortResolver,
  currencyListWords,
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
 * (`missingSettings` is empty); a half-set provider is off, never guessed into a mode. It is never
 * silent either (S19 step 0 round 2): `incompletePaymentProviders` names it and the settings it
 * lacks (never their values), and the readiness check, the daily payment check and its callback
 * addresses all report it. Nothing here throws.
 */

export type ProviderEnv = Readonly<Record<string, string | undefined>>;
export type PaymentGatewayMode = 'TEST' | 'LIVE';
/** Across every configured provider: MIXED when some take real money and some only test payments. */
export type OverallPaymentMode = PaymentGatewayMode | 'MIXED';

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
  /**
   * The names of its settings that are missing or not valid, in a fixed order; empty when it is
   * fully configured. Only names, never a value.
   */
  missingSettings(env: ProviderEnv): readonly string[];
  /** Its port. Only called once `missingSettings` is empty. */
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
function readSslcommerz(env: ProviderEnv): {
  readonly settings: SslcommerzSettings | null;
  readonly missing: readonly string[];
} {
  const storeId = namedValue(env, 'SSLCOMMERZ_STORE_ID')?.trim() ?? '';
  const storePassword = namedValue(env, 'SSLCOMMERZ_STORE_PASSWORD') ?? '';
  const typed = namedValue(env, 'SSLCOMMERZ_MODE')?.trim();
  const mode: SslcommerzSettings['mode'] | null =
    typed === 'sandbox' || typed === 'live' ? typed : null;
  const missing = [
    ...(storeId === '' ? ['SSLCOMMERZ_STORE_ID'] : []),
    ...(storePassword === '' ? ['SSLCOMMERZ_STORE_PASSWORD'] : []),
    ...(mode === null ? ['SSLCOMMERZ_MODE'] : []),
  ];
  // Settings exactly when nothing is missing (the three facts the list above is made from).
  const settings = storeId && storePassword && mode ? { storeId, storePassword, mode } : null;
  return { settings, missing };
}

function sslcommerzSettings(env: ProviderEnv): SslcommerzSettings | null {
  return readSslcommerz(env).settings;
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
  missingSettings(env) {
    return readSslcommerz(env).missing;
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

/**
 * Why `PAYMENT_PROVIDERS` cannot be used as it is, for the readiness check, or null: it names a
 * provider this deployment does not have, or it is set but names nothing at all (such as ","),
 * which would otherwise quietly switch every provider off. Only the setting's name and the
 * supported names are given, never what was typed.
 */
export function paymentProvidersSettingProblem(env: ProviderEnv): string | null {
  const listed = listedNames(env);
  if (listed === null) return null;
  if (unknownListedProviders(env).length > 0) {
    return `unsupported ${PAYMENT_PROVIDERS_SETTING} value - this deployment implements: none, ${PAYMENT_PROVIDER_KEYS.join(', ')}`;
  }
  if (listed.length === 0) {
    return `${PAYMENT_PROVIDERS_SETTING} is set but names no provider - list provider names, or none to switch online payment off`;
  }
  return null;
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
    if (mode !== null && entry.missingSettings(env).length === 0) {
      configured.push({ key, entry, mode });
    }
  }
  return configured;
}

export interface IncompletePaymentProvider {
  readonly key: PaymentProviderKey;
  readonly name: string;
  /** The names of the settings it lacks (never their values). */
  readonly missing: readonly string[];
}

/** The chosen providers that are off because some of their settings are missing or not valid. */
export function incompletePaymentProviders(env: ProviderEnv): readonly IncompletePaymentProvider[] {
  const incomplete: IncompletePaymentProvider[] = [];
  for (const key of chosenPaymentProviders(env)) {
    const entry: PaymentProviderEntry = PAYMENT_PROVIDERS[key];
    const missing = entry.missingSettings(env);
    if (missing.length > 0) incomplete.push({ key, name: entry.name, missing });
  }
  return incomplete;
}

/** One plain line naming an incomplete provider and the settings it lacks, never a value. */
export function incompleteProviderMessage(provider: IncompletePaymentProvider): string {
  return `payment provider ${provider.key} is chosen but its settings are incomplete or not valid: ${provider.missing.join(', ')}`;
}

/**
 * The payment mode across every configured provider: LIVE only when every one takes real money,
 * TEST when all are in test mode (the S29 meanings, unchanged with one provider), MIXED when some
 * are live and some are not, null when none is configured.
 */
export function overallPaymentMode(
  configured: readonly ConfiguredPaymentProvider[],
): OverallPaymentMode | null {
  if (configured.length === 0) return null;
  const live = configured.filter((provider) => provider.mode === 'LIVE').length;
  if (live === configured.length) return 'LIVE';
  return live === 0 ? 'TEST' : 'MIXED';
}

/**
 * The ports of the configured providers, as the resolver the services take. Every configured
 * provider is in it, refunds or not: the refund services use only the ports that can refund, and
 * tell a provider that is switched off from one that cannot refund (S19 step 0 round 3).
 */
export function buildPaymentPorts(
  env: ProviderEnv,
  onFailure: (event: PaymentProviderFailure) => void,
): PaymentPortResolver {
  return paymentPortResolver(
    configuredPaymentProviders(env).map((provider) => ({
      port: provider.entry.create(env, onFailure),
      currencies: provider.entry.currencies,
    })),
  );
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

/**
 * The invoice currencies that can be paid online with real money, and those that can still only
 * take test payments, each in the owner's order (from `onlineOffers`: a currency is paid through
 * the earliest provider that takes it, so that provider's mode decides).
 */
export function currenciesByMode(env: ProviderEnv): {
  readonly live: readonly string[];
  readonly test: readonly string[];
} {
  const live: string[] = [];
  const test: string[] = [];
  for (const [currency, offer] of Object.entries(onlineOffers(env))) {
    (offer.mode === 'LIVE' ? live : test).push(currency);
  }
  return { live, test };
}

/**
 * While some providers take real money and some only test payments (MIXED), what the status page
 * tells the public, in plain words; null otherwise. Nothing claims every payment is real.
 */
export function mixedPaymentsNote(env: ProviderEnv): string | null {
  if (overallPaymentMode(configuredPaymentProviders(env)) !== 'MIXED') return null;
  const { live, test } = currenciesByMode(env);
  const parts = [
    live.length > 0
      ? `Online payment takes real money for invoices in ${currencyListWords(live, 'and')}.`
      : null,
    test.length > 0
      ? `Invoices in ${currencyListWords(test, 'and')} can only take test payments for now.`
      : null,
    live.length === 0 || test.length === 0
      ? 'One payment method is still being tested and is not used for any invoice yet.'
      : null,
  ];
  return parts.filter((part): part is string => part !== null).join(' ');
}
