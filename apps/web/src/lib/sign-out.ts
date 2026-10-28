import 'server-only';
import { redirect } from 'next/navigation';

/**
 * Ends the current Neon Auth session and sends the visitor on: to the landing page, or to a
 * same-site address the caller built itself (never one taken from the request as it came).
 */
export async function signOutCurrentUser(afterwards = '/'): Promise<void> {
  const { getNeonAuth } = await import('./neon-auth');
  await getNeonAuth().signOut();
  redirect(afterwards);
}
