'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Icon, type IconName } from '../../components/icons';
import { type NavLink, isCurrentPath } from '../../lib/navigation';

/** One icon per primary destination, keyed by its path. The words beside it carry the meaning. */
const ICONS: Readonly<Record<string, IconName>> = {
  '/app': 'home',
  '/app/applicants': 'users',
  '/app/shared': 'share',
  '/app/notifications': 'bell',
  '/app/privacy': 'shield',
  '/app/account': 'user',
};

/** How many links stay on the bar at the bottom of a phone; the rest sit under "More". */
const BAR_LINKS = 4;

/**
 * The signed-in navigation (master directive section 7 "PR 7"; names in `lib/navigation.ts`).
 *
 * On a laptop or larger it is a sidebar listing every destination, with the account
 * and switch controls below. On a phone it is a bar at the bottom of the screen, within
 * reach of a thumb: four destinations and a "More" button that opens the rest and the
 * switch controls. The same links are used in both, so nothing is listed twice.
 *
 * Which link is "current" is decided by `isCurrentPath`: the overview link matches only
 * its own path, otherwise every page in the app would light up "Overview".
 */
export function AppNav({
  links,
  children,
}: {
  readonly links: readonly NavLink[];
  /** The switch controls (Agency, Admin, Sign out), supplied by the server layout. */
  readonly children?: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Moving to another page closes the sheet, so it never sits open over the next page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sheet closes when the path changes, which is not read inside the effect
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes the sheet, as people expect of anything that opens over the page.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const link = (item: NavLink) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={isCurrentPath(pathname, item) ? 'page' : undefined}
    >
      <Icon name={ICONS[item.href] ?? 'folder'} size={20} />
      <span className="app-link-label">{item.label}</span>
    </Link>
  );

  return (
    <div className="app-shell-nav" data-open={open ? 'true' : 'false'}>
      <div className="app-sidebar-heading">
        <Icon name="folder" size={22} />
        <span>Your workspace</span>
      </div>
      <div className="app-bar">
        <nav className="app-shell-links" aria-label="Workspace">
          {links.slice(0, BAR_LINKS).map(link)}
        </nav>
        <button
          ref={toggleRef}
          type="button"
          className="app-more-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={open ? 'close' : 'more'} size={20} />
          <span className="app-link-label">More</span>
        </button>
      </div>
      <div className="app-more" id={panelId} ref={panelRef}>
        <nav className="app-shell-links app-shell-links-more" aria-label="Account and privacy">
          {links.slice(BAR_LINKS).map(link)}
        </nav>
        {children}
      </div>
    </div>
  );
}

/** Existing destinations only. Context labels never grant or imply access. */
export function WorkspaceToolbar({ accountLabel }: { readonly accountLabel?: string }) {
  const pathname = usePathname();
  const context = pathname.startsWith('/app/admin')
    ? 'Platform administration'
    : pathname.startsWith('/app/agency')
      ? 'Agency workspace'
      : 'Personal workspace';
  return (
    <header className="workspace-toolbar">
      <p className="workspace-context">{context}</p>
      <nav aria-label="Workspace shortcuts" className="workspace-shortcuts">
        <Link href="/app/notifications" aria-label="Notifications">
          <Icon name="bell" size={20} />
        </Link>
        <Link href="/app/account" aria-label="Your account">
          <Icon name="user" size={20} />
          {accountLabel ? <span className="workspace-identity">{accountLabel}</span> : null}
        </Link>
      </nav>
    </header>
  );
}
