import { NextResponse } from 'next/server';
import { safeReturnPath } from '../../../lib/neon-recency';
import {
  markNoticesSettled,
  mustAcknowledgeNotices,
  signsInWithPassword,
} from '../../../lib/notice-gate';
import { checkPilotAccess } from '../../../lib/pilot-access';
import { withPublicDb } from '../../../lib/public-db';
import { reportServerError } from '../../../lib/server-error';
import { requestOrigin } from '../../../lib/social-sign-in';

export const dynamic = 'force-dynamic';

/**
 * Where `withSession` and the Google return page send a signed-in person who has no account yet
 * (see `lib/notice-gate.ts`). It decides, in a route handler because it may need to write a cookie:
 *  - nothing to agree to (an account exists, or they just agreed): straight on to `next`;
 *  - not invited (the pilot-access check): the "not invited" page, before they are asked anything;
 *  - they came through the sign-up form (they have a password, so the form already recorded the
 *    acknowledgement): keep a proof and go on to `next`;
 *  - otherwise, or when anything cannot be read: the "One Last Step" page, with `next` carried.
 * It only ever moves the person on; it creates no account and records no agreement.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const origin = requestOrigin(request);
  const next = safeReturnPath(new URL(request.url).searchParams.get('next'));
  const go = (path: string) => NextResponse.redirect(new URL(path, origin));
  const toPage = () => go(`/auth/accept-terms?next=${encodeURIComponent(next)}`);

  const { requestSessionReader } = await import('../../../lib/neon-request-session');
  const { data } = await requestSessionReader().getSession();
  const user = data?.user;
  if (!user?.id) return go(`/auth/sign-in?next=${encodeURIComponent('/auth/notice-check')}`);
  if (!user.emailVerified) return go('/auth/verify-email');

  try {
    const { mustAgree, allowed } = await withPublicDb(async (db) => ({
      mustAgree: await mustAcknowledgeNotices(db, { id: user.id, email: user.email }),
      allowed: (await checkPilotAccess(db, { email: user.email })).allowed,
    }));
    if (!mustAgree) return go(next);
    // Someone who may not get an account is told so now, not after being asked to agree.
    if (!allowed) return go('/pilot-access-denied');
    if (await signsInWithPassword()) {
      if (await markNoticesSettled(user.id)) return go(next);
    }
  } catch (error) {
    reportServerError('noticeCheck', error, { step: 'decide' });
  }
  return toPage();
}
