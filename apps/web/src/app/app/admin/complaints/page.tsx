import { listComplaintsForQualityReview, listFeedbackForQualityReview } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { bootstrapAdminEmails, hasPlatformPermission } from '../../../../lib/admin';
import { formatTimestampDate } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';
import { AssignComplaintForm, UpdateComplaintStatusForm } from './forms';

export const metadata: Metadata = { title: 'Complaints' };

export const dynamic = 'force-dynamic';

/**
 * QUALITY_ADMIN triage console (TRU-04 §9): every case complaint and piece of
 * private post-case feedback, platform-wide. Structurally never reachable by
 * an organization member - `listComplaintsForQualityReview`/
 * `listFeedbackForQualityReview` are gated entirely on the QUALITY_ADMIN
 * platform role, a concern with zero overlap with SECURITY_ADMIN/
 * COMPLIANCE_ADMIN/SUPPORT_ADMIN. A dedicated sub-page (mirroring
 * `admin/organizations/[orgId]`) rather than a card on the main admin page,
 * since this is its own growing concern, not per-organization.
 */

const STATUS_TONE: Record<string, string> = {
  OPEN: 'badge-warning',
  IN_PROGRESS: 'badge-warning',
  RESOLVED: 'badge-success',
  CLOSED: 'badge-neutral',
};

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['RESOLVED', 'CLOSED']);

export default async function AdminComplaintsPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'COMPLAINT_MANAGE'))) {
      return { authorized: false as const };
    }
    const actor = { accountId, email, bootstrapEmails: bootstrapAdminEmails() };
    const canViewFeedback = await hasPlatformPermission(db, { accountId, email }, 'FEEDBACK_VIEW');
    const [complaints, feedback] = await Promise.all([
      listComplaintsForQualityReview(db, actor),
      canViewFeedback
        ? listFeedbackForQualityReview(db, actor)
        : Promise.resolve({ ok: true as const, value: [] }),
    ]);
    return {
      authorized: true as const,
      complaints: complaints.ok ? complaints.value : [],
      feedback: feedback.ok ? feedback.value : [],
      canViewFeedback,
    };
  });

  if (!data.authorized) {
    return (
      <section className="section container">
        <article className="card">
          <p className="card-body">
            This area is restricted to quality admins. If you should have access, ask an existing
            platform owner to grant you the QUALITY_ADMIN role.
          </p>
        </article>
      </section>
    );
  }

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/app/admin" className="muted" style={{ fontSize: '0.9rem' }}>
          ← Admin
        </Link>
      </div>
      <PageHeader eyebrow="Quality" title={<>Complaint &amp; feedback triage</>} />

      <article className="card" style={{ marginBottom: '1.5rem' }}>
        <p className="card-kicker">Oversight</p>
        <h2 className="card-title">Complaints</h2>
        {data.complaints.length === 0 ? (
          <p className="card-body">No complaints filed platform-wide.</p>
        ) : (
          <div className="rows">
            {data.complaints.map((c) => (
              <div
                className="row"
                key={c.id}
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <span className="row-key">Case {c.missionId}</span>
                  <span className={`badge ${STATUS_TONE[c.status] ?? 'badge-neutral'}`}>
                    {c.status}
                  </span>
                </div>
                <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                  {c.description}
                </p>
                {c.resolution ? (
                  <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
                    Resolution: {c.resolution}
                  </p>
                ) : null}
                <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
                  Filed {formatTimestampDate(c.createdAt)}
                  {c.ownerAccountId ? ` · Assigned to ${c.ownerAccountId}` : ' · Unassigned'}
                </p>
                {!TERMINAL_STATUSES.has(c.status) ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                    <AssignComplaintForm complaintId={c.id} />
                    <UpdateComplaintStatusForm complaintId={c.id} currentStatus={c.status} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </article>

      {data.canViewFeedback ? (
        <article className="card">
          <p className="card-kicker">Oversight</p>
          <h2 className="card-title">Private feedback</h2>
          <p className="card-body" style={{ marginBottom: '1rem' }}>
            Never visible to the agency being reviewed, and never a public review or ranking.
          </p>
          {data.feedback.length === 0 ? (
            <p className="card-body">No feedback submitted platform-wide.</p>
          ) : (
            <div className="rows">
              {data.feedback.map((f) => (
                <div
                  className="row"
                  key={f.id}
                  style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.2rem' }}
                >
                  <span className="row-key">Case {f.missionId}</span>
                  <span style={{ fontSize: '0.9rem' }}>{f.comments}</span>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    {formatTimestampDate(f.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>
      ) : null}
    </section>
  );
}
