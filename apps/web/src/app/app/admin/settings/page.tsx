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

export const metadata: Metadata = { title: 'Platform Settings' };

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
        eyebrow="Platform Operations"
        title="Settings"
        description="Configuration you can manage, using the existing permission and confirmation requirements."
      />
      <div className="grid">
        {access.owner ? (
          <article className="card">
            <h2 className="card-title">Staff Access & Plans</h2>
            <Link href="/app/admin/access">Manage Platform Roles</Link>
            <p>
              <Link href="/app/admin/organizations">Open Organization Plans</Link>
            </p>
          </article>
        ) : null}
        {access.ai ? (
          <article className="card">
            <h2 className="card-title">AI Configuration</h2>
            <Link href="/app/admin/ai-settings">Manage Approved Provider Settings</Link>
          </article>
        ) : null}
        {access.retention ? (
          <article className="card">
            <h2 className="card-title">Retention Policy</h2>
            <Link href="/app/admin/privacy">Manage Privacy Policy Controls</Link>
          </article>
        ) : null}
        {!access.owner && !access.ai && !access.retention ? (
          <article className="card">
            <h2 className="card-title">No Configuration Permission</h2>
            <p className="card-body">
              Your current role provides operational access, without these configuration changes.
              Ask a platform owner if your responsibilities have changed.
            </p>
          </article>
        ) : null}
        <article className="card">
          <h2 className="card-title">Your Account</h2>
          <Link href="/app/account">Open Account Settings</Link>
        </article>
      </div>
    </section>
  );
}
