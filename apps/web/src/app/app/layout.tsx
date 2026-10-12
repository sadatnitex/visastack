import type { ReactNode } from 'react';
import { Icon } from '../../components/icons';
import { withSession } from '../../lib/session';
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
  const account = await withSession(({ db, ...actor }) => loadWorkspaceChrome(db, actor));

  return (
    <WorkspaceShell
      access={account}
      accountName={account.accountName}
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
            Sign out
          </button>
        </form>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
