import { getMigrationStatus } from '@visastack/db';
import {
  type AuditEventRow,
  type OperationalSignal,
  type ProductEventType,
  collectOperationalSignals,
  documentsPastRetention,
  getPilotScorecard,
  getPlatformEvidenceBytes,
  getProductAnalytics,
  getRetentionPolicies,
  listActiveLegalHolds,
  listActivePlatformRoles,
  listAllApplicants,
  listAllOrganizations,
  listErasureJobsNeedingAttention,
  listFailedJobs,
  listInvitations,
  listRecentAuditEvents,
  loadUploadQuotaConfig,
  reportUnboundAccounts,
  totalAiCostUnits,
} from '@visastack/services';
import Link from 'next/link';
import { hasPlatformPermission, isPlatformAdmin, isPlatformOwnerAccount } from '../../../lib/admin';
import { aiWarningLimitUnits, defaultAiLimits, resolveAiLimits, unitsToUsd } from '../../../lib/ai';
import { formatDuration, formatMinorUnits, humanizeLabel } from '../../../lib/analytics-format';
import { evaluateCommercialReadiness } from '../../../lib/commercial-readiness';
import { getDeploymentMode } from '../../../lib/deployment-mode';
import { SHIPPED_MIGRATIONS } from '../../../lib/migration-journal';
import { evaluateReadiness } from '../../../lib/readiness';
import { withSession } from '../../../lib/session';
import { tolerate } from '../../../lib/tolerate';
import { UsageMeter } from '../applicant/[id]/usage-meter';
import {
  OrgReviewButtons,
  OrgSuspendButton,
  OrgTerminateButton,
  ReleaseHoldButton,
  RetryErasureJobButton,
  RetryJobButton,
  RevokeInvitationButton,
  RevokeRoleButton,
} from './action-buttons';
import { GrantRoleForm, InviteForm, LegalHoldForm, RetentionPolicyForm } from './admin-forms';
import { PurgeButton } from './purge-button';
import { ReconcileButtons } from './reconcile-buttons';

const PLATFORM_ROLE_LABELS: Record<string, string> = {
  PLATFORM_OWNER: 'Platform owner',
  SECURITY_ADMIN: 'Security admin',
  COMPLIANCE_ADMIN: 'Compliance admin',
  SUPPORT_ADMIN: 'Support admin',
  QUALITY_ADMIN: 'Quality admin',
};

export const dynamic = 'force-dynamic';

const SCORECARD_LABELS: Record<ProductEventType, string> = {
  ACCOUNT_CREATED: 'Accounts created',
  APPLICANT_CREATED: 'Applicant records added',
  DOCUMENT_UPLOADED: 'Documents uploaded',
  MISSION_CREATED: 'Missions started',
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

const ORG_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING_VERIFICATION: { label: 'Pending verification', tone: 'badge-warning' },
  ACTIVE: { label: 'Active', tone: 'badge-success' },
  SUSPENDED: { label: 'Suspended', tone: 'badge-danger' },
  REJECTED: { label: 'Rejected', tone: 'badge-danger' },
  CLOSED: { label: 'Closed', tone: 'badge-neutral' },
};

