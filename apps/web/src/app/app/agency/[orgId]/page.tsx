import { CANONICAL_CASE_STATES, LEGACY_ONLY_MISSION_STATES } from '@visastack/core';
import { type Locale, formatNumber } from '@visastack/i18n';
import { isWaitingOnTraveller } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CaseReadinessRing } from '../../../../components/case-readiness-ring';
import { DepthScope, atLevel } from '../../../../components/depth';
import { DepthSwitch } from '../../../../components/depth-switch';
import { DestinationLabel } from '../../../../components/destination-label';
import { ShowMore } from '../../../../components/show-more';
import { Checklist, EmptyState, StatusBadge } from '../../../../components/ui';
import { AboutDisclosure } from '../../../../components/ui-lift/about-disclosure';
import { appAgencyCatalog } from '../../../../i18n/app-agency';
import { depthCopy } from '../../../../lib/ccd/depth-copy';
import { depthWord } from '../../../../lib/ccd/depth-words';
import { readDepth } from '../../../../lib/ccd/depth.server';
import { humanizeCode } from '../../../../lib/format-code';
import { formatDateOnly, formatTimestampDate } from '../../../../lib/format-date';
import { getServerT, primeLocale } from '../../../../lib/i18n-server';
import { type SearchParamsRecord, nextShow, parseShow } from '../../../../lib/paging';
import { agree, plural } from '../../../../lib/plural';
import { withSession } from '../../../../lib/session';
import { BillingStatusNotice, loadBillingNotice } from './billing-status-notice';
import { agencyCaseHref } from './case-anchor';
import { CaseSearchForm } from './case-search-form';
import {
  loadApplicants,
  loadCases,
  loadClientsJoined,
  loadEvidenceRequests,
  loadMembers,
  loadOrgAccess,
  loadUnassignedQueue,
} from './console-data';
import { countOverdueTasks, nextApproachingDate, summarizeAttention } from './console-format';
import { buildDoNextList } from './do-next';
import { DoNextList } from './do-next-list';
import { STAGE_LABELS } from './stage-labels';

