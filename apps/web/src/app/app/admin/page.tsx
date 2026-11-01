import { getMigrationStatus } from '@visastack/db';
import {
  type OperationalSignal,
  type ProductEventType,
  collectOperationalSignals,
  getLifecycleMeasures,
  getPilotScorecard,
  getPlatformEvidenceBytes,
  getPlatformOverview,
  getProductAnalytics,
  listFailedJobs,
  loadUploadQuotaConfig,
  personBillingPresent,
  personRefundGuardPresent,
  totalAiCostUnits,
  travellerPlansEnabled,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../components/ui';
import { bootstrapAdminEmails, isPlatformAdmin, staffPrincipal } from '../../../lib/admin';
import { aiWarningLimitUnits, defaultAiLimits, resolveAiLimits, unitsToUsd } from '../../../lib/ai';
import { formatDuration, formatMinorUnits, humanizeLabel } from '../../../lib/analytics-format';
import { gateStatus } from '../../../lib/commercial-readiness';
import { getDeploymentMode } from '../../../lib/deployment-mode';
import { SHIPPED_MIGRATIONS } from '../../../lib/migration-journal';
import { type SearchParamsRecord, parseCursor } from '../../../lib/paging';
import { type ProviderStatus, describeProviderOperations } from '../../../lib/provider-operations';
import { paymentMode } from '../../../lib/providers';
import { evaluateReadiness } from '../../../lib/readiness';
import { withSession } from '../../../lib/session';
import { staffFactorMode } from '../../../lib/staff-factor';
import { tolerantReader } from '../../../lib/tolerate';
import { travellerPlansRow } from '../../../lib/traveller-plans-readiness';
import { UsageMeter } from '../applicant/[id]/usage-meter';
import { OpenGroupOnLink } from '../mission/[id]/open-group-on-link';
import { RetryJobButton } from './action-buttons';
import { AdminRestricted } from './admin-restricted';
import { QueuePaging, QueuePastEnd } from './email/queue-paging';
import { QueuePanel } from './email/queue-panel';
import { FailedSectionsBanner } from './failed-sections-banner';
import { LifecycleMeasuresCard } from './lifecycle-measures';
import { ReconcileButtons } from './reconcile-buttons';

export const metadata: Metadata = { title: 'Platform Operations' };

export const dynamic = 'force-dynamic';

const SCORECARD_LABELS: Record<ProductEventType, string> = {
  ACCOUNT_CREATED: 'Accounts Created',
  APPLICANT_CREATED: 'Applicant Records Added',
  DOCUMENT_UPLOADED: 'Documents Uploaded',
  MISSION_CREATED: 'Cases Started',
  GRANT_CREATED: 'Grants Created',
  AI_EXTRACTION_RUN: 'AI Extractions Run',
  AI_OCR_RUN: 'AI OCR Runs',
  AI_CLASSIFICATION_RUN: 'AI Classifications Run',
  AI_INCONSISTENCY_RUN: 'AI Inconsistency Checks Run',
  MISSION_STAGE_CHANGED: 'Case Stage Changes',
  MISSION_READY_REACHED: 'Cases First Reaching Ready',
  EVIDENCE_REQUESTED: 'Evidence Requested',
  EVIDENCE_RECEIVED: 'Evidence Received',
  EVIDENCE_REWORK_REQUESTED: 'Evidence Sent Back for Rework',
  TASK_OVERDUE: 'Tasks Gone Overdue',
  READINESS_GAPS_DETECTED: 'Readiness Checks at Capture',
  ACKNOWLEDGEMENT_RECORDED: 'Applicant Acknowledgement Decisions',
  ACKNOWLEDGEMENT_INVALIDATED: 'Acknowledgements Voided by a Change',
  SOURCE_REVIEWED: 'Official Source Reviews',
  AI_PROPOSAL_ACCEPTED: 'AI Proposals Accepted',
  AI_PROPOSAL_CORRECTED: 'AI Proposals Corrected',
  AI_PROPOSAL_REJECTED: 'AI Proposals Rejected',
  OUTCOME_RECORDED: 'Case Outcomes Recorded',
  COMPLAINT_RESOLVED: 'Complaints Ended',
  ACCOUNT_ACTIVATED: 'Accounts Activated (First Case)',
  PLAN_CHANGED: 'Plan Changes',
  PLAN_LIMIT_REACHED: 'Plan Limits Reached',
  CASH_COLLECTED: 'Cash Collections Recorded',
  CASE_PREPARED_AGAIN: 'Cases Prepared Again',
  COUNTRY_CHECKLIST_STARTED: 'Country Checklists Started',
  CLIENT_INVITE_SENT: 'Client Invitations Sent',
  CLIENT_INVITE_ACCEPTED: 'Client Invitations Accepted',
  AI_CONNECTOR_CONNECTED: 'AI Apps Connected',
  AI_CONTEXT_REQUESTED: 'AI Connection Days with Answers',
  AI_CONTEXT_DENIED: 'AI Connection Days with Refusals',
  AI_CONNECTOR_REVOKED: 'AI Connections Turned Off',
  AI_FILE_SERVED: 'AI Connection Days with Files Given',
  DOCUMENT_ARCHIVED: 'Documents Archived',
  DOCUMENT_RESTORED: 'Documents Restored',
  DOCUMENT_REPLACED: 'Documents Replaced',
  DUPLICATE_REMOVED_AT_UPLOAD: 'Duplicates Removed at Upload',
  DOCUMENT_DELETED: 'Duplicates Deleted',
  DOCUMENT_DELETE_UNDONE: 'Deletes Undone',
  DOCUMENT_DESTROYED: 'Documents Removed for Good',
  REMOVAL_REQUESTED: 'Removal Requests',
  REMOVAL_DECIDED: 'Removal Requests Decided',
  TRAVELLER_ARCHIVED: 'Travellers Archived',
  TRAVELLER_RESTORED: 'Travellers Restored',
  TRAVELLER_REMOVED: 'Empty Travellers Removed',
};

const SIGNAL_STATUS_LABEL: Record<OperationalSignal['status'], string> = {
  ok: 'OK',
  warning: 'Warning',
  critical: 'Critical',
  not_measured: 'Not Measured',
  not_built: 'Not Built',
};

const SIGNAL_STATUS_TONE: Record<OperationalSignal['status'], string> = {
  ok: 'badge-success',
  warning: 'badge-warning',
  critical: 'badge-danger',
  not_measured: 'badge-neutral',
  not_built: 'badge-neutral',
};

/**
 * Operations (Commercial V1 Part 9 UX-01): is the platform healthy, what is it
 * carrying, and how is the pilot behaving. The other platform sections (Organizations,
 * Rules, AI, Privacy, Audit, Access) are pages of their own, reached from the bar above.
 */
/** Colour never carries the meaning alone: every badge also says the word. "Set Up" is not green because it is not proof. */
const PROVIDER_STATUS_TONE: Record<ProviderStatus, string> = {
  'Set Up': 'badge-neutral',
  'Not Set Up': 'badge-warning',
  Recorded: 'badge-neutral',
  'Not Proven': 'badge-warning',
  'Not Measured': 'badge-neutral',
};

const OVERVIEW_PATH = '/app/admin';
const JOBS_PANEL = 'admin-failed-jobs-panel';
const GROUPS_SCOPE = 'admin-overview-groups';
/** Failed jobs per load into the fixed box (the scroll budget's server limit for a queue). */
const FAILED_JOBS_PAGE_SIZE = 50;
const NO_FAILED_JOBS = { items: [], nextCursor: null, total: 0 } as const;

/**
 * WP-SB6: the overview fits about two phone screens. The first screen holds the headline counts,
 * what needs attention and the failed jobs (in a fixed box that scrolls inside, 50 at a time from
 * the server); every specialist card sits in a named group below that opens on request. Nothing
 * was removed: each card keeps its own section link.
 */
export default async function AdminOperationsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<SearchParamsRecord>;
}) {
  const search = (await searchParams) ?? {};
  const param = (name: string) => search[name];
  const jobsBefore = parseCursor(param('jobsBefore'));
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    // Sections that cannot be read (typically a table a pending migration has not
    // created) are left empty and named in a banner. The permission check above is
    // NOT wrapped: an authorization failure must stay an error.
    const { read: t, failed: failedSections } = tolerantReader();
    const [
      failedJobs,
      scorecard,
      lifecycleMeasures,
      analytics,
      platformEvidenceBytes,
      aiCostUnits,
      aiLimits,
    ] = await Promise.all([
      t(
        'failed jobs',
        () =>
          listFailedJobs(db, {
            limit: FAILED_JOBS_PAGE_SIZE,
            ...(jobsBefore ? { before: jobsBefore } : {}),
          }),
        NO_FAILED_JOBS,
      ),
      t('product scorecard', () => getPilotScorecard(db), []),
      // Resource lifecycle measures (PROGRAMME section 9): staff with the privacy directory role.
      t(
        'lifecycle measures',
        async () => {
          const staff = await staffPrincipal(
            db,
            { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
            'APPLICANT_DIRECTORY_VIEW',
          );
          if (!staff.ok) return 'restricted' as const;
          const measures = await getLifecycleMeasures(db, staff.value);
          return measures.ok ? measures.value : ('unavailable' as const);
        },
        'unavailable' as const,
      ),
      t('learning areas', () => getProductAnalytics(db), {
        available: false as const,
        reason: 'schema_pending' as const,
      }),
      t('evidence storage', () => getPlatformEvidenceBytes(db), 0),
      t('AI cost', () => totalAiCostUnits(db), 0),
      t('AI limits', () => resolveAiLimits(db), defaultAiLimits()),
    ]);
    // OPS-03: these need the AI figures above, so they run after them. Each is
    // read tolerantly; `collectOperationalSignals` also isolates its own signals.
    const migrations = await t(
      'database migrations',
      () => getMigrationStatus(db, SHIPPED_MIGRATIONS),
      undefined,
    );
    const signals = await t(
      'operational signals',
      () =>
        collectOperationalSignals(db, {
          ...(!failedSections.includes('AI cost') && !failedSections.includes('AI limits')
            ? {
                ai: {
                  spentUnits: aiCostUnits,
                  warningUnits: aiWarningLimitUnits(),
                  limitUnits: aiLimits.budgetLimitUnits,
                },
              }
            : {}),
          ...(migrations ? { migrations } : {}),
        }),
      [],
    );
    const readiness = await t('platform readiness', () => evaluateReadiness(), null);
    // ADR 0025 T6: shown beside the readiness detail, never part of it (selling traveller plans
    // is optional, so it never makes the platform degraded).
    const travellerPlansDatabase = await t(
      'traveller plans',
      async () => ({
        personBilling: await personBillingPresent(db),
        refundGuard: await personRefundGuardPresent(db),
      }),
      null,
    );
    const travellerPlans = travellerPlansRow({
      selling: travellerPlansEnabled(),
      mode: paymentMode(),
      personBilling: travellerPlansDatabase?.personBilling ?? null,
      refundGuard: travellerPlansDatabase?.refundGuard ?? null,
    });
    const overview = await t(
      'platform overview',
      async () => {
        const result = await getPlatformOverview(db, {
          accountId,
          email,
          bootstrapEmails: bootstrapAdminEmails(),
        });
        if (!result.ok) throw new Error('Overview unavailable');
        return result.value;
      },
      null,
    );
    const deploymentMode = getDeploymentMode();
    // Finding #35 (post-programme defect register): the full commercial-
    // readiness gate breakdown (pentest, backup-restore attestation,
    // incident owner, etc.) must never be public: /api/health/ready now
    // reports only the aggregate `ready` boolean on a real deployment. This
    // authenticated, platform-admin-only page is where the full breakdown
    // lives instead. It is the same evaluation as the internal readiness
    // report above (S27): one read of the database-backed gates (AI provider
    // settings, scan runner proof), so the page and the report cannot differ.
    const commercial = deploymentMode === 'commercial' ? readiness?.commercial : undefined;
    const commercialCounts = commercial
      ? {
          satisfied: commercial.gates.filter((gate) => gate.satisfied).length,
          deferred: commercial.gates.filter((gate) => gate.deferral?.status === 'deferred').length,
        }
      : undefined;
    return {
      admin: true as const,
      overview,
      failedJobs,
      scorecard,
      lifecycleMeasures,
      analytics,
      platformEvidenceBytes,
      aiCostUnits,
      aiLimits,
      deploymentMode,
      commercial,
      commercialCounts,
      quota: loadUploadQuotaConfig(),
      signals,
      readiness,
      travellerPlans,
      failedSections,
      providerOperations: describeProviderOperations({
        ...(!failedSections.includes('evidence storage')
          ? { evidenceBytes: platformEvidenceBytes }
          : {}),
        ...(!failedSections.includes('AI cost') ? { aiCostUnits } : {}),
      }),
    };
  });

  const activityMaximum = Math.max(
    1,
    ...(data.admin
      ? (data.overview?.activity.flatMap((item) => [item.activated, item.cases]) ?? [])
      : []),
  );
  return (
    <section className="section container platform-operations">
      <PageHeader
        eyebrow="VisaStack Operations"
        title="Platform Overview"
        description="Platform health, readiness, capacity and pilot measurement."
        actions={
          data.admin ? (
            <>
              <a href="/app/admin/report" className="btn btn-secondary">
                Export Report
              </a>
              <a href="#admin-signals" className="btn btn-primary">
                View Alerts
              </a>
            </>
          ) : undefined
        }
      />

      {!data.admin ? (
        <AdminRestricted />
      ) : (
        <>
          <FailedSectionsBanner sections={data.failedSections} />
          {staffFactorMode() === 'off' ? (
            <output className="notice notice-warn u-mb-150">
              Authenticator codes are not required for staff yet.{' '}
              <a href="/app/staff-code?returnTo=%2Fapp%2Fadmin">Set up your authenticator app</a>.
            </output>
          ) : null}
          <div className="admin-reference-metrics">
            {[
              {
                label: 'Registered Accounts',
                value: data.overview?.accounts,
                hint: 'Current account records',
              },
              {
                label: 'Traveller Records',
                value: data.overview?.travellers,
                hint: 'Saved records, not active-user counts',
              },
              {
                label: 'Agencies',
                value: data.overview?.agencies,
                hint: 'Current organization records',
              },
              {
                label: 'Approved File Versions',
                value: data.overview
                  ? data.overview.terminalVersions
                    ? `${Math.round((100 * data.overview.approvedVersions) / data.overview.terminalVersions)}%`
                    : 'Not Measured'
                  : undefined,
                hint: 'Approved among terminal file-version outcomes',
              },
            ].map((metric) => (
              <article className="card admin-summary-metric" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value ?? 'Unavailable'}</strong>
                <small>{metric.hint}</small>
              </article>
            ))}
          </div>
          <div className="admin-operational-summary">
            <a href="#admin-signals" className="card admin-summary-metric">
              <span>Signals Needing Attention</span>
              <strong>
                {data.failedSections.includes('operational signals')
                  ? 'Unavailable'
                  : data.signals.filter(
                      (signal) => signal.status === 'warning' || signal.status === 'critical',
                    ).length}
              </strong>
              <small>Warnings and critical signals, not unmeasured checks</small>
            </a>
            <a href="#admin-processing" className="card admin-summary-metric">
              <span>Failed Intake Jobs</span>
              <strong>
                {data.failedSections.includes('failed jobs')
                  ? 'Unavailable'
                  : data.failedJobs.total}
              </strong>
              <small>Recorded failures available for review</small>
            </a>
            <a href="#admin-platform-readiness" className="card admin-summary-metric">
              <span>Platform Readiness</span>
              <strong>
                {data.readiness
                  ? data.readiness.ready
                    ? 'Ready'
                    : 'Needs Attention'
                  : 'Unavailable'}
              </strong>
              <small>Deployment checks, separate from full beta acceptance</small>
            </a>
          </div>
          <article className="card admin-failed-jobs" id="admin-processing">
            <p className="card-kicker">Processing</p>
            <h2 className="card-title">Failed Intake Jobs</h2>
            <p className="card-body">
              Emails that did not arrive have their own page.{' '}
              <Link href="/app/admin/email">Open Email Delivery</Link>
            </p>
            {data.failedJobs.items.length === 0 ? (
              jobsBefore ? (
                <QueuePastEnd
                  pathname={OVERVIEW_PATH}
                  search={search}
                  param="jobsBefore"
                  landOn={JOBS_PANEL}
                  what="No older failed jobs."
                />
              ) : (
                <p className="card-body">
                  No failed jobs. A job is parked here only after it exhausts every retry attempt.
                </p>
              )
            ) : (
              <>
                <QueuePanel
                  id={JOBS_PANEL}
                  label="Failed Intake Jobs"
                  kindLabel="Error"
                  pageKey={jobsBefore ?? 'first'}
                  items={data.failedJobs.items.map((job) => ({
                    id: job.id,
                    className: 'failed-job-row',
                    ...(job.errorCode ? { kind: job.errorCode } : {}),
                    find: `${job.documentName} ${job.lastError ?? ''}`,
                    node: (
                      <>
                        <div className="failed-job-head">
                          <span className="row-key failed-job-name">{job.documentName}</span>
                          <span className="row-end">
                            {job.errorCode ? (
                              <span className="badge badge-neutral">{job.errorCode}</span>
                            ) : null}
                            <span className="badge badge-danger">
                              {job.attempts}/{job.maxAttempts} attempts
                            </span>
                            <RetryJobButton jobId={job.id} />
                          </span>
                        </div>
                        {job.lastError ? (
                          <span className="muted failed-job-error">{job.lastError}</span>
                        ) : null}
                      </>
                    ),
                  }))}
                />
                <QueuePaging
                  pathname={OVERVIEW_PATH}
                  search={search}
                  param="jobsBefore"
                  cursor={data.failedJobs.nextCursor}
                  later={jobsBefore !== undefined}
                  landOn={JOBS_PANEL}
                  shown={data.failedJobs.items.length}
                  total={data.failedJobs.total}
                  noun={{ one: 'failed job', other: 'failed jobs' }}
                />
              </>
            )}
          </article>
          <div className="admin-overview-groups" id={GROUPS_SCOPE}>
            {/* A section link (View Alerts, Platform Readiness, a summary count) opens its group. */}
            <OpenGroupOnLink scopeId={GROUPS_SCOPE} />
            <h2 className="sr-only">More Operational Details and Tools</h2>
            <details className="admin-overview-controls admin-overview-group">
              <summary>Activity and Adoption</summary>
              <div className="admin-overview-group-body">
                <article className="card admin-activity-chart">
                  <p className="card-kicker">Activation and Adoption</p>
                  <h2 className="card-title">Recorded Activity, Last 30 Days</h2>
                  <p className="card-body">
                    Accounts reaching their first case and cases started, grouped by UTC day. These
                    are event counts, not a count of active users.
                  </p>
                  {data.overview ? (
                    <>
                      <div className="admin-chart-legend">
                        <span>First-case activations</span>
                        <span>Cases started</span>
                      </div>
                      <div
                        className="admin-daily-chart"
                        role="img"
                        aria-label="Daily first-case activations and cases started, with exact counts in the table below"
                      >
                        {data.overview.activity.map((day) => {
                          return (
                            <div
                              key={day.day}
                              title={`${day.day}: ${day.activated} activations, ${day.cases} cases`}
                            >
                              <span
                                style={{ height: `${(100 * day.activated) / activityMaximum}%` }}
                              />
                              <span style={{ height: `${(100 * day.cases) / activityMaximum}%` }} />
                            </div>
                          );
                        })}
                      </div>
                      <details>
                        <summary>Exact Daily Counts</summary>
                        <table className="data-table">
                          <caption>Recorded Activity by UTC Day</caption>
                          <thead>
                            <tr>
                              <th scope="col">Day</th>
                              <th scope="col">First-Case Activations</th>
                              <th scope="col">Cases Started</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.overview.activity.map((day) => (
                              <tr key={day.day}>
                                <th scope="row">{day.day}</th>
                                <td>{day.activated}</td>
                                <td>{day.cases}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    </>
                  ) : (
                    <p role="alert">Activity counts are unavailable. No trend is inferred.</p>
                  )}
                </article>
              </div>
            </details>
            <details className="admin-overview-controls admin-overview-group">
              <summary>Product Scorecard</summary>
              <div className="admin-overview-group-body">
                <article className="card u-mb-150">
                  <p className="card-kicker">Pilot Measurement</p>
                  <h2 className="card-title">Product Scorecard</h2>
                  <p className="card-body u-mb-100">
                    Real usage milestones, counted from an append-only event log - no PII, no
                    free-text properties.
                  </p>
                  <div className="rows rows-grid admin-scorecard">
                    {data.scorecard.map((row) => (
                      <div className="row" key={row.eventType}>
                        <span className="row-key">{SCORECARD_LABELS[row.eventType]}</span>
                        <span className="row-end">
                          <span className="muted u-fs-085">{row.last7Days} last 7 days</span>
                          <span className="badge badge-neutral">{row.total} total</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
                <LifecycleMeasuresCard measures={data.lifecycleMeasures} />
              </div>
            </details>
            <details className="admin-overview-controls admin-overview-group">
              <summary>Providers and Capacity</summary>
              <div className="admin-overview-group-body admin-reference-rail">
                <article className="card u-mt-150" id="admin-provider-operations">
                  <p className="card-kicker">Providers and Recovery</p>
                  <h2 className="card-title">Providers</h2>
                  <p className="card-body">
                    Recorded usage, configured services and unverified readings are shown
                    separately. Check provider account limits before changing plans. Founding access
                    stays complimentary.
                  </p>
                  <p className="card-body">
                    <a
                      href="https://github.com/sadatnitex/visastack/actions/workflows/database-restore-drill.yml"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Backup Recovery Checks
                    </a>
                  </p>
                  <dl className="rows provider-readings">
                    {data.providerOperations.map((row) => (
                      <div key={row.label} className="row">
                        <dt className="provider-reading-head">
                          <span className="row-key">{row.label}</span>
                          <span className={`badge ${PROVIDER_STATUS_TONE[row.standing]}`}>
                            {row.standing}
                          </span>
                        </dt>
                        <dd className="provider-reading-body">
                          <span>{row.headline}</span>
                          <details>
                            <summary>Show Technical Detail</summary>
                            <p>
                              Reading: <strong>{row.reading}</strong>
                            </p>
                            <p className="muted">Source: {row.source}</p>
                            <p>{row.detail}</p>
                          </details>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </article>
                <article className="card" id="admin-usage">
                  <p className="card-kicker">Capacity</p>
                  <h2 className="card-title">Platform Storage</h2>
                  <p className="card-body u-mb-125">
                    Tracked evidence bytes across every account. New uploads are refused once the
                    platform hits its hard stop; the warning threshold below is purely informational
                    - it is not itself enforced anywhere.
                  </p>
                  {data.failedSections.includes('evidence storage') ? (
                    <p className="card-body">
                      Evidence storage could not be read. Usage and remaining capacity are
                      unavailable.
                    </p>
                  ) : (
                    <UsageMeter
                      label="Evidence Storage (Platform-Wide)"
                      usedBytes={data.platformEvidenceBytes}
                      limitBytes={data.quota.platformHardStopBytes}
                      warnBytes={data.quota.platformWarningBytes}
                    />
                  )}
                </article>
                <article className="card u-mt-150">
                  <p className="card-kicker">Capacity</p>
                  <h2 className="card-title">AI Gateway Spend</h2>
                  <p className="card-body u-mb-125">
                    Lifetime-to-date spend against the configured pilot cap (never resets
                    automatically - raising the limit is a deliberate operator action, not a monthly
                    rollover). A cache hit costs nothing and does not add to this total. The cap
                    shown here is whichever currently governs dispatch -- an ACTIVE AI Gateway
                    configuration's own budget once one exists, environment variables otherwise; the
                    warning threshold has no per-configuration equivalent yet and always comes from
                    the environment.
                  </p>
                  {(() => {
                    if (
                      data.failedSections.includes('AI cost') ||
                      data.failedSections.includes('AI limits')
                    ) {
                      return (
                        <p className="card-body">
                          AI usage or its limit could not be read. Spend and remaining capacity are
                          unavailable.
                        </p>
                      );
                    }
                    const usedUsd = unitsToUsd(data.aiCostUnits);
                    const limitUsd = unitsToUsd(data.aiLimits.budgetLimitUnits);
                    const warnUsd = unitsToUsd(aiWarningLimitUnits());
                    const fraction = limitUsd > 0 ? Math.min(1, usedUsd / limitUsd) : 0;
                    const tone =
                      usedUsd >= limitUsd ? 'meter-full' : usedUsd >= warnUsd ? 'meter-warn' : '';
                    return (
                      <div>
                        <div className="meter-label">
                          <span>AI extraction spend (approximate)</span>
                          <span>
                            ${usedUsd.toFixed(2)} of ${limitUsd.toFixed(2)} used
                          </span>
                        </div>
                        <div className="meter">
                          <div
                            className={`meter-fill ${tone}`.trim()}
                            style={{ width: `${Math.round(fraction * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}
                </article>
              </div>
            </details>
            <details className="admin-overview-controls admin-overview-group">
              <summary>All Operational Signals</summary>
              <div className="admin-overview-group-body">
                <article className="card" id="admin-signals">
                  <p className="card-kicker">Operations</p>
                  <h2 className="card-title">Operational Signals</h2>
                  <p className="card-body u-mb-100">
                    What an operator needs to tell whether the platform is healthy. Counts, ages and
                    ratios only: nothing here names a person or a document. The thresholds are pilot
                    defaults that have not been calibrated against real traffic, and they only
                    choose a colour. "Not Measured" means the application cannot see it from inside;
                    the explanation says where to look.
                  </p>
                  {data.signals.length === 0 ? (
                    <p className="card-body">
                      The signals could not be loaded; see the notice above.
                    </p>
                  ) : (
                    <div className="rows rows-grid">
                      {data.signals.map((signal) => (
                        <div
                          className="row"
                          key={signal.key}
                          style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '0.75rem',
                            }}
                          >
                            <span className="row-key">{signal.label}</span>
                            <span className={`badge ${SIGNAL_STATUS_TONE[signal.status]}`}>
                              {SIGNAL_STATUS_LABEL[signal.status]}
                            </span>
                          </div>
                          <span className="muted u-fs-085">{signal.reading}</span>
                          <details>
                            <summary
                              className="muted"
                              style={{ fontSize: 'var(--text-small)', cursor: 'pointer' }}
                            >
                              What This Means
                            </summary>
                            <p className="card-body" style={{ marginTop: '0.4rem' }}>
                              {signal.detail}
                            </p>
                          </details>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              </div>
            </details>
            <details className="admin-overview-controls admin-overview-group">
              <summary>Readiness</summary>
              <div className="admin-overview-group-body">
                <p className="card-body">
                  <a href="/status">Public Status Page</a>: what anyone can see about the service
                  right now.
                </p>
                <article className="card u-mb-150" id="admin-platform-readiness">
                  <p className="card-kicker">Operations</p>
                  <h2 className="card-title">Platform Readiness Detail</h2>
                  <p className="card-body u-mb-100">
                    The detailed view behind the public readiness probe, which on a deployed build
                    says only "ready" or "degraded". It names missing configuration and pending
                    migrations, so it is shown to platform administrators only. It never shows a
                    value.
                  </p>
                  {data.readiness === null ? (
                    <p className="card-body">
                      Readiness could not be evaluated; see the notice above.
                    </p>
                  ) : (
                    <div className="rows rows-grid">
                      {(() => {
                        const r = data.readiness;
                        const missingSignIn = Object.entries(r.env.signIn)
                          .filter(([, present]) => !present)
                          .map(([name]) => name);
                        const databaseConfigured = Object.values(r.env.database).some(Boolean);
                        const rows: ReadonlyArray<readonly [string, string, boolean]> = [
                          [
                            'Overall',
                            r.ready ? 'Ready' : 'Degraded: something required is missing',
                            r.ready,
                          ],
                          ['Deployment mode', r.deploymentMode, true],
                          [
                            'Database',
                            !databaseConfigured
                              ? 'no connection string configured'
                              : r.db.connected
                                ? `connected${r.db.schemaApplied ? ', schema present' : ', schema missing'}`
                                : 'could not connect',
                            r.db.connected && r.db.schemaApplied,
                          ],
                          [
                            'Migrations',
                            r.migrations.checked
                              ? r.migrations.pending.length === 0
                                ? `${r.migrations.applied} of ${r.migrations.expected} applied`
                                : `${r.migrations.pending.length} pending: ${r.migrations.pending.join(', ')}`
                              : 'not checked',
                            !r.migrations.checked || r.migrations.pending.length === 0,
                          ],
                          [
                            'Provider settings',
                            r.providers.valid ? 'valid' : (r.providers.error ?? 'invalid'),
                            r.providers.valid,
                          ],
                          [
                            'Hosting settings',
                            r.hosting.ready ? 'complete' : (r.hosting.problem ?? 'incomplete'),
                            r.hosting.ready,
                          ],
                          [
                            'Sign-in configuration',
                            missingSignIn.length === 0
                              ? 'complete'
                              : `missing: ${missingSignIn.join(', ')}`,
                            missingSignIn.length === 0,
                          ],
                          [
                            'Signed document links',
                            r.capabilities.signedBlobStorage ? 'configured' : 'not configured',
                            true,
                          ],
                          [
                            'Scheduled job secret',
                            r.capabilities.asyncIntakeSweep ? 'configured' : 'not configured',
                            true,
                          ],
                          ['Traveller Plans', data.travellerPlans.value, data.travellerPlans.good],
                        ];
                        return rows.map(([label, value, good]) => (
                          <div className="row" key={label}>
                            <span className="row-key">{label}</span>
                            <span
                              className={good ? 'muted' : 'badge badge-danger'}
                              style={{ fontSize: 'var(--text-small)' }}
                            >
                              {value}
                            </span>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </article>
                <article className="card" id="admin-readiness">
                  <p className="card-kicker">Operational Posture</p>
                  <h2 className="card-title">Commercial Readiness</h2>
                  <p className="card-body u-mb-100">
                    The full per-gate breakdown behind commercial mode's guard - deliberately{' '}
                    <strong>not</strong> public. An unauthenticated caller (including the public{' '}
                    <code>/status</code> page) only ever sees the aggregate ready/not-ready boolean.
                  </p>
                  {data.deploymentMode === 'commercial' && !data.commercial ? (
                    <p className="card-body">
                      Commercial readiness could not be evaluated; see the notice above.
                    </p>
                  ) : !data.commercial ? (
                    <p className="card-body" style={{ marginBottom: 0 }}>
                      Deployment mode is <strong>{data.deploymentMode}</strong>, not{' '}
                      <code>commercial</code> - this guard does not apply yet.
                    </p>
                  ) : (
                    <>
                      <div className="toolbar u-mb-100">
                        <span className="muted u-fs-085">
                          {data.commercialCounts?.satisfied ?? 0} of {data.commercial.gates.length}{' '}
                          gates satisfied
                          {data.commercialCounts && data.commercialCounts.deferred > 0
                            ? `, ${data.commercialCounts.deferred} of them deferred by the owner`
                            : ''}
                        </span>
                        <span
                          className={
                            data.commercial.ready ? 'badge badge-success' : 'badge badge-danger'
                          }
                        >
                          {data.commercial.ready ? 'ready' : 'not ready'}
                        </span>
                      </div>
                      <div className="rows rows-grid">
                        {data.commercial.gates.map((gate) => {
                          const status = gateStatus(gate);
                          return (
                            <div className="row" key={gate.key}>
                              <span className="row-key">
                                {gate.label}
                                {gate.deferral?.status === 'not_deferred' ? (
                                  <span className="muted u-fs-085"> ({gate.deferral.label})</span>
                                ) : null}
                                {gate.detail ? (
                                  <span className="muted u-fs-085"> {gate.detail}</span>
                                ) : null}
                              </span>
                              <span className={`badge badge-${status.tone}`}>{status.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </article>
              </div>
            </details>
            <details className="admin-overview-controls admin-overview-group">
              <summary>Learning Areas</summary>
              <div className="admin-overview-group-body">
                <article className="card" id="admin-analytics">
                  <p className="card-kicker">Pilot Measurement</p>
                  <h2 className="card-title">Learning Areas</h2>
                  <p className="card-body u-mb-100">
                    Aggregates only, from the same event log. Nothing here names a person, a case, a
                    document or what anyone wrote. Figures are counts and timings; they say how the
                    pilot is behaving, not whether any application will succeed.
                  </p>
                  {data.analytics.available ? (
                    <>
                      <div className="rows rows-grid u-mb-125">
                        {data.analytics.categories.map((category) => (
                          <div className="row" key={category.key}>
                            <span className="row-key">{category.label}</span>
                            <span className="row-end">
                              <span className="muted u-fs-085">
                                {category.last7Days} last 7 days, {category.last30Days} last 30 days
                              </span>
                              <span className="badge badge-neutral">{category.total} total</span>
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="rows rows-grid">
                        {(
                          [
                            ['Intake to ready (first time)', data.analytics.intakeToReady],
                            ['Complaint open to ended', data.analytics.complaintResolution],
                            ['Sign-up to first case', data.analytics.activationDelay],
                          ] as const
                        ).map(([label, summary]) => (
                          <div className="row" key={label}>
                            <span className="row-key">{label}</span>
                            <span className="muted u-fs-085">
                              {summary.count === 0
                                ? 'no data yet'
                                : `median ${formatDuration(summary.medianSeconds)}, 90th percentile ${formatDuration(summary.p90Seconds)} (${summary.count})`}
                            </span>
                          </div>
                        ))}
                        <div className="row">
                          <span className="row-key">Agencies Active, Last 90 Days</span>
                          <span className="muted u-fs-085">
                            {data.analytics.agencyRepeatUse.activeOrganizations} created a case,{' '}
                            {data.analytics.agencyRepeatUse.repeatOrganizations} in two or more
                            different weeks
                          </span>
                        </div>
                        <div className="row">
                          <span className="row-key">AI Proposals Decided</span>
                          <span className="muted u-fs-085">
                            {data.analytics.aiDecisions.accepted} accepted,{' '}
                            {data.analytics.aiDecisions.corrected} corrected,{' '}
                            {data.analytics.aiDecisions.rejected} rejected
                          </span>
                        </div>
                        {(
                          [
                            ['Cases by Stage Entered', data.analytics.casesByStage],
                            ['Case Outcomes', data.analytics.outcomes],
                            ['Plan Limits Reached', data.analytics.planLimitHits],
                          ] as const
                        ).map(([label, counts]) => (
                          <div className="row" key={label}>
                            <span className="row-key">{label}</span>
                            <span className="muted u-fs-085">
                              {counts.length === 0
                                ? 'none yet'
                                : counts
                                    .map((c) => `${humanizeLabel(c.label)} ${c.count}`)
                                    .join(', ')}
                            </span>
                          </div>
                        ))}
                        <div className="row">
                          <span className="row-key">Cash collected (not invoiced)</span>
                          <span className="muted u-fs-085">
                            {data.analytics.cashCollected.length === 0
                              ? 'none recorded yet'
                              : data.analytics.cashCollected
                                  .map(
                                    (c) =>
                                      `${formatMinorUnits(c.minorUnits, c.currency)} in ${c.collections}`,
                                  )
                                  .join(', ')}
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="card-body">
                      Waiting for a database update. These figures appear once the latest database
                      migration has been applied; nothing else is affected in the meantime.
                    </p>
                  )}
                </article>
              </div>
            </details>
            <details className="admin-overview-controls admin-overview-group">
              <summary>Storage Integrity</summary>
              <div className="admin-overview-group-body">
                <article className="card u-mt-150">
                  <p className="card-kicker">Storage Integrity</p>
                  <h2 className="card-title">Orphan Reconciliation</h2>
                  <p className="card-body u-mb-125">
                    Detects drift between storage metadata and actual bytes: dangling references,
                    blobs with no reference, duplicate references, and size/hash mismatches. Cleanup
                    only ever removes a metadata row with no backing bytes and no remaining document
                    - it never deletes bytes that still exist.
                  </p>
                  <ReconcileButtons />
                </article>
              </div>
            </details>
          </div>
        </>
      )}
    </section>
  );
}
