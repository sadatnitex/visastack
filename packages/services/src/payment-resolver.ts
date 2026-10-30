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

/** How a currency is named in a sentence. Any other code is named by its code. */
const CURRENCY_WORDS: Readonly<Record<string, string>> = {
  BDT: 'Bangladeshi taka',
  USD: 'US dollars',
  EUR: 'euros',
  GBP: 'British pounds',
};

function currencyWords(code: string): string {
  return Object.hasOwn(CURRENCY_WORDS, code) ? (CURRENCY_WORDS[code] ?? code) : code;
}

const NOT_AVAILABLE = 'Online payment is not available yet. Please try again later.';

/**
 * The plain sentence for an invoice whose currency no configured provider takes. With SSLCOMMERZ
 * alone (taka only) it is exactly the sentence used before the registry: "Only invoices in
 * Bangladeshi taka can be paid online."
 */
export function onlineCurrencyRefusal(currencies: readonly string[]): string {
  const words = [...new Set(currencies.map(normalizeCurrencyCode))].map(currencyWords);
  if (words.length === 0) return NOT_AVAILABLE;
  const listed =
    words.length === 1
      ? (words[0] ?? '')
      : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1] ?? ''}`;
  return `Only invoices in ${listed} can be paid online.`;
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
