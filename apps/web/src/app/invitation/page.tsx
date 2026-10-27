import type { Metadata } from 'next';
import Link from 'next/link';
import { clientInvitationTerms } from '../../lib/client-invitation-terms';
import { loadClientInvitationPage } from '../../lib/invitation-preview';
import {
  AgencyNotReviewed,
  BusyInvitation,
  ClientInvitationOffer,
  ClosedInvitation,
} from './client-invitation-offer';

export const metadata: Metadata = {
  title: 'Your Invitation',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

/**
 * A public account handoff. A team or sharing invitation shows only the generic handoff. A client
 * invitation (growth loop 1, Option B) first names the agency and shows the terms, read by the link's
 * own token and counted per network address; a link that is no longer open says so in one neutral way,
 * and if the lookup cannot be made it falls back to the generic handoff. Opening a link never accepts
 * anything: acceptance remains behind sign-in and the authenticated service checks.
 */
export default async function InvitationPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly kind?: string; readonly token?: string }>;
}) {
  const { kind, token } = await searchParams;
  if (
    !['team', 'client', 'sharing'].includes(kind ?? '') ||
    !token ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  ) {
    return (
      <section className="section container">
        <h1 className="section-title">Incomplete Invitation Link</h1>
        <p>Ask the person who invited you for a new link.</p>
      </section>
    );
  }
  const path =
    kind === 'team'
      ? '/app/invitations/accept'
      : kind === 'sharing'
        ? '/app/sharing-invitations/accept'
        : '/app/client-invitations/accept';
  const next = encodeURIComponent(`${path}?token=${token}`);
  if (kind === 'client') {
    const page = await loadClientInvitationPage(token);
    if (page.state === 'closed') return <ClosedInvitation />;
    if (page.state === 'busy') return <BusyInvitation />;
    if (page.state === 'open') {
      if (!page.view.verified) return <AgencyNotReviewed agencyName={page.view.agencyName} />;
      const terms = clientInvitationTerms(page.view.grantActions);
      if (terms)
        return <ClientInvitationOffer view={page.view} terms={terms} token={token} next={next} />;
    }
  }
  return (
    <section className="section container">
      <span className="eyebrow">VisaStack Invitation</span>
      <h1 className="section-title">
        {kind === 'team'
          ? 'Join an Agency Team'
          : kind === 'sharing'
            ? 'Review Shared Access'
            : 'Work with an Agency'}
      </h1>
      <ol className="auth-steps" aria-label="What happens next">
        <li aria-current="step">1 Create an account or sign in</li>
        <li>2 Review</li>
        <li>3 You decide</li>
      </ol>
      <article className="card">
        <p className="card-body">
          <strong>Opening the link does not accept it.</strong>
        </p>
        <p className="card-body">Create an account or sign in to review this invitation.</p>
        <p className="card-body">
          {kind === 'team'
            ? 'Use the email address that received the invitation. You will see the agency and your role before joining.'
            : kind === 'sharing'
              ? 'Use the email address that received this invitation. Review the purpose, permissions and expiry before accepting. No access is active until you agree.'
              : 'Use the email address that received this invitation. You will see the agency and requested access, choose your own profile and confirm sharing before connecting.'}
        </p>
        <div className="action-row">
          <Link className="btn btn-primary" href={`/auth/sign-up?next=${next}`}>
            Create an Account
          </Link>
          <Link className="btn btn-secondary" href={`/auth/sign-in?next=${next}`}>
            Sign In
          </Link>
        </div>
        <p className="card-body">
          Already signed in?{' '}
          {kind === 'team' ? (
            <Link href={`/app/invitations/accept?token=${token}`}>Review Your Invitation</Link>
          ) : kind === 'sharing' ? (
            <Link href={`/app/sharing-invitations/accept?token=${token}`}>
              Review Your Invitation
            </Link>
          ) : (
            <Link href={`/app/client-invitations/accept?token=${token}`}>
              Review Your Invitation
            </Link>
          )}
        </p>
        <p className="muted">
          If you need to reset your password, return to this invitation link afterwards.
        </p>
        <p className="muted">
          Invitations expire after 7 days. If this one has expired or was revoked, ask the sender
          for a new invitation.
        </p>
      </article>
    </section>
  );
}
