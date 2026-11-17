import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signInNextSuffix } from '../../../lib/confirmed-landing';
import { safeReturnPath } from '../../../lib/neon-recency';

export const metadata: Metadata = { title: 'Signed In' };
export const dynamic = 'force-dynamic';

/**
 * Where Google sign-in returns to. It shows nothing of its own: a person who is signed in goes
 * straight to where they were headed, and anyone else goes to the sign-in form with the Google
 * message. The sign-in check in `middleware.ts` runs on this path first, so the sign-in Neon Auth
 * made at Google is passed on before this page is reached, and a visitor with none is sent on
 * without reaching it. Kept apart from the email confirmation landing (`/auth/confirmed`) so a
 * Google sign-in never says anything about email confirmation.
 */
export default async function SocialReturnPage({
  searchParams,
}: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const destination = safeReturnPath(next);
  let signedIn = false;
  try {
    const { requestSessionReader } = await import('../../../lib/neon-request-session');
    const { data } = await requestSessionReader().getSession();
    signedIn = Boolean(data?.user);
  } catch {
    signedIn = false;
  }
  redirect(signedIn ? destination : `/auth/sign-in?e=social${signInNextSuffix(destination)}`);
}
