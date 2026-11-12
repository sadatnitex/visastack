import { formatDate } from '@visastack/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DestinationLabel } from '../../../../components/destination-label';
import { SearchableList } from '../../../../components/list-pattern';
import { PageHeader } from '../../../../components/ui';
import { AboutDisclosure } from '../../../../components/ui-lift';
import { appTripsCatalog } from '../../../../i18n/app-trips';
import { getServerT, primeLocale } from '../../../../lib/i18n-server';
import { withSession } from '../../../../lib/session';
import { loadJoinedTrips, loadTripList } from '../trip-data';

export const metadata: Metadata = { title: 'Group Trips' };

export const dynamic = 'force-dynamic';

/** One group trip in the list: its name and how many travellers it holds. */
function TripItem({
  trip,
}: {
  readonly trip: { readonly id: string; readonly title: string; readonly travellerCount: number };
}) {
  const t = getServerT(appTripsCatalog);
  return (
    <li>
      <Link href={`/app/trips/${trip.id}`}>{trip.title}</Link>{' '}
      <span className="muted u-fs-085">
        {trip.travellerCount === 1
          ? t.node('appTrips.appTripsPage.1Traveller')
          : t.node('appTrips.appTripsPage.travellercountTravellers', {
              travellerCount: trip.travellerCount,
            })}
      </span>
    </li>
  );
}

/** UMPE P5: the account holder's group trips. */
export default async function TripsPage() {
  const locale = await primeLocale();
  const t = getServerT(appTripsCatalog);
  const { list, joined } = await withSession(async ({ db, accountId }) => ({
    list: await loadTripList(db, accountId),
    // Empty unless travelling with someone else is on and this account joined a trip or was invited.
    joined: await loadJoinedTrips(db, accountId),
  }));
  const { trips, hasTravellers } = list;
  return (
    <>
      <PageHeader
        title={t('appTrips.appTripsPage.groupTrips')}
        actions={
          hasTravellers ? (
            <Link className="btn btn-primary" href="/app/trips/new">
              {t.node('appTrips.appTripsPage.startAGroupTrip')}
            </Link>
          ) : null
        }
      />
      <AboutDisclosure summary={t('appTrips.appTripsPage.aboutGroupTrips')}>
        <p>{t.node('appTrips.appTripsPage.planOneTripForSeveralTravellers')}</p>
      </AboutDisclosure>
      <article className="card">
        {trips.length > 0 ? (
          <SearchableList
            items={trips.map((trip) => ({
              id: trip.id,
              text: trip.title,
              node: <TripItem trip={trip} />,
            }))}
            noun={{ one: 'trip', other: 'trips' }}
            searchLabel="Search Group Trips"
            resultsTag="ul"
            resultsClassName="trip-list"
          >
            <ul className="trip-list">
              {trips.map((trip) => (
                <TripItem key={trip.id} trip={trip} />
              ))}
            </ul>
          </SearchableList>
        ) : hasTravellers ? (
          <p className="u-m-0">{t.node('appTrips.appTripsPage.noGroupTripsYet')}</p>
        ) : (
          <p className="u-m-0">
            Add a traveller first, then start a trip. <Link href="/app">Go to Home</Link>
          </p>
        )}
      </article>
      {joined.length > 0 ? (
        <section className="card trip-section" aria-labelledby="trips-joined-title">
          <h2 id="trips-joined-title" className="card-title">
            {t.node('appTrips.appTripsPage.tripsYouJoined')}
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
                  <DestinationLabel destination={trip.destination} />
                  {trip.joined
                    ? ''
                    : t.node('appTrips.appTripsPage.invitationEndsFormattimestampdateOpenTheLink', {
                        formatTimestampDate: formatDate(new Date(trip.endsAt), locale, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        }),
                      })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
