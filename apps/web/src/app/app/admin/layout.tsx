import type { ReactNode } from 'react';
import { hasPlatformPermission, isPlatformAdmin } from '../../../lib/admin';
import { platformTabs } from '../../../lib/navigation';
import { withSession } from '../../../lib/session';
import { SubNav } from '../subnav';

export const dynamic = 'force-dynamic';

/**
 * Platform administration (Commercial V1 Part 9 UX-01): a bar of sections above
 * each page (Organizations, Rules, AI, Operations, Privacy, Audit, plus Access and
 * Complaints). Each section is a page of its own; this layout only adds the bar.
 *
 * It decides what to show, not who may see it. Every page still asks
 * `isPlatformAdmin` (or the concern-scoped permission it needs) itself and shows
 * its own refusal, exactly as before. The AI and Complaints tabs appear only for an
 * administrator who may use them, so no tab leads to a refusal.
 */
export default async function AdminLayout({ children }: { readonly children: ReactNode }) {
  const access = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return null;
    const [ai, complaints] = await Promise.all([
      hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'),
      hasPlatformPermission(db, { accountId, email }, 'COMPLAINT_MANAGE'),
    ]);
    return { ai, complaints };
  });

  return (
    <>
      {access ? (
        <div className="container tabs-bar">
          <SubNav links={platformTabs(access)} label="Platform sections" />
        </div>
      ) : null}
      {children}
    </>
  );
}
