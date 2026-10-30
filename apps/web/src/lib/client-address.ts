import { createHash } from 'node:crypto';
import { type HostingPlatform, hostingPlatform } from './hosting';

/**
 * How a request's network address is read and turned into a rate-limit key, in one place for
 * every public address that is limited by source (the sign-in forms and the payment gateway
 * callbacks). Raw addresses are never stored: the key is a short hash.
 *
 * On Vercel (and locally), the first value of `x-forwarded-for` is used, then `x-real-ip`: Vercel
 * sets both and replaces anything a client sends.
 *
 * On the Render fallback (hosting.ts) Render's proxy adds to a client's own `x-forwarded-for`
 * instead of replacing it, so the first value is whatever the client wrote. There only the LAST
 * value is used, the one Render's own proxy appends. `x-real-ip` and `cf-connecting-ip` are never
 * read there: no Render document found says its edge always overwrites them, so a client could
 * set them. With no forwarded value the answer is `unknown`, and such requests share one
 * rate-limit bucket rather than each picking its own.
 */

let renderAddressLogged = false;

export function clientAddressFrom(
  headers: Pick<Headers, 'get'>,
  platform: HostingPlatform = hostingPlatform(),
): string {
  if (platform === 'render') {
    const entries = (headers.get('x-forwarded-for') ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const address = entries[entries.length - 1] ?? 'unknown';
    logRenderAddressOnce(address, entries.length);
    return address;
  }
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * The first-deploy check on Render (docs/operations/render-fallback.md): with
 * `CLIENT_ADDRESS_CHECK=log-once` set on the service, the first address read after each start is
 * written to the service log once, so the owner can compare it with their own address and then
 * remove the setting. Off unless that exact value is set; nothing is logged on Vercel.
 */
function logRenderAddressOnce(address: string, forwardedEntries: number): void {
  const setting = 'CLIENT_ADDRESS_CHECK';
  if (renderAddressLogged || process.env[setting] !== 'log-once') return;
  renderAddressLogged = true;
  console.info(
    `[client-address] Render check: rate limits use ${address} (from ${forwardedEntries} forwarded values). Compare it with your own address, then remove ${setting}.`,
  );
}

/** `kind:` followed by the first 32 hex characters of the SHA-256 of the trimmed, lower-cased value. */
export function hashedSubject(kind: string, value: string): string {
  return `${kind}:${createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32)}`;
}
