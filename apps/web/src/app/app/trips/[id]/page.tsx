import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../components/ui';
import { withSession } from '../../../../lib/session';
import { loadTripPage } from '../trip-data';
import { TripOverview } from '../trip-overview';

export const metadata: Metadata = { title: 'Group Trip' };

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UMPE P5: one group trip, each traveller's readiness and their one next action. */
export default async function GroupTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await withSession(({ db, accountId }) => loadTripPage(db, accountId, id));
  if (!data) notFound();
  return (
    <>
      <PageHeader
        title={data.title}
        description={`${data.destination} for ${data.purpose}. Each traveller below has their own case.`}
        back={{ href: '/app/trips', label: 'Group Trips' }}
      />
      <TripOverview
        tripId={data.id}
        travellers={data.travellers}
        sharedDocuments={data.sharedDocuments}
        addable={data.addable}
        documentOptions={data.documentOptions}
      />
    </>
  );
}
