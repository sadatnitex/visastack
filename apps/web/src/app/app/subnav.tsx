'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SubNavLink {
  readonly href: string;
  readonly label: string;
}

/**
 * Contextual secondary navigation (workspace/agency/admin section tabs —
 * master directive §7 "PR 7"). The first link is always this section's own
 * index/overview route, so — like `AppNav`'s Home — it matches exactly only;
 * every other link also matches its own descendants. Without this, visiting
 * a deeper route (e.g. .../profile) would highlight both "Overview" and
 * "Profile" at once, since .../profile starts with the overview's own path.
 */
export function SubNav({ links }: { readonly links: readonly SubNavLink[] }) {
  const pathname = usePathname();
  return (
    <nav className="subnav" aria-label="Section">
      {links.map((link, index) => {
        const current = index === 0 ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} aria-current={current ? 'page' : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
