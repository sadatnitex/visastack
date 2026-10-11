import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import {
  hasPlatformPermission,
  isPlatformAdmin,
  isPlatformOwnerAccount,
} from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';
import { AdminRestricted } from '../admin-restricted';

export const metadata: Metadata = { title: 'Platform settings' };

export default async function PlatformSettingsPage() {
  const access = await withSession(async ({ db, accountId, email }) => {
    const actor = { accountId, email };
    if (!(await isPlatformAdmin(db, actor))) return null;
    const [owner, ai, retention] = await Promise.all([
      isPlatformOwnerAccount(db, actor),
      hasPlatformPermission(db, actor, 'AI_SETTINGS_MANAGE'),
      hasPlatformPermission(db, actor, 'RETENTION_POLICY_SET'),
    ]);
    return { owner, ai, retention };
  });
  if (!access) return <AdminRestricted />;
  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform operations"
        title="Settings"
        description="Configuration you can manage, using the existing permission and confirmation requirements."
      />
      <div className="grid">
        {access.owner ? (
          <article className="card">
            <h2 className="card-title">Staff access & plans</h2>
            <Link href="/app/admin/access">Manage platform roles</Link>
            <p>
              <Link href="/app/admin/organizations">Open organization plans</Link>
            </p>
          </article>
        ) : null}
        {access.ai ? (
          <article className="card">
            <h2 className="card-title">AI configuration</h2>
            <Link href="/app/admin/ai-settings">Manage approved provider settings</Link>
          </article>
        ) : null}
        {access.retention ? (
          <article className="card">
            <h2 className="card-title">Retention policy</h2>
            <Link href="/app/admin/privacy">Manage privacy policy controls</Link>
          </article>
        ) : null}
        {!access.owner && !access.ai && !access.retention ? (
          <article className="card">
            <h2 className="card-title">No configuration permission</h2>
            <p className="card-body">
              Your current role provides operational access, without these configuration changes.
              Ask a platform owner if your responsibilities have changed.
            </p>
          </article>
        ) : null}
        <article className="card">
          <h2 className="card-title">Your account</h2>
          <Link href="/app/account">Open account settings</Link>
        </article>
      </div>
    </section>
  );
}
