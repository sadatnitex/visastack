'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type NavLink, isCurrentPath } from '../../lib/navigation';

/**
 * Persistent primary navigation for the signed-in product (master directive
 * §7 "PR 7" - global navigation IA). Which link is "current" is decided by
 * `isCurrentPath`: the overview link matches only its own path, otherwise every
 * page in the app would light up "Overview".
 */
export function AppNav({ links }: { readonly links: readonly NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav className="app-shell-links" aria-label="Primary">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={isCurrentPath(pathname, link) ? 'page' : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
