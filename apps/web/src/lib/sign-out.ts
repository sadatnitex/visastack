import 'server-only';
import { signOut as workosSignOut } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';
import { selectedIdentityProvider } from './identity-selection';

/**
 * Ends the current session with whichever sign-in system is selected. WorkOS handles its own
 * redirect; for Neon Auth the session is ended and the visitor is sent to the landing page.
 */
export async function signOutCurrentUser(): Promise<void> {
  if (selectedIdentityProvider() === 'neon_auth') {
    const { getNeonAuth } = await import('./neon-auth');
    await getNeonAuth().signOut();
    redirect('/');
  }
  await workosSignOut();
}
