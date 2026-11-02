import { listApplicants } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { caseCountryOptions, casePurposeGroups } from '../../../../lib/case-choices';
import { withSession } from '../../../../lib/session';
import { GroupTripStartForm } from '../trip-forms';

export const metadata: Metadata = { title: 'Start a Group Trip' };

export const dynamic = 'force-dynamic';

/** UMPE P5: start one trip for several travellers the account holder manages. */
export default async function GroupTripStartPage() {
  const travellers = await withSession(async ({ db, accountId }) =>
    (await listApplicants(db, accountId)).map((a) => ({ applicantId: a.id, name: a.displayName })),
  );
  return (
    <>
      <PageHeader
        title="Start a Group Trip"
        description="Tell us where you are going, why, and who is travelling. Each traveller gets their own case, and the trip keeps them together."
        back={{ href: '/app/trips', label: 'Group Trips' }}
      />
      <article className="card">
        {travellers.length > 0 ? (
          <GroupTripStartForm
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
