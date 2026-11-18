import { formatDate } from '@visastack/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CountryFlag } from '../../../../components/country-flag';
import { DestinationLabel, destinationFlagCode } from '../../../../components/destination-label';
import { SearchableList } from '../../../../components/list-pattern';
import { EmptyState, PageHeader } from '../../../../components/ui';
import { AboutDisclosure } from '../../../../components/ui-lift';
import { appTripsCatalog } from '../../../../i18n/app-trips';
import { getServerT, primeLocale } from '../../../../lib/i18n-server';
import { withSession } from '../../../../lib/session';
import { AreaPicture, TravellerRow } from '../../u7-rows';
import { loadJoinedTrips, loadTripList } from '../trip-data';

export const metadata: Metadata = { title: 'Group Trips' };

export const dynamic = 'force-dynamic';

/** The picture of a trip: the flag of its country when one is known, otherwise a plane. */
function TripPicture({ destination }: { readonly destination: string }) {
  const iso2 = destinationFlagCode(destination);
  return iso2 ? (
    <CountryFlag iso2={iso2} name={destination} size="lg" decorative />
  ) : (
    <AreaPicture mark={{ icon: 'plane', tone: 'blue' }} />
  );
}

/** One group trip in the list: its name, where it goes and how many travellers it holds. */
function TripItem({
  trip,
}: {
  readonly trip: {
    readonly id: string;
    readonly title: string;
    readonly destination: string;
    readonly travellerCount: number;
  };
}) {
  const t = getServerT(appTripsCatalog);
  return (
    <li>
      <TravellerRow
        headingLevel={2}
        href={`/app/trips/${trip.id}`}
        title={trip.title}
        picture={<TripPicture destination={trip.destination} />}
        chip={{
          label:
            trip.travellerCount === 1
              ? t.node('appTrips.appTripsPage.1Traveller')
              : t.node('appTrips.appTripsPage.travellercountTravellers', {
                  travellerCount: trip.travellerCount,
                }),
          tone: 'neutral',
        }}
        meta={<DestinationLabel destination={trip.destination} />}
      />
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
            resultsClassName="trip-list u7-rows u7-list"
          >
            <ul className="trip-list u7-rows u7-list">
              {trips.map((trip) => (
                <TripItem key={trip.id} trip={trip} />
              ))}
            </ul>
          </SearchableList>
        ) : hasTravellers ? (
          <EmptyState
            icon="plane"
            title={t('appTrips.appTripsPage.noGroupTripsYet')}
            action={{ href: '/app/trips/new', label: t('appTrips.appTripsPage.startAGroupTrip') }}
          >
            {t.node('appTrips.appTripsPage.planOneTripForSeveralTravellers')}
          </EmptyState>
        ) : (
          <EmptyState
            icon="plane"
            title="No Group Trips Yet"
            action={{ href: '/app', label: 'Go to Home' }}
          >
            Add a traveller first, then start a trip.
          </EmptyState>
        )}
      </article>
      {joined.length > 0 ? (
        <section className="card trip-section" aria-labelledby="trips-joined-title">
          <h2 id="trips-joined-title" className="card-title">
            {t.node('appTrips.appTripsPage.tripsYouJoined')}
          </h2>
          <ul className="trip-list u7-rows u7-list">
            {joined.map((trip) => (
              <li key={trip.key}>
                <TravellerRow
                  headingLevel={3}
                  {...(trip.joined ? { href: `/app/trip-invitations/${trip.tripId}` } : {})}
                  title={trip.title}
                  picture={<TripPicture destination={trip.destination} />}
                  meta={
                    <>
                      <DestinationLabel destination={trip.destination} />
                      {trip.joined
                        ? ''
                        : t.node(
                            'appTrips.appTripsPage.invitationEndsFormattimestampdateOpenTheLink',
                            {
                              formatTimestampDate: formatDate(new Date(trip.endsAt), locale, {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              }),
                            },
                          )}
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
