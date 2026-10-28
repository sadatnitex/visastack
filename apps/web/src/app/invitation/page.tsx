import type { Metadata } from 'next';
import Link from 'next/link';
import { clientInvitationTerms } from '../../lib/client-invitation-terms';
import { loadClientInvitationPage } from '../../lib/invitation-preview';
import { INVITATION_TOKEN_PATTERN } from '../../lib/invitation-token';
import { isSignedIn } from '../../lib/signed-in';
import { type InvitationKind, isInvitationKind } from './accept-paths';
import {
  AgencyNotReviewed,
  ClientInvitationOffer,
  ClosedInvitation,
  InvitationActions,
  InvitationHelp,
  InvitationMessage,
  InvitationReassurance,
  InvitationSteps,
} from './client-invitation-offer';

export const metadata: Metadata = {
  title: 'Your Invitation',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

/** What each kind of invitation says in its hero and in its list of what to expect. */
const HANDOFF: Readonly<
  Record<
    InvitationKind,
    { readonly title: string; readonly promise: string; readonly expect: readonly string[] }
  >
> = {
  team: {
    title: 'Join an Agency Team',
    promise: 'An agency invited you to join their team on VisaStack.',
    expect: ['You will see the agency and your role before joining.'],
  },
  sharing: {
    title: 'Review Shared Access',
    promise: 'You were invited to access part of a VisaStack profile.',
    expect: [
      'Review the purpose, permissions and expiry before accepting.',
      'No access is active until you agree.',
    ],
  },
  client: {
    title: 'Work with an Agency',
    promise: 'An agency wants to work on your visa case with you.',
    expect: [
      'You will see the agency and the access they ask for.',
      'You choose your own profile and confirm sharing before connecting.',
    ],
  },
};

/**
 * A public account handoff. A team or sharing invitation shows only the generic handoff. A client
 * invitation (growth loop 1, Option B) first names the agency and shows the terms, read by the link's
 * own token and counted per network address; a link that is no longer open says so in one neutral way.
 * If the lookup cannot be made, or this address has already looked at a great many links this hour,
 * it falls back to the generic handoff, which says nothing about the link. Opening a link never
 * accepts anything: acceptance remains behind sign-in and the authenticated service checks.
 */
export default async function InvitationPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly kind?: string; readonly token?: string }>;
}) {
  const { kind, token } = await searchParams;
  if (!isInvitationKind(kind) || !token || !INVITATION_TOKEN_PATTERN.test(token)) {
    return (
      <InvitationMessage
        title="Incomplete Invitation Link"
        sentence="Ask the person who invited you for a new link."
        action={
          <Link className="btn btn-secondary" href="/">
            Go to the Home Page
          </Link>
        }
      />
    );
  }
  // The session is read alongside the lookup, and once per request (the layout asks too).
  const [page, signedIn] = await Promise.all([
    kind === 'client' ? loadClientInvitationPage(token) : null,
    isSignedIn(),
  ]);
  if (page?.state === 'closed') return <ClosedInvitation />;
  if (page?.state === 'open') {
    if (!page.view.verified) return <AgencyNotReviewed agencyName={page.view.agencyName} />;
    const terms = clientInvitationTerms(page.view.grantActions);
    if (terms) {
      return (
        <ClientInvitationOffer
          view={page.view}
          terms={terms}
          token={token}
          now={new Date()}
          signedIn={signedIn}
        />
      );
    }
  }
  const copy = HANDOFF[kind];
  return (
    <section className="section container invitation-page">
      <div className="invitation-hero">
        <span className="eyebrow">VisaStack Invitation</span>
        <h1 className="section-title invitation-title">{copy.title}</h1>
        <p className="invitation-promise">{copy.promise}</p>
        <InvitationActions kind={kind} token={token} signedIn={signedIn} />
        <InvitationReassurance />
      </div>
      <InvitationSteps signedIn={signedIn} />
      <div className="invitation-details">
        <section className="invitation-control" aria-labelledby="invitation-expect-title">
          <h2 className="card-title" id="invitation-expect-title">
            What to Expect
          </h2>
          <ul className="invitation-list">
            {copy.expect.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        <InvitationHelp kind={kind} token={token} signedIn={signedIn} />
        <p className="invitation-legal">
          Invitations expire after 7 days. If this one has expired or was revoked, ask the sender
          for a new invitation.
        </p>
      </div>
    </section>
  );
}
