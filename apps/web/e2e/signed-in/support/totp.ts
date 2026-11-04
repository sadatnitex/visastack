import { createHmac } from 'node:crypto';

/**
 * The six-digit code an authenticator app shows (RFC 6238, SHA-1, 30 seconds), for a synthetic
 * staging account whose second step the owner has turned on. The product has no second step for
 * ordinary accounts today, so this runs only when the sign-in page asks for a code AND the
 * account's secret is configured; otherwise the journey is BLOCKED (see session.ts).
 */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = '';
  for (const char of clean) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error('The authenticator secret is not valid base32.');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret: string, atMs: number = Date.now(), digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / 30)));
  const hmac = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** RFC 6238 appendix B uses this ASCII secret, written here in base32 so the test can check it. */
export const RFC6238_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
