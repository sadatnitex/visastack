import 'server-only';
import { type Db, RATE_LIMITS, checkRateLimit } from '@visastack/services';
import { headers } from 'next/headers';
import { clientAddressFrom, hashedSubject } from '../../../../lib/client-address';

/**
 * Counts one look at a trip invitation from the visitor's network address (kept only as a short
 * hash) and says whether the address has looked too often this hour. This is the same limiter the
 * agency invitation page uses, under its own action name, so trying links in bulk from one place is
 * bounded. Page views and each answer (join, decline) count; the answer to "too many" is one fixed
 * wording for everyone.
 */
export async function networkLimited(db: Db): Promise<boolean> {
  const address = clientAddressFrom(await headers());
  const decision = await checkRateLimit(
    db,
    {
      subjectId: hashedSubject('net', address),
      action: 'trip_companion.preview_ip',
      label: 'visit',
    },
    RATE_LIMITS.INVITATION_PREVIEW_IP,
  );
  return !decision.allowed;
}
