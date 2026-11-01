'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { type RowNoun, ShowMore } from '../../../../../components/show-more';
import { type SearchParamsRecord, nextShow, pagingHref } from '../../../../../lib/paging';
import type { ListKeys, ListWindow } from './list-window';

/**
 * The end of a capped list: Show More while the list grows from the newest, then Show Older
 * Entries for each older page, with a count that says exactly which rows are showing and a way
 * back to the newest. Links keep every other parameter of the page (filters, the open case) and
 * land on `landOn`, the list itself, which then takes keyboard focus so reading continues there.
 */
export function ListPager({
  id,
  landOn,
  pathname,
  query,
  keys,
  sizes,
  window,
  shown,
  total,
  nextCursor,
  noun,
  newestLabel,
}: {
  readonly id: string;
  readonly landOn: string;
  readonly pathname: string;
  readonly query: SearchParamsRecord;
  readonly keys: ListKeys;
  readonly sizes: { readonly step: number; readonly max: number };
  readonly window: ListWindow;
  /** Rows on the page now. */
  readonly shown: number;
  readonly total: number;
  /** The server cursor after the last row shown; null when nothing older exists. */
  readonly nextCursor: string | null;
  readonly noun: RowNoun;
  /** For example "Back to the Newest Cases". */
  readonly newestLabel: string;
}) {
  if (!window.before) {
    const grown = nextShow(window.limit, sizes);
    const next = nextCursor
      ? grown !== null && shown >= window.limit
        ? { [keys.show]: grown }
        : { [keys.before]: nextCursor, [keys.from]: shown + 1, [keys.show]: null }
      : null;
    return (
      <ShowMore
        id={id}
        landOn={landOn}
        pathname={pathname}
        searchParams={query}
        next={next}
        shown={shown}
        total={total}
        noun={noun}
        label={next && keys.before in next ? 'Show Older Entries' : 'Show More'}
      />
    );
  }
  return (
    <OlderPage
      id={id}
      landOn={landOn}
      olderHref={
        nextCursor
          ? pagingHref(
              pathname,
              query,
              {
                [keys.before]: nextCursor,
                [keys.from]: window.from === undefined ? null : window.from + shown,
              },
              landOn,
            )
          : null
      }
      newestHref={pagingHref(
        pathname,
        query,
        { [keys.before]: null, [keys.from]: null, [keys.show]: null },
        landOn,
      )}
      count={
        shown === 0
          ? `No older ${noun.other}.`
          : window.from === undefined
            ? `Showing ${shown} older ${shown === 1 ? noun.one : noun.other} of ${total}.`
            : `Showing ${noun.other} ${window.from} to ${window.from + shown - 1} of ${total}.`
      }
      newestLabel={newestLabel}
    />
  );
}

function OlderPage({
  id,
  landOn,
  olderHref,
  newestHref,
  count,
  newestLabel,
}: {
  readonly id: string;
  readonly landOn: string;
  readonly olderHref: string | null;
  readonly newestHref: string;
  readonly count: string;
  readonly newestLabel: string;
}) {
  // The same landing rule as Show More: when the address points at the list, focus moves there.
  const lastCount = useRef(count);
  useEffect(() => {
    void lastCount.current;
    lastCount.current = count;
    let named = '';
    try {
      named = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    if (named !== landOn) return;
    const landing = document.getElementById(named);
    if (!landing || landing.contains(document.activeElement)) return;
    if (!landing.matches('a[href], button, input, select, textarea, [tabindex]')) {
      landing.setAttribute('tabindex', '-1');
    }
    landing.focus({ preventScroll: true });
  }, [count, landOn]);
  return (
    <div className="show-more" id={id}>
      <output className="show-more-count muted u-fs-085">{count}</output>
      {olderHref ? (
        <Link className="btn btn-secondary u-btn-sm show-more-link" href={olderHref}>
          Show Older Entries
        </Link>
      ) : null}
      <Link className="show-more-newest" href={newestHref}>
        {newestLabel}
      </Link>
    </div>
  );
}
