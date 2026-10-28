import type { ReactNode } from 'react';
import type { DepthChoice, DepthFamily, DepthLevel } from '../lib/ccd/depth';

/**
 * Calm Core With Depths, server side (ADR 0023). A screen wraps its content in one scope and
 * marks each block with the shallowest level it shows at. Everything is always in the page;
 * the stylesheet hides the blocks past the chosen level, so nothing is removed, typed values
 * survive a change of level, and a script-less visitor sees all of it.
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
  return (
    <div className="depth-scope" data-depth-scope={family} data-depth={depth}>
      {/* Only present as an element when scripts are off; the stylesheet then shows every block. */}
      <noscript>
        <span className="depth-nojs" />
      </noscript>
      {children}
    </div>
  );
}

/** The attribute that puts a block at a level: `<section {...atLevel('browse')}>`. */
export function atLevel(level: DepthLevel): { readonly 'data-level': DepthLevel } {
  return { 'data-level': level };
}
