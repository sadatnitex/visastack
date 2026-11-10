import { computeReadiness, getApplicant, hasConsent, listMissions } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CaseListRow } from '../../../../../components/case-list-row';
import { DepthScope, atLevel } from '../../../../../components/depth';
import { DepthSwitch } from '../../../../../components/depth-switch';
import { SearchableList } from '../../../../../components/list-pattern';
import { MarkTile } from '../../../../../components/mark-tile';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { AboutDisclosure } from '../../../../../components/ui-lift';
import {
  caseCountryOptions,
  casePurposeGroups,
  savedPurposeMark,
} from '../../../../../lib/case-choices';
import {
  type CaseListReadiness,
  caseListReadiness,
  caseRowProps,
} from '../../../../../lib/case-list-model';
import { openCasesNewestFirst } from '../../../../../lib/case-stages';
import { depthCopyFor } from '../../../../../lib/ccd/depth-copy';
import { readDepth } from '../../../../../lib/ccd/depth.server';
import { withSession } from '../../../../../lib/session';
import { caseStatus } from '../../../../../lib/status-words';
import { CreateMissionForm } from './create-mission-form';

export const metadata: Metadata = { title: 'Cases' };

export const dynamic = 'force-dynamic';

/** The most cases whose readiness is worked out for the list, so a long history never slows the page. */
const RING_LIMIT = 25;

type CaseSource = {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly destination: string | null;
  readonly purpose: string | null;
  readonly packVersionId: string | null;
  readonly updatedAt: Date;
};

/**
 * Open cases first (newest first, the first one is "the case you are on"), then the closed and
 * cancelled ones, also newest first. Presentation only: no case changes state here.
 */
function groupCases<T extends CaseSource>(cases: readonly T[]): { active: T[]; past: T[] } {
  const active = openCasesNewestFirst(cases);
  const openIds = new Set(active.map((item) => item.id));
  const past = cases
    .filter((item) => !openIds.has(item.id))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return { active, past };
}

/** One case as a card: the row the Trips list draws for every case (components/case-list-row.tsx). */
function CaseListItem({
  mission,
  readiness,
  past,
}: {
  readonly mission: CaseSource;
  readonly readiness: ReadonlyMap<string, CaseListReadiness>;
  readonly past: boolean;
}) {
  const mark = savedPurposeMark(mission.purpose);
  return (
    <CaseListRow
      {...caseRowProps(mission, readiness.get(mission.id), past)}
      {...(mark ? { purposeIcon: <MarkTile mark={mark} size="sm" /> } : {})}
    />
  );
}

function CaseRows({
  cases,
  readiness,
  past = false,
}: {
  readonly cases: readonly CaseSource[];
  readonly readiness: ReadonlyMap<string, CaseListReadiness>;
  readonly past?: boolean;
}) {
  return (
    <ul className="case-list">
      {cases.map((mission) => (
        <CaseListItem key={mission.id} mission={mission} readiness={readiness} past={past} />
      ))}
    </ul>
  );
}