export default async function AdminPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    // Sections that cannot be read (typically a table a pending migration has not
    // created) are left empty and named in a banner. The permission checks below
    // are NOT wrapped: an authorization failure must stay an error.
    const failedSections: string[] = [];
    const t = <T,>(label: string, run: () => Promise<T>, fallback: T) =>
      tolerate(label, run, fallback, failedSections);
    const [
      policies,
      holds,
      orgs,
      failedJobs,
      erasureJobs,
      applicants,
      purgeEligible,
      scorecard,
      analytics,
      roles,
      unboundAccounts,
      owner,
      platformEvidenceBytes,
      auditEvents,
      aiCostUnits,
      invitations,
      canManageComplaints,
      canManageAiSettings,
      aiLimits,
    ] = await Promise.all([
      t('retention policies', () => getRetentionPolicies(db), []),
      t('legal holds', () => listActiveLegalHolds(db), []),
      t('organizations', () => listAllOrganizations(db), []),
      t('failed jobs', () => listFailedJobs(db), []),
      t('erasure jobs', () => listErasureJobsNeedingAttention(db), []),
      t('applicants', () => listAllApplicants(db), []),
      t('documents past retention', () => documentsPastRetention(db), []),
      t('product scorecard', () => getPilotScorecard(db), []),
      t('learning areas', () => getProductAnalytics(db), {
        available: false as const,
        reason: 'schema_pending' as const,
      }),
      t('platform roles', () => listActivePlatformRoles(db), []),
      t('unbound accounts', () => reportUnboundAccounts(db), []),
      isPlatformOwnerAccount(db, { accountId, email }),
      t('evidence storage', () => getPlatformEvidenceBytes(db), 0),
      t('audit events', () => listRecentAuditEvents(db, 50), []),
      t('AI cost', () => totalAiCostUnits(db), 0),
      t('invitations', () => listInvitations(db), []),
      hasPlatformPermission(db, { accountId, email }, 'COMPLAINT_MANAGE'),
      hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'),
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
    // incident owner, etc.) must never be public — /api/health/ready now
    // reports only the aggregate `ready` boolean on a real deployment. This
    // authenticated, platform-admin-only page is where the full breakdown
    // lives instead. `databaseReady: true` is sound here, not assumed: every
    // query in the Promise.all above already succeeded against this same
    // `db` handle by the time this line runs, in this same request.
    const commercial =
      deploymentMode === 'commercial'
        ? evaluateCommercialReadiness({ databaseReady: true })
        : undefined;
    return {
      admin: true as const,
      policies,
      holds,
      orgs,
      failedJobs,
      erasureJobs,
      applicants,
      purgeEligible,
      scorecard,
      analytics,
      roles,
      unboundAccounts,
      owner,
      platformEvidenceBytes,
      auditEvents,
      aiCostUnits,
      invitations,
      deploymentMode,
      commercial,
      quota: loadUploadQuotaConfig(),
      canManageComplaints,
      canManageAiSettings,
      aiLimits,
      signals,
      readiness,
      failedSections,
    };
  });

  const applicantName = (applicantId: string): string =>
    (data.admin ? data.applicants.find((a) => a.id === applicantId)?.displayName : undefined) ??
    applicantId;

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Admin</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Platform administration
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Compliance controls: retention policies, legal holds, and organization verification.
          </p>
        </div>
        {data.admin ? (
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <Link href="/app/admin/packs" className="btn btn-secondary">
              Pack Studio
            </Link>
            {data.canManageComplaints ? (
              <Link href="/app/admin/complaints" className="btn btn-secondary">
                Complaint triage
              </Link>
            ) : null}
            {data.canManageAiSettings ? (
              <Link href="/app/admin/ai-settings" className="btn btn-secondary">
                AI Gateway
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {!data.admin ? (
        <article className="card">
          <p className="card-body">
            This area is restricted to platform administrators. If you should have access, ask an
            existing platform owner to grant you a role.
          </p>
        </article>
      ) : (
        <>
          {data.failedSections.length > 0 ? (
            <article
              className="card"
              role="alert"
              style={{ marginBottom: '1.5rem', borderColor: 'var(--danger, #b42318)' }}
            >
              <p className="card-kicker">Incomplete page</p>
              <h2 className="card-title">Some sections could not be loaded</h2>
              <p className="card-body">
                {data.failedSections.join(', ')}. The sections above are shown empty or at zero
                because they could not be read, not because there is nothing there. This is most
                often a database migration that has not been applied yet; check the runtime log for
                the exact message.
              </p>
            </article>
          ) : null}
          <nav aria-label="Admin sections" className="pill-list" style={{ marginBottom: '1.5rem' }}>
            <a href="/status" className="pill">
              Readiness
            </a>
            <a href="#admin-signals" className="pill">
              Signals
            </a>
            <a href="#admin-analytics" className="pill">
              Analytics
            </a>
            <a href="#admin-security" className="pill">
              Security
            </a>
            <a href="#admin-readiness" className="pill">
              Commercial readiness
            </a>
            <a href="#admin-pilot-access" className="pill">
              Pilot access
            </a>
            <a href="#admin-organizations" className="pill">
              Organizations
            </a>
            <a href="#admin-retention" className="pill">
              Retention
            </a>
            <a href="#admin-deletion" className="pill">
              Deletion
            </a>
            <a href="#admin-processing" className="pill">
              Processing failures
            </a>
            <a href="#admin-usage" className="pill">
              Usage
            </a>
            <a href="#admin-audit" className="pill">
              Audit
            </a>
          </nav>

          <article className="card" style={{ marginBottom: '1.5rem' }}>
            <p className="card-kicker">Pilot measurement</p>
            <h2 className="card-title">Product scorecard</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              Real usage milestones, counted from an append-only event log — no PII, no free-text
              properties.
            </p>
            <div className="rows">
              {data.scorecard.map((row) => (
                <div className="row" key={row.eventType}>
                  <span className="row-key">{SCORECARD_LABELS[row.eventType]}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
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
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
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

          <article className="card" style={{ marginBottom: '1.5rem' }} id="admin-security">
            <p className="card-kicker">Identity</p>
            <h2 className="card-title">Platform roles</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              Replaces the old ADMIN_EMAILS allowlist. A grant is never deleted, only revoked, so
              the full history of who held what and why is always reconstructable.
            </p>
            {data.roles.length === 0 ? (
              <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                No active grants.
              </p>
            ) : (
              <div className="rows" style={{ marginBottom: '1.25rem' }}>
                {data.roles.map((r) => (
                  <div
                    className="row"
                    key={r.id}
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
                      <span className="row-key">{PLATFORM_ROLE_LABELS[r.role] ?? r.role}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          {r.assignedAt.toLocaleDateString()}
                        </span>
                        {data.owner ? <RevokeRoleButton grantId={r.id} /> : null}
                      </span>
                    </div>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {r.reason}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {data.owner ? (
              <GrantRoleForm />
            ) : (
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Only a platform owner can grant or revoke roles.
              </p>
            )}
          </article>

          <article className="card" style={{ marginBottom: '1.5rem' }} id="admin-readiness">
            <p className="card-kicker">Operational posture</p>
            <h2 className="card-title">Commercial readiness</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              The full per-gate breakdown behind commercial mode's guard — deliberately{' '}
              <strong>not</strong> public. An unauthenticated caller (including the public{' '}
              <code>/status</code> page) only ever sees the aggregate ready/not-ready boolean.
            </p>
            {!data.commercial ? (
              <p className="card-body" style={{ marginBottom: 0 }}>
                Deployment mode is <strong>{data.deploymentMode}</strong>, not{' '}
                <code>commercial</code> — this guard does not apply yet.
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

          <article className="card" style={{ marginBottom: '1.5rem' }} id="admin-pilot-access">
            <p className="card-kicker">Controlled pilot</p>
            <h2 className="card-title">Pilot access</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              This is an invite-only controlled pilot: an authenticated identity that isn't invited
              or allowlisted is denied a local account. An invitation is never deleted, only revoked
              — the full history of who was invited, by whom, and why is always reconstructable.
              Revoking only blocks a future, not-yet-provisioned sign-in; an account already
              provisioned from this invitation keeps its access.
            </p>
            {data.invitations.length === 0 ? (
              <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                No invitations yet.
              </p>
            ) : (
              <div className="rows" style={{ marginBottom: '1.25rem' }}>
                {data.invitations.map((inv) => {
                  const status = inv.revokedAt
                    ? { label: 'Revoked', tone: 'badge-danger' }
                    : inv.acceptedAt
                      ? { label: 'Accepted', tone: 'badge-success' }
                      : { label: 'Pending', tone: 'badge-neutral' };
                  return (
                    <div
                      className="row"
                      key={inv.id}
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
                          {inv.email}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <span className={`badge ${status.tone}`}>{status.label}</span>
                          {data.owner && !inv.revokedAt ? (
                            <RevokeInvitationButton invitationId={inv.id} />
                          ) : null}
                        </span>
                      </div>
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        {inv.reason ?? 'No reason given'} · invited{' '}
                        {inv.invitedAt.toLocaleDateString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {data.owner ? (
              <InviteForm />
            ) : (
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Only a platform owner can invite or revoke pilot access.
              </p>
            )}
          </article>

          {data.unboundAccounts.length > 0 ? (
            <article className="card" style={{ marginBottom: '1.5rem' }}>
              <p className="card-kicker">Identity</p>
              <h2 className="card-title">Accounts awaiting WorkOS identity binding</h2>
              <p className="card-body" style={{ marginBottom: '1rem' }}>
                Read-only migration report — resolves itself the moment each owner next signs in.
                The
                <code>workos_user_id</code> column becomes required only once this list is empty.
              </p>
              <div className="rows">
                {data.unboundAccounts.map((a) => (
                  <div className="row" key={a.id}>
                    <span className="row-key" style={{ wordBreak: 'break-word' }}>
                      {a.email}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        since {new Date(a.createdAt).toLocaleDateString()}
                      </span>
                      <span
                        className={`badge ${a.applicantCount > 0 ? 'badge-warning' : 'badge-neutral'}`}
                      >
                        {a.applicantCount} applicant{a.applicantCount === 1 ? '' : 's'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          <div className="grid" id="admin-retention">
            <article className="card">
              <p className="card-kicker">Retention</p>
              <h2 className="card-title">Document retention policies</h2>
              {data.policies.length === 0 ? (
                <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                  No retention policies configured. Without a policy, documents of a type are never
                  auto-purged.
                </p>
              ) : (
                <div className="rows" style={{ marginBottom: '1.25rem' }}>
                  {data.policies.map((p) => (
                    <div className="row" key={p.id}>
                      <span className="row-key">{p.docType}</span>
                      <span className="row-val">{p.retentionDays} days</span>
                    </div>
                  ))}
                </div>
              )}
              <RetentionPolicyForm />
            </article>

            <article className="card">
              <p className="card-kicker">Legal holds</p>
              <h2 className="card-title">Active holds</h2>
              {data.holds.length === 0 ? (
                <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                  No active legal holds. A hold blocks deletion and retention purge for an applicant
                  until released.
                </p>
              ) : (
                <div className="rows" style={{ marginBottom: '1.25rem' }}>
                  {data.holds.map((h) => (
                    <div
                      className="row"
                      key={h.id}
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
                          {applicantName(h.applicantId)}
                        </span>
                        <ReleaseHoldButton holdId={h.id} />
                      </div>
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        {h.reason}
                      </span>
                      <span style={{ fontSize: '0.8rem' }}>
                        {h.reviewAt === null ? (
                          <span className="badge badge-danger">no review date set</span>
                        ) : h.reviewAt.getTime() < Date.now() ? (
                          <span className="badge badge-danger">
                            review overdue since {h.reviewAt.toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="badge badge-neutral">
                            review by {h.reviewAt.toLocaleDateString()}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <LegalHoldForm
                applicants={data.applicants.map((a) => ({ id: a.id, displayName: a.displayName }))}
              />
            </article>
          </div>

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
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
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

          <article className="card" style={{ marginTop: '1.5rem' }} id="admin-deletion">
            <p className="card-kicker">Erasure</p>
            <h2 className="card-title">Erasure jobs needing attention</h2>
            {data.erasureJobs.length === 0 ? (
              <p className="card-body">
                No erasure jobs are failed or blocked. A job parks here only after it exhausts every
                retry attempt, or while it's waiting on a legal hold to clear.
              </p>
            ) : (
              <div className="rows" style={{ marginTop: '0.5rem' }}>
                {data.erasureJobs.map((job) => (
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
                        {job.objectKey}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span
                          className={`badge ${job.status === 'BLOCKED_BY_HOLD' ? 'badge-warning' : 'badge-danger'}`}
                        >
                          {job.status === 'BLOCKED_BY_HOLD'
                            ? 'Blocked by hold'
                            : `${job.attempts}/${job.maxAttempts} attempts`}
                        </span>
                        <RetryErasureJobButton jobId={job.id} />
                      </span>
                    </div>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {job.reason === 'ACCOUNT_DELETION' ? 'Account deletion' : 'Retention purge'}
                    </span>
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
              hits its hard stop; the warning threshold below is purely informational — it is not
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
              Lifetime-to-date spend against the configured pilot cap (never resets automatically —
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
              removes a metadata row with no backing bytes and no remaining document — it never
              deletes bytes that still exist.
            </p>
            <ReconcileButtons />
          </article>

          <article className="card" style={{ marginTop: '1.5rem' }}>
            <p className="card-kicker">Retention</p>
            <h2 className="card-title">Documents eligible for purge</h2>
            {data.purgeEligible.length === 0 ? (
              <p className="card-body">
                No documents are currently past their retention policy (or all are under an active
                legal hold).
              </p>
            ) : (
              <>
                <div className="rows" style={{ marginBottom: '1.25rem' }}>
                  {data.purgeEligible.map((doc) => (
                    <div className="row" key={doc.id}>
                      <span className="row-key" style={{ wordBreak: 'break-word' }}>
                        {doc.originalName}
                      </span>
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        {applicantName(doc.applicantId)}
                      </span>
                    </div>
                  ))}
                </div>
                <PurgeButton eligibleCount={data.purgeEligible.length} />
              </>
            )}
          </article>

          <article className="card" style={{ marginTop: '1.5rem' }} id="admin-organizations">
            <p className="card-kicker">Verification</p>
            <h2 className="card-title">Organizations</h2>
            {data.orgs.length === 0 ? (
              <p className="card-body">No organizations yet.</p>
            ) : (
              <div className="rows" style={{ marginTop: '0.5rem' }}>
                {data.orgs.map((org) => {
                  const badge = ORG_STATUS[org.status] ?? {
                    label: org.status,
                    tone: 'badge-neutral',
                  };
                  const pending = org.status === 'PENDING_VERIFICATION';
                  const active = org.status === 'ACTIVE';
                  const suspended = org.status === 'SUSPENDED';
                  return (
                    <div
                      className="row"
                      key={org.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.75rem',
                      }}
                    >
                      <span className="row-key">{org.name}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span className={`badge ${badge.tone}`}>{badge.label}</span>
                        {pending ? <OrgReviewButtons organizationId={org.id} /> : null}
                        {active ? <OrgSuspendButton organizationId={org.id} /> : null}
                        {active || suspended ? (
                          <OrgTerminateButton organizationId={org.id} />
                        ) : null}
                        {data.owner ? (
                          <Link
                            href={`/app/admin/organizations/${org.id}`}
                            className="btn btn-secondary"
                            style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
                          >
                            Manage
                          </Link>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </article>

          <article className="card" style={{ marginTop: '1.5rem' }} id="admin-audit">
            <p className="card-kicker">Transparency</p>
            <h2 className="card-title">Recent audit events</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              The last {data.auditEvents.length} entries of the platform's append-only, hash-chained
              audit trail — every sensitive action across every tenant, newest first.
            </p>
            {data.auditEvents.length === 0 ? (
              <p className="card-body">No audit events recorded yet.</p>
            ) : (
              <div className="rows">
                {data.auditEvents.map((event: AuditEventRow) => (
                  <div
                    className="row"
                    key={event.seq}
                    style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.2rem' }}
                  >
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}
                    >
                      <span className="row-key mono" style={{ fontSize: '0.85rem' }}>
                        {event.eventType}
                      </span>
                      {event.result ? (
                        <span
                          className={`badge ${event.result === 'DENIED' ? 'badge-danger' : 'badge-neutral'}`}
                        >
                          {event.result}
                        </span>
                      ) : null}
                    </div>
                    <span className="muted" style={{ fontSize: '0.78rem' }}>
                      {event.occurredAt.toLocaleString()}
                      {event.resourceType ? ` · ${event.resourceType}` : ''}
                      {event.reason ? ` · ${event.reason}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </>
      )}
    </section>
  );
}