function Stat({
  label,
  value,
  locale,
  tone,
  note,
}: {
  readonly label: string;
  readonly value: number;
  readonly locale: Locale;
  readonly tone?: 'warning' | 'danger';
  /** A second line under the number. */
  readonly note?: string | undefined;
}) {
  const state = value > 0 && tone ? ` stat-${tone}` : '';
  return (
    <div className={`stat${state}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{formatNumber(value, locale)}</span>
      {note ? (
        <span className="stat-note" data-value>
          {note}
        </span>
      ) : null}
    </div>
  );
}

export const metadata: Metadata = { title: 'Agency Dashboard' };

/** How many cases and queued cases the Dashboard shows before Show More (WP-SB5). */
const DASHBOARD_CASE_STEP = 10;
/**
 * WP-SB11: on a phone the table draws its first 5 cases as compact cards and folds the rest of
 * this load behind "Show the Other N Cases" (a checkbox and CSS, so it works without script).
 * Every case stays on the page; a wider screen shows them all. A case card is about 245 px tall,
 * so this keeps the Dashboard within its two-screen budget on a phone.
 */
const PHONE_FIRST_CASES = 5;

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
    readonly show?: string;
    readonly queue?: string;
  }>;
}) {
  const locale = await primeLocale();
  const t = getServerT(appAgencyCatalog);
  const { orgId } = await params;
  const query = await searchParams;
  const {
    q: rawQuery = '',
    stage: stageFilter = '',
    destination: rawDestinationFilter = '',
    assignee: assigneeFilter = '',
    quick: rawQuick = '',
  } = query;
  // WP-SB5: the case table shows the 10 most urgent cases, then Show More; the reassignment
  // queue the same. The Cases page lists every case.
  const casesShown = parseShow(query.show, { step: DASHBOARD_CASE_STEP });
  const queueShown = parseShow(query.queue, { step: DASHBOARD_CASE_STEP });

  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    // The layout explains the "no role" case; there is nothing to load for it.
    if (!access?.member) return null;
    const members = await loadMembers(db, accountId, orgId, access);
    const [requests, caseList, unassignedQueue, clients, clientsJoined, billingStatus] =
      await Promise.all([
        loadEvidenceRequests(db, accountId, orgId, access, { withFileStates: true }),
        loadCases(db, accountId, orgId),
        loadUnassignedQueue(db, orgId, access),
        loadApplicants(db, orgId, access),
        loadClientsJoined(db, accountId, orgId),
        loadBillingNotice(db, accountId, orgId),
      ]);
    return {
      admin: access.admin,
      billingStatus,
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
  const dashboardQuery: SearchParamsRecord = { ...query };
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
        waitingOnTraveller: forCase.filter((r) => isWaitingOnTraveller(r.status)).length,
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
  const { items: doNext, quietHidden } = buildDoNextList({
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

  const depth = await readDepth('agency-home');
  const depthWords = depthCopy({
    glance: depthWord(filtered ? 'depth.agency-home.glance.filtered' : 'depth.agency-home.glance'),
    browse: depthWord(
      data.admin ? 'depth.agency-home.browse.admin' : 'depth.agency-home.browse.member',
    ),
    everything: depthWord(
      data.admin ? 'depth.agency-home.everything.admin' : 'depth.agency-home.everything.member',
    ),
  });
  // A search, a stage or a quick view is the list the person asked for: it shows at Glance.
  const listLevel = filtered ? null : 'browse';

  return (
    <DepthScope family="agency-home" depth={depth}>
      <BillingStatusNotice notice={data.billingStatus} admin={data.admin} organizationId={orgId} />
      <DepthSwitch family="agency-home" initial={depth} copy={depthWords} notesBehindInfo />
      <section
        className="agency-reference-metrics"
        aria-label={t('appAgency.appAgencyOrgidPage.agencyOverview')}
      >
        <Stat
          locale={locale}
          label={
            data.admin
              ? t('appAgency.appAgencyOrgidPage.activeClients')
              : t('appAgency.appAgencyOrgidPage.clientsYouCanWorkWith')
          }
          value={
            data.admin
              ? data.clients.length
              : new Set(data.missions.map((mission) => mission.applicantId)).size
          }
        />
        <Stat
          locale={locale}
          label={t('appAgency.appAgencyOrgidPage.openCases')}
          value={
            data.missions.filter((mission) => !['CLOSED', 'CANCELLED'].includes(mission.state))
              .length
          }
        />
        <Stat
          locale={locale}
          label={t('appAgency.appAgencyOrgidPage.pendingRequests')}
          value={summary.pendingRequests.pending}
          note={
            data.admin
              ? t('appAgency.appAgencyOrgidPage.waitingontravellersWaitingOnTravellersWaitingona', {
                  waitingOnTravellers: summary.pendingRequests.waitingOnTravellers,
                  waitingOnAgency: summary.pendingRequests.waitingOnAgency,
                })
              : undefined
          }
        />
        {data.admin ? (
          <Stat
            locale={locale}
            label={t('appAgency.appAgencyOrgidPage.teamMembers')}
            value={data.members.filter((member) => member.active).length}
          />
        ) : (
          <Stat
            locale={locale}
            label={t('appAgency.appAgencyOrgidPage.assignedCases')}
            value={data.missions.length}
          />
        )}
      </section>
      {data.clientsJoined ? (
        <section
          className="agency-clients-joined"
          aria-label={t('appAgency.appAgencyOrgidPage.clientsJoined')}
          {...atLevel('everything')}
        >
          <Stat
            locale={locale}
            label={t('appAgency.appAgencyOrgidPage.clientsJoinedd73060')}
            value={data.clientsJoined.total}
          />
          <Stat
            locale={locale}
            label={t('appAgency.appAgencyOrgidPage.joinedInTheLast30Days')}
            value={data.clientsJoined.last30Days}
          />
        </section>
      ) : null}
      {data.admin && setupSteps.some((step) => !step.done) ? (
        // Shown only while setup is unfinished, and then it is the next thing to do: every level.
        <details className="agency-setup-disclosure">
          <summary>
            {t('appAgency.appAgencyOrgidPage.finishAgencySetupLengthOfLength2', {
              length: setupSteps.filter((step) => step.done).length,
              length2: setupSteps.length,
            })}
          </summary>
          <Checklist title={t('appAgency.appAgencyOrgidPage.setUpYourAgency')} items={setupSteps} />
        </details>
      ) : null}

      {!data.admin ? (
        <article className="card u-mb-150" {...atLevel('browse')}>
          <p className="card-body">{t('appAgency.appAgencyOrgidPage.youReAMemberOfThis')}</p>
        </article>
      ) : null}

      <DoNextList
        items={doNext}
        admin={data.admin}
        filtered={filtered}
        quietHidden={quietHidden}
        base={base}
      />

      <div className="agency-working-area" {...(listLevel ? atLevel(listLevel) : {})}>
        <div className="agency-case-column">
          {data.missions.length > 0 ? (
            <section
              className="card pipeline-card"
              aria-labelledby="pipeline-heading"
              {...(listLevel ? atLevel(listLevel) : {})}
            >
              <h2 className="card-title" id="pipeline-heading">
                {t('appAgency.appAgencyOrgidPage.casePipeline')}
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
                    <strong>{formatNumber(segment.count, locale)}</strong>
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
            <section
              className="card pipeline-card"
              aria-labelledby="pipeline-heading"
              {...(listLevel ? atLevel(listLevel) : {})}
            >
              <h2 className="card-title" id="pipeline-heading">
                {t('appAgency.appAgencyOrgidPage.casePipeline')}
              </h2>
              <EmptyState
                icon="briefcase"
                title={t('appAgency.appAgencyOrgidPage.noCaseStagesToShow')}
              >
                {t('appAgency.appAgencyOrgidPage.actualStageCountsAppearWhenA')}
              </EmptyState>
              <Link href={`${base}/cases`}>{t('appAgency.appAgencyOrgidPage.openCases')}</Link>
            </section>
          )}

          <section className="card" aria-labelledby="inbox-heading">
            <h2 className="card-title" id="inbox-heading">
              {t('appAgency.appAgencyOrgidPage.casesAndAttention')}
            </h2>
            <AboutDisclosure
              summary={t('appAgency.appAgencyOrgidPage.aboutThisList')}
              className="u-mb-100"
            >
              <p className="card-body">
                {t('appAgency.appAgencyOrgidPage.casesThatNeedActionComeFirst')}
              </p>
              <p className="card-body">
                {t('appAgency.appAgencyOrgidPage.searchCoversOnlyTheCasesYou')}
              </p>
            </AboutDisclosure>
            <div className="depth-item" {...(filtered ? {} : atLevel('everything'))}>
              <CaseSearchForm
                orgId={orgId}
                members={data.members.map((m) => ({ accountId: m.accountId, email: m.email }))}
                query={rawQuery}
                stage={stageFilter}
                destination={rawDestinationFilter}
                assignee={assigneeFilter}
              />
            </div>
            {data.missions.length > 0 ? (
              <nav
                className="quick-views u-mt-100"
                aria-label={t('appAgency.appAgencyOrgidPage.quickViewsOfTheCaseList')}
              >
                <Link
                  href={quickHref('')}
                  className={`quick-view${activeQuick ? '' : ' quick-view-on'}`}
                  aria-current={activeQuick ? undefined : 'true'}
                >
                  {t('appAgency.appAgencyOrgidClientsPage.all')}{' '}
                  <span className="muted">{searchedAll.length}</span>
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
                  title={t('appAgency.appAgencyOrgidCasesPage.noCasesYet')}
                  icon="briefcase"
                  why="Once a client accepts, their cases appear here with how many checklist items are ready."
                  {...(data.admin
                    ? { action: { href: `/app/agency/${orgId}/clients`, label: 'Invite a Client' } }
                    : {})}
                >
                  {data.admin
                    ? t('appAgency.appAgencyOrgidCasesPage.noCasesAreReachableYetA')
                    : t('appAgency.appAgencyOrgidCasesPage.youArenTAssignedToAny')}
                </EmptyState>
              </div>
            ) : searched.length === 0 ? (
              <p className="card-body u-mt-100">
                {t('appAgency.appAgencyOrgidPage.noCasesMatchThatSearch')}
              </p>
            ) : (
              <table className="data-table agency-case-table u-mt-100">
                <caption className="sr-only">
                  {t('appAgency.appAgencyOrgidPage.casesMostUrgentFirst')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('appAgency.appAgencyOrgidPage.case')}</th>
                    <th scope="col">{t('appAgency.appAgencyOrgidCaseSearchForm.stage')}</th>
                    <th scope="col">{t('appAgency.appAgencyOrgidPage.readiness')}</th>
                    <th scope="col">{t('appAgency.appAgencyOrgidPage.deadline')}</th>
                    <th scope="col">{t('appAgency.appAgencyOrgidPage.needsAttention')}</th>
                    <th scope="col">
                      {t('appAgency.appAgencyOrgidMissionCollaboration.assigned')}
                    </th>
                    <th scope="col">{t('appAgency.appAgencyOrgidPage.travellerConfirmed')}</th>
                  </tr>
                </thead>
                <tbody id="agency-case-table-rows">
                  {searched.slice(0, casesShown).map((row, index) => {
                    const { mission } = row;
                    const required = mission.readiness?.requiredCount ?? 0;
                    const satisfied = mission.readiness?.satisfiedRequired ?? 0;
                    return (
                      <tr
                        key={mission.missionId}
                        {...(index >= PHONE_FIRST_CASES
                          ? { className: 'agency-case-row-later' }
                          : {})}
                      >
                        <th scope="row" className="cell-main">
                          <Link href={agencyCaseHref(orgId, mission.missionId)}>
                            {mission.applicantName} · {mission.title}
                          </Link>
                          {mission.destination?.trim() ? (
                            <span className="cell-sub">
                              <DestinationLabel destination={mission.destination} />
                            </span>
                          ) : null}
                        </th>
                        <td data-label={t('appAgency.appAgencyOrgidCaseSearchForm.stage')}>
                          {STAGE_LABELS[mission.state] ?? mission.state}
                        </td>
                        <td data-label={t('appAgency.appAgencyOrgidPage.readiness')}>
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
                              ? t('appAgency.appAgencyOrgidPage.manualMode')
                              : !mission.packVersionId
                                ? t('appAgency.appAgencyOrgidPage.noPackAttached')
                                : mission.readiness
                                  ? mission.readiness.ready
                                    ? t('appAgency.appAgencyOrgidPage.ready')
                                    : `${required - satisfied} missing`
                                  : t('appAgency.appAgencyOrgidPage.readinessUnavailable')}
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
                        <td data-label={t('appAgency.appAgencyOrgidPage.deadline')}>
                          {mission.targetDeadline ? (
                            formatDateOnly(mission.targetDeadline, locale)
                          ) : (
                            <span className="muted" data-value>
                              {t('appAgency.appAgencyOrgidPage.notSet')}
                            </span>
                          )}
                        </td>
                        <td data-label={t('appAgency.appAgencyOrgidPage.needsAttention')}>
                          <span className="case-row-badges">
                            {row.openRequests > 0 ? (
                              <StatusBadge tone="warning">
                                {t('appAgency.appAgencyOrgidPage.openrequestsOpenRequests', {
                                  openRequests: row.openRequests,
                                })}
                              </StatusBadge>
                            ) : null}
                            {row.reviewIssues > 0 ? (
                              <StatusBadge tone="warning">
                                {t('appAgency.appAgencyOrgidPage.reviewissuesNeedsReplacement', {
                                  reviewIssues: row.reviewIssues,
                                })}
                              </StatusBadge>
                            ) : null}
                            {row.overdueTasks > 0 ? (
                              <StatusBadge tone="danger">
                                {t('appAgency.appAgencyOrgidPage.overduetasksOverdueTasks', {
                                  overdueTasks: row.overdueTasks,
                                })}
                              </StatusBadge>
                            ) : null}
                            {row.approaching ? (
                              <StatusBadge tone="warning">
                                {row.approaching.label}{' '}
                                {formatDateOnly(row.approaching.date, locale)}
                              </StatusBadge>
                            ) : null}
                            {row.openRequests +
                              row.reviewIssues +
                              row.overdueTasks +
                              (row.approaching ? 1 : 0) ===
                            0 ? (
                              <span className="muted" data-value>
                                {t('appAgency.appAgencyOrgidPage.nothing')}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td data-label={t('appAgency.appAgencyOrgidMissionCollaboration.assigned')}>
                          {row.assignedToMe ? (
                            <StatusBadge tone="neutral">
                              {t('appAgency.appAgencyOrgidPage.assignedToYou')}
                            </StatusBadge>
                          ) : null}
                          {mission.assignments.length === 0 ? (
                            <StatusBadge tone="warning">
                              {t('appAgency.appAgencyOrgidPage.needsAssignment')}
                            </StatusBadge>
                          ) : (
                            <span className="cell-sub">
                              {mission.assignments.map((a) => a.memberEmail).join(', ')}
                            </span>
                          )}
                        </td>
                        <td data-label={t('appAgency.appAgencyOrgidPage.travellerConfirmed')}>
                          {/* TRU-02 (Part 7 section 3): the applicant's own live sign-off status, not a
                          reviewer's. This org can see whether it exists, never act on it. */}
                          {mission.liveAcknowledgementAt
                            ? t('appAgency.appAgencyOrgidPage.acknowledgedFormattimestampdate', {
                                formatTimestampDate: formatTimestampDate(
                                  mission.liveAcknowledgementAt,
                                ),
                              })
                            : t('appAgency.appAgencyOrgidPage.notYetAcknowledged')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {Math.min(casesShown, searched.length) > PHONE_FIRST_CASES ? (
              <div className="agency-case-table-toggle">
                <input
                  type="checkbox"
                  id="agency-case-table-all"
                  className="agency-case-table-toggle-input"
                  // A stable spoken name with the checked state; the visible words switch.
                  aria-label={t('appAgency.appAgencyOrgidPage.showAllMinCases', {
                    min: Math.min(casesShown, searched.length),
                  })}
                />
                <label htmlFor="agency-case-table-all" className="btn btn-secondary u-btn-sm">
                  <span className="agency-case-table-toggle-closed">
                    {(() => {
                      const others = Math.min(casesShown, searched.length) - PHONE_FIRST_CASES;
                      return `Show the Other ${others} ${others === 1 ? 'Case' : 'Cases'}`;
                    })()}
                  </span>
                  <span className="agency-case-table-toggle-open">
                    {t('appAgency.appAgencyOrgidPage.showFewerCases')}
                  </span>
                </label>
              </div>
            ) : null}
            {searched.length > 0 ? (
              <div className="agency-case-table-end">
                <ShowMore
                  id="agency-case-table-more"
                  landOn="agency-case-table-rows"
                  pathname={base}
                  searchParams={dashboardQuery}
                  next={(() => {
                    const more = nextShow(casesShown, { step: DASHBOARD_CASE_STEP });
                    return more !== null && searched.length > casesShown ? { show: more } : null;
                  })()}
                  shown={Math.min(casesShown, searched.length)}
                  total={searched.length}
                  noun={{ one: 'case', other: 'cases' }}
                />
                <Link href={`${base}/cases`} className="btn btn-secondary u-btn-sm">
                  {t('appAgency.appAgencyOrgidPage.viewAllCases')}
                </Link>
              </div>
            ) : null}
          </section>

          {data.admin && data.unassignedQueue.length > 0 ? (
            <article className="card u-mb-150" {...atLevel('everything')}>
              <p className="card-kicker">{t('appAgency.appAgencyOrgidPage.needsAttention')}</p>
              <h2 className="card-title">{t('appAgency.appAgencyOrgidPage.reassignmentQueue')}</h2>
              <p className="card-body u-mb-125">
                {t('appAgency.appAgencyOrgidPage.activeCasesThisOrganizationCanStill')}
              </p>
              <div className="rows" id="agency-reassignment-rows">
                {data.unassignedQueue.slice(0, queueShown).map((m) => (
                  <Link
                    key={m.missionId}
                    href={agencyCaseHref(orgId, m.missionId)}
                    className="row row-link"
                  >
                    <span className="row-key">{m.title}</span>
                    <span className="muted">{m.applicantName}</span>
                  </Link>
                ))}
              </div>
              <ShowMore
                id="agency-reassignment-more"
                landOn="agency-reassignment-rows"
                pathname={base}
                searchParams={dashboardQuery}
                next={(() => {
                  const more = nextShow(queueShown, { step: DASHBOARD_CASE_STEP });
                  return more !== null && data.unassignedQueue.length > queueShown
                    ? { queue: more }
                    : null;
                })()}
                shown={Math.min(queueShown, data.unassignedQueue.length)}
                total={data.unassignedQueue.length}
                noun={{ one: 'case', other: 'cases' }}
              />
            </article>
          ) : null}
        </div>
        <aside
          className="agency-context-rail"
          aria-label={t('appAgency.appAgencyOrgidPage.requestsAndTeam')}
          {...atLevel('browse')}
        >
          {data.admin ? (
            <>
              <article className="card">
                <h2 className="card-title">
                  {t('appAgency.appAgencyOrgidClientsPage.evidenceRequests')}
                </h2>
                <p className="card-body">
                  {t('appAgency.appAgencyOrgidPage.recentRequestsAvailableToYourAdministrator')}
                </p>
                {data.requests.length ? (
                  <ul className="agency-request-list">
                    {data.requests.slice(0, 5).map((request) => (
                      <li key={request.id}>
                        <Link href={`${base}/clients#agency-evidence-requests`}>
                          <strong>
                            {request.docType ??
                              request.fieldKey ??
                              t('appAgency.appAgencyOrgidPage.evidenceRequest')}
                          </strong>
                          <span>
                            {request.applicantName ?? t('appAgency.appAgencyOrgidPage.traveller')} ·{' '}
                            {humanizeCode(request.status)}
                          </span>
                          {request.dueDate ? (
                            <small>
                              {t('appAgency.appAgencyOrgidPage.dueFormattimestampdate', {
                                formatTimestampDate: formatTimestampDate(request.dueDate),
                              })}
                            </small>
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
                  <p className="muted">{t('appAgency.appAgencyOrgidPage.noEvidenceRequestsYet')}</p>
                )}
                <Link
                  href={`${base}/clients#agency-evidence-requests`}
                  className="btn btn-secondary"
                >
                  {t('appAgency.appAgencyOrgidPage.manageRequests')}
                </Link>
              </article>
              <article className="card">
                <h2 className="card-title">{t('appAgency.appAgencyOrgidPage.yourTeam')}</h2>
                <p className="card-body">
                  {t('appAgency.appAgencyOrgidPage.lengthActiveMembersInactiveMembershipsRemain', {
                    length: data.members.filter((member) => member.active).length,
                  })}
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
                  {t('appAgency.appAgencyOrgidPage.manageTeam')}
                </Link>
              </article>
            </>
          ) : (
            <article className="card">
              <h2 className="card-title">{t('appAgency.appAgencyOrgidPage.yourCaseWork')}</h2>
              <p className="card-body">
                {t('appAgency.appAgencyOrgidPage.requestsAndTeamManagementBelongTo')}
              </p>
              <Link href={`${base}/cases`}>
                {t('appAgency.appAgencyOrgidPage.openAssignedCases')}
              </Link>
            </article>
          )}
          <article className="card" {...atLevel('everything')}>
            <h2 className="card-title">{t('appAgency.appAgencyOrgidActivityPage.caseActivity')}</h2>
            <p className="card-body">
              {t('appAgency.appAgencyOrgidPage.recentNotesFromCasesYouCan')}
            </p>
            <Link href={`${base}/activity`}>
              {t('appAgency.appAgencyOrgidPage.viewAccessibleCaseActivity')}
            </Link>
          </article>
        </aside>
      </div>
      <details className="agency-attention-disclosure" {...atLevel('everything')}>
        <summary>
          {t('appAgency.appAgencyOrgidPage.attentionDetailsPluralAgreeAResponse', {
            plural: plural(needsYou, 'item'),
            agree: agree(needsYou, 'needs', 'need'),
          })}
        </summary>
        <section aria-labelledby="today-heading" className="stat-section">
          <h2 className="section-label" id="today-heading">
            {t('appAgency.appAgencyOrgidPage.whatNeedsYouFirst')}
          </h2>
          <div className="stat-strip">
            <Stat
              locale={locale}
              label={t('appAgency.appAgencyOrgidPage.overdueTasks')}
              value={summary.overdueTasks}
              tone="danger"
            />
            {summary.needAssignment !== null ? (
              <Stat
                locale={locale}
                label={t('appAgency.appAgencyOrgidPage.casesWithNobodyAssigned')}
                value={summary.needAssignment}
                tone="warning"
              />
            ) : null}
            {summary.openRequests !== null ? (
              <Stat
                locale={locale}
                label={t('appAgency.appAgencyOrgidPage.evidenceRequestsWaitingOnTheTraveller')}
                value={summary.openRequests}
                tone="warning"
              />
            ) : null}
            <Stat
              locale={locale}
              label={t('appAgency.appAgencyOrgidPage.casesYouCanSee')}
              value={summary.cases}
            />
          </div>
          {needsYou === 0 && doNext.length === 0 ? (
            <p className="stat-note">
              {t('appAgency.appAgencyOrgidPage.nothingIsOverdueUnassignedOrWaiting')}
            </p>
          ) : null}
        </section>
      </details>
    </DepthScope>
  );
}
