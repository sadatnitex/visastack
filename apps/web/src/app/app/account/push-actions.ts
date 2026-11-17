'use server';

import { parsePushSubscription } from '@visastack/adapters';
import {
  removeWebPushSubscription,
  renewWebPushSubscription,
  saveWebPushSubscription,
  webPushTableReady,
} from '@visastack/services/web-push';
import { neonSessionRef } from '../../../lib/neon-recency';
import { withSession } from '../../../lib/session';
import { webPushKeyPort, webPushReady } from '../../../lib/web-push';

/**
 * Turn On, Turn Off and the renewal check for phone and desktop alerts (WP-PIC18). Each call
 * checks the sign-in again. Turn On and the renewal check also need the switch, the keys and the
 * table; Turn Off needs only the table, so a browser can always be forgotten even after the switch
 * was turned off. While something is missing every call gives the same answer. The browser's
 * subscription is checked here (a real push service address over https, keys of the right length)
 * before anything is stored.
 */

export type PushActionResult = { readonly ok: true } | { readonly ok: false };

const REFUSED: PushActionResult = { ok: false };

function plausibleEndpoint(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048;
}

export async function turnOnPushAction(subscription: unknown): Promise<PushActionResult> {
  const parsed = parsePushSubscription(subscription);
  return withSession(async ({ db, self }) => {
    const ready = await webPushReady(db);
    const port = webPushKeyPort();
    if (!ready || !port || !parsed) return REFUSED;
    // Without this sign-in's reference, signing out could not forget the browser: refuse.
    const sessionRef = await neonSessionRef().catch(() => null);
    if (!sessionRef) return REFUSED;
    try {
      const saved = await saveWebPushSubscription(db, port, self, {
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
  return withSession(async ({ db, self }) => {
    if (!plausibleEndpoint(endpoint)) return REFUSED;
    try {
      if (!(await webPushTableReady(db))) return REFUSED;
      await removeWebPushSubscription(db, self, { endpoint });
      return { ok: true };
    } catch {
      return REFUSED;
    }
  });
}

/**
 * This browser seen signed in: whether its alerts are on for this account, renewing it and tying
 * it to this sign-in when they are. Off means the server does not know this browser (any more).
 */
export async function renewPushAction(endpoint: unknown): Promise<PushActionResult> {
  return withSession(async ({ db, self }) => {
    const ready = await webPushReady(db);
    if (!ready || !plausibleEndpoint(endpoint)) return REFUSED;
    const sessionRef = await neonSessionRef().catch(() => null);
    if (!sessionRef) return REFUSED;
    try {
      return (await renewWebPushSubscription(db, self, { endpoint, sessionRef }))
        ? { ok: true }
        : REFUSED;
    } catch {
      return REFUSED;
    }
  });
}
