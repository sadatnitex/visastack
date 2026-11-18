import Link from 'next/link';
import type { ReactNode } from 'react';
import './public-site.css';

export interface PublicButtonProps {
  readonly href: string;
  readonly variant: 'primary' | 'secondary';
  /** The words, always one of today's button labels (owner, 17 Nov 2026: labels stay). */
  readonly children: ReactNode;
}

/** True for addresses that leave the page for sign-in, where a prefetch would be a blocked request. */
function leavesForSignIn(href: string): boolean {
  return href === '/app' || href.startsWith('/app/') || href.startsWith('/app?');
}

/**
 * A public call to action, 44 px high at least, coloured by the chapter it sits in. `/app` is a
 * plain link like the header's, because it sends a visitor on to the sign-in provider.
 */
export function PublicButton({ href, variant, children }: PublicButtonProps) {
  const className = `pub-button pub-button-${variant}`;
  return leavesForSignIn(href) ? (
    <a className={className} href={href}>
      {children}
    </a>
  ) : (
    <Link className={className} href={href}>
      {children}
    </Link>
  );
}
