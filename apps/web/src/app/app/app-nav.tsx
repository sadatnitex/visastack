'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface AppNavLink {
  readonly href: string;
  readonly label: string;
}

/**
 * Persistent primary navigation for the signed-in product (master directive
 * §7 "PR 7" — global navigation IA). A link is "current" when the path
 * matches exactly or is a descendant of it, except Home (`/app`), which only
 * matches exactly — otherwise every page in the app would light up "Home".
 */
export function AppNav({ links }: { readonly links: readonly AppNavLink[] }) {
  const pathname = usePathname();
  return (
    <nav className="app-shell-links" aria-label="Primary">
      {links.map((link) => {
        const current =
          link.href === '/app' ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} aria-current={current ? 'page' : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
