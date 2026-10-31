import { computeReadiness, getApplicant, hasConsent, listMissions } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  CaseReadinessRing,
  type ReadinessCounts,
} from '../../../../../components/case-readiness-ring';
import { DepthScope, atLevel } from '../../../../../components/depth';
import { DepthSwitch } from '../../../../../components/depth-switch';
import { PROGRESS_IN_CASE_LINE } from '../../../../../components/progress-ring';
import { EmptyState, PageHeader, StatusBadge } from '../../../../../components/ui';
import { caseCountryOptions, casePurposeGroups } from '../../../../../lib/case-choices';
import { caseStateLabel, openCasesNewestFirst } from '../../../../../lib/case-stages';
import { depthCopyFor } from '../../../../../lib/ccd/depth-copy';
import { readDepth } from '../../../../../lib/ccd/depth.server';
import { withSession } from '../../../../../lib/session';
import { CreateMissionForm } from './create-mission-form';

export const metadata: Metadata = { title: 'Cases' };

export const dynamic = 'force-dynamic';

/** The most cases whose readiness is worked out for the list, so a long history never slows the page. */
const RING_LIMIT = 25;

/** Past Cases folds away once it holds more than this many, so open work stays in view. */
const PAST_OPEN_LIMIT = 3;

type CaseListRow = {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly packVersionId: string | null;
  readonly updatedAt: Date;
};

/**
 * Open cases first (newest first, the first one is "the case you are on"), then the closed and
 * cancelled ones, also newest first. Presentation only: no case changes state here.
 */
function groupCases<T extends CaseListRow>(cases: readonly T[]): { active: T[]; past: T[] } {
  const active = openCasesNewestFirst(cases);
  const openIds = new Set(active.map((item) => item.id));
  const past = cases
    .filter((item) => !openIds.has(item.id))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return { active, past };
}

function CaseRows({
  cases,
  readiness,
}: {
  readonly cases: readonly CaseListRow[];
  readonly readiness: ReadonlyMap<string, ReadinessCounts>;
}) {
  return (
    <div className="rows u-mt-050">
      {cases.map((mission) => (
        <Link className="row row-link" key={mission.id} href={`/app/mission/${mission.id}`}>
          <span className="row-key">
            {mission.title}
            <span className="progress-ring-row">
              <CaseReadinessRing
                size="sm"
                readiness={readiness.get(mission.id) ?? null}
                {...(mission.packVersionId ? { emptyLine: PROGRESS_IN_CASE_LINE } : {})}
              />
            </span>
          </span>
          <span className="row-end">
            <StatusBadge tone="neutral">{caseStateLabel(mission.state)}</StatusBadge>
            <span className="muted" aria-hidden="true">
              →
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

export default async function MissionsPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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
    const readiness = new Map<string, ReadinessCounts>();
    await Promise.all(
      [...groups.active, ...groups.past]
        .filter((mission) => mission.packVersionId)
        .slice(0, RING_LIMIT)
        .map(async (mission) => {
          const result = await computeReadiness(db, mission.id);
          if (result.ok) readiness.set(mission.id, result.value);
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

  return (
    <>
      <PageHeader
        eyebrow={data.applicant.displayName}
        title="Cases"
        description="A case assembles this traveller's evidence against a published requirement pack."
        actions={
          <a className="btn btn-secondary" href="#start-case">
            Start a Case
          </a>
        }
      />

      <DepthScope family="cases" depth={depth}>
        <DepthSwitch family="cases" initial={depth} copy={depthCopyFor('cases')} />
        <p className="muted" data-only="glance">
          {active ? (
            <>
              Your case: <Link href={`/app/mission/${active.id}`}>{active.title}</Link>
              {' \u00b7 '}
              {caseStateLabel(active.state)}
            </>
          ) : data.missionsRead ? (
            'No active case yet.'
          ) : (
            'Your cases could not be loaded. Refresh to try again.'
          )}
        </p>

        <div className="grid">
          <article className="card" {...atLevel('browse')}>
            <div data-case-group="active">
              <h2 className="card-title">Active Cases</h2>
              {!data.missionsRead ? (
                // A failed read never claims there are no cases: that invites a duplicate case.
                <p className="notice notice-warn u-mt-050">
                  Your cases could not be loaded. Refresh to try again.
                </p>
              ) : hasNoCase ? (
                <EmptyState
                  icon="briefcase"
                  title="No Cases Yet"
                  why="Once a checklist is attached, you see how many items are ready and what is still missing."
                  action={{ href: '#start-case', label: 'Start a Case' }}
                >
                  A case checks this person's documents against the checklist of one visa route.
                  Start one with the form on this page.
                </EmptyState>
              ) : activeCases.length === 0 ? (
                <p className="muted u-mt-050">
                  No case is being worked on right now. <a href="#start-case">Start a Case</a>
                </p>
              ) : (
                <CaseRows cases={activeCases} readiness={data.readiness} />
              )}
            </div>

            {pastCases.length > 0 ? (
              <div className="u-mt-150" data-case-group="past">
                <h2 className="card-title">Past Cases</h2>
                <p className="muted">Closed and cancelled cases. You can still open them.</p>
                {pastCases.length > PAST_OPEN_LIMIT ? (
                  <details className="disclosure u-mt-050">
                    <summary>
                      <span className="disclosure-title">{pastCases.length} Past Cases</span>
                    </summary>
                    <div className="disclosure-body">
                      <CaseRows cases={pastCases} readiness={data.readiness} />
                    </div>
                  </details>
                ) : (
                  <CaseRows cases={pastCases} readiness={data.readiness} />
                )}
              </div>
            ) : null}
          </article>

          <article
            className="card"
            id="start-case"
            // With no case being worked on, starting one is the main thing to do here, so the form is
            // not tucked away.
            {...atLevel(data.missionsRead && activeCases.length === 0 ? 'browse' : 'everything')}
          >
            <p className="card-kicker">New</p>
            <h2 className="card-title">Start a Case</h2>
            {data.coreGranted ? (
              <CreateMissionForm
                applicantId={id}
                countries={caseCountryOptions()}
                purposes={casePurposeGroups()}
                openDetails
              />
            ) : (
              <p className="card-body">
                Turn on <strong>Let VisaStack Process My Details</strong> on Home to create cases.
              </p>
            )}
          </article>
        </div>

        <div className="action-row u-mt-150" {...atLevel('everything')}>
          <Link className="btn btn-secondary" href={`/app/applicant/${id}/outputs`}>
            Prepare a Brief
          </Link>
          <Link className="btn btn-secondary" href={`/app/applicant/${id}/memory`}>
            Case History
          </Link>
        </div>
      </DepthScope>
    </>
  );
}
