import {
  COMPANION_SHARE_LEVELS,
  COMPANION_SHARE_LEVEL_LABELS,
  type CompanionShareLevel,
  getCompanionTrip,
  joinedCompanionAccess,
  listMyTripPapers,
  myTripCaseId,
  readCompanionTripSummary,
  tripCompanionsEnabled,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '../../../../components/ui';
import { withSession } from '../../../../lib/session';
import {
  ChoosePaperForm,
  LeaveTripForm,
  PlanOwnCaseForm,
  RemovePaperForm,
  ShareLevelForm,
} from './joined-trip-forms';
import { DestinationLabel } from '../../../../components/destination-label';

export const metadata: Metadata = {
  title: 'Joined Trip',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the organiser then sees, one line each. */
const SHARE_LINES: Readonly<Record<CompanionShareLevel, string>> = {
  NAME_ONLY: 'Your name and that you joined.',
  PLAN_STATUS: 'Also one plain phrase about your own case for this trip.',
  TRAVEL_BOOKINGS: 'Also the names of booking and itinerary papers you choose.',
};

function Shell({ children }: { readonly children: ReactNode }) {
  return <section className="section container">{children}</section>;
}

const moreWords = (count: number) => `${count} more travelling with the organiser`;

/**
 * UMPE UX6 package 4: the read-only page of a trip a person joined. It shows only what
 * `getCompanionTrip` returns (title, destination, purpose, the organiser as "The organiser", the
 * other people who joined by the names they confirmed, and how many more are travelling), and
 * nothing else: no case, no reference, no document, no address. Every bad request (an unknown trip,
 * someone else's, one the person left, was removed from or declined, and the feature being off) is
 * the same 404.
 */
export default async function JoinedTripPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  if (!tripCompanionsEnabled()) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const page = await withSession(async ({ db, accountId }) => {
    const access = await joinedCompanionAccess(db, accountId, id);
    if (!access) return null;
    const trip = await getCompanionTrip(db, access);
    const summary = await readCompanionTripSummary(db, access);
    if (!trip.ok || !summary.ok) return null;
    const level = summary.value.shareLevel ?? 'NAME_ONLY';
    const papers = level === 'TRAVEL_BOOKINGS' ? await listMyTripPapers(db, access) : null;
    const ownCase = await myTripCaseId(db, access);
    return {
      trip: trip.value,
      level,
      papers: papers?.ok && papers.value.available ? papers.value : null,
      ownCaseId: ownCase.ok ? ownCase.value : null,
    };
  });
  if (!page) notFound();
  const { trip, level, papers, ownCaseId } = page;
  return (
    <Shell>
      <PageHeader title={trip.title} description="You joined this trip." />
      <article className="card">
        <dl className="rows">
          <div className="row">
            <dt>Where</dt>
            <dd>
              <DestinationLabel destination={trip.destination} />
            </dd>
          </div>
          <div className="row">
            <dt>Why</dt>
            <dd>{trip.purpose}</dd>
          </div>
          <div className="row">
            <dt>Travelling</dt>
            <dd>
              <ul className="companion-people">
                {trip.people.map((name, at) => (
                  <li key={`${at}-${name}`}>{name}</li>
                ))}
              </ul>
              {trip.moreTravelling > 0 ? (
                <p className="muted u-fs-085 u-m-0">{moreWords(trip.moreTravelling)}</p>
              ) : null}
            </dd>
          </div>
        </dl>
        <div className="companion-actions">
          {ownCaseId ? (
            <Link className="btn btn-primary" href={`/app/mission/${ownCaseId}`}>
              Open My Case
            </Link>
          ) : (
            <PlanOwnCaseForm tripId={id} />
          )}
        </div>
      </article>
      <article className="card">
        <ShareLevelForm
          tripId={id}
          current={level}
          choices={COMPANION_SHARE_LEVELS.map((value) => ({
            value,
            label: COMPANION_SHARE_LEVEL_LABELS[value],
            line: SHARE_LINES[value],
          }))}
        />
        {papers ? (
          <details className="companion-more">
            <summary>Papers You Show ({papers.chosen.length})</summary>
            <p className="muted u-fs-085 u-m-0">
              The organiser sees only the name and kind of each paper, never the file.
            </p>
            {papers.chosen.length > 0 ? (
              <ul className="companion-papers">
                {papers.chosen.map((paper) => (
                  <li key={paper.documentId}>
                    <span>
                      {paper.name} <span className="muted u-fs-085">{`${paper.kind}`}</span>
                    </span>
                    <RemovePaperForm tripId={id} paper={paper} />
                  </li>
                ))}
              </ul>
            ) : null}
            {papers.options.length > 0 ? (
              <ChoosePaperForm tripId={id} options={papers.options} />
            ) : (
              <p className="muted u-m-0">
                No bookings or itineraries in your documents to add right now.
              </p>
            )}
          </details>
        ) : null}
      </article>
      <div className="companion-leave">
        <LeaveTripForm tripId={id} />
        <Link href="/app/trips">Back to My Trips</Link>
      </div>
    </Shell>
  );
}
