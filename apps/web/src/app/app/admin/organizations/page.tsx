import { listAllOrganizations } from '@visastack/services';
import Link from 'next/link';
import { isPlatformAdmin, isPlatformOwnerAccount } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';
import { tolerantReader } from '../../../../lib/tolerate';
import { OrgReviewButtons, OrgSuspendButton, OrgTerminateButton } from '../action-buttons';
import { AdminRestricted } from '../admin-restricted';
import { FailedSectionsBanner } from '../failed-sections-banner';

export const dynamic = 'force-dynamic';

const ORG_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING_VERIFICATION: { label: 'Pending verification', tone: 'badge-warning' },
  ACTIVE: { label: 'Active', tone: 'badge-success' },
  SUSPENDED: { label: 'Suspended', tone: 'badge-danger' },
  REJECTED: { label: 'Rejected', tone: 'badge-danger' },
  CLOSED: { label: 'Closed', tone: 'badge-neutral' },
};

/** Every organization on the platform, with the actions a platform administrator may take on it. */
export default async function AdminOrganizationsPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    // A section that cannot be read (typically a table a pending migration has not created) is
    // left empty and named in a banner. The permission checks are NOT wrapped: an
    // authorization failure must stay an error.
    const { read: t, failed: failedSections } = tolerantReader();
    const [orgs, owner] = await Promise.all([
      t('organizations', () => listAllOrganizations(db), []),
      isPlatformOwnerAccount(db, { accountId, email }),
    ]);
    return { admin: true as const, orgs, owner, failedSections };
  });

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Platform</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Organizations
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Verify, suspend or close the organizations that use the platform.
          </p>
        </div>
      </div>

      {!data.admin ? (
        <AdminRestricted />
      ) : (
        <>
          <FailedSectionsBanner sections={data.failedSections} />

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
        </>
      )}
    </section>
  );
}
