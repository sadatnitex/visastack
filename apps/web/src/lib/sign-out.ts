import 'server-only';
import { redirect } from 'next/navigation';

import { PUSH_ENDPOINT_FIELD } from './web-push-fields';

export { PUSH_ENDPOINT_FIELD };

/** How long sign-out waits for the alert cleanup before it signs out anyway. */
export const PUSH_CLEANUP_CEILING_MS = 2000;

/**
 * Ends the current Neon Auth session and sends the visitor on: to the landing page, or to a
 * same-site address the caller built itself (never one taken from the request as it came).
 * A sign-out form may pass its fields so this browser's phone alerts are forgotten too.
 */
export async function signOutCurrentUser(afterwards = '/', form?: FormData): Promise<void> {
  const endpoint = form?.get(PUSH_ENDPOINT_FIELD);
  await forgetThisBrowsersAlerts(typeof endpoint === 'string' && endpoint ? endpoint : null);
  const { getNeonAuth } = await import('./neon-auth');
  await getNeonAuth().signOut();
  redirect(afterwards);
}

/**
 * WP-PIC18: the browsers this sign-in turned phone and desktop alerts on for, and the browser
 * being signed out (by the push address its form sent), are forgotten before the session ends,
 * so nobody gets alerts on a device after signing out of it. This runs whatever the Web Push
 * switch says, so switching alerts off never strands a browser; with no table it does one small
 * query and stops. It never stops the sign-out and waits at most two seconds.
 */
async function forgetThisBrowsersAlerts(endpoint: string | null): Promise<void> {
  let release: (() => Promise<void>) | undefined;
  const cleanup = (async () => {
    const [{ neonSessionRef }, { removeWebPushOnSignOut }, { createPooledDb, resolveDatabaseUrl }] =
      await Promise.all([
        import('./neon-recency'),
        import('@visastack/services/web-push'),
        import('@visastack/db'),
      ]);
    const sessionRef = await neonSessionRef().catch(() => null);
    if (!sessionRef && !endpoint) return;
    const connectionString = resolveDatabaseUrl(process.env);
    if (!connectionString) return;
    // Its own short-lived connection: no account lookup and no other sign-in work.
    const { db, pool } = createPooledDb(connectionString);
    pool.on('error', () => undefined);
    release = () => pool.end().catch(() => undefined);
    await removeWebPushOnSignOut(db as unknown as Parameters<typeof removeWebPushOnSignOut>[0], {
      sessionRef,
      endpoint,
    });
  })().catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, PUSH_CLEANUP_CEILING_MS);
  });
  try {
    await Promise.race([cleanup, ceiling]);
  } finally {
    if (timer) clearTimeout(timer);
    // The connection closes once the cleanup ends, even when sign-out went on without it.
    void cleanup.then(() => release?.());
  }
}
