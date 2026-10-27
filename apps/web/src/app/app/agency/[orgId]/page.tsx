import { CANONICAL_CASE_STATES, LEGACY_ONLY_MISSION_STATES } from '@visastack/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CaseReadinessRing } from '../../../../components/case-readiness-ring';
import { Checklist, EmptyState, StatusBadge } from '../../../../components/ui';
import { humanizeCode } from '../../../../lib/format-code';
import { formatDateOnly, formatTimestampDate } from '../../../../lib/format-date';
import { agree, plural } from '../../../../lib/plural';
import { withSession } from '../../../../lib/session';
import { CaseSearchForm, STAGE_LABELS } from './case-search-form';
import {
  loadApplicants,
  loadCases,
  loadClientsJoined,
  loadEvidenceRequests,
  loadMembers,
  loadOrgAccess,
  loadUnassignedQueue,
} from './console-data';
import {
  WAITING_ON_TRAVELLER_STATUSES,
  countOverdueTasks,
  nextApproachingDate,
  summarizeAttention,
} from './console-format';
import { buildDoNext } from './do-next';
import { DoNextList } from './do-next-list';

function Stat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'warning' | 'danger';
}) {
  const state = value > 0 && tone ? ` stat-${tone}` : '';
  return (
    <div className={`stat${state}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export const metadata: Metadata = { title: 'Agency Dashboard' };

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
    readonly quick?: string;
  }>;
}) {
  const { orgId } = await params;
  const {
    q: rawQuery = '',
    stage: stageFilter = '',
    destination: rawDestinationFilter = '',
    assignee: assigneeFilter = '',
    quick: rawQuick = '',
  } = await searchParams;

  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    // The layout explains the "no role" case; there is nothing to load for it.
    if (!access?.member) return null;
    const members = await loadMembers(db, accountId, orgId, access);
    const [requests, caseList, unassignedQueue, clients, clientsJoined] = await Promise.all([
      loadEvidenceRequests(db, accountId, orgId, access, { withFileStates: true }),
      loadCases(db, accountId, orgId, members),
      loadUnassignedQueue(db, orgId, access),
      loadApplicants(db, orgId, access),
      loadClientsJoined(db, accountId, orgId),
    ]);
    return {
      admin: access.admin,
      clientsJoined,
      organizationName: access.org.name ?? null,
      clients,
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

  const base = `/app/agency/${orgId}`;
  const setupSteps = [
    {
      key: 'client',
      label: 'Invite a Client',
      hint: 'A traveller who agrees to work with you.',
      done: data.missions.length > 0 || data.requests.length > 0,
      href: `${base}/clients`,
    },
    {
      key: 'case',
      label: 'Open a Case',
      hint: 'A case appears once a client shares one with you.',
      done: data.missions.length > 0,
      href: `${base}/cases`,
    },
    {
      key: 'request',
      label: 'Ask for a Document',
      hint: 'You will see here when it arrives and when it is overdue.',
      done: data.requests.length > 0,
      href: `${base}/clients`,
    },
    {
      key: 'team',
      label: 'Add a Colleague',
      hint: 'Give staff their own access to the cases you assign them.',
      done: data.members.length > 1,
      href: `${base}/team`,
    },
  ];

  const q = rawQuery.trim().toLowerCase();
  const destinationQuery = rawDestinationFilter.trim().toLowerCase();
  const searchedAll = data.missions
    .filter((mission) => {
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
    })
    .map((mission) => {
      // A request that names a case counts on that case only; one made for the traveller in
      // general (no case) still shows on each of that traveller's cases (WP-V4 W0 flag 2).
      const forCase = data.requests.filter((r) =>
        r.missionId ? r.missionId === mission.missionId : r.applicantId === mission.applicantId,
      );
      return {
        mission,
        openRequests: forCase.filter((r) => r.status === 'OPEN').length,
        // "Review issues": evidence a reviewer already looked at and sent back for replacement.
        reviewIssues: forCase.filter((r) => r.status === 'NEEDS_REPLACEMENT').length,
        waitingOnTraveller: forCase.filter((r) => WAITING_ON_TRAVELLER_STATUSES.has(r.status))
          .length,
        overdueTasks: countOverdueTasks(mission.tasks, undefined, mission.applicantTimezone),
        approaching: nextApproachingDate(mission.targetDeadline, mission.travelStartDate),
        assignedToMe: mission.assignments.some((a) => a.memberAccountId === data.viewerAccountId),
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
    });

  // One-tap views over the cases already found. They only narrow the list; nothing is hidden for good.
  const quickViews: readonly {
    readonly key: string;
    readonly label: string;
    readonly test: (row: (typeof searchedAll)[number]) => boolean;
  }[] = [
    { key: 'mine', label: 'Mine', test: (row) => row.assignedToMe },
    { key: 'overdue', label: 'Overdue', test: (row) => row.overdueTasks > 0 },
    // Both a first request and one sent back for a fix wait on the traveller.
    {
      key: 'waiting',
      label: 'Waiting on Traveller',
      test: (row) => row.waitingOnTraveller > 0,
    },
    { key: 'unassigned', label: 'Unassigned', test: (row) => row.mission.assignments.length === 0 },
  ];
  const activeQuick = quickViews.find((view) => view.key === rawQuick);
  const searched = activeQuick ? searchedAll.filter(activeQuick.test) : searchedAll;
  const quickHref = (key: string) => {
    const params = new URLSearchParams();
    if (rawQuery) params.set('q', rawQuery);
    if (stageFilter) params.set('stage', stageFilter);
    if (rawDestinationFilter) params.set('destination', rawDestinationFilter);
    if (assigneeFilter) params.set('assignee', assigneeFilter);
    if (key) params.set('quick', key);
    const query = params.toString();
    return `${base}${query ? `?${query}` : ''}`;
  };

  const filtered =
    q.length > 0 ||
    stageFilter.length > 0 ||
    destinationQuery.length > 0 ||
    assigneeFilter.length > 0 ||
    activeQuick !== undefined;
  // Do Next ranks only what this page already loaded, narrowed to the cases in view.
  const doNext = buildDoNext({
    admin: data.admin,
    viewerAccountId: data.viewerAccountId,
    cases: searched.map((row) => row.mission),
    requests: data.requests,
    applicantWide: filtered ? 'travellers-in-view' : 'all',
    members: data.members,
    organizationName: data.organizationName,
    base,
  });

  const stageCounts = new Map<string, number>([
    ['DRAFT', 0],
    ['INTAKE', 0],
    ['IN_REVIEW', 0],
    ['SUBMISSION_READY', 0],
  ]);
  for (const mission of data.missions) {
    stageCounts.set(mission.state, (stageCounts.get(mission.state) ?? 0) + 1);
  }
  const stageOrder: readonly string[] = [...CANONICAL_CASE_STATES, ...LEGACY_ONLY_MISSION_STATES];
  const pipeline = [...stageCounts.entries()]
    .map(([state, count], index) => ({ state, count, index: index % 6 }))
    .sort((a, b) => {
      const left = stageOrder.indexOf(a.state);
      const right = stageOrder.indexOf(b.state);
      return (
        (left < 0 ? stageOrder.length : left) - (right < 0 ? stageOrder.length : right) ||
        a.state.localeCompare(b.state)
      );
    });
  const pipelineSummary = pipeline
    .map(
      (segment) => `${segment.count} ${STAGE_LABELS[segment.state] ?? humanizeCode(segment.state)}`,
    )
    .join(', ');

  return (
    <>
      <section className="agency-reference-metrics" aria-label="Agency overview">
        <Stat
          label={data.admin ? 'Active Clients' : 'Clients you can work with'}
          value={
            data.admin
              ? data.clients.length
              : new Set(data.missions.map((mission) => mission.applicantId)).size
          }
        />
        <Stat
          label="Open Cases"
          value={
            data.missions.filter((mission) => !['CLOSED', 'CANCELLED'].includes(mission.state))
              .length
          }
        />
        <Stat
          label="Pending Requests"
          value={
            data.requests.filter((request) =>
              ['OPEN', 'SUBMITTED', 'NEEDS_REPLACEMENT'].includes(request.status),
            ).length
          }
        />
        {data.admin ? (
          <Stat
            label="Team Members"
            value={data.members.filter((member) => member.active).length}
          />
        ) : (
          <Stat label="Assigned Cases" value={data.missions.length} />
        )}
      </section>
      {data.clientsJoined ? (
        <section className="agency-clients-joined" aria-label="Clients joined">
          <Stat label="Clients Joined" value={data.clientsJoined.total} />
          <Stat label="Joined in the Last 30 Days" value={data.clientsJoined.last30Days} />
        </section>
      ) : null}
      {data.admin && setupSteps.some((step) => !step.done) ? (
        <details className="agency-setup-disclosure">
          <summary>
            Finish agency setup: {setupSteps.filter((step) => step.done).length} of{' '}
            {setupSteps.length} complete
          </summary>
          <Checklist title="Set Up Your Agency" items={setupSteps} />
        </details>
      ) : null}

      {!data.admin ? (
        <article className="card u-mb-150">
          <p className="card-body">
            You're a member of this organization but not an administrator. Requesting evidence, bulk
            export, and member management are admin-only - you can still collaborate on cases you're
            assigned to in the Cases section.
          </p>
        </article>
      ) : null}

      <DoNextList items={doNext} admin={data.admin} filtered={filtered} />

      <div className="agency-working-area">
        <div className="agency-case-column">
          {data.missions.length > 0 ? (
            <section className="card pipeline-card" aria-labelledby="pipeline-heading">
              <h2 className="card-title" id="pipeline-heading">
                Case Pipeline
              </h2>
              <p className="sr-only">{pipelineSummary}</p>
              <div className="agency-pipeline-stages">
                {pipeline.map((segment) => (
                  <Link
                    className="agency-stage-card"
                    key={segment.state}
                    href={`${base}?stage=${segment.state}`}
                  >
                    <span>{STAGE_LABELS[segment.state] ?? humanizeCode(segment.state)}</span>
                    <strong>{segment.count}</strong>
                    <progress
                      max={data.missions.length}
                      value={segment.count}
                      aria-label={`${STAGE_LABELS[segment.state] ?? humanizeCode(segment.state)} cases`}
                    />
                  </Link>
                ))}
              </div>
            </section>
          ) : (
            <section className="card pipeline-card" aria-labelledby="pipeline-heading">
              <h2 className="card-title" id="pipeline-heading">
                Case Pipeline
              </h2>
              <EmptyState icon="briefcase" title="No Case Stages to Show">
                Actual stage counts appear when a case is shared and visible to you.
              </EmptyState>
              <Link href={`${base}/cases`}>Open Cases</Link>
            </section>
          )}

          <section className="card" aria-labelledby="inbox-heading">
            <h2 className="card-title" id="inbox-heading">
              Cases and Attention
            </h2>
            <p className="card-body u-mb-100">
              Cases that need action come first. Search covers only the cases you are already
              allowed to see, by traveller, case title, reference, destination or stage.
            </p>
            <CaseSearchForm
              orgId={orgId}
              members={data.members.map((m) => ({ accountId: m.accountId, email: m.email }))}
              query={rawQuery}
              stage={stageFilter}
              destination={rawDestinationFilter}
              assignee={assigneeFilter}
            />
            {data.missions.length > 0 ? (
              <nav className="quick-views u-mt-100" aria-label="Quick views of the case list">
                <Link
                  href={quickHref('')}
                  className={`quick-view${activeQuick ? '' : ' quick-view-on'}`}
                  aria-current={activeQuick ? undefined : 'true'}
                >
                  All <span className="muted">{searchedAll.length}</span>
                </Link>
                {quickViews.map((view) => (
                  <Link
                    key={view.key}
                    href={quickHref(view.key)}
                    className={`quick-view${activeQuick?.key === view.key ? ' quick-view-on' : ''}`}
                    aria-current={activeQuick?.key === view.key ? 'true' : undefined}
                  >
                    {view.label}{' '}
                    <span className="muted">{searchedAll.filter(view.test).length}</span>
                  </Link>
                ))}
              </nav>
            ) : null}
            {data.missions.length === 0 ? (
              <div className="u-mt-100">
                <EmptyState
                  title="No Cases Yet"
                  icon="briefcase"
                  why="Once a client accepts, their cases appear here with how many checklist items are ready."
                  {...(data.admin
                    ? { action: { href: `/app/agency/${orgId}/clients`, label: 'Invite a Client' } }
                    : {})}
                >
                  {data.admin
                    ? 'No cases are reachable yet - an applicant must grant this organization access to a specific case.'
                    : "You aren't assigned to any cases yet - ask an admin to assign you to one."}
                </EmptyState>
              </div>
            ) : searched.length === 0 ? (
              <p className="card-body u-mt-100">No cases match that search.</p>
            ) : (
              <table className="data-table u-mt-100">
                <caption className="sr-only">Cases, Most Urgent First</caption>
                <thead>
                  <tr>
                    <th scope="col">Case</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Readiness</th>
                    <th scope="col">Deadline</th>
                    <th scope="col">Needs Attention</th>
                    <th scope="col">Assigned</th>
                    <th scope="col">Traveller Confirmed</th>
                  </tr>
                </thead>
                <tbody>
                  {searched.map((row) => {
                    const { mission } = row;
                    const required = mission.readiness?.requiredCount ?? 0;
                    const satisfied = mission.readiness?.satisfiedRequired ?? 0;
                    return (
                      <tr key={mission.missionId}>
                        <th scope="row" className="cell-main">
                          <Link href={`/app/agency/${orgId}/cases#mission-${mission.missionId}`}>
                            {mission.applicantName} · {mission.title}
                          </Link>
                          {mission.destination ? (
                            <span className="cell-sub">{mission.destination}</span>
                          ) : null}
                        </th>
                        <td data-label="Stage">{STAGE_LABELS[mission.state] ?? mission.state}</td>
                        <td data-label="Readiness">
                          <StatusBadge
                            tone={
                              mission.manualMode
                                ? 'warning'
                                : mission.readiness?.ready
                                  ? 'success'
                                  : 'neutral'
                            }
                          >
                            {mission.manualMode
                              ? 'Manual Mode'
                              : !mission.packVersionId
                                ? 'No Pack Attached'
                                : mission.readiness
                                  ? mission.readiness.ready
                                    ? 'Ready'
                                    : `${required - satisfied} missing`
                                  : 'Readiness Unavailable'}
                          </StatusBadge>
                          {mission.manualMode ? null : (
                            <span className="progress-ring-row">
                              <CaseReadinessRing
                                size="sm"
                                readiness={mission.readiness}
                                emptyLine={
                                  mission.packVersionId
                                    ? 'Progress is not available right now.'
                                    : 'No checklist is attached to this case yet.'
                                }
                              />
                            </span>
                          )}
                        </td>
                        <td data-label="Deadline">
                          {mission.targetDeadline ? (
                            formatDateOnly(mission.targetDeadline)
                          ) : (
                            <span className="muted">Not set</span>
                          )}
                        </td>
                        <td data-label="Needs Attention">
                          <span className="case-row-badges">
                            {row.openRequests > 0 ? (
                              <StatusBadge tone="warning">
                                {row.openRequests} open request{row.openRequests === 1 ? '' : 's'}
                              </StatusBadge>
                            ) : null}
                            {row.reviewIssues > 0 ? (
                              <StatusBadge tone="warning">
                                {row.reviewIssues} needs replacement
                              </StatusBadge>
                            ) : null}
                            {row.overdueTasks > 0 ? (
                              <StatusBadge tone="danger">
                                {row.overdueTasks} overdue task{row.overdueTasks === 1 ? '' : 's'}
                              </StatusBadge>
                            ) : null}
                            {row.approaching ? (
                              <StatusBadge tone="warning">
                                {row.approaching.label} {formatDateOnly(row.approaching.date)}
                              </StatusBadge>
                            ) : null}
                            {row.openRequests +
                              row.reviewIssues +
                              row.overdueTasks +
                              (row.approaching ? 1 : 0) ===
                            0 ? (
                              <span className="muted">Nothing</span>
                            ) : null}
                          </span>
                        </td>
                        <td data-label="Assigned">
                          {row.assignedToMe ? (
                            <StatusBadge tone="neutral">Assigned to You</StatusBadge>
                          ) : null}
                          {mission.assignments.length === 0 ? (
                            <StatusBadge tone="warning">Needs Assignment</StatusBadge>
                          ) : (
                            <span className="cell-sub">
                              {mission.assignments.map((a) => a.memberEmail).join(', ')}
                            </span>
                          )}
                        </td>
                        <td data-label="Traveller Confirmed">
                          {/* TRU-02 (Part 7 section 3): the applicant's own live sign-off status, not a
                          reviewer's. This org can see whether it exists, never act on it. */}
                          {mission.liveAcknowledgementAt
                            ? `Acknowledged ${formatTimestampDate(mission.liveAcknowledgementAt)}`
                            : 'Not yet acknowledged'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {data.admin && data.unassignedQueue.length > 0 ? (
            <article className="card u-mb-150">
              <p className="card-kicker">Needs Attention</p>
              <h2 className="card-title">Reassignment Queue</h2>
              <p className="card-body u-mb-125">
                Active cases this organization can still act on but that currently have nobody
                assigned - most often because the only assigned member was removed. Open one to
                assign someone in the Cases section.
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
        </div>
        <aside className="agency-context-rail" aria-label="Requests and team">
          {data.admin ? (
            <>
              <article className="card">
                <h2 className="card-title">Evidence Requests</h2>
                <p className="card-body">Recent requests available to your administrator role.</p>
                {data.requests.length ? (
                  <ul className="agency-request-list">
                    {data.requests.slice(0, 5).map((request) => (
                      <li key={request.id}>
                        <Link href={`${base}/clients#agency-evidence-requests`}>
                          <strong>
                            {request.docType ?? request.fieldKey ?? 'Evidence Request'}
                          </strong>
                          <span>
                            {request.applicantName ?? 'Traveller'} · {humanizeCode(request.status)}
                          </span>
                          {request.dueDate ? (
                            <small>Due {formatTimestampDate(request.dueDate)}</small>
                          ) : null}
                          {/* Plain text inside the link: a Copy button cannot sit inside a link. */}
                          {request.referenceCode ? (
                            <small translate="no">{request.referenceCode}</small>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No evidence requests yet.</p>
                )}
                <Link
                  href={`${base}/clients#agency-evidence-requests`}
                  className="btn btn-secondary"
                >
                  Manage Requests
                </Link>
              </article>
              <article className="card">
                <h2 className="card-title">Your Team</h2>
                <p className="card-body">
                  {data.members.filter((member) => member.active).length} active members. Inactive
                  memberships remain available in team management.
                </p>
                <ul className="agency-request-list">
                  {data.members
                    .filter((member) => member.active)
                    .slice(0, 4)
                    .map((member) => (
                      <li key={member.accountId}>
                        <strong>{member.email}</strong>
                        <span>{humanizeCode(member.role)}</span>
                      </li>
                    ))}
                </ul>
                <Link href={`${base}/team`} className="btn btn-secondary">
                  Manage Team
                </Link>
              </article>
            </>
          ) : (
            <article className="card">
              <h2 className="card-title">Your Case Work</h2>
              <p className="card-body">
                Requests and team management belong to agency administrators. Your assigned case
                tools remain available.
              </p>
              <Link href={`${base}/cases`}>Open Assigned Cases</Link>
            </article>
          )}
          <article className="card">
            <h2 className="card-title">Case Activity</h2>
            <p className="card-body">
              Recent notes from cases you can currently access. This is not the full organization
              audit log.
            </p>
            <Link href={`${base}/activity`}>View Accessible Case Activity</Link>
          </article>
        </aside>
      </div>
      <details className="agency-attention-disclosure">
        <summary>
          Attention Details: {plural(needsYou, 'item')} {agree(needsYou, 'needs', 'need')} a
          response
        </summary>
        <section aria-labelledby="today-heading" className="stat-section">
          <h2 className="section-label" id="today-heading">
            What Needs You First
          </h2>
          <div className="stat-strip">
            <Stat label="Overdue Tasks" value={summary.overdueTasks} tone="danger" />
            {summary.needAssignment !== null ? (
              <Stat
                label="Cases with Nobody Assigned"
                value={summary.needAssignment}
                tone="warning"
              />
            ) : null}
            {summary.openRequests !== null ? (
              <Stat
                label="Evidence Requests Waiting on the Applicant"
                value={summary.openRequests}
                tone="warning"
              />
            ) : null}
            <Stat label="Cases you can see" value={summary.cases} />
          </div>
          {needsYou === 0 && doNext.length === 0 ? (
            <p className="stat-note">
              Nothing is overdue, unassigned or waiting on an applicant right now.
            </p>
          ) : null}
        </section>
      </details>
    </>
  );
}
