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
    // Readiness only for a case with a checklist attached; the owner check above covers every case here.
    const readiness = new Map<string, ReadinessCounts>();
    await Promise.all(
      rows
        .filter((mission) => mission.packVersionId)
        .slice(0, RING_LIMIT)
        .map(async (mission) => {
          const result = await computeReadiness(db, mission.id);
          if (result.ok) readiness.set(mission.id, result.value);
        }),
    );
    return { applicant, missions: rows, missionsRead: missions.ok, readiness, coreGranted };
  });

  if (!data) notFound();
  const depth = await readDepth('cases');
  // The case being worked on: the newest one that is not closed or cancelled (as on the
  // traveller's own page).
  const active = openCasesNewestFirst(data.missions)[0];

  return (
    <>
      <PageHeader
        eyebrow={data.applicant.displayName}
        title="Cases"
        description="A case assembles this applicant's evidence against a published requirement pack."
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
            <h2 className="card-title">All Cases</h2>
            {data.missions.length === 0 ? (
              <EmptyState
                icon="briefcase"
                title="No Cases Yet"
                why="Once a checklist is attached, you see how many items are ready and what is still missing."
                action={{ href: '#start-case', label: 'Start a Case' }}
              >
                A case checks this person's documents against the checklist of one visa route. Start
                one with the form on this page.
              </EmptyState>
            ) : (
              <div className="rows u-mt-050">
                {data.missions.map((mission) => (
                  <Link
                    className="row row-link"
                    key={mission.id}
                    href={`/app/mission/${mission.id}`}
                  >
                    <span className="row-key">
                      {mission.title}
                      <span className="progress-ring-row">
                        <CaseReadinessRing
                          size="sm"
                          readiness={data.readiness.get(mission.id) ?? null}
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
            )}
          </article>

          <article
            className="card"
            id="start-case"
            // With no case yet, starting one is the main thing to do here, so the form is not tucked away.
            {...atLevel(data.missions.length === 0 ? 'browse' : 'everything')}
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
