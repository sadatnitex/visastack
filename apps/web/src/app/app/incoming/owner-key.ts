import 'server-only';
import { createHmac } from 'node:crypto';

/** Kept apart from every other key made from the same secret. */
const LABEL = 'visastack-share-inbox-owner';

/**
 * The key that ties files shared from another app to one account on this device (WP-PIC11). The
 * service worker keeps the first key that opens `/app/incoming` and empties the inbox when a
 * different one asks, so on a shared phone the next person to sign in never sees the files.
 *
 * Made the same way as the signed retry cookie (`lib/signed-retry-cookie.ts`): an HMAC keyed from the
 * session secret. It names no one and cannot be turned back into the account id. Null when the
 * secret is missing: the page then reads nothing from the inbox.
 */
export function shareOwnerKey(
  accountId: string,
  readEnv: (name: string) => string | undefined = (name) => process.env[name],
): string | null {
  const secret = readEnv('NEON_AUTH_COOKIE_SECRET');
  if (!secret || secret.length < 32 || !accountId) return null;
  const key = createHmac('sha256', secret).update(LABEL).digest();
  return createHmac('sha256', key).update(accountId).digest('base64url').slice(0, 32);
}
