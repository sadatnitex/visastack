import 'server-only';
import { redirect } from 'next/navigation';

/**
 * Ends the current Neon Auth session and sends the visitor on: to the landing page, or to a
 * same-site address the caller built itself (never one taken from the request as it came).
 */
export async function signOutCurrentUser(afterwards = '/'): Promise<void> {
  await forgetThisSignInsAlerts();
  const { getNeonAuth } = await import('./neon-auth');
  await getNeonAuth().signOut();
  redirect(afterwards);
}

/**
 * WP-PIC18: the browsers this sign-in turned phone and desktop alerts on for are forgotten
 * before the session ends, so nobody gets alerts on a device after signing out of it. Does
 * nothing while Web Push is off, and never stops the sign-out.
 */
async function forgetThisSignInsAlerts(): Promise<void> {
  try {
    const { webPushSwitchOn } = await import('./web-push');
    if (!webPushSwitchOn()) return;
    const [{ neonSessionRef }, { removeWebPushSubscriptionsForSession }, { withSession }] =
      await Promise.all([
        import('./neon-recency'),
        import('@visastack/services/web-push'),
        import('./session'),
      ]);
    const sessionRef = await neonSessionRef();
    if (!sessionRef) return;
    await withSession(({ db, accountId }) =>
      removeWebPushSubscriptionsForSession(db, { accountId, sessionRef }),
    );
  } catch {
    // A redirect from the session check (already signed out) or a missing table: sign out anyway.
  }
}
