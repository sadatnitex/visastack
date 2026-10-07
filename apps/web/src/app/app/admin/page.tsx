import { getMigrationStatus } from '@visastack/db';
import {
  type OperationalSignal,
  type ProductEventType,
  collectOperationalSignals,
  getPilotScorecard,
  getPlatformEvidenceBytes,
  getProductAnalytics,
  listFailedJobs,
  loadUploadQuotaConfig,
  totalAiCostUnits,
} from '@visastack/services';
import type { Metadata } from 'next';
import { PageHeader } from '../../../components/ui';
import { isPlatformAdmin } from '../../../lib/admin';
import { aiWarningLimitUnits, defaultAiLimits, resolveAiLimits, unitsToUsd } from '../../../lib/ai';
import { formatDuration, formatMinorUnits, humanizeLabel } from '../../../lib/analytics-format';
import { evaluateCommercialReadiness } from '../../../lib/commercial-readiness';
import { getDeploymentMode } from '../../../lib/deployment-mode';
import { SHIPPED_MIGRATIONS } from '../../../lib/migration-journal';
import { evaluateReadiness } from '../../../lib/readiness';
import { withSession } from '../../../lib/session';
import { tolerantReader } from '../../../lib/tolerate';
import { UsageMeter } from '../applicant/[id]/usage-meter';
import { RetryJobButton } from './action-buttons';
import { AdminRestricted } from './admin-restricted';
import { FailedSectionsBanner } from './failed-sections-banner';
import { ReconcileButtons } from './reconcile-buttons';

export const metadata: Metadata = { title: 'Platform operations' };

export const dynamic = 'force-dynamic';

const SCORECARD_LABELS: Record<ProductEventType, string> = {
  ACCOUNT_CREATED: 'Accounts created',
  APPLICANT_CREATED: 'Applicant records added',
  DOCUMENT_UPLOADED: 'Documents uploaded',
  MISSION_CREATED: 'Cases started',
  GRANT_CREATED: 'Grants created',
  AI_EXTRACTION_RUN: 'AI extractions run',
  AI_OCR_RUN: 'AI OCR runs',
  AI_CLASSIFICATION_RUN: 'AI classifications run',
  AI_INCONSISTENCY_RUN: 'AI inconsistency checks run',
  MISSION_STAGE_CHANGED: 'Case stage changes',
  MISSION_READY_REACHED: 'Cases first reaching ready',
  EVIDENCE_REQUESTED: 'Evidence requested',
  EVIDENCE_RECEIVED: 'Evidence received',
  EVIDENCE_REWORK_REQUESTED: 'Evidence sent back for rework',
  TASK_OVERDUE: 'Tasks gone overdue',
  READINESS_GAPS_DETECTED: 'Readiness checks at capture',
  ACKNOWLEDGEMENT_RECORDED: 'Applicant acknowledgement decisions',
  ACKNOWLEDGEMENT_INVALIDATED: 'Acknowledgements voided by a change',
  SOURCE_REVIEWED: 'Official source reviews',
  AI_PROPOSAL_ACCEPTED: 'AI proposals accepted',
  AI_PROPOSAL_CORRECTED: 'AI proposals corrected',
  AI_PROPOSAL_REJECTED: 'AI proposals rejected',
  OUTCOME_RECORDED: 'Case outcomes recorded',
  COMPLAINT_RESOLVED: 'Complaints ended',
  ACCOUNT_ACTIVATED: 'Accounts activated (first case)',
  PLAN_CHANGED: 'Plan changes',
  PLAN_LIMIT_REACHED: 'Plan limits reached',
  CASH_COLLECTED: 'Cash collections recorded',
};

