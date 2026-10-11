'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Icon, type IconName } from '../../components/icons';
import { type NavLink, PRIMARY_NAV, isCurrentPath } from '../../lib/navigation';

/** One icon per primary destination, keyed by its path. The words beside it carry the meaning. */
const ICONS: Readonly<Record<string, IconName>> = {
  '/app': 'home',
  '/app/applicants': 'users',
  '/app/shared': 'share',
  '/app/notifications': 'bell',
  '/app/privacy': 'shield',
  '/app/account': 'user',
};

const CONTEXT_ICONS: Readonly<Record<string, IconName>> = {
  Overview: 'home',
  'My profile': 'user',
  Documents: 'folder',
  'Visa cases': 'briefcase',
  Sharing: 'share',
  Notifications: 'bell',
  Settings: 'settings',
  'Help & support': 'shield',
  Clients: 'users',
  Cases: 'briefcase',
  'Evidence requests': 'clipboard',
  Team: 'users',
  'Activity log': 'activity',
  'Case activity': 'activity',
  Members: 'users',
  Organizations: 'building',
  Activity: 'activity',
  Providers: 'folder',
  'Costs & plans': 'briefcase',
  Security: 'shield',
};

/** How many links stay on the bar at the bottom of a phone; the rest sit under "More". */
const BAR_LINKS = 4;
const MOBILE_LABELS: Readonly<Record<string, string>> = {
  'My profile': 'Profile',
  'Visa cases': 'Cases',
  'Choose a traveller': 'Travellers',
  'Add a traveller': 'Add traveller',
  'Evidence requests': 'Requests',
  'Activity log': 'Activity',
  'Case activity': 'Activity',
};

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
  accountLabel,
  identity,
  secondaryLinks = [],
  footer,
}: {
  readonly links: readonly NavLink[];
  readonly accountLabel?: string;
  readonly identity?: ReactNode;
  readonly secondaryLinks?: readonly NavLink[];
  readonly footer?: ReactNode;
  /** The switch controls (Agency, Admin, Sign out), supplied by the server layout. */
  readonly children?: ReactNode;
}) {
  const pathname = usePathname();
  const [hash, setHash] = useState('');
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Hash destinations are real sections; their selected state follows browser history too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname navigation can change the fragment
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, [pathname]);

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
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panelRef.current?.contains(event.target) &&
        !toggleRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);

  const activeFragment = links.find(
    (item) => item.href.includes('#') && isCurrentPath(pathname + hash, item),
  );
  const link = (item: NavLink) => (
    <Link
      key={item.href}
      href={item.href}
      aria-label={item.label}
      onClick={() => setOpen(false)}
      aria-current={
        (activeFragment ? activeFragment.href === item.href : isCurrentPath(pathname + hash, item))
          ? 'page'
          : undefined
      }
    >
      <Icon name={CONTEXT_ICONS[item.label] ?? ICONS[item.href] ?? 'folder'} size={20} />
      <span className="app-link-label app-link-full">{item.label}</span>
      <span className="app-link-label app-link-compact" aria-hidden="true">
        {MOBILE_LABELS[item.label] ?? item.label}
      </span>
    </Link>
  );

  return (
    <div className="app-shell-nav" data-open={open ? 'true' : 'false'}>
      <div className="app-sidebar-heading">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true" />
          VisaStack
        </Link>
      </div>
      {identity ?? (
        <Link href="/app/account" className="app-sidebar-account">
          <Icon name="user" size={20} />
          <span>
            <b>
              {pathname.startsWith('/app/admin')
                ? 'Platform workspace'
                : pathname.startsWith('/app/agency')
                  ? 'Agency workspace'
                  : 'Personal workspace'}
            </b>
            <small>{accountLabel ?? 'Account details'}</small>
          </span>
        </Link>
      )}
      <p className="app-sidebar-context">Workspace</p>
      <div
        className="app-bar"
        style={
          { '--mobile-nav-count': Math.max(1, Math.min(links.length, BAR_LINKS)) } as CSSProperties
        }
      >
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
        <div className="app-more-heading">
          <strong>Workspace navigation</strong>
          <button
            type="button"
            className="btn btn-secondary"
            aria-label="Close navigation"
            onClick={() => {
              setOpen(false);
              toggleRef.current?.focus();
            }}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <nav className="app-shell-links app-shell-links-more" aria-label="Account and privacy">
          {links.slice(BAR_LINKS).map(link)}
        </nav>
        {children}
        {secondaryLinks.length ? (
          <nav className="app-shell-links workspace-bottom-links" aria-label="Settings and support">
            {secondaryLinks.map(link)}
          </nav>
        ) : null}
        {footer}
      </div>
    </div>
  );
}

/** Existing destinations only. Context labels never grant or imply access. */
export function WorkspaceToolbar({
  accountLabel,
  isAdmin = false,
}: {
  readonly accountLabel?: string;
  readonly isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const finder = useRef<HTMLInputElement>(null);
  const finderId = useId();
  const destinations = [
    ...PRIMARY_NAV,
    { href: '/app/agency', label: 'Agency workspace' },
    ...(isAdmin ? [{ href: '/app/admin', label: 'Platform administration' }] : []),
  ];
  const matches = destinations.filter((item) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: navigation clears the finder
  useEffect(() => setQuery(''), [pathname]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (!finder.current?.getClientRects().length) return;
        event.preventDefault();
        finder.current.focus();
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);
  const context = pathname.startsWith('/app/admin')
    ? 'Platform administration'
    : pathname.startsWith('/app/agency')
      ? 'Agency workspace'
      : 'Personal workspace';
  return (
    <header className="workspace-toolbar">
      <Link href="/" className="brand workspace-brand">
        <span className="brand-mark" aria-hidden="true" />
        VisaStack
      </Link>
      <div className="workspace-finder">
        <Icon name="search" size={19} />
        <label className="sr-only" htmlFor={finderId}>
          Find a page
        </label>
        <input
          id={finderId}
          ref={finder}
          type="search"
          placeholder="Find a page..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
        />
        <kbd className="workspace-finder-key">⌘ K</kbd>
        {query.trim() ? (
          <nav className="workspace-finder-results" aria-label="Matching pages">
            {matches.length ? (
              matches.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setQuery('')}>
                  {item.label}
                </Link>
              ))
            ) : (
              <p>No pages match. Try another name.</p>
            )}
          </nav>
        ) : null}
      </div>
      <p className="workspace-context">{context}</p>
      <nav aria-label="Workspace shortcuts" className="workspace-shortcuts">
        <Link href="/status" aria-label="Help and service status">
          <Icon name="alert" size={20} />
        </Link>
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
