import { listApplicants, tripCompanionsAvailable, tripTablesReady } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { AboutDisclosure } from '../../../../components/ui-lift';
import { caseCountryOptions, casePurposeGroups } from '../../../../lib/case-choices';
import { withSession } from '../../../../lib/session';
import { GroupTripStartForm } from '../trip-forms';

export const metadata: Metadata = { title: 'Start a Group Trip' };

export const dynamic = 'force-dynamic';

/** UMPE P5: start one trip for several travellers the account holder manages. */
export default async function GroupTripStartPage() {
  const { travellers, ready, companionsOn } = await withSession(async ({ db, accountId }) => ({
    travellers: (await listApplicants(db, accountId)).map((a) => ({
      applicantId: a.id,
      name: a.displayName,
    })),
    ready: await tripTablesReady(db),
    companionsOn: await tripCompanionsAvailable(db),
  }));
  return (
    <>
      <PageHeader title="Start a Group Trip" back={{ href: '/app/trips', label: 'Group Trips' }} />
      <AboutDisclosure summary="About Group Trips">
        <p>
          Tell us where you are going, why, and who is travelling. Each traveller gets their own
          case, and the trip keeps them together.
        </p>
      </AboutDisclosure>
      <article className="card">
        {!ready ? (
          <p className="u-m-0">
            Group trips are not switched on yet. <Link href="/app/mission/start">Start a Trip</Link>{' '}
            gives each traveller their own case for now.
          </p>
        ) : travellers.length > 0 ? (
          <GroupTripStartForm
            countries={caseCountryOptions()}
            purposes={casePurposeGroups()}
            travellers={travellers}
            companionsOn={companionsOn}
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
