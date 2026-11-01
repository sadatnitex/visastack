import { type Organization, listAllOrganizations } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { StickyDetails } from '../../../../components/sticky-details';
import { EmptyState, StatusBadge, type Tone } from '../../../../components/ui';
import { PageHeader } from '../../../../components/ui';
import { isPlatformAdmin, isPlatformOwnerAccount } from '../../../../lib/admin';
import {
  type SearchParamsRecord,
  TEAM_LIST_STEP,
  firstParam,
  pagingHref,
  parseCursor,
} from '../../../../lib/paging';
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

type OrgStatus = Organization['status'];

const PATHNAME = '/app/admin/organizations';
const SEARCH_MAX_CHARS = 100;

function statusOf(value: string | undefined): OrgStatus | undefined {
  return value !== undefined && Object.hasOwn(ORG_STATUS, value) ? (value as OrgStatus) : undefined;
}

/**
 * Every organization on the platform, with the actions a platform administrator may take on it.
 * Read 25 at a time (WP-SB7), newest first, narrowed by a name search and a status; the page
 * address carries the filters and the cursor, and the server applies the same check to each page.
 */
export default async function AdminOrganizationsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<SearchParamsRecord>;
}) {
  const query: SearchParamsRecord = (await searchParams) ?? {};
  const { q, status: statusParam, before: cursorParam } = query;
  const search = (firstParam(q) ?? '').trim().slice(0, SEARCH_MAX_CHARS);
  const status = statusOf(firstParam(statusParam));
  const before = parseCursor(cursorParam);
  const filtered = search.length > 0 || status !== undefined;

  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    // A section that cannot be read (typically a table a pending migration has not created) is
    // left empty and named in a banner. The permission checks are NOT wrapped: an
    // authorization failure must stay an error.
    const { read: t, failed: failedSections } = tolerantReader();
    const [page, owner] = await Promise.all([
      t(
        'organizations',
        () =>
          listAllOrganizations(db, {
            limit: TEAM_LIST_STEP,
            ...(search ? { search } : {}),
            ...(status ? { status } : {}),
            ...(before ? { before } : {}),
          }),
        { items: [], nextCursor: null },
      ),
      isPlatformOwnerAccount(db, { accountId, email }),
    ]);
    return {
      admin: true as const,
      orgs: page.items,
      nextCursor: page.nextCursor,
      owner,
      failedSections,
    };
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
            <form
              className="sb7-filter-bar u-mt-050"
              method="get"
              action={PATHNAME}
              aria-label="Find organizations"
            >
              <div className="field-row">
                <label className="field-label" htmlFor="org-search">
                  Name
                </label>
                <input
                  id="org-search"
                  name="q"
                  type="search"
                  className="input"
                  defaultValue={search}
                  maxLength={SEARCH_MAX_CHARS}
                  autoComplete="off"
                />
              </div>
              <div className="field-row">
                <label className="field-label" htmlFor="org-status">
                  Status
                </label>
                <select id="org-status" name="status" className="input" defaultValue={status ?? ''}>
                  <option value="">All Statuses</option>
                  {Object.entries(ORG_STATUS).map(([value, { label }]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn btn-secondary">
                Find
              </button>
              {filtered ? <Link href={PATHNAME}>Clear Filters</Link> : null}
            </form>
            {data.orgs.length === 0 ? (
              filtered || before ? (
                <p className="card-body u-mt-050">
                  No organizations match these filters.{' '}
                  <Link href={PATHNAME}>Show Every Organization</Link>
                </p>
              ) : (
                <EmptyState title="No Organizations Yet" icon="building">
                  Organizations appear here when an agency registers and asks to be verified.
                </EmptyState>
              )
            ) : (
              <table className="data-table u-mt-050" id="organizations-list">
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
                    const menu = active || suspended || data.owner;
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
                            {menu ? (
                              <StickyDetails
                                initiallyOpen={false}
                                className="sb7-row-menu"
                                summary={
                                  <>
                                    More Actions
                                    <span className="sr-only"> for {org.name}</span>
                                  </>
                                }
                              >
                                <span className="sb7-row-menu-items">
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
                              </StickyDetails>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {data.nextCursor || before ? (
              <nav className="show-more" aria-label="Organization pages">
                {data.nextCursor ? (
                  <Link
                    className="btn btn-secondary u-btn-sm show-more-link"
                    href={pagingHref(
                      PATHNAME,
                      query,
                      { before: data.nextCursor },
                      'admin-organizations',
                    )}
                  >
                    Next Page
                  </Link>
                ) : (
                  <p className="muted u-fs-085 u-m-0">These are the oldest organizations.</p>
                )}
                {before ? (
                  <Link href={pagingHref(PATHNAME, query, { before: null }, 'admin-organizations')}>
                    Back to the First Page
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </article>
        </>
      )}
    </section>
  );
}
