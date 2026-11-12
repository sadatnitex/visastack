import type { ReactNode } from 'react';
import { Icon } from '../../components/icons';
import { ShareOriginsProvider } from '../../components/share/share-origins';
import { appHomeCatalog } from '../../i18n/app-home';
import { resolveBaseUrl } from '../../lib/base-url';
import { caseSubjectFor } from '../../lib/case-subject';
import { getT } from '../../lib/i18n-server';
import { withSession } from '../../lib/session';
import { getSidebarState } from '../../lib/sidebar-state';
import { signOutCurrentUser } from '../../lib/sign-out';
import { loadWorkspaceChrome } from '../../lib/workspace-chrome';
import { WorkspaceShell } from './workspace-shell';

/**
 * The signed-in workspace frame: sidebar, top bar and account menu over the existing owner,
 * membership and role reads. Selectors describe accessible contexts and never establish record
 * permission; every destination keeps its own service and action authorization.
 *
 * It belongs only to pages that already require a signed-in session (`/app` and the signed-in
 * answers page). It must never wrap a page a guest can open, because it reads the session's
 * account.
 *
 * `pathname` is the address of the page being rendered, for a case page only: it lets the first
 * paint show the case's traveller instead of a neutral sidebar that changes once the browser
 * wakes up. It chooses which record to check; the same owner-scoped read as the case page decides.
 */
export async function WorkspaceFrame({
  children,
  pathname,
}: {
  readonly children: ReactNode;
  readonly pathname?: string | null;
}) {
  // getT primes the language itself: this frame also wraps pages (collect, account, answers)
  // whose layout and page never prime it, and a sync read there would crash in dev and show English.
  const t = await getT(appHomeCatalog);
  // The address comes from the same session read the chrome already uses; nothing new is loaded.
  // It is kept apart from the access object so the browser receives it once, only for the menu.
  const { account, accountEmail, caseSubject } = await withSession(async ({ db, ...actor }) => {
    const [chrome, subject] = await Promise.all([
      loadWorkspaceChrome(db, actor),
      caseSubjectFor(pathname, db, actor.accountId),
    ]);
    return { account: chrome, accountEmail: actor.email, caseSubject: subject };
  });

  // This device's choice (a small cookie), so the sidebar is drawn open or as a rail from the first paint.
  const sidebarState = await getSidebarState();

  return (
    <WorkspaceShell
      access={account}
      sidebarState={sidebarState}
      accountName={account.accountName}
      accountEmail={accountEmail}
      toolbarState={account.toolbar}
      initialCaseSubject={caseSubject}
      signOut={
        <form
          action={async () => {
            'use server';
            await signOutCurrentUser();
          }}
        >
          <button type="submit" className="btn btn-secondary nav-cta">
            <Icon name="logout" size={18} />
            {t.node('appHome.appWorkspaceFrame.signOut')}
          </button>
        </form>
      }
    >
      <ShareOriginsProvider origin={resolveBaseUrl()}>{children}</ShareOriginsProvider>
    </WorkspaceShell>
  );
}
