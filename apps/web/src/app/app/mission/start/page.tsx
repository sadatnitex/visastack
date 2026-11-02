import { listApplicants } from '@visastack/services';
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
  const travellers = await withSession(async ({ db, accountId }) =>
    (await listApplicants(db, accountId)).map((a) => ({ applicantId: a.id, name: a.displayName })),
  );
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
    </>
  );
}
