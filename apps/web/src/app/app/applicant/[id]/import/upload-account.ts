import 'server-only';
import { createHash } from 'node:crypto';

/** Kept apart from any other hash of the same id. */
const LABEL = 'visastack-upload-account';

/**
 * WP-PIC17: the key that ties files waiting in a page's upload queue to the account that chose
 * them. Made on the server from the account id and handed to the signed-in page as a prop. Before
 * waiting files go out again after a dropped connection, the page asks the server whether the
 * session still belongs to this key; if not (signed out, or another account in another tab), the
 * files are dropped and nothing is sent. It is account separation on one device, not a secret.
 */
export function uploadAccountKey(accountId: string): string | null {
  if (!accountId) return null;
  return createHash('sha256').update(`${LABEL}\u0000${accountId}`).digest('base64url').slice(0, 32);
}
