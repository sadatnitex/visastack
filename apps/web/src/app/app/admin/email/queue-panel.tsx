'use client';

import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * WP-SB6: the fixed box every staff queue uses (failed jobs, emails, complaints, feedback,
 * invitations). It lives with the Email Delivery page because that is the first page that used it;
 * the overview, complaints and access pages import it from here.
 */

/** One row of a queue: what the filter searches, an optional kind for the kind filter, the row. */
export interface QueueItem {
  readonly id: string;
  /** The words the search looks through, for example the document name and the error. */
  readonly find: string;
  /** A short kind for the kind filter, for example "Client Invitation". */
  readonly kind?: string;
  readonly className?: string;
  readonly node: ReactNode;
}

/**
 * A queue that stays the same height however long it grows: its rows scroll inside a named box
 * that takes keyboard focus, with a search (and a kind filter when rows carry a kind) over the rows
 * of this load. Each load comes from the server; when another load arrives (`pageKey` changes) the
 * box scrolls back to its top and, if the address points at it, takes focus, so the new rows start
 * where people read from. Without script every row shows and the box still scrolls.
 */
export function QueuePanel({
  id,
  label,
  items,
  pageKey,
  kindLabel = 'Kind',
}: {
  /** Unique on the page; paging links land here. */
  readonly id: string;
  /** The accessible name of the box, for example "Failed Intake Jobs". */
  readonly label: string;
  readonly items: readonly QueueItem[];
  /** Changes with every load (the cursor the load was read from). */
  readonly pageKey: string;
  readonly kindLabel?: string;
}) {
  const fieldId = useId();
  const box = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const [kindChoice, setKind] = useState('');

  useEffect(() => {
    void pageKey;
    const element = box.current;
    if (!element) return;
    element.scrollTop = 0;
    let named = '';
    try {
      named = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    if (named === id && !element.contains(document.activeElement)) {
      element.focus({ preventScroll: true });
    }
  }, [pageKey, id]);

  const kinds = useMemo(
    () => [...new Set(items.flatMap((item) => (item.kind ? [item.kind] : [])))].sort(),
    [items],
  );
  // A kind that has left this load must not keep filtering unseen.
  const kind = kinds.includes(kindChoice) ? kindChoice : '';
  const words = query.trim().toLowerCase();
  const shown = items.filter(
    (item) =>
      (!kind || item.kind === kind) &&
      (!words || `${item.find} ${item.kind ?? ''}`.toLowerCase().includes(words)),
  );
  const filtered = Boolean(words || kind);

  return (
    <div className="staff-queue">
      <fieldset className="activity-log-filters staff-queue-filters">
        <legend className="sr-only">{`Find in ${label}`}</legend>
        <label className="activity-log-field activity-log-search" htmlFor={`${fieldId}-q`}>
          <span className="field-label">Find in This List</span>
          <input
            id={`${fieldId}-q`}
            type="search"
            className="input"
            value={query}
            placeholder="Search these rows"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {kinds.length > 1 ? (
          <label className="activity-log-field" htmlFor={`${fieldId}-kind`}>
            <span className="field-label">{kindLabel}</span>
            <select
              id={`${fieldId}-kind`}
              className="input"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="">All Kinds</option>
              {kinds.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </fieldset>
      {filtered ? (
        <div className="activity-log-summary">
          <output className="muted u-fs-085">
            {`${shown.length} of the ${items.length} rows in this load match.`}
          </output>
          <button
            type="button"
            className="btn btn-secondary u-btn-sm"
            onClick={() => {
              setQuery('');
              setKind('');
            }}
          >
            Clear Filters
          </button>
        </div>
      ) : null}
      <section
        className="activity-log-scroll staff-queue-panel"
        id={id}
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it
        tabIndex={0}
        ref={box}
      >
        {shown.length === 0 ? (
          <p className="muted activity-log-none">Nothing in this load matches.</p>
        ) : (
          <ul className="rows">
            {shown.map((item) => (
              <li className={item.className ? `row ${item.className}` : 'row'} key={item.id}>
                {item.node}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
