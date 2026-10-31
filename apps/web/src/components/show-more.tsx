import Link from 'next/link';
import { type SearchParamsRecord, pagingHref } from '../lib/paging';

/** How to name the rows in the count, for example `{ one: 'case', other: 'cases' }`. */
export interface RowNoun {
  readonly one: string;
  readonly other: string;
}

function rowsWord(count: number, noun: RowNoun): string {
  return count === 1 ? noun.one : noun.other;
}

/** The count line under a capped list, in plain words. */
export function showMoreCount({
  shown,
  total,
  noun,
  more,
}: {
  readonly shown: number;
  readonly total?: number | undefined;
  readonly noun: RowNoun;
  readonly more: boolean;
}): string {
  if (total !== undefined && total <= shown) {
    return total === 1 ? `Showing the only ${noun.one}.` : `Showing all ${total} ${noun.other}.`;
  }
  if (total !== undefined) return `Showing ${shown} of ${total} ${rowsWord(total, noun)}.`;
  return more
    ? `Showing the first ${shown} ${rowsWord(shown, noun)}.`
    : `Showing all ${shown} ${rowsWord(shown, noun)}.`;
}

/**
 * The end of a capped list: how many rows are showing and, when more exist, a real link that asks
 * the server for the next step (`?show=<n>`) or the next page (`?before=<cursor>`). The link lands
 * on `landOn`: give it the id of the row that will be first among the new ones, so scrolling and
 * the keyboard pick up exactly where the new rows start (it falls back to this control, right
 * below them). The count sits in a polite status, so a screen reader hears the new total.
 *
 * Server-rendered: it needs no script, and the server read behind it must use the same access
 * checks whatever the address says.
 */
export function ShowMore({
  id,
  pathname,
  searchParams,
  next,
  shown,
  total,
  noun,
  landOn,
  label = 'Show More',
}: {
  /** Unique on the page. */
  readonly id: string;
  /** The id of the first new row after loading more; defaults to this control's own id. */
  readonly landOn?: string;
  /** This page's path, for example `/app/agency/123/cases`. */
  readonly pathname: string;
  /** This page's current parameters (filters and tabs are kept). */
  readonly searchParams?: SearchParamsRecord | URLSearchParams;
  /** The parameters for the next load, for example `{ show: 20 }`; null when nothing more exists. */
  readonly next: Readonly<Record<string, string | number | null>> | null;
  /** Rows on the page now. */
  readonly shown: number;
  /** All rows, when the server knows the number cheaply. */
  readonly total?: number;
  readonly noun: RowNoun;
  readonly label?: 'Show More' | 'Show Older Entries';
}) {
  const href = next ? pagingHref(pathname, searchParams, next, landOn ?? id) : null;
  return (
    <div className="show-more" id={id}>
      <output className="show-more-count muted u-fs-085">
        {showMoreCount({ shown, total, noun, more: href !== null })}
      </output>
      {href ? (
        <Link className="btn btn-secondary u-btn-sm show-more-link" href={href}>
          {label}
          {label === 'Show More' ? <span className="sr-only"> {noun.other}</span> : null}
        </Link>
      ) : null}
    </div>
  );
}
