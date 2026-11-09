'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../../lib/use-popover';

/** At and below this width the panel is a full screen of its own (the case page is one column). */
export const PANE_SHEET_QUERY = '(max-width: 1180px)';

/** One item's panel, drawn by the server. */
export interface PaneEntry {
  readonly id: string;
  /** The item's name, for the panel's heading label. */
  readonly title: string;
  readonly content: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** The address with the chosen item set or removed, everything else on it left alone. */
function withItem(param: string, id: string | null): URL {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(param, id);
  else url.searchParams.delete(param);
  return url;
}

/**
 * A list and the panel of the chosen item, the one pattern of every list screen. Every panel is in
 * the page the server sends (unchosen ones carry `hidden`), so nothing waits for a request and the
 * address `?item=<id>` opens one straight away, with or without script. With script a click on a
 * row's name opens its panel in place:
 * - Wide: the panel takes the side column; the rest of the side column steps aside while it is open.
 * - Narrow: the panel is a full screen with one way back. Back (the browser's), Esc and the Back
 *   button close it, focus returns to the row that opened it, and the page behind it does not scroll.
 * The wrapper draws no box of its own, so the list and the panel are grid cells of the page.
 */
export function ListWithPane({
  children,
  panes,
  initial,
  param = 'item',
  paneLabel,
  backLabel,
  backHref,
}: {
  /** The list, drawn by the server. Rows open a panel through `a[data-pane-open="<id>"]`. */
  readonly children: ReactNode;
  readonly panes: readonly PaneEntry[];
  /** The item named by the address when the page was drawn, if it is one of the panes. */
  readonly initial?: string | undefined;
  /** The address parameter that names the chosen item. */
  readonly param?: string;
  /** The accessible name of the panel region ("Item details"). */
  readonly paneLabel: string;
  /** The words of the way back ("Back to the Checklist"). */
  readonly backLabel: string;
  /** Where the way back goes when script is off: the page without the chosen item. */
  readonly backHref: string;
}) {
  const known = (id: string | null | undefined) =>
    id && panes.some((p) => p.id === id) ? id : null;
  const [selected, setSelected] = useState<string | null>(known(initial));
  const sheetWidth = useMediaQuery(PANE_SHEET_QUERY);
  const sheetShown = sheetWidth && selected !== null;
  const root = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pushed = useRef(false);

  const open = (id: string, from: HTMLElement | null) => {
    opener.current = from;
    const url = withItem(param, id);
    // The first open adds a history entry, so Back closes the panel; moving between rows replaces.
    if (selected === null) {
      window.history.pushState({ lp: true }, '', url);
      pushed.current = true;
    } else {
      window.history.replaceState(window.history.state, '', url);
    }
    setSelected(id);
  };

  const close = () => {
    setSelected(null);
    if (pushed.current && window.history.state?.lp) {
      pushed.current = false;
      window.history.back();
    } else {
      window.history.replaceState(window.history.state, '', withItem(param, null));
    }
    opener.current?.focus();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // A click on a row's name opens its panel; a click with a modifier key, or on a link that leaves
  // the page, keeps its normal behaviour.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest<HTMLElement>('a[data-pane-open]');
      const id = known(link?.getAttribute('data-pane-open'));
      if (!link || !id || !el.contains(link)) return;
      event.preventDefault();
      open(id, link);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  });

  // The browser's Back closes the panel it opened; Forward opens the item the address names.
  useEffect(() => {
    const onPop = () => {
      const named = known(new URL(window.location.href).searchParams.get(param));
      pushed.current = false;
      setSelected(named);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  // The chosen row is marked for screen readers and for the eye.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    for (const link of el.querySelectorAll<HTMLElement>('a[data-pane-open]')) {
      if (link.getAttribute('data-pane-open') === selected)
        link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
      link
        .closest('[data-pattern="list-row"]')
        ?.toggleAttribute('data-selected', link.getAttribute('data-pane-open') === selected);
    }
  }, [selected]);

  // The panel takes focus when it opens by a click; Esc closes it; on a narrow screen Tab stays in
  // the full screen and the page behind it does not scroll.
  useEffect(() => {
    if (selected === null) return;
    const wasOpener = opener.current;
    if (wasOpener) pane.current?.focus();
    const previous = document.body.style.overflow;
    if (sheetShown) document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      // A menu or question inside the panel that already used Escape keeps it for itself.
      if (event.key === 'Escape' && !event.defaultPrevented) {
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !sheetShown) return;
      const panel = pane.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => node.offsetParent !== null,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!panel.contains(active) || active === panel) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [selected, sheetShown]);

  return (
    <div className="lp-root" ref={root} data-pattern="list-with-pane">
      {children}
      <aside
        ref={pane}
        tabIndex={-1}
        className="lp-pane"
        data-sheet={selected !== null ? 'open' : 'closed'}
        aria-label={paneLabel}
        {...(sheetShown ? { role: 'dialog', 'aria-modal': true } : {})}
      >
        <div className="lp-pane-bar">
          <a
            className="btn btn-secondary"
            href={backHref}
            onClick={(event) => {
              event.preventDefault();
              close();
            }}
          >
            {backLabel}
          </a>
        </div>
        {panes.map((entry) => (
          <section
            key={entry.id}
            id={`lp-pane-${entry.id}`}
            className="lp-pane-item"
            data-pattern="detail-pane"
            aria-label={entry.title}
            hidden={entry.id !== selected}
          >
            {entry.content}
          </section>
        ))}
      </aside>
    </div>
  );
}
