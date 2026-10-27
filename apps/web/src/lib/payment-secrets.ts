import 'server-only';
import { readEnv } from './env';

/**
 * An error safe to log from payment code: the same message with the store password (and the
 * store id) blanked out, and nothing else carried over. The payment adapter never puts a
 * credential in an error, so this is a second line of defence for whatever a library, a driver
 * or a future change might put in one.
 */
export function withoutPaymentSecrets(error: unknown): Error {
  let message = error instanceof Error ? error.message : String(error);
  for (const name of ['SSLCOMMERZ_STORE_PASSWORD', 'SSLCOMMERZ_STORE_ID']) {
    const secret = readEnv(name);
    if (secret && secret.length >= 4) message = message.split(secret).join('[removed]');
  }
  const safe = new Error(message);
  if (error instanceof Error) safe.name = error.name;
  return safe;
}
