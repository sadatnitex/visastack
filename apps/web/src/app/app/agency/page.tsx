import { listMembershipsForAccount } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '../../../components/ui';
import { humanizeCode } from '../../../lib/format-code';
import { withSession } from '../../../lib/session';
import { CreateOrgForm } from './create-org-form';

export const metadata: Metadata = { title: 'Agencies' };

export const dynamic = 'force-dynamic';

const ORG_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING_VERIFICATION: { label: 'Pending Verification', tone: 'badge-warning' },
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
      <PageHeader
        eyebrow="Agency"
        title="Organizations"
        description="Agencies collaborate on cases and request evidence. Membership never grants record access on its own - access is always an accepted grant."
      />

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Your Organizations</p>
          <h2 className="card-title">Memberships</h2>
          {orgs.length === 0 ? (
            <EmptyState icon="building" title="No Organizations Yet">
              Apply to register your agency here. You become its owner, and a platform administrator
              must verify it before it can work with clients.
            </EmptyState>
          ) : (
            <div className="rows u-mt-050">
              {orgs.map((m) => {
                const badge = ORG_STATUS[m.organization.status] ?? {
                  label: humanizeCode(m.organization.status),
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
                      <span
                        className="muted"
                        style={{ fontSize: 'var(--text-small)', marginLeft: '0.5rem' }}
                      >
                        {humanizeCode(m.role)}
                      </span>
                    </span>
                    <span className="row-end">
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
          <h2 className="card-title">Apply to Register an Agency</h2>
          <p className="card-body u-mb-125">
            You become the owner. New organizations start pending verification by a platform
            administrator.
          </p>
          <CreateOrgForm />
        </article>
      </div>
    </section>
  );
}
