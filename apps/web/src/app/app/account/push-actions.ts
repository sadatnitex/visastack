'use server';

import { parsePushSubscription } from '@visastack/adapters';
import { removeWebPushSubscription, saveWebPushSubscription } from '@visastack/services/web-push';
import { neonSessionRef } from '../../../lib/neon-recency';
import { withSession } from '../../../lib/session';
import { webPushKeyPort, webPushReady } from '../../../lib/web-push';

/**
 * Turn On and Turn Off for phone and desktop alerts (WP-PIC18). Each call checks the sign-in,
 * the switch, the keys and the table again; while any is missing every call gives the same
 * answer, so nothing can be learned by trying. The browser's subscription is checked here
 * (a real push service address over https, keys of the right length) before anything is stored.
 */

export type PushActionResult = { readonly ok: true } | { readonly ok: false };

const REFUSED: PushActionResult = { ok: false };

export async function turnOnPushAction(subscription: unknown): Promise<PushActionResult> {
  const parsed = parsePushSubscription(subscription);
  return withSession(async ({ db, accountId }) => {
    const ready = await webPushReady(db);
    const port = webPushKeyPort();
    if (!ready || !port || !parsed) return REFUSED;
    const sessionRef = await neonSessionRef().catch(() => null);
    try {
      const saved = await saveWebPushSubscription(db, port, {
        accountId,
        subscription: parsed,
        sessionRef,
      });
      return saved === 'saved' ? { ok: true } : REFUSED;
    } catch {
      return REFUSED;
    }
  });
}

export async function turnOffPushAction(endpoint: unknown): Promise<PushActionResult> {
  return withSession(async ({ db, accountId }) => {
    const ready = await webPushReady(db);
    if (!ready || typeof endpoint !== 'string' || endpoint.length > 2048) return REFUSED;
    try {
      await removeWebPushSubscription(db, { accountId, endpoint });
      return { ok: true };
    } catch {
      return REFUSED;
    }
  });
}
