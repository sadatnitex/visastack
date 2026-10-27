import type { PublicClientInvitationView } from '@visastack/services';
import Link from 'next/link';
import { InvitingAgency } from '../../components/inviting-agency';
import {
  type ClientInvitationTerms,
  formatInvitationExpiry,
} from '../../lib/client-invitation-terms';

/**
 * What a traveller sees, before signing in or creating an account, when an agency VisaStack has
 * reviewed has invited them
 * (growth loop 1, Option B): who is asking and what they would get, in plain words. Every figure and
 * sentence comes from the real invitation and the real access it gives; nothing here accepts
 * anything, and it carries nothing about the person invited.
 */
export function ClientInvitationOffer({
  view,
  terms,
  token,
  next,
}: {
  readonly view: PublicClientInvitationView;
  readonly terms: ClientInvitationTerms;
  readonly token: string;
  /** The already-encoded address to return to after signing in. */
  readonly next: string;
}) {
  const logoUrl =
    view.logoVersion === null
      ? null
      : `/invitation/logo?token=${encodeURIComponent(token)}&v=${encodeURIComponent(view.logoVersion)}`;
  return (
    <section className="section container">
      <span className="eyebrow">VisaStack Invitation</span>
      <h1 className="section-title">{view.agencyName} Invited You</h1>
      <ol className="auth-steps" aria-label="What happens next">
        <li aria-current="step">1 Create an account or sign in</li>
        <li>2 Review</li>
        <li>3 You decide</li>
      </ol>
      <article className="card invitation-offer">
        <p className="card-body">
          <strong>Opening the link does not accept it.</strong>
        </p>
        <InvitingAgency name={view.agencyName} accentColor={view.accentColor} logoUrl={logoUrl} />
        <p className="card-body">
          An administrator at {view.agencyName} invited you to share part of your VisaStack record
          with them, so they can work on a visa case with you.
        </p>

        <h2 className="card-title">What {view.agencyName} Could Do</h2>
        <p className="card-body">If you accept, they could:</p>
        <ul className="invitation-terms-list">
          {terms.agencyCan.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
        {terms.agencyCannot ? <p className="card-body">{terms.agencyCannot}</p> : null}

        <h2 className="card-title">What You Control</h2>
        <ul className="invitation-terms-list">
          <li>You choose which of your profiles this applies to, or start a new one.</li>
          <li>Nothing is shared until you accept.</li>
          <li>You can stop sharing at any time.</li>
          <li>
            This invitation expires on{' '}
            <time dateTime={view.expiresAt.toISOString()}>
              {formatInvitationExpiry(view.expiresAt)}
            </time>
            .
          </li>
        </ul>
        <p className="card-body">
          A complete checklist, or a file marked ready, is not an approval. Only the embassy or visa
          office decides.
        </p>

        <p className="card-body">
          Create an account or sign in to review this invitation. Use the email address that
          received it.
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
          <Link href={`/app/client-invitations/accept?token=${token}`}>Review Your Invitation</Link>
        </p>
        <p className="muted">
          If you need to reset your password, return to this invitation link afterwards.
        </p>
      </article>
    </section>
  );
}

/**
 * An invitation from an agency VisaStack has not finished reviewing. An invitation cannot be accepted
 * until that review is done, so the page says so instead of sending the traveller through sign-up to a
 * refusal. It names the agency but gives it no logo or colour and none of the look of a reviewed one.
 * The link stays good, so it works once the review is complete.
 */
export function AgencyNotReviewed({ agencyName }: { readonly agencyName: string }) {
  return (
    <section className="section container">
      <span className="eyebrow">VisaStack Invitation</span>
      <h1 className="section-title">This Agency Is Still Being Reviewed</h1>
      <article className="card">
        <p className="card-body">
          <strong>{agencyName}</strong> invited you to work together on VisaStack. VisaStack has not
          finished reviewing them, so you cannot accept yet.
        </p>
        <p className="card-body">
          Nothing has been shared. Ask {agencyName} to tell you when their review is complete, then
          open this link again.
        </p>
      </article>
    </section>
  );
}

/** The same page for a link that is unknown, expired, withdrawn or already used: nothing tells them apart. */
export function ClosedInvitation() {
  return (
    <section className="section container">
      <h1 className="section-title">This Invitation Is No Longer Open</h1>
      <article className="card">
        <p className="card-body">
          It may have expired, been withdrawn or already been used. Ask the agency that invited you
          to send a new one.
        </p>
        <p className="card-body">
          Already signed in? <Link href="/app">Go to Workspace</Link>
        </p>
      </article>
    </section>
  );
}

/** Shown when one connection has opened a great many invitation links in an hour. */
export function BusyInvitation() {
  return (
    <section className="section container">
      <h1 className="section-title">Please Try Again Shortly</h1>
      <article className="card">
        <p className="card-body">
          Too many invitation links were opened from your connection in the last hour. Wait a few
          minutes, then open your link again.
        </p>
      </article>
    </section>
  );
}
