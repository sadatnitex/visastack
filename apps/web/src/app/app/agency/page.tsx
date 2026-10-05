import { listMembershipsForAccount } from '@visastack/services';
import Link from 'next/link';
import { withSession } from '../../../lib/session';
import { CreateOrgForm } from './create-org-form';

export const dynamic = 'force-dynamic';

const ORG_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING_VERIFICATION: { label: 'Pending verification', tone: 'badge-warning' },
  ACTIVE: { label: 'Active', tone: 'badge-success' },
  REJECTED: { label: 'Rejected', tone: 'badge-danger' },
  SUSPENDED: { label: 'Suspended', tone: 'badge-danger' },
};

export default async function AgencyPage() {
  const orgs = await withSession(async ({ db, accountId }) =>
    listMembershipsForAccount(db, accountId),
  );

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Agency</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Organizations
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Agencies collaborate on cases and request evidence. Membership never grants record
            access on its own — access is always an accepted grant.
          </p>
        </div>
      </div>

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Your organizations</p>
          <h2 className="card-title">Memberships</h2>
          {orgs.length === 0 ? (
            <p className="card-body">You are not a member of any organization yet.</p>
          ) : (
            <div className="rows" style={{ marginTop: '0.5rem' }}>
              {orgs.map((m) => {
                const badge = ORG_STATUS[m.organization.status] ?? {
                  label: m.organization.status,
                  tone: 'badge-neutral',
                };
                return (
                  <Link
                    className="row row-link"
                    key={m.organization.id}
                    href={`/app/agency/${m.organization.id}`}
                  >
                    <span className="row-key">
                      {m.organization.name}
                      <span className="muted" style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                        {m.role}
                      </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className={`badge ${badge.tone}`}>{badge.label}</span>
                      <span className="muted" aria-hidden="true">
                        →
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">New</p>
          <h2 className="card-title">Create an organization</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            You become the owner. New organizations start pending verification by a platform
            administrator.
          </p>
          <CreateOrgForm />
        </article>
      </div>
    </section>
  );
}
