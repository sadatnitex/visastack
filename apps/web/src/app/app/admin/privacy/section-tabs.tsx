'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

export interface SectionTab<K extends string> {
  readonly key: K;
  readonly label: string;
  readonly href: string;
  /** How many items the section holds, when that helps choose it. */
  readonly count?: number;
  /** True when more exist than `count` (a paged list): shown as "25+". */
  readonly more?: boolean;
}

/**
 * The sections of a long staff page as tabs (WP-SB7, used by Privacy and Document Protection).
 * Each tab is its own address, so it works without script, can be shared and reloads where it
 * was; the open one is marked for screen readers with aria-current. Built on the product's
 * secondary navigation bar, which scrolls sideways on a phone instead of wrapping; like the
 * section bar (SubNav) it scrolls the open tab into view, moving only the bar, never the page.
 */
export function SectionTabs<K extends string>({
  label,
  tabs,
  active,
}: {
  /** What the tabs choose between, for screen readers (for example "Privacy Sections"). */
  readonly label: string;
  readonly tabs: readonly SectionTab<K>[];
  readonly active: K;
}) {
  const bar = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the open tab changes with `active`, which is not read inside the effect
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
  }, [active]);
  return (
    <nav className="subnav sb7-section-tabs" aria-label={label} ref={bar}>
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={tab.key === active ? 'page' : undefined}>
          {tab.label}
          {tab.count === undefined ? null : (
            <span className="sb7-tab-count">
              {' '}
              ({tab.count}
              {tab.more ? '+' : ''})
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
