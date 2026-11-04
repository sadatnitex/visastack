import Link from 'next/link';
import { type ReactNode, createElement } from 'react';
import type { LiftHeadingLevel } from './types';

/** A real heading of the given level. Kept apart so every component picks its level the same way. */
export function LiftHeading({
  level,
  className,
  id,
  children,
}: {
  readonly level: LiftHeadingLevel;
  readonly className: string;
  readonly id?: string | undefined;
  readonly children: ReactNode;
}) {
  return createElement(`h${level}`, { className, ...(id ? { id } : {}) }, children);
}

/**
 * A link: an in-page address (`#evidence`) is a plain anchor, a path inside the app is a
 * client-side link. The class decides how it looks.
 */
export function LiftLink({
  href,
  className,
  openGroup,
  children,
}: {
  readonly href: string;
  readonly className: string;
  readonly openGroup?: string | undefined;
  readonly children: ReactNode;
}) {
  if (href.startsWith('/')) {
    return (
      <Link className={className} href={href} data-open-group={openGroup}>
        {children}
      </Link>
    );
  }
  return (
    <a className={className} href={href} data-open-group={openGroup}>
      {children}
    </a>
  );
}
