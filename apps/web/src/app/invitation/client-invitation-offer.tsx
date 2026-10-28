import type { PublicClientInvitationView } from '@visastack/services';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { Icon } from '../../components/icons';
import { InvitingAgency } from '../../components/inviting-agency';
import { StatusBadge } from '../../components/ui';
import {
  type ClientInvitationTerms,
  invitationExpiryBadge,
} from '../../lib/client-invitation-terms';
import { type InvitationKind, invitationAcceptHref, invitationReturnPath } from './accept-paths';
import { StickyInvitationActions } from './sticky-invitation-actions';
import { SwitchInvitationAccount } from './switch-account';

/**
 * The parts every open invitation page shares (UX-G): the hero with its main buttons, the three
 * steps on one line, and the help lines at the end. Each kind of invitation fills them with its own
 * words. Nothing on these pages accepts anything: acceptance stays behind sign-in and the checks of
 * the page each button leads to.
 */

/** The three steps, on one line, with the one the visitor is on marked for sight and for speech. */
export function InvitationSteps({ signedIn }: { readonly signedIn: boolean }) {
  const current = signedIn ? 1 : 0;
  return (
    <ol className="invitation-steps" aria-label="What Happens Next">
      {['Sign In', 'Review', 'Decide'].map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? 'step' : undefined}
          data-done={index < current ? 'true' : undefined}
        >
          <span className="invitation-step-mark" aria-hidden="true">
            {index < current ? <Icon name="check" size={14} /> : index + 1}
          </span>
          {step}
          {index < current ? <span className="sr-only"> (Done)</span> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * The main buttons, from the one table of accept pages: create an account or sign in (each returning
 * to this kind's review page), or, for a visitor already signed in, straight to the review, with a
 * quiet way to switch to the invited account.
 */
export function InvitationActions({
  kind,
  token,
  signedIn,
}: {
  readonly kind: InvitationKind;
  readonly token: string;
  readonly signedIn: boolean;
}) {
  const next = invitationReturnPath(kind, token);
  return (
    <>
      <StickyInvitationActions>
        {signedIn ? (
          <Link className="btn btn-primary" href={invitationAcceptHref(kind, token)}>
            Review Your Invitation
          </Link>
        ) : (
          <>
            <Link className="btn btn-primary" href={`/auth/sign-up?next=${next}`}>
              Create an Account to Review
            </Link>
            <Link className="btn btn-secondary" href={`/auth/sign-in?next=${next}`}>
              Sign In
            </Link>
          </>
        )}
      </StickyInvitationActions>
      {signedIn ? <SwitchInvitationAccount kind={kind} token={token} /> : null}
    </>
  );
}

/** The one quiet line under the main buttons. */
export function InvitationReassurance() {
  return (
    <p className="invitation-reassure">
      Opening this link accepts nothing. You decide after you review.
    </p>
  );
}

/**
 * Help at the end of the page: which email address to use, a way in for someone already signed in
 * (in case the page could not tell), and what to do after a password reset.
 */
export function InvitationHelp({
  kind,
  token,
  signedIn,
}: {
  readonly kind: InvitationKind;
  readonly token: string;
  readonly signedIn: boolean;
}) {
  return (
    <section className="invitation-help" aria-labelledby="invitation-help-title">
      <h2 className="card-title" id="invitation-help-title">
        Before You Start
      </h2>
      <ul className="invitation-list">
        {signedIn ? (
          <li>Use the email address that received this invitation.</li>
        ) : (
          <>
            <li>
              Create an account or sign in with the email address that received this invitation.
            </li>
            <li>
              Already signed in?{' '}
              <Link href={invitationAcceptHref(kind, token)}>Review Your Invitation</Link>
            </li>
          </>
        )}
        <li>If you reset your password, open this invitation link again afterwards.</li>
      </ul>
    </section>
  );
}

/** One fact per item, each with a small decorative mark: a tick for what is given, a cross for not. */
function MarkedList({
  items,
  mark,
}: {
  readonly items: readonly string[];
  readonly mark: 'check' | 'close';
}) {
  return (
    <ul className={`invitation-marked invitation-marked-${mark}`}>
      {items.map((item) => (
        <li key={item}>
          <Icon name={mark} size={18} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What a traveller sees, before signing in or creating an account, when an agency that VisaStack has
 * reviewed invites them (growth loop 1, Option B): who is asking and what they would get, in plain
 * words. Every figure and sentence comes from the real invitation and the real access it gives;
 * nothing here accepts anything, and it carries nothing about the person invited.
 */
export function ClientInvitationOffer({
  view,
  terms,
  token,
  now,
  signedIn = false,
}: {
  readonly view: PublicClientInvitationView;
  readonly terms: ClientInvitationTerms;
  readonly token: string;
  readonly now: Date;
  /** Whether the visitor already has a session; a failed check counts as signed out. */
  readonly signedIn?: boolean;
}) {
  const logoUrl =
    view.logoVersion === null
      ? null
      : `/api/branding/invitation-logo?token=${encodeURIComponent(token)}&v=${encodeURIComponent(view.logoVersion)}`;
  return (
    <section className="section container invitation-page invitation-offer">
      <div className="invitation-hero">
        <InvitingAgency name={view.agencyName} accentColor={view.accentColor} logoUrl={logoUrl} />
        <h1 className="section-title invitation-title">{view.agencyName} Invited You</h1>
        <p className="invitation-promise">
          {view.agencyName} wants to work on your visa case with you.
        </p>
        <p className="invitation-expiry">
          <StatusBadge tone="neutral">
            <time dateTime={view.expiresAt.toISOString()}>
              {invitationExpiryBadge(view.expiresAt, now)}
            </time>
          </StatusBadge>
        </p>
        <InvitationActions kind="client" token={token} signedIn={signedIn} />
        <InvitationReassurance />
      </div>
      <InvitationSteps signedIn={signedIn} />

      <div className="invitation-details">
        <p className="invitation-intro">
          An administrator at {view.agencyName} invited you to share part of your VisaStack record
          with them. If you accept:
        </p>
        <div className="invitation-terms">
          <section className="invitation-term" aria-labelledby="invitation-can-title">
            <h2 className="card-title" id="invitation-can-title">
              They Could
            </h2>
            <MarkedList items={terms.agencyCan} mark="check" />
          </section>
          {terms.withheld.length > 0 ? (
            <section className="invitation-term" aria-labelledby="invitation-cannot-title">
              <h2 className="card-title" id="invitation-cannot-title">
                They Could Not
              </h2>
              <MarkedList items={terms.withheld} mark="close" />
              <p className="invitation-term-note">
                Each of these would need a separate choice from you.
              </p>
            </section>
          ) : null}
        </div>

        <section className="invitation-control" aria-labelledby="invitation-control-title">
          <h2 className="card-title" id="invitation-control-title">
            You Stay in Control
          </h2>
          <ul className="invitation-list">
            <li>You choose which of your profiles this applies to, or start a new one.</li>
            <li>Nothing is shared until you accept.</li>
            <li>You can stop sharing at any time.</li>
          </ul>
        </section>

        <InvitationHelp kind="client" token={token} signedIn={signedIn} />

        <p className="invitation-legal">
          A complete checklist, or a file marked ready, is not an approval. Only the embassy or visa
          office decides.
        </p>
      </div>
    </section>
  );
}

/**
 * One state of a link that cannot go further: a title, one sentence, and at most one action, with
 * an optional quiet line after it. Used for the incomplete, closed and not-yet-reviewed pages.
 */
export function InvitationMessage({
  title,
  sentence,
  action,
  after,
}: {
  readonly title: string;
  readonly sentence: ReactNode;
  readonly action: ReactElement | null;
  readonly after?: ReactNode;
}) {
  return (
    <section className="section container invitation-page invitation-message">
      <span className="eyebrow">VisaStack Invitation</span>
      <h1 className="section-title invitation-title">{title}</h1>
      <p className="invitation-promise">{sentence}</p>
      {action ? <div className="invitation-actions">{action}</div> : null}
      {after ? <p className="invitation-reassure">{after}</p> : null}
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
    <InvitationMessage
      title="This Agency Is Still Being Reviewed"
      sentence={
        <>
          <strong>{agencyName}</strong> invited you to work together on VisaStack. VisaStack has not
          finished reviewing them, so you cannot accept yet.
        </>
      }
      action={null}
      after={`Nothing has been shared. Ask ${agencyName} to tell you when their review is complete, then open this link again.`}
    />
  );
}

/**
 * The same page for a link that is unknown, expired, withdrawn, already used or no longer acceptable:
 * nothing tells them apart. Someone who already accepted is pointed to their own workspace first,
 * because asking the agency again would only start a second case.
 */
export function ClosedInvitation() {
  return (
    <InvitationMessage
      title="This Invitation Is No Longer Open"
      sentence="It may have expired, been withdrawn or already been used."
      action={
        <Link className="btn btn-primary" href="/auth/sign-in?next=%2Fapp">
          Sign In
        </Link>
      }
      after="If you already accepted it, sign in to find your case. If not, ask the agency that invited you to send a new one."
    />
  );
}
