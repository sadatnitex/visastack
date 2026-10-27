import { createHash } from 'node:crypto';

/**
 * How a request's network address is read and turned into a rate-limit key, in one place for
 * every public address that is limited by source (the sign-in forms and the payment gateway
 * callbacks). The first value of `x-forwarded-for` is used, then `x-real-ip`; the hosting
 * platform sets both and replaces anything a client sends. Raw addresses are never stored: the
 * key is a short hash.
 */

export function clientAddressFrom(headers: Pick<Headers, 'get'>): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip')?.trim() || 'unknown';
}

/** `kind:` followed by the first 32 hex characters of the SHA-256 of the trimmed, lower-cased value. */
export function hashedSubject(kind: string, value: string): string {
  return `${kind}:${createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32)}`;
}
