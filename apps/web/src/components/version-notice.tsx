'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { rememberVersionNoticeSeen } from '../lib/version-notice';
import { Icon } from './icons';

export interface VersionNoticeCopy {
  readonly label: string;
  readonly detail: string;
  /** Phone version: the same meaning in a few words, so the notice stays one or two lines. */
  readonly short: string;
}

/**
 * The notice about this version. On the first page a visitor opens it shows in full: the version
 * name, what that means, the What Works Today link and Hide This Notice. Seeing it once is enough:
 * the cookie written here makes later pages arrive with only the slim label (the version name and
 * the link, one line), and moving to another page in the same visit folds it the same way. Once
 * folded it stays folded for the visit, even back on the first page. Hide This Notice folds it at
 * once; nothing removes the label, so every page still says which version this is. The words are
 * decided on the server (`pilot-banner.tsx`); this part only remembers and folds.
 */
export function VersionNotice({
  copy,
  folded: foldedAtStart = false,
}: {
  readonly copy: VersionNoticeCopy;
  /** This device has already seen the notice: start with the slim label. */
  readonly folded?: boolean;
}) {
  const pathname = usePathname();
  const [firstPage] = useState(pathname);
  const [folded, setFolded] = useState(foldedAtStart);
  const link = useRef<HTMLAnchorElement>(null);
  // Leaving the first page folds the notice for the rest of the visit (set while rendering, so the
  // next page never shows the full notice for a frame).
  if (!folded && pathname !== firstPage) setFolded(true);
  useEffect(() => {
    if (!foldedAtStart) rememberVersionNoticeSeen();
  }, [foldedAtStart]);
  // A named region, so the notice is a landmark a screen reader user can find and skip,
  // not loose content above the page's own landmarks.
  return (
    <section
      className={folded ? 'pilot-banner pilot-banner-slim' : 'pilot-banner'}
      aria-label="About this version"
    >
      <span className="pilot-banner-label">{copy.label}</span>
      {folded ? null : (
        <>
          {/* One of these two shows, by screen width; the link gives the full list either way. */}
          <span className="pilot-banner-detail">{copy.detail}</span>
          <span className="pilot-banner-short">{copy.short}</span>
        </>
      )}
      <a className="pilot-banner-link" href="/status" ref={link}>
        What Works Today
      </a>
      {folded ? null : (
        <button
          type="button"
          className="pilot-banner-hide"
          aria-label="Hide This Notice"
          onClick={() => {
            rememberVersionNoticeSeen();
            setFolded(true);
            // The button goes; the keyboard stays in the notice, on the link that remains.
            requestAnimationFrame(() => link.current?.focus());
          }}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </section>
  );
}
