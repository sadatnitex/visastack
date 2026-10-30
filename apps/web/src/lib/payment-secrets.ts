import 'server-only';
import { readEnv } from './env';
import { PAYMENT_PROVIDERS, type PaymentProviderEntry } from './payment-providers';
import { PAYMENT_RESULT_SIGNING_SECRET } from './payment-result';

/**
 * Every setting payment code must never let reach a log: each registry provider's secret
 * settings (S19 step 0), and the result-page signing secret.
 */
export function paymentSecretNames(): readonly string[] {
  const entries: readonly PaymentProviderEntry[] = Object.values(PAYMENT_PROVIDERS);
  return [...entries.flatMap((entry) => entry.secretNames), PAYMENT_RESULT_SIGNING_SECRET];
}

/**
 * An error safe to log from payment code: the same message with every payment secret (each
 * provider's passwords and store ids, and the signing secret) blanked out, and nothing else
 * carried over. The payment adapters never put a credential in an error, so this is a second line
 * of defence for whatever a library, a driver or a future change might put in one.
 */
export function withoutPaymentSecrets(error: unknown): Error {
  let message = error instanceof Error ? error.message : String(error);
  for (const name of paymentSecretNames()) {
    const secret = readEnv(name);
    if (secret && secret.length >= 4) message = message.split(secret).join('[removed]');
  }
  const safe = new Error(message);
  if (error instanceof Error) safe.name = error.name;
  return safe;
}
