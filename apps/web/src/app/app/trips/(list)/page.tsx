import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { AboutDisclosure } from '../../../../components/ui-lift';
import { formatTimestampDate } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';
import { loadJoinedTrips, loadTripList } from '../trip-data';

export const metadata: Metadata = { title: 'Group Trips' };

export const dynamic = 'force-dynamic';

/** UMPE P5: the account holder's group trips. */
export default async function TripsPage() {
  const { list, joined } = await withSession(async ({ db, accountId }) => ({
    list: await loadTripList(db, accountId),
    // Empty unless travelling with someone else is on and this account joined a trip or was invited.
    joined: await loadJoinedTrips(db, accountId),
  }));
  const { trips, hasTravellers } = list;
  return (
    <>
      <PageHeader
        title="Group Trips"
        actions={
          hasTravellers ? (
            <Link className="btn btn-primary" href="/app/trips/new">
              Start a Group Trip
            </Link>
          ) : null
        }
      />
      <AboutDisclosure summary="About Group Trips">
        <p>
          Plan one trip for several travellers. Each traveller keeps their own case, documents and
          privacy.
        </p>
      </AboutDisclosure>
      <article className="card">
        {trips.length > 0 ? (
          <ul className="trip-list">
            {trips.map((trip) => (
              <li key={trip.id}>
                <Link href={`/app/trips/${trip.id}`}>{trip.title}</Link>{' '}
                <span className="muted u-fs-085">
                  {trip.travellerCount === 1 ? '1 Traveller' : `${trip.travellerCount} Travellers`}
                </span>
              </li>
            ))}
          </ul>
        ) : hasTravellers ? (
          <p className="u-m-0">No group trips yet.</p>
        ) : (
          <p className="u-m-0">
            Add a traveller first, then start a trip. <Link href="/app">Go to Home</Link>
          </p>
        )}
      </article>
      {joined.length > 0 ? (
        <section className="card trip-section" aria-labelledby="trips-joined-title">
          <h2 id="trips-joined-title" className="card-title">
            Trips You Joined
          </h2>
          <ul className="trip-list">
            {joined.map((trip) => (
              <li key={trip.key}>
                {trip.joined ? (
                  <Link href={`/app/trip-invitations/${trip.tripId}`}>{trip.title}</Link>
                ) : (
                  <span>{trip.title}</span>
                )}{' '}
                <span className="muted u-fs-085">
                  {trip.destination}
                  {trip.joined
                    ? ''
                    : `. Invitation ends ${formatTimestampDate(trip.endsAt)}. Open the link in your email to answer.`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
