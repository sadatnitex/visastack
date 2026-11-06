import { STARTER_SEED_ROWS } from '@visastack/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../../components/ui';
import { hasPlatformPermission, isPlatformAdmin } from '../../../../../lib/admin';
import { withSession } from '../../../../../lib/session';
import { StarterImporter } from './starter-importer';

export const metadata: Metadata = { title: 'Starter Country Lists' };
export const dynamic = 'force-dynamic';

/**
 * Loads the starter country checklists into Pack Studio and sends them back out as a sheet. Only
 * platform admins see it; only the role the studio accepts changes from can load.
 */
export default async function StarterListsPage() {
  const access = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return null;
    return { canManage: await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE') };
  });
  if (access === null) {
    return (
      <section className="section container">
        <PageHeader title="Starter Country Lists" description="This page is for platform staff." />
      </section>
    );
  }
  return (
    <section className="section container">
      <PageHeader
        eyebrow="Rules"
        title="Starter Country Lists"
        description="Agency lists, not official. Travellers pick them and change items on their case."
      />
      <p>
        <Link href="/app/admin/packs">Back to Pack Studio</Link>
      </p>
      <article className="card">
        <h2 className="card-title">Load Lists</h2>
        {access.canManage ? (
          <StarterImporter suppliedCount={STARTER_SEED_ROWS.length} />
        ) : (
          <p className="muted">Your role can read lists but not load them.</p>
        )}
      </article>
      <article className="card">
        <h2 className="card-title">Edit as a Sheet</h2>
        <p className="muted">Download the lists as they are now, edit them, then load the sheet.</p>
        <a
          className="btn btn-secondary"
          href="/app/admin/packs/import/export"
          download="starter-checklists.csv"
        >
          Download the Lists
        </a>
      </article>
    </section>
  );
}
