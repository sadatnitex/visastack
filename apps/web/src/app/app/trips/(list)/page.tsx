import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { withSession } from '../../../../lib/session';
import { loadTripList } from '../trip-data';

export const metadata: Metadata = { title: 'Group Trips' };

export const dynamic = 'force-dynamic';

/** UMPE P5: the account holder's group trips. */
export default async function TripsPage() {
  const { trips, hasTravellers } = await withSession(({ db, accountId }) =>
    loadTripList(db, accountId),
  );
  return (
    <>
      <PageHeader
        title="Group Trips"
        description="Plan one trip for several travellers. Each traveller keeps their own case, documents and privacy."
        actions={
          hasTravellers ? (
            <Link className="btn btn-primary" href="/app/trips/new">
              Start a Group Trip
            </Link>
          ) : null
        }
      />
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
    </>
  );
}
