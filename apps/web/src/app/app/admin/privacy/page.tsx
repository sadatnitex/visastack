import {
  type ErasureJobReason,
  documentsPastRetention,
  getRetentionPolicies,
  listActiveLegalHolds,
  listAllApplicants,
  listErasureJobsNeedingAttention,
} from '@visastack/services';
import type { Metadata } from 'next';
import { DocumentTypeDatalist } from '../../../../components/catalogue-datalists';
import { PageHeader } from '../../../../components/ui';
import { isPlatformAdmin } from '../../../../lib/admin';
import { formatDateOnly } from '../../../../lib/format-date';
import { documentTypeLabel } from '../../../../lib/labels';
import { withSession } from '../../../../lib/session';
import { tolerantReader } from '../../../../lib/tolerate';
import { ReleaseHoldButton, RetryErasureJobButton } from '../action-buttons';
import { LegalHoldForm, RetentionPolicyForm } from '../admin-forms';
import { AdminRestricted } from '../admin-restricted';
import { FailedSectionsBanner } from '../failed-sections-banner';
import { PurgeButton } from '../purge-button';

/** Why each erasure job exists. Exhaustive: a new reason does not compile until it has a label. */
const ERASURE_REASON_LABELS = {
  ACCOUNT_DELETION: 'Account Deletion',
  RETENTION_PURGE: 'Retention Purge',
  PROFILE_PHOTO_REMOVAL: 'Photo Removal',
} as const satisfies Record<ErasureJobReason, string>;

export const metadata: Metadata = { title: 'Platform Privacy' };

export const dynamic = 'force-dynamic';

/** How long documents are kept, what is held back from deletion, and what erasure still needs a person. */
export default async function AdminPrivacyPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    const { read: t, failed: failedSections } = tolerantReader();
    const [policies, holds, erasureJobs, applicants, purgeEligible] = await Promise.all([
      t('retention policies', () => getRetentionPolicies(db), []),
      t('legal holds', () => listActiveLegalHolds(db), []),
      t('erasure jobs', () => listErasureJobsNeedingAttention(db), []),
      t('applicants', () => listAllApplicants(db), []),
      t('documents past retention', () => documentsPastRetention(db), []),
    ]);
    return {
      admin: true as const,
      policies,
      holds,
      erasureJobs,
      applicants,
      purgeEligible,
      failedSections,
    };
  });

  const applicantName = (applicantId: string): string =>
    (data.admin ? data.applicants.find((a) => a.id === applicantId)?.displayName : undefined) ??
    applicantId;

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform"
        title="Privacy"
        description="Retention policies, legal holds, erasure and purge."
      />

      {!data.admin ? (
        <AdminRestricted />
      ) : (
        <>
          <FailedSectionsBanner sections={data.failedSections} />

          <div className="grid" id="admin-retention">
            <article className="card">
              <p className="card-kicker">Retention</p>
              <h2 className="card-title">Document Retention Policies</h2>
              {data.policies.length === 0 ? (
                <p className="card-body u-mb-125">
                  No retention policies configured. Without a policy, documents of a type are never
                  auto-purged.
                </p>
              ) : (
                <div className="rows u-mb-125">
                  {data.policies.map((p) => (
                    <div className="row" key={p.id}>
                      <span className="row-key">{documentTypeLabel(p.docType)}</span>
                      <span className="row-val">{p.retentionDays} days</span>
                    </div>
                  ))}
                </div>
              )}
              <>
                <DocumentTypeDatalist />
                <RetentionPolicyForm />
              </>
            </article>

            <article className="card">
              <p className="card-kicker">Legal Holds</p>
              <h2 className="card-title">Active Holds</h2>
              {data.holds.length === 0 ? (
                <p className="card-body u-mb-125">
                  No active legal holds. A hold blocks deletion and retention purge for an applicant
                  until released.
                </p>
              ) : (
                <div className="rows u-mb-125">
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
                      <span className="muted u-fs-085">{h.reason}</span>
                      <span className="u-fs-085">
                        {h.reviewAt === null ? (
                          <span className="badge badge-danger">no review date set</span>
                        ) : h.reviewAt.getTime() < Date.now() ? (
                          <span className="badge badge-danger">
                            review overdue since {formatDateOnly(h.reviewAt)}
                          </span>
                        ) : (
                          <span className="badge badge-neutral">
                            review by {formatDateOnly(h.reviewAt)}
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

          <article className="card u-mt-150" id="admin-deletion">
            <p className="card-kicker">Erasure</p>
            <h2 className="card-title">Erasure Jobs Needing Attention</h2>
            {data.erasureJobs.length === 0 ? (
              <p className="card-body">
                No erasure jobs are failed or blocked. A job parks here only after it exhausts every
                retry attempt, or while it's waiting on a legal hold to clear.
              </p>
            ) : (
              <div className="rows u-mt-050">
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
                      <span className="row-end">
                        <span
                          className={`badge ${job.status === 'BLOCKED_BY_HOLD' ? 'badge-warning' : 'badge-danger'}`}
                        >
                          {job.status === 'BLOCKED_BY_HOLD'
                            ? 'Blocked by Hold'
                            : `${job.attempts}/${job.maxAttempts} attempts`}
                        </span>
                        <RetryErasureJobButton jobId={job.id} />
                      </span>
                    </div>
                    <span className="muted u-fs-085">{ERASURE_REASON_LABELS[job.reason]}</span>
                    {job.lastError ? (
                      <span
                        className="muted"
                        style={{ fontSize: 'var(--text-small)', fontFamily: 'var(--font-mono)' }}
                      >
                        {job.lastError}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="card u-mt-150">
            <p className="card-kicker">Retention</p>
            <h2 className="card-title">Documents Eligible for Purge</h2>
            {data.purgeEligible.length === 0 ? (
              <p className="card-body">
                No documents are currently past their retention policy (or all are under an active
                legal hold).
              </p>
            ) : (
              <>
                <div className="rows u-mb-125">
                  {data.purgeEligible.map((doc) => (
                    <div className="row" key={doc.id}>
                      <span className="row-key" style={{ wordBreak: 'break-word' }}>
                        {doc.originalName}
                      </span>
                      <span className="muted u-fs-085">{applicantName(doc.applicantId)}</span>
                    </div>
                  ))}
                </div>
                <PurgeButton eligibleCount={data.purgeEligible.length} />
              </>
            )}
          </article>
        </>
      )}
    </section>
  );
}
