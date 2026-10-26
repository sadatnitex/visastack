import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { hasPlatformPermission, isPlatformAdmin } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';
import { AdminRestricted } from '../admin-restricted';

export const metadata: Metadata = { title: 'Platform Security' };

export default async function PlatformSecurityPage() {
  const access = await withSession(async ({ db, accountId, email }) => {
    const actor = { accountId, email };
    if (!(await isPlatformAdmin(db, actor))) return null;
    const [audit, privacy] = await Promise.all([
      hasPlatformPermission(db, actor, 'AUDIT_TRAIL_VIEW'),
      hasPlatformPermission(db, actor, 'APPLICANT_DIRECTORY_VIEW'),
    ]);
    return { audit, privacy };
  });
  if (!access) return <AdminRestricted />;
  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform Operations"
        title="Security & Access"
        description="Existing access, audit and privacy controls. This is not a complete security-monitoring service."
      />
      <div className="grid">
        <article className="card">
          <h2 className="card-title">Platform Access</h2>
          <p className="card-body">
            Review current staff roles and account-access references. Role changes retain their
            owner and reauthentication checks.
          </p>
          <Link href="/app/admin/access" className="btn btn-secondary">
            Review Access
          </Link>
        </article>
        {access.audit ? (
          <article className="card">
            <h2 className="card-title">Recorded Activity</h2>
            <p className="card-body">Inspect the existing audit history and integrity readings.</p>
            <Link href="/app/admin/audit" className="btn btn-secondary">
              Open Audit
            </Link>
          </article>
        ) : null}
        {access.privacy ? (
          <article className="card">
            <h2 className="card-title">Privacy Operations</h2>
            <p className="card-body">
              Review retention, deletion and legal-hold work through existing permissions.
            </p>
            <Link href="/app/admin/privacy" className="btn btn-secondary">
              Open Privacy
            </Link>
          </article>
        ) : null}
      </div>
    </section>
  );
}
