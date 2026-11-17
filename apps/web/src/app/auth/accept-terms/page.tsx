import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { primeLocale } from '../../../lib/i18n-server';
import { safeReturnPath } from '../../../lib/neon-recency';
import { acceptNoticesAction } from '../actions';
import { AuthShell, ErrorLine } from '../auth-ui';

export const metadata: Metadata = { title: 'One Last Step' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  notices: 'Read and acknowledge the terms and privacy notice to continue.',
  failed: 'We could not save your agreement. Please try again in a moment.',
};

/**
 * "One last step": a person who signed in with Google agrees to the terms of use and the privacy
 * notice before an account is created for them. `withSession` sends them here (through `/auth/notice-check`) at the
 * moment an account would be created (see `lib/notice-gate.ts`); nobody else ever sees it. A person who has
 * nothing to agree to (an account exists, or they came through the sign-up form, or they already
 * agreed) is sent straight on, so the page can be opened at any time without harm.
 */
export default async function AcceptTermsPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; next?: string }> }) {
  await primeLocale();
  const { e, next } = await searchParams;
  const destination = safeReturnPath(next);
  const { requestSessionReader } = await import('../../../lib/neon-request-session');
  const { data } = await requestSessionReader().getSession();
  const user = data?.user;
  if (!user?.id) redirect('/auth/sign-in?next=%2Fauth%2Faccept-terms');
  if (!user.emailVerified) redirect('/auth/verify-email');

  const { mustAcknowledgeNotices } = await import('../../../lib/notice-gate');
  const { checkPilotAccess } = await import('../../../lib/pilot-access');
  const { withPublicDb } = await import('../../../lib/public-db');
  // When the check cannot be made the form is shown (a tick is only ever asked once more).
  let state: { needed: boolean; allowed: boolean };
  try {
    state = await withPublicDb(async (db) => ({
      needed: await mustAcknowledgeNotices(db, { id: user.id, email: user.email }),
      allowed: (await checkPilotAccess(db, { email: user.email })).allowed,
    }));
  } catch {
    state = { needed: true, allowed: true };
  }
  if (!state.needed) redirect(destination);
  if (!state.allowed) redirect('/pilot-access-denied');

  const error = e ? ERRORS[e] : undefined;
  return (
    <AuthShell title="One Last Step">
      <div lang="en">
        <p className="card-body">
          You are signed in. Before your VisaStack account is created, please read and agree to the
          terms of use and the privacy notice. Nothing is saved to an account until you do.
        </p>
        <ErrorLine id="notices-error" message={error} />
        <div className="card u-mb-100">
          <form action={acceptNoticesAction} className="field-list">
            <input type="hidden" name="next" value={destination} />
            <label className="card-body signup-consent" htmlFor="accept-notices">
              <input
                id="accept-notices"
                type="checkbox"
                name="acceptNotices"
                value="yes"
                required
              />{' '}
              I agree to the <Link href="/terms">terms of use</Link> and acknowledge the{' '}
              <Link href="/privacy">privacy notice</Link>.
            </label>
            <button type="submit" className="btn btn-primary">
              Agree and Continue
            </button>
          </form>
        </div>
        <p className="card-body signup-notice-note">
          Agreeing does not turn on marketing. Your agreement is kept with the version of the
          notices you saw.
        </p>
      </div>
    </AuthShell>
  );
}
