import type { Metadata } from 'next';
import { signInNextSuffix } from '../../../lib/confirmed-landing';
import { safeReturnPath } from '../../../lib/neon-recency';
import { landAfterSignIn } from '../land-after-sign-in';

export const metadata: Metadata = { title: 'Signed In' };
export const dynamic = 'force-dynamic';

/**
 * Where the email sign-in link returns to (Q8). It shows nothing of its own, exactly like the
 * Google return (`/auth/social-return`): the sign-in check in `middleware.ts` runs on this path
 * first and hands over the sign-in Neon Auth made when the link was opened. With no sign-in (the
 * link was opened on another device or browser) the sign-in form explains what to do.
 */
export default async function LinkReturnPage({
  searchParams,
}: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const destination = safeReturnPath(next);
  return landAfterSignIn(destination, `/auth/sign-in?e=link${signInNextSuffix(destination)}`);
}
