'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { componentsCatalog } from '../i18n/components';
import { useT } from './i18n-provider';
import { Icon } from './icons';

export interface SiteNavigationPage {
  /** Where the link goes (a part of the home page while the page's own address is not live). */
  readonly href: string;
  /** The page's own address, so the current page can be told apart. */
  readonly route: string;
  readonly label: ReactNode;
}

/** The page is the current one on its own address or anywhere beneath it. */
export function isCurrentPage(pathname: string | null, route: string): boolean {
  if (!pathname) return false;
  return route === '/' ? pathname === '/' : pathname === route || pathname.startsWith(`${route}/`);
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
  pages,
  actions,
  menuExtras,
}: {
  readonly pages: readonly SiteNavigationPage[];
  readonly actions: ReactNode;
  readonly menuExtras?: ReactNode;
}) {
  const t = useT(componentsCatalog);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const links = useRef<HTMLElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new path closes the menu
  useEffect(() => setOpen(false), [pathname]);
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

  // Choosing a page or the language is the end of the menu's job: it closes.
  const closeOnChoice = (event: { target: EventTarget }) => {
    if (!(event.target as HTMLElement).closest('a, button')) return;
    setOpen(false);
    // The choice is about to be hidden with the menu (a page link that stays on this page, or the
    // language button): keep focus on the menu button rather than dropping it to the page top.
    button.current?.focus();
  };

  return (
    <div className="site-navigation" data-open={open ? 'true' : 'false'}>
      <div id={id} className="site-menu-panel">
        <nav
          ref={links}
          className="nav-links"
          aria-label={t('components.siteNavigation.site')}
          onClickCapture={closeOnChoice}
        >
          <div className="site-nav-pages">
            {pages.map((page) => (
              <Link
                key={page.route}
                href={page.href}
                aria-current={isCurrentPage(pathname, page.route) ? 'page' : undefined}
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
