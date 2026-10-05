import { signOut } from '@workos-inc/authkit-nextjs';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { isPlatformAdmin } from '../../lib/admin';
import { getI18n } from '../../lib/locale';
import { PRIMARY_NAV, localizeLinks } from '../../lib/navigation';
import { withSession } from '../../lib/session';
import { AppNav } from './app-nav';

export const dynamic = 'force-dynamic';

/**
 * Persistent primary navigation for every signed-in page (master directive
 * §7 "PR 7" - global navigation IA; the names are in `lib/navigation.ts`:
 * Overview, Applicants, Shared with me, Alerts, Privacy, Account). Agency and
 * Platform administration are separate areas a qualifying account can switch
 * into, surfaced as a secondary control here rather than crowded into the
 * primary six, since most applicants use neither. Agency is always reachable
 * (not gated on already having a membership): `/app/agency` is also the only
 * entry point to create an organization, so hiding it pre-membership would
 * leave a brand-new account with no way to ever get one. Admin stays
 * role-gated, since there is no equivalent self-service path into platform
 * administration.
 */
export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  const { t } = await getI18n();
  const isAdmin = await withSession(async ({ db, accountId, email }) =>
    isPlatformAdmin(db, { accountId, email }),
  );

  return (
    <>
      <div className="app-shell-nav">
        <AppNav links={localizeLinks(PRIMARY_NAV, t)} label={t('shell.nav.primary')} />
        <div className="app-shell-switch">
          <Link href="/app/agency" className="btn btn-secondary nav-cta">
            {t('shell.app.agency')}
          </Link>
          {isAdmin ? (
            <Link href="/app/admin" className="btn btn-secondary nav-cta">
              {t('shell.app.admin')}
            </Link>
          ) : null}
          <form
            action={async () => {
              'use server';
              await signOut();
            }}
          >
            <button type="submit" className="btn btn-secondary nav-cta">
              {t('shell.app.signOut')}
            </button>
          </form>
        </div>
      </div>
      {children}
    </>
  );
}
