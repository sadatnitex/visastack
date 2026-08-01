import { listMembershipsForAccount } from '@visastack/services';
import { signOut } from '@workos-inc/authkit-nextjs';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { isPlatformAdmin } from '../../lib/admin';
import { withSession } from '../../lib/session';
import { AppNav } from './app-nav';

export const dynamic = 'force-dynamic';

/**
 * Persistent primary navigation for every signed-in page (master directive
 * §7 "PR 7" — global navigation IA: Home, Applicants, Shared with me,
 * Privacy, Account). Agency and Platform administration are separate,
 * role-gated areas a qualifying account can switch into — surfaced as a
 * secondary control here rather than crowded into the primary five, since
 * most applicants have neither.
 */
export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  const { isAdmin, hasAgencyAccess } = await withSession(async ({ db, accountId, email }) => {
    const [admin, memberships] = await Promise.all([
      isPlatformAdmin(db, { accountId, email }),
      listMembershipsForAccount(db, accountId),
    ]);
    return { isAdmin: admin, hasAgencyAccess: memberships.length > 0 };
  });

  return (
    <>
      <div className="app-shell-nav">
        <AppNav
          links={[
            { href: '/app', label: 'Home' },
            { href: '/app/applicants', label: 'Applicants' },
            { href: '/app/shared', label: 'Shared with me' },
            { href: '/app/privacy', label: 'Privacy' },
            { href: '/app/account', label: 'Account' },
          ]}
        />
        <div className="app-shell-switch">
          {hasAgencyAccess ? (
            <Link href="/app/agency" className="btn btn-secondary nav-cta">
              Agency
            </Link>
          ) : null}
          {isAdmin ? (
            <Link href="/app/admin" className="btn btn-secondary nav-cta">
              Admin
            </Link>
          ) : null}
          <form
            action={async () => {
              'use server';
              await signOut();
            }}
          >
            <button type="submit" className="btn btn-secondary nav-cta">
              Sign out
            </button>
          </form>
        </div>
      </div>
      {children}
    </>
  );
}
