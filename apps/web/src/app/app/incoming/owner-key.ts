import 'server-only';
import { createHash } from 'node:crypto';

/** Kept apart from any other hash of the same id. */
const LABEL = 'visastack-share-inbox-owner';

/**
 * The key that ties files shared from another app to one account on this device (WP-PIC11). The
 * service worker keeps the first key that opens `/app/incoming` and empties the inbox when a
 * different one asks, so on a shared phone the next person to sign in never sees the files.
 *
 * Made on the server from the account id (a random UUID that is never shown to anyone else) and
 * sent to the worker only in a request header. It separates accounts on one device; it is not a
 * secret against someone who already knows the account id, which is enough here: the files never
 * leave the device, expire after 15 minutes, and are sent only after the person confirms. It reads
 * no secret on purpose (only the files listed in `scripts/no-auth-bypass.test.mjs` may).
 */
export function shareOwnerKey(accountId: string): string | null {
  if (!accountId) return null;
  return createHash('sha256').update(`${LABEL}\u0000${accountId}`).digest('base64url').slice(0, 32);
}
