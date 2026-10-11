import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { isPlatformAdmin } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';
import { AdminRestricted } from '../admin-restricted';

export const metadata: Metadata = { title: 'Platform security' };

export default async function PlatformSecurityPage() {
  const allowed = await withSession(({ db, accountId, email }) =>
    isPlatformAdmin(db, { accountId, email }),
  );
  if (!allowed) return <AdminRestricted />;
  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform operations"
        title="Security & access"
        description="Existing access, audit and privacy controls. This is not a complete security-monitoring service."
      />
      <div className="grid">
        <article className="card">
          <h2 className="card-title">Platform access</h2>
          <p className="card-body">
            Review current staff roles and account-access references. Role changes retain their
            owner and reauthentication checks.
          </p>
          <Link href="/app/admin/access" className="btn btn-secondary">
            Review access
          </Link>
        </article>
        <article className="card">
          <h2 className="card-title">Recorded activity</h2>
          <p className="card-body">Inspect the existing audit history and integrity readings.</p>
          <Link href="/app/admin/audit" className="btn btn-secondary">
            Open audit
          </Link>
        </article>
        <article className="card">
          <h2 className="card-title">Privacy operations</h2>
          <p className="card-body">
            Review retention, deletion and legal-hold work through existing permissions.
          </p>
          <Link href="/app/admin/privacy" className="btn btn-secondary">
            Open privacy
          </Link>
        </article>
      </div>
    </section>
  );
}
