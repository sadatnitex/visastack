import type { Metadata } from 'next';
import { PageHeader } from '../../../../components/ui';
import { withSession } from '../../../../lib/session';
import { loadTripPage } from '../trip-data';
import { TripOverview } from '../trip-overview';

export const metadata: Metadata = { title: 'Group Trip' };

export const dynamic = 'force-dynamic';

/** What the page says after a change that removed the form it came from (fixed words only). */
const NOTICES: Readonly<Record<string, string>> = {
  added: 'Added to the trip, each with their own case.',
  removed: 'Removed from the trip. Their case is kept as it is.',
  shared: 'Added to the trip. Choose who it may be used for.',
  unshared: 'No longer shared across the trip. The document stays in its own place.',
  partial:
    'The trip was started, but not everyone could be added. Add the others below, or check their profile first.',
  'added-someone': 'Added to the trip.',
  'removed-someone': 'Removed from the trip.',
  'not-sent':
    'Added to the trip, but the invitation could not be sent just now. Try Send Again beside their name.',
  'partial-someone':
    'The trip was started, but the person you added could not be added. Try Add Someone Else below.',
};

/** UMPE P5: one group trip, each traveller's readiness and their one next action. */
export default async function GroupTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string | string[] }>;
}) {
  const { id } = await params;
  const { done } = await searchParams;
  const notice = typeof done === 'string' ? NOTICES[done] : undefined;
  const data = await withSession(({ db, accountId }) => loadTripPage(db, accountId, id));
  // The layout already answered 404 for a missing trip; this covers one removed in between.
  if (!data) return <p>This trip is not available.</p>;
  return (
    <>
      <PageHeader
        title={data.title}
        description={`${data.destination} for ${data.purpose}.`}
        back={{ href: '/app/trips', label: 'Group Trips' }}
      />
      {notice ? <output className="trip-notice">{notice}</output> : null}
      <TripOverview
        tripId={data.id}
        travellers={data.travellers}
        sharedDocuments={data.sharedDocuments}
        addable={data.addable}
        documentOptions={data.documentOptions}
        companionsOn={data.companionsOn}
        companions={data.companions}
      />
    </>
  );
}
