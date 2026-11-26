'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { componentsCatalog } from '../i18n/components';
import { isCurrentPath } from '../lib/navigation';
import { useT } from './i18n-provider';
import { Icon } from './icons';

export interface SiteNavigationGroupItem {
  readonly href: string;
  readonly label: ReactNode;
  readonly description: ReactNode;
  /** Left out of the phone menu (its page is listed once, further down). */
  readonly wideOnly?: boolean;
}

/** A disclosure menu in the bar: a button that opens a short list of links (LAND1: "How It Works"). */
export interface SiteNavigationGroup {
  readonly label: ReactNode;
  readonly items: readonly SiteNavigationGroupItem[];
  /** The pages the menu stands for, so the bar marks it while one of them is open. */
  readonly currentRoutes: readonly string[];
}

export interface SiteNavigationPage {
  /** Where the link goes (a part of the home page while the page's own address is not live). */
  readonly href: string;
  /** The page's own address, so the current page can be told apart. */
  readonly route: string;
  readonly label: ReactNode;
}

/**
 * The public header's links (NAV2). On a wide screen it is one calm row: the pages in the middle
 * and the actions on the right. When the row would not fit in one line, the pages, the language
 * switch and the quiet sign-in move into a menu, and the one action that matters stays in the bar.
 *
 * `actions` is the part of the bar that never moves into the menu. What the bar shows on a wide
 * screen and the menu repeats on a narrow one (the language switch, the quiet sign-in) is drawn
 * twice: the bar's copy in `actions` (hidden by the stylesheet on a narrow screen) and the menu's
 * copy in `menuExtras` (hidden on a wide one), so each control is on the screen once and the
 * hidden copy is out of the page for everyone, screen readers included.
 */
export function SiteNavigation({
  group,
  pages,
  actions,
  menuExtras,
}: {
  readonly group?: SiteNavigationGroup;
  readonly pages: readonly SiteNavigationPage[];
  readonly actions: ReactNode;
  readonly menuExtras?: ReactNode;
}) {
  const t = useT(componentsCatalog);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const id = useId();
  const groupId = useId();
  const groupRoot = useRef<HTMLDivElement>(null);
  const groupButton = useRef<HTMLButtonElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const links = useRef<HTMLElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new path closes both menus
  useEffect(() => {
    setOpen(false);
    setGroupOpen(false);
  }, [pathname]);

  // The disclosure menu closes on Escape (focus returns to its button), on a press outside it and
  // when keyboard focus leaves it, like the phone menu below.
  useEffect(() => {
    if (!groupOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setGroupOpen(false);
      groupButton.current?.focus();
    };
    const away = (event: PointerEvent) => {
      if (!groupRoot.current?.contains(event.target as Node)) setGroupOpen(false);
    };
    document.addEventListener('keydown', onEscape);
    document.addEventListener('pointerdown', away);
    return () => {
      document.removeEventListener('keydown', onEscape);
      document.removeEventListener('pointerdown', away);
    };
  }, [groupOpen]);
  useEffect(() => {
    if (!open) return;
    links.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open]);

  // An open menu covers the page, so it closes when a press lands outside it or when keyboard focus
  // moves out of it (a tab past the last control), as well as on Escape.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  // Choosing a page or the language is the end of the menu's job: it closes. A page link takes the
  // person to the new page; the language button is hidden with the menu, so focus goes back to the
  // menu button instead of dropping to the top of the page.
  const closeOnChoice = (event: { target: EventTarget }) => {
    const chosen = (event.target as HTMLElement).closest('a, button');
    if (!chosen) return;
    // The disclosure's own button opens and closes itself; every other choice ends both menus.
    if (chosen === groupButton.current) return;
    setOpen(false);
    setGroupOpen(false);
    if (chosen.tagName === 'BUTTON') button.current?.focus();
  };

  return (
    <div
      ref={root}
      className="site-navigation"
      data-open={open ? 'true' : 'false'}
      onBlur={(event) => {
        // Only focus that moves to an element outside the menu closes it. Safari does not focus a
        // link on a press, so a blur with no target happens in the middle of a click inside the
        // menu; presses outside are handled by the pointerdown listener above.
        if (
          open &&
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <div id={id} className="site-menu-panel">
        <nav
          ref={links}
          className="nav-links"
          aria-label={t('components.siteNavigation.site')}
          onClickCapture={closeOnChoice}
        >
          <div className="site-nav-pages">
            {group ? (
              <div
                ref={groupRoot}
                className="site-nav-group"
                data-open={groupOpen ? 'true' : 'false'}
                onBlur={(event) => {
                  if (
                    groupOpen &&
                    event.relatedTarget instanceof Node &&
                    !event.currentTarget.contains(event.relatedTarget)
                  )
                    setGroupOpen(false);
                }}
              >
                <button
                  ref={groupButton}
                  type="button"
                  className="site-nav-group-toggle"
                  aria-expanded={groupOpen}
                  aria-controls={groupId}
                  data-current={
                    pathname &&
                    group.currentRoutes.some((route) =>
                      isCurrentPath(pathname, { href: route, label: '' }),
                    )
                      ? 'true'
                      : undefined
                  }
                  onClick={() => setGroupOpen((value) => !value)}
                >
                  {group.label}
                </button>
                <div id={groupId} className="site-nav-group-panel">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={item.wideOnly ? 'site-nav-wide-only' : undefined}
                    >
                      <strong>{item.label}</strong>
                      <span>{item.description}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
            {pages.map((page) => (
              <Link
                key={page.route}
                href={page.href}
                aria-current={
                  pathname &&
                  isCurrentPath(pathname, {
                    href: page.route,
                    label: '',
                    exact: page.route === '/',
                  })
                    ? 'page'
                    : undefined
                }
              >
                {page.label}
              </Link>
            ))}
          </div>
        </nav>
        {menuExtras ? (
          <div className="site-menu-extras" onClickCapture={closeOnChoice}>
            {menuExtras}
          </div>
        ) : null}
      </div>
      <div className="site-nav-actions">{actions}</div>
      <button
        ref={button}
        type="button"
        className="site-menu-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? 'close' : 'more'} size={20} />
        <span className="site-menu-label">{t.node('components.siteNavigation.menu')}</span>
      </button>
    </div>
  );
}
