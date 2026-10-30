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
    const [owner, ai, retention, protection] = await Promise.all([
      isPlatformOwnerAccount(db, actor),
      hasPlatformPermission(db, actor, 'AI_SETTINGS_MANAGE'),
      hasPlatformPermission(db, actor, 'RETENTION_POLICY_SET'),
      hasPlatformPermission(db, actor, 'DOCUMENT_PROTECTION_MANAGE'),
    ]);
    return { owner, ai, retention, protection };
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
        {access.owner ? (
          <article className="card">
            <h2 className="card-title">Plans</h2>
            <p className="card-body">
              Create plans, set what each includes and what it costs, and retire plans you no longer
              offer.
            </p>
            <Link href="/app/admin/plans">Manage Plans</Link>
          </article>
        ) : null}
        {access.owner ? (
          <article className="card">
            <h2 className="card-title">Billing Rules</h2>
            <p className="card-body">
              Choose when invoices are due and whether an unpaid invoice moves an agency to Grace
              and then Suspended.
            </p>
            <Link href="/app/admin/billing">Manage Billing Rules</Link>
          </article>
        ) : null}
        {access.owner ? (
          <article className="card">
            <h2 className="card-title">AI Features</h2>
            <p className="card-body">
              Turn AI features on or off for everyone, and set how much each person may use them.
            </p>
            <Link href="/app/admin/ai">Manage AI Features</Link>
          </article>
        ) : null}
        {access.ai ? (
          <article className="card">
            <h2 className="card-title">AI Configuration</h2>
            <Link href="/app/admin/ai-settings">Manage Approved Provider Settings</Link>
          </article>
        ) : null}
        {access.protection ? (
          <article className="card">
            <h2 className="card-title">Document Protection</h2>
            <p className="card-body">
              Choose which documents need a fresh sign-in check before anyone previews or downloads
              them.
            </p>
            <Link href="/app/admin/document-protection">Manage Document Protection</Link>
          </article>
        ) : null}
        {access.retention ? (
          <article className="card">
            <h2 className="card-title">Retention Policy</h2>
            <Link href="/app/admin/privacy">Manage Privacy Policy Controls</Link>
          </article>
        ) : null}
        {!access.owner && !access.ai && !access.retention && !access.protection ? (
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
