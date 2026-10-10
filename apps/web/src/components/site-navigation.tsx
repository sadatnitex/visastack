'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Icon } from './icons';

/** One set of real links, shown inline on desktop and in a compact phone menu. */
export function SiteNavigation({ children }: { readonly children: ReactNode }) {
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

  return (
    <div className="site-navigation" data-open={open ? 'true' : 'false'}>
      <button
        ref={button}
        type="button"
        className="site-menu-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? 'close' : 'more'} size={20} />
        Menu
      </button>
      <nav
        ref={links}
        id={id}
        className="nav-links"
        aria-label="Site"
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('a')) setOpen(false);
        }}
      >
        {children}
      </nav>
    </div>
  );
}
