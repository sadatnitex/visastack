import {
  type ProductEventType,
  documentsPastRetention,
  getPilotScorecard,
  getRetentionPolicies,
  listActiveLegalHolds,
  listAllApplicants,
  listAllOrganizations,
  listFailedJobs,
} from '@visastack/services';
import Link from 'next/link';
import { isPlatformAdmin } from '../../../lib/admin';
import { withSession } from '../../../lib/session';
import { OrgReviewButtons, ReleaseHoldButton, RetryJobButton } from './action-buttons';
import { LegalHoldForm, RetentionPolicyForm } from './admin-forms';
import { PurgeButton } from './purge-button';

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
  const data = await withSession(async ({ db, email }) => {
    if (!isPlatformAdmin(email)) return { admin: false as const };
    const [policies, holds, orgs, failedJobs, applicants, purgeEligible, scorecard] =
      await Promise.all([
        getRetentionPolicies(db),
        listActiveLegalHolds(db),
        listAllOrganizations(db),
        listFailedJobs(db),
        listAllApplicants(db),
        documentsPastRetention(db),
        getPilotScorecard(db),
      ]);
    return {
      admin: true as const,
      policies,
      holds,
      orgs,
      failedJobs,
      applicants,
      purgeEligible,
      scorecard,
    };
  });

  const applicantName = (applicantId: string): string =>
    (data.admin ? data.applicants.find((a) => a.id === applicantId)?.displayName : undefined) ??
    applicantId;

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/app" className="muted" style={{ fontSize: '0.9rem' }}>
          ← Workspace
        </Link>
      </div>
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
          <Link href="/app/admin/packs" className="btn btn-secondary">
            Pack Studio
          </Link>
        ) : null}
      </div>

      {!data.admin ? (
        <article className="card">
          <p className="card-body">
            This area is restricted to platform administrators. If you should have access, ask an
            existing administrator to add your email to the allowlist.
          </p>
        </article>
      ) : (
        <>
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

          <div className="grid">
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
                    </div>
                  ))}
                </div>
              )}
              <LegalHoldForm
                applicants={data.applicants.map((a) => ({ id: a.id, displayName: a.displayName }))}
              />
            </article>
          </div>

          <article className="card" style={{ marginTop: '1.5rem' }}>
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

          <article className="card" style={{ marginTop: '1.5rem' }}>
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
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </>
      )}
    </section>
  );
}
