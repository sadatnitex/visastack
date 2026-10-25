import 'server-only';
import { redirect } from 'next/navigation';

/** Ends the current Neon Auth session and sends the visitor to the landing page. */
export async function signOutCurrentUser(): Promise<void> {
  const { getNeonAuth } = await import('./neon-auth');
  await getNeonAuth().signOut();
  redirect('/');
}
