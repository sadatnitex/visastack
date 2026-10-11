import { listPlatformMembers } from '@visastack/services';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { bootstrapAdminEmails } from '../../../../lib/admin';
import { formatTimestampDate } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

export default async function PlatformMembersPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly after?: string }>;
}) {
  const { after } = await searchParams;
  const result = await withSession(({ db, accountId, email }) =>
    listPlatformMembers(db, { accountId, email, bootstrapEmails: bootstrapAdminEmails() }, after),
  );
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
        <Link href="/app/admin/members">Open the first page</Link>
      </section>
    );
  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform operations"
        title="Members"
        description="Registered accounts, separate from platform staff roles. Verification does not grant administrator access."
      />
      <article className="card">
        <div className="rows">
          {result.value.members.map((member) => (
            <article className="workspace-member-row" key={member.id}>
              <h2>{member.email}</h2>
              <p>
                {member.emailVerifiedAt ? 'Email confirmed' : 'Email confirmation not recorded'}
              </p>
              <p>Joined {formatTimestampDate(member.createdAt)}</p>
            </article>
          ))}
        </div>
      </article>
      <nav aria-label="Member pages" className="workspace-pagination">
        <Link href="/app/admin/members">First page</Link>
        {result.value.next ? (
          <Link href={`/app/admin/members?after=${result.value.next}`}>Next page</Link>
        ) : null}
      </nav>
    </section>
  );
}
