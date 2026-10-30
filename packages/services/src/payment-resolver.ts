import { normalizeCurrencyCode } from '@visastack/core';
import type { PaymentPort, PaymentPortResolver } from './ports';

/**
 * How the services find the payment provider for a step (S19 step 0, ADR 0020 amendment). The web
 * app's provider registry (apps/web/src/lib/payment-providers.ts) builds one of these from the
 * providers the owner chose and configured; tests build one from fake ports.
 */

/** One configured provider's port and the currencies it takes (upper-case ISO codes). */
export interface PaymentPortChoice {
  readonly port: PaymentPort;
  readonly currencies: readonly string[];
}

/** How a currency is named in a sentence. Any other code is named by its code. The one list. */
const CURRENCY_WORDS: Readonly<Record<string, string>> = {
  BDT: 'Bangladeshi taka',
  USD: 'US dollars',
  EUR: 'euros',
  GBP: 'British pounds',
};

/** A currency code in plain words ("Bangladeshi taka"); a code without words stays a code. */
export function currencyWords(code: string): string {
  const upper = normalizeCurrencyCode(code);
  return Object.hasOwn(CURRENCY_WORDS, upper) ? (CURRENCY_WORDS[upper] ?? upper) : upper;
}

/**
 * Currency codes as one plain phrase, each named once, in the given order: "Bangladeshi taka",
 * "Bangladeshi taka or US dollars", "euros, British pounds and US dollars".
 */
export function currencyListWords(
  codes: readonly string[],
  conjunction: 'or' | 'and' = 'or',
): string {
  const words = [...new Set(codes.map(normalizeCurrencyCode))].map(currencyWords);
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} ${conjunction} ${words[words.length - 1] ?? ''}`;
}

const NOT_AVAILABLE = 'Online payment is not available yet. Please try again later.';

/**
 * The plain sentence for an invoice whose currency no configured provider takes. With SSLCOMMERZ
 * alone (taka only) it is exactly the sentence used before the registry: "Only invoices in
 * Bangladeshi taka can be paid online."
 */
export function onlineCurrencyRefusal(currencies: readonly string[]): string {
  if (currencies.length === 0) return NOT_AVAILABLE;
  return `Only invoices in ${currencyListWords(currencies, 'or')} can be paid online.`;
}

/**
 * A resolver over the given ports, in the given order. A port that is not configured, or has no
 * mode (test or live), is left out entirely, so nothing can start, check or refund through it. The
 * first port of a provider name wins; a later one with the same name is ignored.
 */
export function paymentPortResolver(choices: readonly PaymentPortChoice[]): PaymentPortResolver {
  const usable: { readonly port: PaymentPort; readonly currencies: ReadonlySet<string> }[] = [];
  for (const choice of choices) {
    if (!choice.port.configured || choice.port.mode === null) continue;
    if (usable.some((u) => u.port.provider === choice.port.provider)) continue;
    usable.push({
      port: choice.port,
      currencies: new Set(choice.currencies.map(normalizeCurrencyCode)),
    });
  }
  const ports = Object.freeze(usable.map((u) => u.port));
  const currencyRefusal = onlineCurrencyRefusal(usable.flatMap((u) => [...u.currencies]));
  return {
    configured: () => ports,
    forCurrency: (currency) => {
      const code = normalizeCurrencyCode(currency);
      return usable.find((u) => u.currencies.has(code))?.port ?? null;
    },
    forProvider: (provider) =>
      provider === null ? null : (usable.find((u) => u.port.provider === provider)?.port ?? null),
    currencyRefusal,
  };
}

/**
 * The clock time by which the provider at `index` (of `count`, in order) must stop starting
 * gateway calls: an equal share of what is left of the run's budget, so a slow or hanging earlier
 * provider can never use up the time of a later one (S19 step 0 round 2). Null without a budget.
 */
export function providerShareDeadline(
  deadline: number | null,
  index: number,
  count: number,
  now: number = Date.now(),
): number | null {
  if (deadline === null) return null;
  const left = Math.max(0, deadline - now);
  return now + Math.floor(left / Math.max(1, count - index));
}
