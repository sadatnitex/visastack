import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { confirmedLandingDecision } from '../../../lib/confirmed-landing';

export const metadata: Metadata = { title: 'Email Confirmed' };
export const dynamic = 'force-dynamic';

/**
 * Where the confirmation link in the email leads (P1, 10 Nov 2026). It shows nothing of its own:
 * a person who is signed in goes straight to where they were headed (the ordinary home, or the
 * task they came for), and anyone else goes to the sign-in form with the "confirmed" line. The
 * sign-in check in `middleware.ts` runs on this path first, so a sign-in made when the link was
 * confirmed is passed on, and a visitor with none never reaches this page at all.
 */
export default async function ConfirmedPage({
  searchParams,
}: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  let signedIn = false;
  try {
    const { getNeonAuth } = await import('../../../lib/neon-auth');
    const { data } = await getNeonAuth().getSession();
    signedIn = Boolean(data?.user);
  } catch {
    signedIn = false;
  }
  redirect(confirmedLandingDecision({ signedIn, next }));
}