const SIGNAL_STATUS_LABEL: Record<OperationalSignal['status'], string> = {
  ok: 'OK',
  warning: 'Warning',
  critical: 'Critical',
  not_measured: 'Not measured',
  not_built: 'Not built',
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
export default async function AdminOperationsPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    // Sections that cannot be read (typically a table a pending migration has not
    // created) are left empty and named in a banner. The permission check above is
    // NOT wrapped: an authorization failure must stay an error.
    const { read: t, failed: failedSections } = tolerantReader();
    const [failedJobs, scorecard, analytics, platformEvidenceBytes, aiCostUnits, aiLimits] =
      await Promise.all([
        t('failed jobs', () => listFailedJobs(db), []),
        t('product scorecard', () => getPilotScorecard(db), []),
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
          ai: {
            spentUnits: aiCostUnits,
            warningUnits: aiWarningLimitUnits(),
            limitUnits: aiLimits.budgetLimitUnits,
          },
          ...(migrations ? { migrations } : {}),
        }),
      [],
    );
    const readiness = await t('platform readiness', () => evaluateReadiness(), null);
    const deploymentMode = getDeploymentMode();
    // Finding #35 (post-programme defect register): the full commercial-
    // readiness gate breakdown (pentest, backup-restore attestation,
    // incident owner, etc.) must never be public: /api/health/ready now
    // reports only the aggregate `ready` boolean on a real deployment. This
    // authenticated, platform-admin-only page is where the full breakdown
    // lives instead. `databaseReady: true` is sound here, not assumed: every
    // query above already succeeded against this same `db` handle by the
    // time this line runs, in this same request.
    const commercial =
      deploymentMode === 'commercial'
        ? evaluateCommercialReadiness({ databaseReady: true })
        : undefined;
    return {
      admin: true as const,
      failedJobs,
      scorecard,
      analytics,
      platformEvidenceBytes,
      aiCostUnits,
      aiLimits,
      deploymentMode,
      commercial,
      quota: loadUploadQuotaConfig(),
      signals,
      readiness,
      failedSections,
    };
  });

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform"
        title="Operations"
        description="Platform health, readiness, capacity and pilot measurement."
      />

      {!data.admin ? (
        <AdminRestricted />
      ) : (
        <>
          <FailedSectionsBanner sections={data.failedSections} />
          <nav aria-label="On this page" className="pill-list" style={{ marginBottom: '1.5rem' }}>
            <a href="/status" className="pill">
              Public status page
            </a>
            <a href="#admin-signals" className="pill">
              Signals
            </a>
            <a href="#admin-platform-readiness" className="pill">
              Readiness detail
            </a>
            <a href="#admin-analytics" className="pill">
              Learning areas
            </a>
            <a href="#admin-readiness" className="pill">
              Commercial readiness
            </a>
            <a href="#admin-processing" className="pill">
              Processing failures
            </a>
            <a href="#admin-usage" className="pill">
              Capacity
            </a>
          </nav>

          <article className="card" style={{ marginBottom: '1.5rem' }}>
            <p className="card-kicker">Pilot measurement</p>
            <h2 className="card-title">Product scorecard</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              Real usage milestones, counted from an append-only event log - no PII, no free-text
              properties.
            </p>
            <div className="rows">
              {data.scorecard.map((row) => (
                <div className="row" key={row.eventType}>
                  <span className="row-key">{SCORECARD_LABELS[row.eventType]}</span>
                  <span className="row-end">
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {row.last7Days} last 7 days
                    </span>
                    <span className="badge badge-neutral">{row.total} total</span>
                  </span>
                </div>
              ))}
            </div>
          </article>

          <article className="card" style={{ marginBottom: '1.5rem' }} id="admin-signals">
            <p className="card-kicker">Operations</p>
            <h2 className="card-title">Operational signals</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              What an operator needs to tell whether the platform is healthy. Counts, ages and
              ratios only: nothing here names a person or a document. The thresholds are pilot
              defaults that have not been calibrated against real traffic, and they only choose a
              colour. "Not measured" means the application cannot see it from inside; the
              explanation says where to look.
            </p>
            {data.signals.length === 0 ? (
              <p className="card-body">The signals could not be loaded; see the notice above.</p>
            ) : (
              <div className="rows">
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
                    <span className="muted" style={{ fontSize: '0.85rem' }}>
                      {signal.reading}
                    </span>
                    <details>
                      <summary className="muted" style={{ fontSize: '0.8rem', cursor: 'pointer' }}>
                        What this means
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

          <article
            className="card"
            style={{ marginBottom: '1.5rem' }}
            id="admin-platform-readiness"
          >
            <p className="card-kicker">Operations</p>
            <h2 className="card-title">Platform readiness detail</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              The detailed view behind the public readiness probe, which on a deployed build says
              only "ready" or "degraded". It names missing configuration and pending migrations, so
              it is shown to platform administrators only. It never shows a value.
            </p>
            {data.readiness === null ? (
              <p className="card-body">Readiness could not be evaluated; see the notice above.</p>
            ) : (
              <div className="rows">
                {(() => {
                  const r = data.readiness;
                  const missingSignIn = [
                    ...Object.entries(r.env.workos)
                      .filter(([, present]) => !present)
                      .map(([name]) => name),
                    ...(r.env.redirectUri ? [] : ['NEXT_PUBLIC_WORKOS_REDIRECT_URI']),
                  ];
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
                  ];
                  return rows.map(([label, value, good]) => (
                    <div className="row" key={label}>
                      <span className="row-key">{label}</span>
                      <span
                        className={good ? 'muted' : 'badge badge-danger'}
                        style={{ fontSize: '0.85rem' }}
                      >
                        {value}
                      </span>
                    </div>
                  ));
                })()}
              </div>
            )}
          </article>

          <article className="card" style={{ marginBottom: '1.5rem' }} id="admin-analytics">
            <p className="card-kicker">Pilot measurement</p>
            <h2 className="card-title">Learning areas</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              Aggregates only, from the same event log. Nothing here names a person, a case, a
              document or what anyone wrote. Figures are counts and timings; they say how the pilot
              is behaving, not whether any application will succeed.
            </p>
            {data.analytics.available ? (
              <>
                <div className="rows" style={{ marginBottom: '1.25rem' }}>
                  {data.analytics.categories.map((category) => (
                    <div className="row" key={category.key}>
                      <span className="row-key">{category.label}</span>
                      <span className="row-end">
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          {category.last7Days} last 7 days, {category.last30Days} last 30 days
                        </span>
                        <span className="badge badge-neutral">{category.total} total</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="rows">
                  {(
                    [
                      ['Intake to ready (first time)', data.analytics.intakeToReady],
                      ['Complaint open to ended', data.analytics.complaintResolution],
                      ['Sign-up to first case', data.analytics.activationDelay],
                    ] as const
                  ).map(([label, summary]) => (
                    <div className="row" key={label}>
                      <span className="row-key">{label}</span>
                      <span className="muted" style={{ fontSize: '0.85rem' }}>
                        {summary.count === 0
                          ? 'no data yet'
                          : `median ${formatDuration(summary.medianSeconds)}, 90th percentile ${formatDuration(summary.p90Seconds)} (${summary.count})`}
                      </span>
                    </div>
                  ))}
                  <div className="row">
                    <span className="row-key">Agencies active, last 90 days</span>
                    <span className="muted" style={{ fontSize: '0.85rem' }}>
                      {data.analytics.agencyRepeatUse.activeOrganizations} created a case,{' '}
                      {data.analytics.agencyRepeatUse.repeatOrganizations} in two or more different
                      weeks
                    </span>
                  </div>
                  <div className="row">
                    <span className="row-key">AI proposals decided</span>
                    <span className="muted" style={{ fontSize: '0.85rem' }}>
                      {data.analytics.aiDecisions.accepted} accepted,{' '}
                      {data.analytics.aiDecisions.corrected} corrected,{' '}
                      {data.analytics.aiDecisions.rejected} rejected
                    </span>
                  </div>
                  {(
                    [
                      ['Cases by stage entered', data.analytics.casesByStage],
                      ['Case outcomes', data.analytics.outcomes],
                      ['Plan limits reached', data.analytics.planLimitHits],
                    ] as const
                  ).map(([label, counts]) => (
                    <div className="row" key={label}>
                      <span className="row-key">{label}</span>
                      <span className="muted" style={{ fontSize: '0.85rem' }}>
                        {counts.length === 0
                          ? 'none yet'
                          : counts.map((c) => `${humanizeLabel(c.label)} ${c.count}`).join(', ')}
                      </span>
                    </div>
                  ))}
                  <div className="row">
                    <span className="row-key">Cash collected (not invoiced)</span>
                    <span className="muted" style={{ fontSize: '0.85rem' }}>
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

          <article className="card" style={{ marginBottom: '1.5rem' }} id="admin-readiness">
            <p className="card-kicker">Operational posture</p>
            <h2 className="card-title">Commercial readiness</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              The full per-gate breakdown behind commercial mode's guard - deliberately{' '}
              <strong>not</strong> public. An unauthenticated caller (including the public{' '}
              <code>/status</code> page) only ever sees the aggregate ready/not-ready boolean.
            </p>
            {!data.commercial ? (
              <p className="card-body" style={{ marginBottom: 0 }}>
                Deployment mode is <strong>{data.deploymentMode}</strong>, not{' '}
                <code>commercial</code> - this guard does not apply yet.
              </p>
            ) : (
              <>
                <div className="toolbar" style={{ marginBottom: '1rem' }}>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {data.commercial.gates.filter((g) => g.satisfied).length} of{' '}
                    {data.commercial.gates.length} gates satisfied
                  </span>
                  <span
                    className={data.commercial.ready ? 'badge badge-success' : 'badge badge-danger'}
                  >
                    {data.commercial.ready ? 'ready' : 'not ready'}
                  </span>
                </div>
                <div className="rows">
                  {data.commercial.gates.map((gate) => (
                    <div className="row" key={gate.key}>
                      <span className="row-key">{gate.label}</span>
                      <span
                        className={gate.satisfied ? 'badge badge-success' : 'badge badge-danger'}
                      >
                        {gate.satisfied ? 'satisfied' : 'unmet'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </article>

          <article className="card" style={{ marginTop: '1.5rem' }} id="admin-processing">
            <p className="card-kicker">Processing</p>
            <h2 className="card-title">Failed intake jobs</h2>
            {data.failedJobs.length === 0 ? (
              <p className="card-body">
                No failed jobs. A job is parked here only after it exhausts every retry attempt.
              </p>
            ) : (
              <div className="rows" style={{ marginTop: '0.5rem' }}>
                {data.failedJobs.map((job) => (
                  <div
                    className="row"
                    key={job.id}
                    style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.75rem',
                      }}
                    >
                      <span className="row-key" style={{ wordBreak: 'break-word' }}>
                        {job.documentName}
                      </span>
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
                      <span
                        className="muted"
                        style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}
                      >
                        {job.lastError}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="card" style={{ marginTop: '1.5rem' }} id="admin-usage">
            <p className="card-kicker">Capacity</p>
            <h2 className="card-title">Platform storage</h2>
            <p className="card-body" style={{ marginBottom: '1.25rem' }}>
              Tracked evidence bytes across every account. New uploads are refused once the platform
              hits its hard stop; the warning threshold below is purely informational - it is not
              itself enforced anywhere.
            </p>
            <UsageMeter
              label="Evidence storage (platform-wide)"
              usedBytes={data.platformEvidenceBytes}
              limitBytes={data.quota.platformHardStopBytes}
              warnBytes={data.quota.platformWarningBytes}
            />
          </article>

          <article className="card" style={{ marginTop: '1.5rem' }}>
            <p className="card-kicker">Capacity</p>
            <h2 className="card-title">AI Gateway spend</h2>
            <p className="card-body" style={{ marginBottom: '1.25rem' }}>
              Lifetime-to-date spend against the configured pilot cap (never resets automatically -
              raising the limit is a deliberate operator action, not a monthly rollover). A cache
              hit costs nothing and does not add to this total. The cap shown here is whichever
              currently governs dispatch -- an ACTIVE AI Gateway configuration's own budget once one
              exists, environment variables otherwise; the warning threshold has no
              per-configuration equivalent yet and always comes from the environment.
            </p>
            {(() => {
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

          <article className="card" style={{ marginTop: '1.5rem' }}>
            <p className="card-kicker">Storage integrity</p>
            <h2 className="card-title">Orphan reconciliation</h2>
            <p className="card-body" style={{ marginBottom: '1.25rem' }}>
              Detects drift between storage metadata and actual bytes: dangling references, blobs
              with no reference, duplicate references, and size/hash mismatches. Cleanup only ever
              removes a metadata row with no backing bytes and no remaining document - it never
              deletes bytes that still exist.
            </p>
            <ReconcileButtons />
          </article>
        </>
      )}
    </section>
  );
}
