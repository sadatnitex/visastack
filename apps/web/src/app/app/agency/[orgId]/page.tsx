import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusBadge } from '../../../../components/ui';
import { formatDateOnly } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';
import { CaseSearchForm, STAGE_LABELS } from './case-search-form';
import {
  loadCases,
  loadEvidenceRequests,
  loadMembers,
  loadOrgAccess,
  loadUnassignedQueue,
} from './console-data';
import { countOverdueTasks, nextApproachingDate, summarizeAttention } from './console-format';

/** An unambiguous day, month name and year in the viewer's own timezone, for real timestamps. */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const metadata: Metadata = { title: 'Agency dashboard' };

export const dynamic = 'force-dynamic';

/**
 * Dashboard: what needs attention across the cases this person can see, with a
 * search over exactly those cases (Commercial V1 Part 9 UX-01). The header and the
 * section bar come from the layout. Each case here opens that case's workspace on
 * the Cases tab; it used to link to the traveller's own case page, which only the
 * applicant who owns the case can open, so an agency member who clicked got
 * "not found".
 */
export default async function AgencyDashboardPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ orgId: string }>;
  readonly searchParams: Promise<{
    readonly q?: string;
    readonly stage?: string;
    readonly destination?: string;
    readonly assignee?: string;
  }>;
}) {
  const { orgId } = await params;
  const {
    q: rawQuery = '',
    stage: stageFilter = '',
    destination: rawDestinationFilter = '',
    assignee: assigneeFilter = '',
  } = await searchParams;

  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    // The layout explains the "no role" case; there is nothing to load for it.
    if (!access?.member) return null;
    const members = await loadMembers(db, accountId, orgId, access);
    const [requests, caseList, unassignedQueue] = await Promise.all([
      loadEvidenceRequests(db, accountId, orgId, access),
      loadCases(db, accountId, orgId, members),
      loadUnassignedQueue(db, orgId, access),
    ]);
    return {
      admin: access.admin,
      members,
      requests,
      missions: caseList.cases,
      unassignedQueue,
      viewerAccountId: accountId,
    };
  });
  if (!data) return null;

  const summary = summarizeAttention({
    admin: data.admin,
    cases: data.missions,
    requests: data.requests,
  });

  const needsYou =
    summary.overdueTasks + (summary.needAssignment ?? 0) + (summary.openRequests ?? 0);

  return (
    <>
      {!data.admin ? (
        <article className="card" style={{ marginBottom: '1.5rem' }}>
          <p className="card-body">
            You're a member of this organization but not an administrator. Requesting evidence, bulk
            export, and member management are admin-only - you can still collaborate on cases you're
            assigned to in the Cases section.
          </p>
        </article>
      ) : null}

      <article className="card" style={{ marginBottom: '1.5rem' }}>
        <p className="card-kicker">Today</p>
        <h2 className="card-title">What needs you first</h2>
        {needsYou === 0 ? (
          <p className="card-body" style={{ marginBottom: '0.75rem' }}>
            Nothing is overdue, unassigned or waiting on an applicant right now.
          </p>
        ) : null}
        <div className="rows">
          <div className="row">
            <span className="row-key">Overdue tasks</span>
            <StatusBadge tone={summary.overdueTasks > 0 ? 'danger' : 'neutral'}>
              {summary.overdueTasks}
            </StatusBadge>
          </div>
          {summary.needAssignment !== null ? (
            <div className="row">
              <span className="row-key">Cases with nobody assigned</span>
              <StatusBadge tone={summary.needAssignment > 0 ? 'warning' : 'neutral'}>
                {summary.needAssignment}
              </StatusBadge>
            </div>
          ) : null}
          {summary.openRequests !== null ? (
            <div className="row">
              <span className="row-key">Evidence requests waiting on the applicant</span>
              <StatusBadge tone={summary.openRequests > 0 ? 'warning' : 'neutral'}>
                {summary.openRequests}
              </StatusBadge>
            </div>
          ) : null}
          <div className="row">
            <span className="row-key">Cases you can see</span>
            <span className="row-val">{summary.cases}</span>
          </div>
        </div>
      </article>

      <article className="card" style={{ marginBottom: '1.5rem' }}>
        <p className="card-kicker">Case inbox</p>
        <h2 className="card-title">What needs attention</h2>
        <p className="card-body" style={{ marginBottom: '1rem' }}>
          Search only looks at cases you're already authorized to see below - never a wider,
          unscoped lookup. There's no passport-number or wallet-content search here; only case
          metadata already shown in this console.
        </p>
        <CaseSearchForm
          orgId={orgId}
          members={data.members.map((m) => ({ accountId: m.accountId, email: m.email }))}
          query={rawQuery}
          stage={stageFilter}
          destination={rawDestinationFilter}
          assignee={assigneeFilter}
        />
        {data.missions.length === 0 ? (
          <p className="card-body" style={{ marginTop: '1rem' }}>
            {data.admin
              ? 'No cases are reachable yet - an applicant must grant this organization access to a specific case.'
              : "You aren't assigned to any cases yet - ask an admin to assign you to one."}
          </p>
        ) : (
          (() => {
            const q = rawQuery.trim().toLowerCase();
            const destinationQuery = rawDestinationFilter.trim().toLowerCase();
            const searched = data.missions.filter((mission) => {
              if (q.length > 0) {
                const haystack =
                  `${mission.applicantName} ${mission.title} ${mission.missionId}`.toLowerCase();
                if (!haystack.includes(q)) return false;
              }
              if (stageFilter.length > 0 && mission.state !== stageFilter) return false;
              if (
                destinationQuery.length > 0 &&
                !(mission.destination ?? '').toLowerCase().includes(destinationQuery)
              ) {
                return false;
              }
              if (
                assigneeFilter.length > 0 &&
                !mission.assignments.some((a) => a.memberAccountId === assigneeFilter)
              ) {
                return false;
              }
              return true;
            });
            if (searched.length === 0) {
              return (
                <p className="card-body" style={{ marginTop: '1rem' }}>
                  No cases match that search.
                </p>
              );
            }
            return (
              <div className="rows" style={{ marginTop: '1rem' }}>
                {searched
                  .map((mission) => {
                    const openRequests = data.requests.filter(
                      (r) => r.applicantId === mission.applicantId && r.status === 'OPEN',
                    ).length;
                    // "Review issues": evidence a reviewer already looked
                    // at and sent back for replacement. A separate, older
                    // decision mechanism (recordMissionDecision/CAS-06's
                    // ledger note) also produces REJECTED outcomes; not
                    // folded in here, same as openRequests' own scope.
                    const reviewIssues = data.requests.filter(
                      (r) =>
                        r.applicantId === mission.applicantId && r.status === 'NEEDS_REPLACEMENT',
                    ).length;
                    const overdueTasks = countOverdueTasks(mission.tasks);
                    const approaching = nextApproachingDate(
                      mission.targetDeadline,
                      mission.travelStartDate,
                    );
                    const assignedToMe = mission.assignments.some(
                      (a) => a.memberAccountId === data.viewerAccountId,
                    );
                    return {
                      mission,
                      openRequests,
                      reviewIssues,
                      overdueTasks,
                      approaching,
                      assignedToMe,
                    };
                  })
                  // Cases needing action float to the top.
                  .sort((a, b) => {
                    const weight = (x: typeof a) =>
                      (x.mission.assignments.length === 0 ? 2 : 0) +
                      (x.openRequests > 0 ? 1 : 0) +
                      (x.reviewIssues > 0 ? 1 : 0) +
                      (x.overdueTasks > 0 ? 1 : 0) +
                      (x.approaching ? 1 : 0);
                    return weight(b) - weight(a);
                  })
                  .map(
                    ({
                      mission,
                      openRequests,
                      reviewIssues,
                      overdueTasks,
                      approaching,
                      assignedToMe,
                    }) => (
                      <div className="case-row" key={mission.missionId}>
                        <div className="case-row-head">
                          <span className="case-row-title">
                            <Link href={`/app/agency/${orgId}/cases#mission-${mission.missionId}`}>
                              {mission.applicantName} · {mission.title}
                            </Link>
                          </span>
                          <span className="case-row-badges">
                            {assignedToMe ? (
                              <span className="badge badge-neutral">Assigned to you</span>
                            ) : null}
                            {mission.assignments.length === 0 ? (
                              <span className="badge badge-warning">Needs assignment</span>
                            ) : null}
                            {openRequests > 0 ? (
                              <span className="badge badge-warning">
                                {openRequests} open request{openRequests === 1 ? '' : 's'}
                              </span>
                            ) : null}
                            {reviewIssues > 0 ? (
                              <span className="badge badge-warning">
                                {reviewIssues} needs replacement
                              </span>
                            ) : null}
                            {overdueTasks > 0 ? (
                              <span className="badge badge-danger">
                                {overdueTasks} overdue task{overdueTasks === 1 ? '' : 's'}
                              </span>
                            ) : null}
                            {approaching ? (
                              <span className="badge badge-warning">
                                {approaching.label} {formatDateOnly(approaching.date)}
                              </span>
                            ) : null}
                            <span
                              className={`badge ${mission.manualMode ? 'badge-warning' : mission.readiness?.ready ? 'badge-success' : 'badge-neutral'}`}
                            >
                              {mission.manualMode
                                ? 'Manual mode'
                                : !mission.packVersionId
                                  ? 'No pack attached'
                                  : mission.readiness
                                    ? mission.readiness.ready
                                      ? 'Ready'
                                      : `${mission.readiness.requiredCount - mission.readiness.satisfiedRequired} missing`
                                    : 'Readiness unavailable'}
                            </span>
                          </span>
                        </div>
                        <span className="case-row-meta">
                          {STAGE_LABELS[mission.state] ?? mission.state}
                          {' · '}
                          {mission.assignments.length > 0
                            ? `Assigned: ${mission.assignments.map((a) => a.memberEmail).join(', ')}`
                            : 'Unassigned'}
                          {mission.notes.length > 0 ? ` · ${mission.notes.length} note(s)` : ''}
                          {mission.destination ? ` · ${mission.destination}` : ''}
                          {/* TRU-02 (Part 7 §3): the applicant's own live
                                sign-off status, not a reviewer's -- this org
                                can see whether it exists, never act on it. */}
                          {mission.liveAcknowledgementAt
                            ? ` · Acknowledged ${formatDateTime(mission.liveAcknowledgementAt)}`
                            : ' · Not yet acknowledged'}
                        </span>
                      </div>
                    ),
                  )}
              </div>
            );
          })()
        )}
      </article>

      {data.admin && data.unassignedQueue.length > 0 ? (
        <article className="card" style={{ marginBottom: '1.5rem' }}>
          <p className="card-kicker">Needs attention</p>
          <h2 className="card-title">Reassignment queue</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            Active cases this organization can still act on but that currently have nobody assigned
            - most often because the only assigned member was removed. Open one to assign someone in
            the Cases section.
          </p>
          <div className="rows">
            {data.unassignedQueue.map((m) => (
              <Link
                key={m.missionId}
                href={`/app/agency/${orgId}/cases#mission-${m.missionId}`}
                className="row row-link"
              >
                <span className="row-key">{m.title}</span>
                <span className="muted">{m.applicantName}</span>
              </Link>
            ))}
          </div>
        </article>
      ) : null}
    </>
  );
}
