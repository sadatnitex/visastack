import { listPlatformMembers } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { bootstrapAdminEmails, isPlatformOwnerAccount } from '../../../../lib/admin';
import { formatTimestampDate } from '../../../../lib/format-date';
import {
  type SearchParamsRecord,
  firstParam,
  pagingHref,
  parseCursor,
} from '../../../../lib/paging';
import { withSession } from '../../../../lib/session';

export const metadata: Metadata = { title: 'Platform Members' };

export const dynamic = 'force-dynamic';

const PATHNAME = '/app/admin/members';
/** WP-SB7: the directory shows 20 accounts at a time. */
const MEMBERS_PER_PAGE = 20;
const SEARCH_MAX_CHARS = 100;

/**
 * The owner's account directory, 20 accounts at a time, newest first, with a search on part of
 * the email address. The address carries the search and the cursor; the service checks the owner
 * role on every page, and a cursor from another search opens the first page.
 */
export default async function PlatformMembersPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  const query = await searchParams;
  const { q, before: cursorParam } = query;
  const search = (firstParam(q) ?? '').trim().slice(0, SEARCH_MAX_CHARS);
  const before = parseCursor(cursorParam);
  const result = await withSession(async ({ db, accountId, email }) => {
    // Same rule as every platform check, including the authenticator code when it is required.
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) {
      return { ok: false, error: { code: 'forbidden', message: 'Not allowed.' } } as const;
    }
    return listPlatformMembers(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      undefined,
      {
        limit: MEMBERS_PER_PAGE,
        ...(search ? { emailSearch: search } : {}),
        ...(before ? { before } : {}),
      },
    );
  });
  if (!result.ok)
    return result.error.code === 'forbidden' ? (
      <article className="card">
        <p className="card-body">
          The account directory requires platform owner access. Other administrator roles do not
          grant access to account email addresses.
        </p>
      </article>
    ) : (
      <section className="section container">
        <PageHeader title="Members" />
        <p className="notice notice-warn">{result.error.message}</p>
        <Link href={PATHNAME}>Open the First Page</Link>
      </section>
    );
  const { members, next } = result.value;
  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform Operations"
        title="Members"
        description="Registered accounts, separate from platform staff roles. Verification does not grant administrator access."
      />
      <article className="card" id="members-list">
        <form className="sb7-filter-bar" method="get" action={PATHNAME} aria-label="Find members">
          <div className="field-row">
            <label className="field-label" htmlFor="member-search">
              Email Contains
            </label>
            <input
              id="member-search"
              name="q"
              type="search"
              className="input"
              defaultValue={search}
              maxLength={SEARCH_MAX_CHARS}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button type="submit" className="btn btn-secondary">
            Find
          </button>
          {search ? <Link href={PATHNAME}>Clear Search</Link> : null}
        </form>
        {members.length === 0 ? (
          <p className="card-body">
            {search || before ? 'No members match this search.' : 'No members yet.'}
          </p>
        ) : (
          <div className="rows">
            {members.map((member) => (
              <article className="workspace-member-row" key={member.id}>
                <h2>{member.email}</h2>
                <p>
                  {member.emailVerifiedAt ? 'Email confirmed' : 'Email confirmation not recorded'}
                </p>
                <p>Joined {formatTimestampDate(member.createdAt)}</p>
              </article>
            ))}
          </div>
        )}
      </article>
      {next || before ? (
        <nav aria-label="Member pages" className="workspace-pagination">
          {before ? (
            <Link href={pagingHref(PATHNAME, query, { before: null }, 'members-list')}>
              First Page
            </Link>
          ) : null}
          {next ? (
            <Link href={pagingHref(PATHNAME, query, { before: next, after: null }, 'members-list')}>
              Next Page
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
