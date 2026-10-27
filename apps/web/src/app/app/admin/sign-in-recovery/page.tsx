import { SIGN_IN_RECOVERY_WINDOW_DAYS, listSignInRecoveryRequests } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import {
  bootstrapAdminEmails,
  isPlatformOwnerAccount,
  staffPrincipal,
} from '../../../../lib/admin';
import { formatTimestampDate } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';
import { AdminRestricted } from '../admin-restricted';
import { ConnectSignInForm } from './forms';

export const metadata: Metadata = { title: 'Sign-In Recovery' };

export const dynamic = 'force-dynamic';

/**
 * Older accounts (made before the current sign-in service) whose holder recently created a new
 * sign-in with the same confirmed email. VisaStack never joins the two by email alone; staff check
 * with the person and connect them here.
 */
export default async function SignInRecoveryPage() {
  const access = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'ACCOUNT_SIGN_IN_RECOVERY',
    );
    if (!staff.ok) return null;
    const [requests, owner] = await Promise.all([
      listSignInRecoveryRequests(db, staff.value),
      isPlatformOwnerAccount(db, { accountId, email }),
    ]);
    return { requests, owner };
  });
  if (!access) return <AdminRestricted />;
  const { requests: result, owner } = access;
  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform Operations"
        title="Sign-In Recovery"
        description="People whose account was made before the current sign-in and who have since created a new sign-in with the same confirmed email. Check with each person before connecting."
      />
      {!result.ok ? (
        <p className="notice notice-warn">This list could not be loaded. Try again in a moment.</p>
      ) : result.value.length === 0 ? (
        <article className="card">
          <p className="card-body">
            Nobody is waiting. When someone with an older account creates a new sign-in, they appear
            here for {SIGN_IN_RECOVERY_WINDOW_DAYS} days.
          </p>
        </article>
      ) : (
        <div className="rows">
          {result.value.map((request) => (
            <article className="card" key={request.accountId}>
              <h2 className="card-title">{request.email}</h2>
              <p className="card-body">
                Account made {formatTimestampDate(request.joinedAt)}, last used{' '}
                {formatTimestampDate(request.lastActiveAt)}. New sign-in tried{' '}
                {formatTimestampDate(request.requestedAt)}.
              </p>
              {request.ambiguous ? (
                <p className="notice notice-warn">
                  More than one new sign-in tried to reach this account in the last{' '}
                  {SIGN_IN_RECOVERY_WINDOW_DAYS} days, so it cannot be connected safely here. Check
                  with the person which sign-in is theirs and verify them another way.
                </p>
              ) : request.holdsPlatformRole && !owner ? (
                <p className="notice notice-warn">
                  This account holds a platform role. Only a platform owner can connect it.
                </p>
              ) : (
                <ConnectSignInForm accountId={request.accountId} email={request.email} />
              )}
            </article>
          ))}
        </div>
      )}
      <p>
        <Link href="/app/admin/security">Back to Security &amp; Access</Link>
      </p>
    </section>
  );
}
