'use client';

import type { Locale } from '@visastack/i18n';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { BrandMark } from '../../components/brand-mark';
import { useLocale, useT } from '../../components/i18n-provider';
import { Icon, type IconName } from '../../components/icons';
import { LinkPending } from '../../components/link-pending';
import { ShortcutHint } from '../../components/shortcut-hint';
import { appHomeCatalog } from '../../i18n/app-home';
import { countLabel } from '../../lib/count-label';
import { type NavAction, type NavLink, PRIMARY_NAV, isCurrentPath } from '../../lib/navigation';

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
  // UMPE P13: the traveller's three entry points and their tasks.
  'My Documents': 'folder',
  'My Trips': 'briefcase',
  'Sharing & Requests': 'share',
  'Add Documents': 'upload',
  'Start a Trip': 'plus',
  Record: 'file',
  Overview: 'home',
  'My Profile': 'user',
  Documents: 'folder',
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
  Providers: 'globe',
  'Costs & Plans': 'file',
  Security: 'shield',
  // The platform tools lists carry the same icon beside the words as the main links do.
  'Rules & Packs': 'clipboard',
  'AI Settings': 'key',
  'Privacy Operations': 'lock',
  'Removal Requests': 'clock',
  'Field Insights': 'eye',
  'Platform Access': 'users',
  Complaints: 'alert',
  Billing: 'briefcase',
  'Email Delivery': 'mail',
  'Document Protection': 'shield',
  'Sign-In Recovery': 'key',
};

/** The icon that stands beside a destination's words, the same wherever the link is drawn. */
export function navIconFor(item: { readonly href: string; readonly label: string }): IconName {
  return CONTEXT_ICONS[item.label] ?? ICONS[item.href] ?? 'folder';
}

/**
 * How many links stay on the bar at the bottom of a phone; the rest sit under "More". For a
 * traveller these are the four tabs Home, Record, Cases and Sharing (WP-V3 part 2).
 */
const BAR_LINKS = 4;
const MOBILE_LABELS: Readonly<Record<string, string>> = {
  'Account Overview': 'Overview',
  'All Travellers': 'Travellers',
  'My Profile': 'Profile',
  'Choose a Traveller': 'Travellers',
  'Add a Traveller': 'Traveller',
  'Evidence Requests': 'Requests',
  'My Documents': 'Documents',
  'My Trips': 'Trips',
  'Sharing & Requests': 'Sharing',
  'Activity Log': 'Activity',
  'Case Activity': 'Activity',
};

/**
 * The phone tab bar's label: the short one where there is one, otherwise the full name. A label
 * longer than ten letters ("Organizations") marks its bar so the tabs share the width by what
 * they hold, and the word shows whole rather than cut (S30). It stays the word the page uses, so
 * the label is part of the link's name, and it keeps the 12px text floor.
 */
function compactLabel(label: string): string {
  return MOBILE_LABELS[label] ?? label;
}

/**
 * How a tab's count is drawn and spoken: nothing at zero, "9+" above nine on the tab (it is small),
 * and the real number in the link's name up to "99+". Exported for the tests.
 */
