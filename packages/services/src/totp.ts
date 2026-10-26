import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * One-time authenticator codes (RFC 4226 and RFC 6238) and the helpers around them. Pure
 * functions with no database and no clock of their own, so every case is testable with the RFC
 * vectors. HMAC-SHA1 is what every authenticator app supports; it is used only as the RFC's
 * keyed construction, never as a plain hash.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** One step either side of "now": enough for clock drift, small enough to keep guessing hard. */
export const TOTP_WINDOW_STEPS = 1;
export const TOTP_SECRET_BYTES = 20;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('not a valid base32 string');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function generateTotpSecret(): Uint8Array {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** RFC 4226 HOTP with HMAC-SHA1 and dynamic truncation. */
export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The 30-second step a moment falls in. */
export function totpStep(atMs: number, periodSeconds = TOTP_PERIOD_SECONDS): number {
  return Math.floor(atMs / 1000 / periodSeconds);
}

export function totp(secret: Uint8Array, atMs: number, digits = TOTP_DIGITS): string {
  return hotp(secret, totpStep(atMs), digits);
}

/**
 * The step a typed code matches within the window, or null. Every candidate is compared in
 * constant time and the loop never exits early, so timing does not say which step matched.
 */
export function matchTotp(
  secret: Uint8Array,
  code: string,
  atMs: number,
  windowSteps = TOTP_WINDOW_STEPS,
): number | null {
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const typedBytes = Buffer.from(typed);
  const now = totpStep(atMs);
  let matched: number | null = null;
  for (let offset = -windowSteps; offset <= windowSteps; offset += 1) {
    const step = now + offset;
    if (step < 0) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, typedBytes) && matched === null) matched = step;
  }
  return matched;
}

/** The address an authenticator app reads from the QR code. */
export function otpauthUri(input: {
  readonly issuer: string;
  readonly account: string;
  readonly secret: Uint8Array;
}): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(input.secret),
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** The secret in groups of four, for typing into an app by hand. */
export function groupSecret(secret: Uint8Array): string {
  return (base32Encode(secret).match(/.{1,4}/g) ?? []).join(' ');
}

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 10;

/** Ten single-use codes of 80 random bits each, shown as XXXX-XXXX-XXXX-XXXX. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const text = base32Encode(randomBytes(RECOVERY_CODE_BYTES));
    return (text.match(/.{1,4}/g) ?? []).join('-');
  });
}

/** Upper case, no spaces or dashes, so what a person types matches what was shown. */
export function normaliseRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

export function looksLikeRecoveryCode(code: string): boolean {
  return /^[A-Z2-7]{16}$/.test(normaliseRecoveryCode(code));
}
