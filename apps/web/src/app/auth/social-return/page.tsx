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
 * Google sign-in never says anything about email confirmation. A new person is sent through the
 * agreement step first (`/auth/notice-check`), carrying where they were headed.
 */
export default async function SocialReturnPage({
  searchParams,
}: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const destination = safeReturnPath(next);
  let user: { id: string; email: string } | undefined;
  try {
    const { requestSessionReader } = await import('../../../lib/neon-request-session');
    const { data } = await requestSessionReader().getSession();
    if (data?.user?.id) user = { id: data.user.id, email: data.user.email };
  } catch {
    user = undefined;
  }
  if (!user) redirect(`/auth/sign-in?e=social${signInNextSuffix(destination)}`);

  // A new person must agree to the terms first; asking here (not only inside `withSession`) keeps
  // the destination they were headed for. Anything that cannot be read goes straight on, and
  // `withSession` asks again, so nobody gets an account without agreeing.
  let mustAgree: boolean;
  try {
    const { mustAcknowledgeNotices } = await import('../../../lib/notice-gate');
    const { withPublicDb } = await import('../../../lib/public-db');
    mustAgree = await withPublicDb((db) => mustAcknowledgeNotices(db, user));
  } catch {
    mustAgree = false;
  }
  redirect(mustAgree ? `/auth/notice-check?next=${encodeURIComponent(destination)}` : destination);
}
