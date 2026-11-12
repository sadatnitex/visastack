import { type OrgMembershipView, listMembershipsForAccount } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { EmptyState, PageHeader } from '../../../components/ui';
import { appAgencyCatalog } from '../../../i18n/app-agency';
import { humanizeCode } from '../../../lib/format-code';
import { getServerT, primeLocale } from '../../../lib/i18n-server';
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

interface AgencyPageProps {
  readonly searchParams?: Promise<{
    readonly withdrawn?: string | string[];
    readonly withdrawal?: string | string[];
  }>;
}

// Two signatures: the route always passes props, while whole-page checks render it bare.
export default async function AgencyPage(): Promise<ReactElement>;
export default async function AgencyPage(props: AgencyPageProps): Promise<ReactElement>;
export default async function AgencyPage({
  searchParams,
}: AgencyPageProps = {}): Promise<ReactElement> {
  await primeLocale();
  const t = getServerT(appAgencyCatalog);
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
        eyebrow={t('appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.agency')}
        title={t('appAgency.appAgencyPage.organizations')}
        description={t('appAgency.appAgencyPage.agenciesCollaborateOnCasesAndRequest')}
      />

      {withdrawalMessage ? (
        <output className="lc-g3-withdrawal-status">{withdrawalMessage}</output>
      ) : null}

      <div className="grid">
        <article className="card">
          <p className="card-kicker">{t.node('appAgency.appAgencyPage.yourOrganizations')}</p>
          <h2 className="card-title">{t.node('appAgency.appAgencyPage.memberships')}</h2>
          {orgs.length === 0 ? (
            <EmptyState icon="building" title={t('appAgency.appAgencyPage.noOrganizationsYet')}>
              {t.node('appAgency.appAgencyPage.applyToRegisterYourAgencyHere')}
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
                        {t.node('appAgency.appAgencyPage.withdrawApplication')}
                      </summary>
                      <form
                        action={withdrawOrganizationApplicationAction}
                        className="lc-g3-confirm"
                      >
                        <input type="hidden" name="organizationId" value={m.organization.id} />
                        <p id={confirmId} className="lc-g3-confirm-text">
                          {t.node('appAgency.appAgencyPage.withdrawTheApplicationForNameIt', {
                            name: m.organization.name,
                          })}
                        </p>
                        <button
                          type="submit"
                          className="btn btn-danger"
                          aria-describedby={confirmId}
                        >
                          {t.node('appAgency.appAgencyPage.withdrawApplication')}
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
          <p className="card-kicker">{t.node('appAgency.appAgencyPage.new')}</p>
          <h2 className="card-title">
            {t.node('appAgency.appAgencyPage.applyToRegisterAnAgency')}
          </h2>
          <p className="card-body u-mb-125">
            {t.node('appAgency.appAgencyPage.youBecomeTheOwnerNewOrganizations')}
          </p>
          <CreateOrgForm />
        </article>
      </div>
    </section>
  );
}
