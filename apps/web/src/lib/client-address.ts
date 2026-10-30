import { createHash } from 'node:crypto';
import { type HostingPlatform, hostingPlatform } from './hosting';

/**
 * How a request's network address is read and turned into a rate-limit key, in one place for
 * every public address that is limited by source (the sign-in forms and the payment gateway
 * callbacks). The first value of `x-forwarded-for` is used, then `x-real-ip`; the hosting
 * platform sets both and replaces anything a client sends. Raw addresses are never stored: the
 * key is a short hash.
 *
 * On the Render fallback (hosting.ts) Render's front proxy is reported to add to a client's own
 * `x-forwarded-for` rather than replace it, so there `cf-connecting-ip`, which Render's edge
 * network (Cloudflare) sets to the connecting address, is read first. That header is read only on
 * Render: anywhere else a client could send it, so it is ignored, and Vercel behaves as before.
 */

export function clientAddressFrom(
  headers: Pick<Headers, 'get'>,
  platform: HostingPlatform = hostingPlatform(),
): string {
  if (platform === 'render') {
    const edge = headers.get('cf-connecting-ip')?.trim();
    if (edge) return edge;
  }
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip')?.trim() || 'unknown';
}

/** `kind:` followed by the first 32 hex characters of the SHA-256 of the trimmed, lower-cased value. */
export function hashedSubject(kind: string, value: string): string {
  return `${kind}:${createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32)}`;
}
