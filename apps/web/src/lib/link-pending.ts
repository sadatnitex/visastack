/**
 * The "link pending" mark (Q8): proof that THIS browser asked for a sign-in link, so a link
 * someone else asked for can never sign this browser in (login CSRF). Set by the email-link
 * actions for every valid address alike (it says nothing about who has an account), checked by
 * the sign-in filter before Neon Auth hands over any sign-in on `/auth/link-return`, and cleared
 * there, so each mark is used once.
 *
 * Web Crypto only (no Node modules), because the sign-in filter (`middleware.ts`) runs it too.
 * HMAC-SHA256 with a purpose prefix under the Neon Auth cookie key, the same key every other
 * signed cookie here reuses under its own purpose.
 */

export const LINK_PENDING_LIFETIME_S = 10 * 60;
const PURPOSE = 'visastack/sign-in-link-pending/v1:';

export function linkPendingCookieName(secure: boolean): string {
  return secure ? '__Host-vs-link-pending' : 'vs-link-pending';
}

/**
 * Lax on purpose: a link opened from a mail app is a cross-site top-level visit, which a Strict
 * cookie would miss, breaking every real sign-in. httpOnly, host-only, Secure on https.
 */
export function linkPendingCookieOptions(secure: boolean): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: LINK_PENDING_LIFETIME_S };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sign(payload: string, secret: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(PURPOSE + payload)));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}

export async function encodeLinkPending(secret: string, now: number = Date.now()): Promise<string> {
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ n: nonce, e: now + LINK_PENDING_LIFETIME_S * 1000 })),
  );
  return `${payload}.${toBase64Url(await sign(payload, secret))}`;
}

/** True only for a mark this site signed that has not expired. */
export async function linkPendingValid(
  value: string | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!value || value.length > 512 || secret.length < 32) return false;
  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const given = fromBase64Url(parts[1]);
  const body = fromBase64Url(parts[0]);
  if (!given || !body) return false;
  if (!sameBytes(given, await sign(parts[0], secret))) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(body)) as { e?: unknown };
    return typeof payload.e === 'number' && payload.e >= now;
  } catch {
    return false;
  }
}
