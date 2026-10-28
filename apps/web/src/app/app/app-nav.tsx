'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { BrandMark } from '../../components/brand-mark';
import { Icon, type IconName } from '../../components/icons';
import { ShortcutHint } from '../../components/shortcut-hint';
import { type NavLink, PRIMARY_NAV, isCurrentPath } from '../../lib/navigation';

/** One icon per primary destination, keyed by its path. The words beside it carry the meaning. */
const ICONS: Readonly<Record<string, IconName>> = {
  '/app': 'home',
  '/app/applicants': 'users',
  '/app/shared': 'share',
  '/app/notifications': 'bell',
  '/app/countries': 'globe',
  '/app/privacy': 'shield',
  '/app/account': 'user',
};

const CONTEXT_ICONS: Readonly<Record<string, IconName>> = {
  Home: 'home',
  Record: 'file',
  Overview: 'home',
  'My Profile': 'user',
  Documents: 'folder',
  'Visa Cases': 'briefcase',
  Sharing: 'share',
  Notifications: 'bell',
  Countries: 'globe',
  Settings: 'settings',
  'Agency Settings': 'settings',
  'Platform Settings': 'settings',
  'Help & Support': 'shield',
  Clients: 'users',
  Cases: 'briefcase',
  'Evidence Requests': 'clipboard',
  Team: 'users',
  'Activity Log': 'activity',
  'Case Activity': 'activity',
  Members: 'users',
  Organizations: 'building',
  Activity: 'activity',
  Providers: 'folder',
  'Costs & Plans': 'briefcase',
  Security: 'shield',
};

/**
 * How many links stay on the bar at the bottom of a phone; the rest sit under "More". For a
 * traveller these are the four tabs Home, Record, Cases and Sharing (WP-V3 part 2).
 */
const BAR_LINKS = 4;
const MOBILE_LABELS: Readonly<Record<string, string>> = {
  'Account Overview': 'Overview',
  'All Travellers': 'Travellers',
  'My Profile': 'Profile',
  'Visa Cases': 'Cases',
  'Choose a Traveller': 'Travellers',
  'Add a Traveller': 'Traveller',
  'Evidence Requests': 'Requests',
  'Activity Log': 'Activity',
  'Case Activity': 'Activity',
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
  sidebarCollapsed = false,
  onToggleSidebar,
}: {
  readonly links: readonly NavLink[];
  readonly accountLabel?: string;
  readonly identity?: ReactNode;
  readonly secondaryLinks?: readonly NavLink[];
  readonly footer?: ReactNode;
  /** True when the laptop sidebar is shown as a slim rail. The look itself is set by the shell frame. */
  readonly sidebarCollapsed?: boolean;
  /**
   * Shows the Hide Menu / Show Menu button on a laptop or larger. Left out, the sidebar is fixed
   * open, as in the layout tests.
   */
  readonly onToggleSidebar?: () => void;
  /** The switch controls (Agency, Admin, Sign out), supplied by the server layout. */
  readonly children?: ReactNode;
}) {
  const pathname = usePathname();
  const [hash, setHash] = useState('');
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const navId = useId();
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
    // A closed workspace disclosure contains hidden links; focus its visible summary first.
    const firstControl =
      panelRef.current?.querySelector<HTMLElement>('.app-mobile-identity summary') ??
      Array.from(panelRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? []).find(
        (link) => link.getClientRects().length > 0,
      ) ??
      panelRef.current?.querySelector<HTMLElement>('.app-more-heading button');
    firstControl?.focus();
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
    <div className="app-shell-nav" id={navId} data-open={open ? 'true' : 'false'}>
      <div className="app-sidebar-heading">
        <Link className="brand" href="/">
          <BrandMark />
          VisaStack
        </Link>
        {onToggleSidebar ? (
          // Laptop and larger only (the stylesheet hides it on a phone). One button in both states,
          // so keyboard focus stays on it when the sidebar changes size.
          <button
            type="button"
            className="app-sidebar-toggle"
            aria-expanded={!sidebarCollapsed}
            aria-controls={navId}
            aria-label={sidebarCollapsed ? 'Show Menu' : 'Hide Menu'}
            onClick={onToggleSidebar}
          >
            <Icon name="sidebar" size={20} />
          </button>
        ) : null}
      </div>
      {identity ?? (
        <Link href="/app/account" className="app-sidebar-account">
          <Icon name="user" size={20} />
          <span>
            <b>
              {pathname.startsWith('/app/admin')
                ? 'Platform Workspace'
                : pathname.startsWith('/app/agency')
                  ? 'Agency Workspace'
                  : 'Personal Workspace'}
            </b>
            <small>{accountLabel ?? 'Account Details'}</small>
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
          <strong>Workspace Navigation</strong>
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
        {identity ? <div className="app-mobile-identity">{identity}</div> : null}
        <nav
          className="app-shell-links app-shell-links-more"
          aria-label="More workspace destinations"
        >
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
    { href: '/app/agency', label: 'Agency Workspace' },
    ...(isAdmin ? [{ href: '/app/admin', label: 'Platform Administration' }] : []),
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
    ? 'Platform Administration'
    : pathname.startsWith('/app/agency')
      ? 'Agency Workspace'
      : 'Personal Workspace';
  return (
    <header className="workspace-toolbar">
      <Link href="/" className="brand workspace-brand">
        <BrandMark />
        VisaStack
      </Link>
      <div className="workspace-finder">
        <Icon name="search" size={19} />
        <label className="sr-only" htmlFor={finderId}>
          Find a Page
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
        <ShortcutHint keyName="K" className="workspace-finder-key" />
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
        <Link href="/app/account" aria-label="Your Account">
          <Icon name="user" size={20} />
          {accountLabel ? <span className="workspace-identity">{accountLabel}</span> : null}
        </Link>
      </nav>
    </header>
  );
}
