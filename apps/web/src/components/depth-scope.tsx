'use client';

import { type ReactNode, useState } from 'react';
import type { DepthChoice, DepthFamily } from '../lib/ccd/depth';

/**
 * The element that carries a screen's level (ADR 0023). It renders the level it was given once:
 * after that the switch, a filter tile or a link changes the attribute directly, and a later
 * server refresh of the page (for example while a file is being checked) must not undo it.
 */
export function DepthScope({
  family,
  depth,
  children,
}: {
  readonly family: DepthFamily;
  readonly depth: DepthChoice;
  readonly children: ReactNode;
}) {
  const [first] = useState(depth);
  return (
    <div className="depth-scope" data-depth-scope={family} data-depth={first}>
      {/* Only present as an element when scripts are off; the stylesheet then shows every block. */}
      <noscript>
        <span className="depth-nojs" />
      </noscript>
      {children}
    </div>
  );
}
