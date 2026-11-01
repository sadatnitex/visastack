import Link from 'next/link';
import { type SearchParamsRecord, pagingHref } from '../../../../lib/paging';

/** How to name the rows in the count, for example `{ one: 'failed job', other: 'failed jobs' }`. */
export interface QueueNoun {
  readonly one: string;
  readonly other: string;
}

/**
 * The count line under a queue, in plain words. A later load says so, because the rows are
 * replaced by the next ones, not added to: "Showing 50 older failed jobs, of 1000."
 */
export function queueCount({
  shown,
  total,
  noun,
  later,
  direction,
}: {
  readonly shown: number;
  readonly total: number;
  readonly noun: QueueNoun;
  readonly later: boolean;
  readonly direction: 'older' | 'next';
}): string {
  const word = (count: number) => (count === 1 ? noun.one : noun.other);
  if (later) {
    return `Showing ${shown} ${direction === 'older' ? 'older' : 'more'} ${word(shown)}, of ${total}.`;
  }
  if (total <= shown) {
    return total === 1 ? `Showing the only ${noun.one}.` : `Showing all ${total} ${noun.other}.`;
  }
  return `Showing the ${direction === 'older' ? 'newest' : 'first'} ${shown} of ${total} ${noun.other}.`;
}

/**
 * WP-SB6: the end of one staff queue. It says how many rows this load shows, links to the next load
 * from the server (its cursor travels in `param`, every other parameter on the page is kept), and,
 * once a later load is open, links back to the first one. Both links land on the queue's box, which
 * scrolls back to its top and takes focus when the new rows arrive.
 */
export function QueuePaging({
  pathname,
  search,
  param,
  cursor,
  later,
  landOn,
  shown,
  total,
  noun,
  direction = 'older',
}: {
  readonly pathname: string;
  readonly search: SearchParamsRecord;
  /** The address parameter that carries this queue's cursor. */
  readonly param: string;
  /** The next load's cursor; null when nothing more exists. */
  readonly cursor: string | null;
  /** True when this is not the first load. */
  readonly later: boolean;
  /** The id of the queue's box. */
  readonly landOn: string;
  readonly shown: number;
  readonly total: number;
  readonly noun: QueueNoun;
  /** `older` for a newest-first queue, `next` for one that reads oldest first. */
  readonly direction?: 'older' | 'next';
}) {
  return (
    <div className="staff-queue-paging">
      <output className="muted u-fs-085">
        {queueCount({ shown, total, noun, later, direction })}
      </output>
      {cursor ? (
        <Link
          className="btn btn-secondary u-btn-sm"
          href={pagingHref(pathname, search, { [param]: cursor }, landOn)}
        >
          {direction === 'older' ? 'Show Older Entries' : 'Show Next Entries'}
        </Link>
      ) : null}
      {later ? (
        <Link
          className="btn btn-secondary u-btn-sm"
          href={pagingHref(pathname, search, { [param]: null }, landOn)}
        >
          {direction === 'older' ? 'Show Newest Entries' : 'Show First Entries'}
        </Link>
      ) : null}
    </div>
  );
}

/** The line a queue shows when a later load came back empty, with the way to the first load. */
export function QueuePastEnd({
  pathname,
  search,
  param,
  landOn,
  what,
  direction = 'older',
}: {
  readonly pathname: string;
  readonly search: SearchParamsRecord;
  readonly param: string;
  readonly landOn: string;
  /** For example "No older failed jobs." */
  readonly what: string;
  readonly direction?: 'older' | 'next';
}) {
  return (
    <p className="card-body">
      {what}{' '}
      <Link href={pagingHref(pathname, search, { [param]: null }, landOn)}>
        {direction === 'older' ? 'Show Newest Entries' : 'Show First Entries'}
      </Link>
    </p>
  );
}