export function badgeFor(
  count: number | undefined,
  locale: Locale = 'en',
): { readonly shown: string; readonly spoken: string } | null {
  if (count === undefined || !Number.isFinite(count) || count < 1) return null;
  return { shown: countLabel(count, 9, locale), spoken: countLabel(count, 99, locale) };
}

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
  badges = {},
}: {
  readonly links: readonly NavLink[];
  /**
   * A count of new things on a destination, by its path (see `lib/tab-badges.ts`). A destination
   * with none, or a zero, shows nothing. The count is part of the link's name.
   */
  readonly badges?: Readonly<Record<string, number>>;
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
  const t = useT(appHomeCatalog);
  const locale = useLocale();
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
  /** A destination and, in the sidebar, its one task just below it (UMPE P13). */
  const entry = (item: NavLink) =>
    item.action ? (
      // The task sits inside its destination's row (a small icon at the end of it on a laptop), so
      // the menu stays one row per destination. On a phone the wrapper steps aside.
      <div key={item.href} className="app-nav-entry">
        {link(item)}
        {actionLink(item.action, 'icon')}
      </div>
    ) : (
      link(item)
    );
  const actionLink = (action: NavAction, variant: 'icon' | 'row') => {
    // In the sidebar the task is an icon at the end of its row, so its name is the spoken name
    // and the hover and focus label (see the stylesheet). In the phone's More panel it is a full
    // row with its words showing.
    const iconOnly = variant === 'icon';
    return (
      <Link
        key={`action:${action.href}`}
        href={action.href}
        className={iconOnly ? 'app-nav-action' : 'app-nav-action-row'}
        {...(iconOnly ? { 'aria-label': action.label } : {})}
        onClick={() => setOpen(false)}
      >
        <LinkPending />
        <Icon name={CONTEXT_ICONS[action.label] ?? 'plus'} size={18} />
        {iconOnly ? null : <span>{action.label}</span>}
      </Link>
    );
  };
  const actions = links.flatMap((item) => (item.action ? [item.action] : []));
  const link = (item: NavLink) => {
    const badge = badgeFor(badges[item.href], locale);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-label={
          badge
            ? t('appHome.appAppNav.labelSpokenNew', {
                label: item.label,
                spoken: badge.spoken,
              })
            : item.label
        }
        onClick={() => setOpen(false)}
        aria-current={
          (
            activeFragment
              ? activeFragment.href === item.href
              : isCurrentPath(pathname + hash, item)
          )
            ? 'page'
            : undefined
        }
      >
        <LinkPending />
        <Icon name={navIconFor(item)} size={20} />
        <span className="app-link-label app-link-full">{item.label}</span>
        <span
          className={`app-link-label app-link-compact${compactLabel(item.label).length > 10 ? ' app-link-compact-long' : ''}`}
          aria-hidden="true"
        >
          {compactLabel(item.label)}
        </span>
        {badge ? (
          <span className="app-tab-badge" aria-hidden="true">
            {badge.shown}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <div className="app-shell-nav" id={navId} data-open={open ? 'true' : 'false'}>
      <div className="app-sidebar-heading">
        <Link className="brand" href="/">
          <BrandMark />
          {t.node('appHome.appAppNav.visastack')}
        </Link>
        {onToggleSidebar ? (
          // Laptop and larger only (the stylesheet hides it on a phone). One button in both states,
          // so keyboard focus stays on it when the sidebar changes size.
          <button
            type="button"
            className="app-sidebar-toggle"
            aria-expanded={!sidebarCollapsed}
            aria-controls={navId}
            aria-label={
              sidebarCollapsed ? t('appHome.appAppNav.showMenu') : t('appHome.appAppNav.hideMenu')
            }
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
                ? t.node('appHome.appAppNav.platformWorkspace')
                : pathname.startsWith('/app/agency')
                  ? t.node('appHome.appAppNav.agencyWorkspace')
                  : t.node('appHome.appAppNav.personalWorkspace')}
            </b>
            <small>{accountLabel ?? t.node('appHome.appAppNav.accountDetails')}</small>
          </span>
        </Link>
      )}
      <p className="app-sidebar-context">{t.node('appHome.appAppNav.workspace')}</p>
      <div
        className="app-bar"
        style={
          { '--mobile-nav-count': Math.max(1, Math.min(links.length, BAR_LINKS)) } as CSSProperties
        }
      >
        <nav
          className="app-shell-links"
          aria-label={t('appHome.appAppNav.workspace')}
          {...t.lang('appHome.appAppNav.workspace')}
        >
          {links.slice(0, BAR_LINKS).map(entry)}
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
          <span className="app-link-label">{t.node('appHome.appAppNav.more')}</span>
        </button>
      </div>
      <div className="app-more" id={panelId} ref={panelRef}>
        <div className="app-more-heading">
          <strong>{t.node('appHome.appAppNav.workspaceNavigation')}</strong>
          <button
            type="button"
            className="btn btn-secondary"
            aria-label={t('appHome.appAppNav.closeNavigation')}
            {...t.lang('appHome.appAppNav.closeNavigation')}
            onClick={() => {
              setOpen(false);
              toggleRef.current?.focus();
            }}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        {identity ? <div className="app-mobile-identity">{identity}</div> : null}
        {actions.length ? (
          // On a phone the bar has no room for tasks, so they lead the More panel. The sidebar
          // shows each under its destination instead, so this list is hidden there.
          <nav
            className="app-shell-links app-nav-actions"
            aria-label={t('appHome.appAppNav.quickActions')}
            {...t.lang('appHome.appAppNav.quickActions')}
          >
            {actions.map((action) => actionLink(action, 'row'))}
          </nav>
        ) : null}
        <nav
          className="app-shell-links app-shell-links-more"
          aria-label={t('appHome.appAppNav.moreWorkspaceDestinations')}
          {...t.lang('appHome.appAppNav.moreWorkspaceDestinations')}
        >
          {links.slice(BAR_LINKS).map(entry)}
        </nav>
        {children}
        {secondaryLinks.length ? (
          <nav
            className="app-shell-links workspace-bottom-links"
            aria-label={t('appHome.appAppNav.settingsAndSupport')}
            {...t.lang('appHome.appAppNav.settingsAndSupport')}
          >
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
  const t = useT(appHomeCatalog);
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
        {t.node('appHome.appAppNav.visastack')}
      </Link>
      <div className="workspace-finder">
        <Icon name="search" size={19} />
        <label className="sr-only" htmlFor={finderId}>
          {t.node('appHome.appAppNav.findAPage')}
        </label>
        <input
          id={finderId}
          ref={finder}
          type="search"
          placeholder={t('appHome.appAppNav.findAPage6ae3fa')}
          {...t.lang('appHome.appAppNav.findAPage6ae3fa')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
        />
        <ShortcutHint keyName="K" className="workspace-finder-key" />
        {query.trim() ? (
          <nav
            className="workspace-finder-results"
            aria-label={t('appHome.appAppNav.matchingPages')}
          >
            {matches.length ? (
              matches.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setQuery('')}>
                  {item.label}
                </Link>
              ))
            ) : (
              <p>{t.node('appHome.appAppNav.noPagesMatchTryAnotherName')}</p>
            )}
          </nav>
        ) : null}
      </div>
      <p className="workspace-context">{context}</p>
      <nav aria-label={t('appHome.appAppNav.workspaceShortcuts')} className="workspace-shortcuts">
        <Link
          href="/status"
          aria-label={t('appHome.appAppNav.helpAndServiceStatus')}
          {...t.lang('appHome.appAppNav.helpAndServiceStatus')}
        >
          <Icon name="alert" size={20} />
        </Link>
        <Link
          href="/app/notifications"
          aria-label={t('appHome.appAppNav.notifications')}
          {...t.lang('appHome.appAppNav.notifications')}
        >
          <Icon name="bell" size={20} />
        </Link>
        <Link
          href="/app/account"
          aria-label={t('appHome.appAppNav.yourAccount')}
          {...t.lang('appHome.appAppNav.yourAccount')}
        >
          <Icon name="user" size={20} />
          {accountLabel ? <span className="workspace-identity">{accountLabel}</span> : null}
        </Link>
      </nav>
    </header>
  );
}
