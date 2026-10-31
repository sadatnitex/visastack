import { type OrgMembershipView, listMembershipsForAccount } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '../../../components/ui';
import { humanizeCode } from '../../../lib/format-code';
import { withSession } from '../../../lib/session';
import { withdrawOrganizationApplicationAction } from './actions';
import { CreateOrgForm } from './create-org-form';

export const metadata: Metadata = { title: 'Agencies' };

export const dynamic = 'force-dynamic';

const ORG_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING_VERIFICATION: { label: 'Pending Verification', tone: 'badge-warning' },
  ACTIVE: { label: 'Active', tone: 'badge-success' },
  REJECTED: { label: 'Rejected', tone: 'badge-danger' },
  SUSPENDED: { label: 'Suspended', tone: 'badge-danger' },
  CLOSED: { label: 'Closed', tone: 'badge-neutral' },
};

/** What the page says after a withdrawal. Success is shown only when the list confirms it. */
const WITHDRAWN_MESSAGE =
  'Application withdrawn. It will not be reviewed. You can apply again at any time.';
const REFUSED_MESSAGE =
  'This application could not be withdrawn. It may already have been reviewed. Its current status is shown below.';

/** Only an active owner of an application still waiting for review is offered the withdrawal. */
function mayWithdraw(m: OrgMembershipView): boolean {
  return m.active && m.role === 'OWNER' && m.organization.status === 'PENDING_VERIFICATION';
}

export default async function AgencyPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{
    readonly withdrawn?: string | string[];
    readonly withdrawal?: string | string[];
  }>;
}) {
  const query = (await searchParams) ?? {};
  const orgs = await withSession(async ({ db, accountId }) =>
    listMembershipsForAccount(db, accountId),
  );
  // A link cannot claim a withdrawal that did not happen: the named agency must be in this
  // person's own list and closed.
  const withdrawnConfirmed =
    typeof query.withdrawn === 'string' &&
    orgs.some((m) => m.organization.id === query.withdrawn && m.organization.status === 'CLOSED');
  const withdrawalMessage = withdrawnConfirmed
    ? WITHDRAWN_MESSAGE
    : query.withdrawal === 'refused'
      ? REFUSED_MESSAGE
      : undefined;

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Agency"
        title="Organizations"
        description="Agencies collaborate on cases and request evidence. Membership never grants record access on its own - access is always an accepted grant."
      />

      {withdrawalMessage ? (
        <output className="lc-g3-withdrawal-status">{withdrawalMessage}</output>
      ) : null}

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
                const link = (
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
                if (!mayWithdraw(m)) return link;
                const confirmId = `withdraw-${m.organization.id}`;
                return (
                  <div className="lc-g3-org" key={m.organization.id}>
                    {link}
                    <details className="lc-g3-withdraw">
                      <summary className="btn btn-secondary lc-g3-withdraw-open">
                        Withdraw Application
                      </summary>
                      <form
                        action={withdrawOrganizationApplicationAction}
                        className="lc-g3-confirm"
                      >
                        <input type="hidden" name="organizationId" value={m.organization.id} />
                        <p id={confirmId} className="lc-g3-confirm-text">
                          Withdraw the application for {m.organization.name}? It will no longer be
                          reviewed, and anyone you added to it loses access. You can apply again at
                          any time.
                        </p>
                        <button
                          type="submit"
                          className="btn btn-danger"
                          aria-describedby={confirmId}
                        >
                          Withdraw Application
                        </button>
                      </form>
                    </details>
                  </div>
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
