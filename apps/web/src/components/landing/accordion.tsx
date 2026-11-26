import type { ReactNode } from 'react';

/**
 * One open-and-close row of the approved homepage: the browser's own disclosure with the design's
 * plus and minus marker (home-landing.css). It works before any script loads and with script off,
 * opens and closes from the keyboard (Enter, Space) and opens in find-in-page.
 *
 * `group` names an exclusive group (one row open at a time, the browser closes the others); the
 * common questions have none, so each opens on its own. The product's Expandable Section is a
 * card row with a heading and a chevron; the approved design draws a plain line with a plus, so the
 * homepage keeps this one small component (counted once in scripts/ui-ratchet.baseline.json, not
 * six times).
 */
export function Accordion({
  summary,
  children,
  group,
  defaultOpen = false,
}: {
  /** The row's name, with an optional badge after it. */
  readonly summary: ReactNode;
  readonly children: ReactNode;
  readonly group?: string;
  readonly defaultOpen?: boolean;
}) {
  return (
    <details {...(group ? { name: group } : {})} open={defaultOpen}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
