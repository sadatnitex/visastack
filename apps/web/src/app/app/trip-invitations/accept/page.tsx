import {
  COMPANION_SHARE_LEVEL_LABELS,
  type CompanionShareLevel,
  getConsents,
  listMyCompanionTrips,
  previewCompanionInvitation,
  tripCompanionsEnabled,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { DestinationLabel } from '../../../../components/destination-label';
import { PageHeader } from '../../../../components/ui';
import { formatTimestampDate } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';
import {
  AcceptTripInvitationForm,
  DeclineTripInvitationForm,
  type ShareChoice,
} from './accept-form';
import { CoreConsentStep } from './core-consent';
import { networkLimited } from './network-limit';
import { INVITATION_BUSY, INVITATION_UNAVAILABLE } from './words';

export const metadata: Metadata = {
  title: 'Join a Trip',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** What the organiser then sees, one line each. The first is the smallest and is chosen already. */
const SHARE_LINES: Readonly<Record<CompanionShareLevel, string>> = {
  NAME_ONLY: 'The organiser sees your name and that you joined.',
  PLAN_STATUS: 'Also one plain phrase about your own case for this trip, such as Getting Ready.',
  TRAVEL_BOOKINGS: 'Also the names of booking and itinerary papers you choose to add to the trip.',
};
const choiceFor = (value: CompanionShareLevel): ShareChoice => ({
  value,
  label: COMPANION_SHARE_LEVEL_LABELS[value],
  line: SHARE_LINES[value],
});

function Shell({ children }: { readonly children: ReactNode }) {
  return <section className="section container">{children}</section>;
}

/**
 * Every bad invitation looks exactly like this: no reason, and nothing about any address or
 * account. The sign-in link keeps the way back to this page for someone who has the wrong account
 * open. It carries the link's token only when it has the shape of one.
 */
function Unavailable({ token, busy = false }: { readonly token: string; readonly busy?: boolean }) {
  const back = TOKEN_SHAPE.test(token)
    ? `/auth/sign-in?next=${encodeURIComponent(`/app/trip-invitations/accept?token=${token}`)}`
    : '/auth/sign-in';
  return (
    <Shell>
      <PageHeader title="Invitation Unavailable" />
      <article className="card">
        <p className="u-m-0">{busy ? INVITATION_BUSY : INVITATION_UNAVAILABLE}</p>
        <p className="muted u-m-0">
          Ask the person who invited you for a new link, or sign in with the email address they
          used.
        </p>
        <div className="companion-actions">
          <Link className="btn btn-secondary" href={back}>
            Sign In with the Invited Email
          </Link>
          <Link href="/app">Go to Home</Link>
        </div>
      </article>
    </Shell>
  );
}

/** What a person sees after answering; the invitation itself is gone, so no token is in the address. */
async function answered(done: 'joined' | 'declined') {
  if (done === 'declined') {
    return (
      <Shell>
        <PageHeader title="Invitation Declined" />
        <article className="card">
          <p className="u-m-0">You did not join the trip. Nothing was shared.</p>
          <Link href="/app">Go to Home</Link>
        </article>
      </Shell>
    );
  }
  const trip = await withSession(async ({ db, accountId }) =>
    (await listMyCompanionTrips(db, accountId)).find((t) => t.standing === 'JOINED'),
  );
  if (!trip) return <Unavailable token="" />;
  return (
    <Shell>
      <PageHeader title="You Joined the Trip" description={trip.title} />
      <article className="card">
        <p className="u-m-0">
          Your name now shows to others on this trip. Nobody gets access to anyone&apos;s documents.
        </p>
        <div className="companion-actions">
          <Link className="btn btn-primary" href="/app/trips">
            My Trips
          </Link>
        </div>
      </article>
    </Shell>
  );
}

/**
 * UMPE UX6: the page an invitation link opens. Opening it only shows the trip basics to the person
 * the invitation was sent to; joining and declining are confirmed answers from the forms below
 * (never this page). A 404 while the feature is off.
 */
export default async function TripInvitationPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly token?: string; readonly done?: string }>;
}) {
  if (!tripCompanionsEnabled()) notFound();
  const { token = '', done } = await searchParams;
  if (done === 'joined' || done === 'declined') return answered(done);
  return withSession(async ({ db, accountId }) => {
    if (await networkLimited(db)) return <Unavailable token={token} busy />;
    const result = await previewCompanionInvitation(db, { accountId, rawToken: token });
    if (!result.ok)
      return <Unavailable token={token} busy={result.error.code === 'rate_limited'} />;
    const invite = result.value;
    const consent = await getConsents(db, accountId);
    return (
      <Shell>
        <PageHeader
          title="Join a Trip"
          description="Someone added you to a trip on VisaStack. Opening this page joins nothing."
        />
        <article className="card">
          <dl className="rows">
            <div className="row">
              <dt>Trip</dt>
              <dd>{invite.title}</dd>
            </div>
            <div className="row">
              <dt>Where</dt>
              <dd>
                <DestinationLabel destination={invite.destination} />
              </dd>
            </div>
            <div className="row">
              <dt>Why</dt>
              <dd>{invite.purpose}</dd>
            </div>
            <div className="row">
              <dt>Invitation Ends</dt>
              <dd>{formatTimestampDate(invite.expiresAt)}</dd>
            </div>
          </dl>
          <p className="u-m-0">
            Joining shows your name to others on this trip. Nobody gets access to anyone&apos;s
            documents.
          </p>
          {consent.CORE_PROCESSING ? (
            <AcceptTripInvitationForm
              token={token}
              defaultName={invite.displayName}
              first={choiceFor('NAME_ONLY')}
              more={[choiceFor('PLAN_STATUS'), choiceFor('TRAVEL_BOOKINGS')]}
            />
          ) : (
            <>
              <CoreConsentStep />
              <p className="muted u-m-0">
                Turn on the consent above to continue.{' '}
                <Link href="/privacy">Read the Privacy Policy</Link>.
              </p>
            </>
          )}
          <DeclineTripInvitationForm token={token} />
        </article>
      </Shell>
    );
  });
}
