import { listApplicants, tripTablesReady } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { caseCountryOptions, casePurposeGroups } from '../../../../lib/case-choices';
import { withSession } from '../../../../lib/session';
import { TripStartForm } from './start-form';

export const metadata: Metadata = { title: 'Start a Trip' };

export const dynamic = 'force-dynamic';

/** UMPE P4 (R13): start a trip from where, why and who; one case per traveller. */
export default async function TripStartPage() {
  const { travellers, groupTrips } = await withSession(async ({ db, accountId }) => ({
    travellers: (await listApplicants(db, accountId)).map((a) => ({
      applicantId: a.id,
      name: a.displayName,
    })),
    // UMPE P5: offered only once the group trip tables exist.
    groupTrips: await tripTablesReady(db),
  }));
  return (
    <>
      <PageHeader
        title="Start a Trip"
        description="Tell us where you are going, why, and who is travelling. We set up a case for each traveller and show what their visa usually needs."
      />
      <article className="card">
        {travellers.length > 0 ? (
          <TripStartForm
            countries={caseCountryOptions()}
            purposes={casePurposeGroups()}
            travellers={travellers}
          />
        ) : (
          <p className="u-m-0">
            Add a traveller first, then start the trip. <Link href="/app">Go to Home</Link>
          </p>
        )}
      </article>
      {groupTrips && travellers.length > 1 ? (
        <p className="muted u-fs-085">
          Travelling together? <Link href="/app/trips/new">Start a Group Trip</Link> to keep
          everyone&apos;s cases together on one page.
        </p>
      ) : null}
    </>
  );
}
