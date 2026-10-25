import { listAllOrganizations } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, StatusBadge, type Tone } from '../../../../components/ui';
import { PageHeader } from '../../../../components/ui';
import { isPlatformAdmin, isPlatformOwnerAccount } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';
import { tolerantReader } from '../../../../lib/tolerate';
import { OrgReviewButtons, OrgSuspendButton, OrgTerminateButton } from '../action-buttons';
import { AdminRestricted } from '../admin-restricted';
import { FailedSectionsBanner } from '../failed-sections-banner';

export const metadata: Metadata = { title: 'Platform Organizations' };

export const dynamic = 'force-dynamic';

const ORG_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING_VERIFICATION: { label: 'Pending Verification', tone: 'badge-warning' },
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
      <PageHeader
        eyebrow="Platform"
        title="Organizations"
        description="Verify, suspend or close the organizations that use the platform."
      />

      {!data.admin ? (
        <AdminRestricted />
      ) : (
        <>
          <FailedSectionsBanner sections={data.failedSections} />

          <article className="card u-mt-150" id="admin-organizations">
            <p className="card-kicker">Verification</p>
            <h2 className="card-title">Organizations</h2>
            {data.orgs.length === 0 ? (
              <EmptyState title="No Organizations Yet" icon="building">
                Organizations appear here when an agency registers and asks to be verified.
              </EmptyState>
            ) : (
              <table className="data-table u-mt-050">
                <caption className="sr-only">Organizations on the Platform</caption>
                <thead>
                  <tr>
                    <th scope="col">Organization</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orgs.map((org) => {
                    const badge = ORG_STATUS[org.status] ?? {
                      label: org.status,
                      tone: 'badge-neutral',
                    };
                    const pending = org.status === 'PENDING_VERIFICATION';
                    const active = org.status === 'ACTIVE';
                    const suspended = org.status === 'SUSPENDED';
                    return (
                      <tr key={org.id}>
                        <th scope="row" className="cell-main">
                          {org.name}
                        </th>
                        <td data-label="Status">
                          <StatusBadge tone={badge.tone.replace('badge-', '') as Tone}>
                            {badge.label}
                          </StatusBadge>
                        </td>
                        <td data-label="Actions">
                          <span className="case-row-badges">
                            {pending ? <OrgReviewButtons organizationId={org.id} /> : null}
                            {active ? <OrgSuspendButton organizationId={org.id} /> : null}
                            {active || suspended ? (
                              <OrgTerminateButton organizationId={org.id} />
                            ) : null}
                            {data.owner ? (
                              <Link
                                href={`/app/admin/organizations/${org.id}`}
                                className="btn btn-secondary nav-cta"
                              >
                                Manage
                              </Link>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </article>
        </>
      )}
    </section>
  );
}
