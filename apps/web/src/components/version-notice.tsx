'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { rememberVersionNoticeSeen } from '../lib/version-notice';
import { Icon } from './icons';

export interface VersionNoticeCopy {
  readonly label: string;
  readonly detail: string;
  /** Phone version: the same meaning in a few words, so the notice stays one or two lines. */
  readonly short: string;
}

/** Where focus goes once the notice is hidden: the first control after it that can be seen. */
function focusNextControl(): void {
  const next = [
    ...document.querySelectorAll<HTMLElement>(
      'header.nav a[href], header.nav button, main a[href], main button, main input, main select',
    ),
  ].find((element) => element.getClientRects().length > 0);
  next?.focus();
}

/**
 * The notice itself, shown in full on the first page a visitor opens. Showing it once is enough:
 * the cookie written here makes the next page arrive without it, and a move to another page in the
 * same visit (which keeps this layout) folds it away too. Hide This Notice puts it away at once.
 * The words are decided on the server (`pilot-banner.tsx`); this part only remembers and hides.
 */
export function VersionNotice({ copy }: { readonly copy: VersionNoticeCopy }) {
  const pathname = usePathname();
  const [firstPage] = useState(pathname);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    rememberVersionNoticeSeen();
  }, []);
  if (hidden || pathname !== firstPage) return null;
  // A named region, so the notice is a landmark a screen reader user can find and skip,
  // not loose content above the page's own landmarks.
  return (
    <section className="pilot-banner" aria-label="About this version">
      <span className="pilot-banner-label">{copy.label}</span>
      {/* One of these two shows, by screen width; the link below gives the full list either way. */}
      <span className="pilot-banner-detail">{copy.detail}</span>
      <span className="pilot-banner-short">{copy.short}</span>
      <a className="pilot-banner-link" href="/status">
        What Works Today
      </a>
      <button
        type="button"
        className="pilot-banner-hide"
        aria-label="Hide This Notice"
        onClick={() => {
          rememberVersionNoticeSeen();
          setHidden(true);
          // After React removes the notice, keep the keyboard where the page continues.
          requestAnimationFrame(focusNextControl);
        }}
      >
        <Icon name="close" size={16} />
      </button>
    </section>
  );
}
