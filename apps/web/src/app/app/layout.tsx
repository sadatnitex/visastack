import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { Icon } from '../../components/icons';
import { withSession } from '../../lib/session';
import { SIDEBAR_COOKIE, parseSidebarState } from '../../lib/sidebar-preference';
import { signOutCurrentUser } from '../../lib/sign-out';
import { loadWorkspaceChrome } from '../../lib/workspace-chrome';
import { WorkspaceShell } from './workspace-shell';

export const dynamic = 'force-dynamic';

/**
 * Shared context-aware chrome over existing owner/membership/role reads.
 * Selectors describe accessible contexts and never establish record permission.
 * Every destination retains its existing service and action authorization.
 */
export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  // The address comes from the same session read the chrome already uses; nothing new is loaded.
  // It is kept apart from the access object so the browser receives it once, only for the menu.
  const { account, accountEmail } = await withSession(async ({ db, ...actor }) => ({
    account: await loadWorkspaceChrome(db, actor),
    accountEmail: actor.email,
  }));

  // This device's choice (a small cookie), so the sidebar is drawn open or as a rail from the first paint.
  const sidebarState = parseSidebarState((await cookies()).get(SIDEBAR_COOKIE)?.value);

  return (
    <WorkspaceShell
      access={account}
      sidebarState={sidebarState}
      accountName={account.accountName}
      accountEmail={accountEmail}
      toolbarState={account.toolbar}
      signOut={
        <form
          action={async () => {
            'use server';
            await signOutCurrentUser();
          }}
        >
          <button type="submit" className="btn btn-secondary nav-cta">
            <Icon name="logout" size={18} />
            Sign Out
          </button>
        </form>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
