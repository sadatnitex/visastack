'use client';

import { type ReactNode, useState } from 'react';

/**
 * A disclosure that starts open or closed and then stays as the person left it. A plain
 * `<details open={...}>` follows the prop on every render, so a server refresh after a save
 * (which can flip the prop) would close it over the result message the person still needs.
 */
export function StickyDetails({
  initiallyOpen,
  className,
  summary,
  children,
}: {
  readonly initiallyOpen: boolean;
  readonly className?: string;
  readonly summary: ReactNode;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details className={className} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
