import { redirect } from 'next/navigation';

/**
 * The shared last step of a sign-in that returns from elsewhere (Google, or the email sign-in
 * link). The sign-in check in `middleware.ts` has already run and handed over the new sign-in.
 * Signed in: on to the validated destination, or first through the agreement and invitation step
 * (`/auth/notice-check`) for a new person. Not signed in: to `signedOutPath`. Nobody gets an
 * account without agreeing: anything unreadable here goes straight on, and `withSession` asks again.
 */
export async function landAfterSignIn(destination: string, signedOutPath: string): Promise<never> {
  let user: { id: string; email: string } | undefined;
  try {
    const { requestSessionReader } = await import('../../lib/neon-request-session');
    const { data } = await requestSessionReader().getSession();
    if (data?.user?.id) user = { id: data.user.id, email: data.user.email };
  } catch {
    user = undefined;
  }
  if (!user) redirect(signedOutPath);

  let mustAgree: boolean;
  try {
    const { mustAcknowledgeNotices } = await import('../../lib/notice-gate');
    const { withPublicDb } = await import('../../lib/public-db');
    mustAgree = await withPublicDb((db) => mustAcknowledgeNotices(db, user));
  } catch {
    mustAgree = false;
  }
  redirect(mustAgree ? `/auth/notice-check?next=${encodeURIComponent(destination)}` : destination);
}
