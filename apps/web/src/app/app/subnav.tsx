'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { type NavLink, isCurrentPath } from '../../lib/navigation';

/**
 * Contextual secondary navigation (workspace/agency/admin section tabs —
 * master directive §7 "PR 7"). A section's own index link is marked `exact`, so
 * visiting a deeper route (e.g. .../profile) highlights "Profile" and not
 * "Overview" as well, since .../profile starts with the overview's own path.
 *
 * On a narrow screen the tabs scroll sideways inside the bar. A page that loads
 * with its tab off to the right would otherwise hide where the visitor is, so
 * the bar scrolls the current tab into view. Only the bar's own scroll position
 * changes; the page itself never moves.
 *
 * `fit` is for a bar of at most five short tabs (the Record sections): the tabs share the width
 * and use their short names, so nothing scrolls at any phone width. The full label stays the
 * link's accessible name.
 */
export function SubNav({
  links,
  label = 'Section',
  fit = false,
}: {
  readonly links: readonly NavLink[];
  readonly label?: string;
  readonly fit?: boolean;
}) {
  const pathname = usePathname();
  const bar = useRef<HTMLElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the current tab changes with the path, which is not read inside the effect
  useEffect(() => {
    const nav = bar.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current) return;
    const bounds = nav.getBoundingClientRect();
    const tab = current.getBoundingClientRect();
    const margin = 16;
    if (tab.left < bounds.left + margin) nav.scrollLeft -= bounds.left + margin - tab.left;
    else if (tab.right > bounds.right - margin)
      nav.scrollLeft += tab.right - (bounds.right - margin);
  }, [pathname]);

  return (
    <nav className={fit ? 'subnav subnav-fit' : 'subnav'} aria-label={label} ref={bar}>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={isCurrentPath(pathname, link) ? 'page' : undefined}
          {...(fit && link.short ? { 'aria-label': link.label } : {})}
        >
          {fit ? (link.short ?? link.label) : link.label}
        </Link>
      ))}
    </nav>
  );
}
