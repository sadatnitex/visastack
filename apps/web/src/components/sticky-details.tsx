'use client';

import { type ReactNode, useState } from 'react';

/** Optional attributes for the summary row, for a caller that names and describes it. */
export interface StickySummaryProps {
  readonly className?: string;
  readonly 'aria-labelledby'?: string;
  readonly 'aria-describedby'?: string;
}

/**
 * A disclosure that starts open or closed and then stays as the person left it. A plain
 * `<details open={...}>` follows the prop on every render, so a server refresh after a save
 * (which can flip the prop) would close it over the result message the person still needs.
 */
export function StickyDetails({
  initiallyOpen,
  className,
  summary,
  summaryProps,
  children,
}: {
  readonly initiallyOpen: boolean;
  readonly className?: string;
  readonly summary: ReactNode;
  /** Attributes for the summary element (WAL1); left out, the summary is drawn exactly as before. */
  readonly summaryProps?: StickySummaryProps;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details className={className} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary {...summaryProps}>{summary}</summary>
      {children}
    </details>
  );
}
