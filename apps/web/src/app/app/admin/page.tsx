import {
  getRetentionPolicies,
  listActiveLegalHolds,
  listAllOrganizations,
} from '@visastack/services';
import Link from 'next/link';
import { isPlatformAdmin } from '../../../lib/admin';
import { withSession } from '../../../lib/session';
import { releaseLegalHoldAction, reviewOrganizationAction } from './actions';
import { LegalHoldForm, RetentionPolicyForm } from './admin-forms';

export const dynamic = 'force-dynamic';

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
    const [policies, holds, orgs] = await Promise.all([
      getRetentionPolicies(db),
      listActiveLegalHolds(db),
      listAllOrganizations(db),
    ]);
    return { admin: true as const, policies, holds, orgs };
  });

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
                          {h.applicantId}
                        </span>
                        <form action={releaseLegalHoldAction}>
                          <input type="hidden" name="holdId" value={h.id} />
                          <button
                            type="submit"
                            className="btn btn-secondary"
                            style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
                          >
                            Release
                          </button>
                        </form>
                      </div>
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        {h.reason}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <LegalHoldForm />
            </article>
          </div>

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
                        {pending ? (
                          <>
                            <form action={reviewOrganizationAction}>
                              <input type="hidden" name="organizationId" value={org.id} />
                              <input type="hidden" name="decision" value="ACTIVE" />
                              <button
                                type="submit"
                                className="btn btn-primary"
                                style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
                              >
                                Verify
                              </button>
                            </form>
                            <form action={reviewOrganizationAction}>
                              <input type="hidden" name="organizationId" value={org.id} />
                              <input type="hidden" name="decision" value="REJECTED" />
                              <button
                                type="submit"
                                className="btn btn-secondary"
                                style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
                              >
                                Reject
                              </button>
                            </form>
                          </>
                        ) : null}
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