export default async function MissionsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<{ readonly deleted?: string; readonly manual?: string }>;
}) {
  const { id } = await params;
  // A cancelled case was just deleted: say so once, then it is simply not in the list.
  const query = await searchParams;
  const justDeleted = query?.deleted === '1';
  // Arriving from Start a Trip with "not sure where yet": the by-name form is already open.
  const manualOpen = query?.manual === '1';

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [missions, coreGranted] = await Promise.all([
      listMissions(db, accountId, id),
      hasConsent(db, accountId, 'CORE_PROCESSING'),
    ]);
    const rows = missions.ok ? missions.value : [];
    const groups = groupCases(rows);
    // Readiness only for a case with a checklist attached, open cases first so a long history never
    // pushes them past the limit; the owner check above covers every case here.
    const readiness = new Map<string, CaseListReadiness>();
    await Promise.all(
      [...groups.active, ...groups.past]
        .filter((mission) => mission.packVersionId)
        .slice(0, RING_LIMIT)
        .map(async (mission) => {
          const result = await computeReadiness(db, mission.id);
          if (result.ok) readiness.set(mission.id, caseListReadiness(result.value));
        }),
    );
    return { applicant, groups, missionsRead: missions.ok, readiness, coreGranted };
  });

  if (!data) notFound();
  const depth = await readDepth('cases');
  // The case being worked on: the newest one that is not closed or cancelled (as on the
  // traveller's own page).
  const { active: activeCases, past: pastCases } = data.groups;
  const active = activeCases[0];
  const hasNoCase = activeCases.length + pastCases.length === 0;
  // The main way to start a case is the same three questions as Start a Trip, with this traveller
  // already chosen. The person is checked again on that page against the signed-in account. Without
  // consent the start card explains what to turn on first, so the links stay on this page.
  const startHref = data.coreGranted ? `/app/mission/start?traveller=${id}` : '#start-case';
  const startLabel = data.coreGranted ? 'Start a Trip' : 'Start a Case';
  // The search finds a case by its name or its stage, among the cases this page already holds.
  const searchItems = [
    ...activeCases.map((mission) => ({ mission, group: 'Active', past: false })),
    ...pastCases.map((mission) => ({ mission, group: 'Past Trips', past: true })),
  ].map(({ mission, group, past }) => ({
    id: mission.id,
    group,
    text: [mission.title, mission.destination, mission.purpose, caseStatus(mission.state).word]
      .filter(Boolean)
      .join(' '),
    node: <CaseListItem mission={mission} readiness={data.readiness} past={past} />,
  }));

  return (
    <>
      <PageHeader
        eyebrow={data.applicant.displayName}
        title="Cases"
        actions={
          <Link className="btn btn-secondary" href={startHref}>
            {startLabel}
          </Link>
        }
      />
      {justDeleted ? <output className="notice u-mb-100">Case deleted.</output> : null}

      {/* Owner, 5 Nov 2026: no page should have more than 30 words. What a case is, one tap away. */}
      <AboutDisclosure summary="About Cases">
        <p>A case checks this traveller's documents against the list for one visa.</p>
      </AboutDisclosure>

      <DepthScope family="cases" depth={depth}>
        <DepthSwitch family="cases" initial={depth} copy={depthCopyFor('cases')} />
        <p className="muted" data-only="glance">
          {active ? (
            <>
              Your case: <Link href={`/app/mission/${active.id}`}>{active.title}</Link>
              {' \u00b7 '}
              {caseStatus(active.state).word}
            </>
          ) : data.missionsRead ? (
            'No active case yet.'
          ) : (
            'Your cases could not be loaded. Refresh to try again.'
          )}
        </p>

        <div className="grid">
          <article className="card lc-empty-host" {...atLevel('browse')}>
            <SearchableList
              items={searchItems}
              noun={{ one: 'case', other: 'cases' }}
              searchLabel="Search Cases"
              resultsTag="ul"
              resultsClassName="case-list"
            >
              <div data-case-group="active">
                <h2 className="case-section-title">Active ({activeCases.length})</h2>
                {!data.missionsRead ? (
                  // A failed read never claims there are no cases: that invites a duplicate case.
                  <p className="notice notice-warn u-mt-050">
                    Your cases could not be loaded. Refresh to try again.
                  </p>
                ) : hasNoCase ? (
                  <EmptyState
                    art="trips"
                    title="No Cases Yet"
                    fold
                    why="Once a checklist is attached, you see how many items are ready and what is still missing."
                    action={{ href: startHref, label: startLabel }}
                  >
                    A case checks this person's documents against the checklist of one visa route.
                    Start one by saying where and why.
                  </EmptyState>
                ) : activeCases.length === 0 ? (
                  <p className="muted u-mt-050">
                    No case is being worked on right now. <Link href={startHref}>{startLabel}</Link>
                  </p>
                ) : (
                  <CaseRows cases={activeCases} readiness={data.readiness} />
                )}
              </div>

              {pastCases.length > 0 ? (
                <details className="case-past-fold" data-case-group="past">
                  <summary>Past Trips ({pastCases.length})</summary>
                  <CaseRows cases={pastCases} readiness={data.readiness} past />
                </details>
              ) : null}
            </SearchableList>
          </article>

          <article
            className="card"
            id="start-case"
            // With no case being worked on, starting one is the main thing to do here, so the form is
            // not tucked away.
            {...atLevel(data.missionsRead && activeCases.length === 0 ? 'browse' : 'everything')}
          >
            <p className="card-kicker">New</p>
            <h2 className="card-title">{startLabel}</h2>
            {data.coreGranted ? (
              <>
                <p className="card-body">
                  Say where you are going and why. We set up the case and its checklist.
                </p>
                <Link className="btn btn-primary" href={startHref}>
                  Start a Trip
                </Link>
                <AboutDisclosure summary="Not Sure Where Yet? Add a Case by Name" open={manualOpen}>
                  <CreateMissionForm
                    applicantId={id}
                    countries={caseCountryOptions()}
                    purposes={casePurposeGroups()}
                    openDetails
                  />
                </AboutDisclosure>
              </>
            ) : (
              <p className="card-body">
                Turn on <strong>Let VisaStack Process My Details</strong> on{' '}
                <Link href="/app#permissions">Home</Link> to create cases.
              </p>
            )}
          </article>
        </div>

        <div className="action-row u-mt-150" {...atLevel('everything')}>
          <Link className="btn btn-secondary" href={`/app/applicant/${id}/outputs`}>
            Prepare a Summary
          </Link>
          <Link className="btn btn-secondary" href={`/app/applicant/${id}/memory`}>
            Case History
          </Link>
        </div>
      </DepthScope>
    </>
  );
}
