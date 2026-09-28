import {
  type AuditEventRow,
  type ProductEventType,
  documentsPastRetention,
  getPilotScorecard,
  getPlatformEvidenceBytes,
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
import { aiBudgetLimitUnits, aiWarningLimitUnits, unitsToUsd } from '../../../lib/ai';
import { evaluateCommercialReadiness } from '../../../lib/commercial-readiness';
import { getDeploymentMode } from '../../../lib/deployment-mode';
import { withSession } from '../../../lib/session';
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
    const [
      policies,
      holds,
      orgs,
      failedJobs,
      erasureJobs,
      applicants,
      purgeEligible,
      scorecard,
      roles,
      unboundAccounts,
      owner,
      platformEvidenceBytes,
      auditEvents,
      aiCostUnits,
      invitations,
      canManageComplaints,
      canManageAiSettings,
    ] = await Promise.all([
      getRetentionPolicies(db),
      listActiveLegalHolds(db),
      listAllOrganizations(db),
      listFailedJobs(db),
      listErasureJobsNeedingAttention(db),
      listAllApplicants(db),
      documentsPastRetention(db),
      getPilotScorecard(db),
      listActivePlatformRoles(db),
      reportUnboundAccounts(db),
      isPlatformOwnerAccount(db, { accountId, email }),
      getPlatformEvidenceBytes(db),
      listRecentAuditEvents(db, 50),
      totalAiCostUnits(db),
      listInvitations(db),
      hasPlatformPermission(db, { accountId, email }, 'COMPLAINT_MANAGE'),
      hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'),
    ]);
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
          <nav aria-label="Admin sections" className="pill-list" style={{ marginBottom: '1.5rem' }}>
            <a href="/status" className="pill">
              Readiness
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
              hit costs nothing and does not add to this total.
            </p>
            {(() => {
              const usedUsd = unitsToUsd(data.aiCostUnits);
              const limitUsd = unitsToUsd(aiBudgetLimitUnits());
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
