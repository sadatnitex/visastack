import {
  type SearchParamsRecord,
  firstParam,
  parseCursor,
  parseShow,
} from '../../../../../lib/paging';

/** The address parameters one capped list uses: how many rows, and which older page. */
export interface ListKeys {
  /** Rows shown from the newest, growing by one step per Show More (`?show=`). */
  readonly show: string;
  /** The server cursor of an older page (`?before=`). */
  readonly before: string;
  /** Where an older page starts, counted from the newest (only for the count line). */
  readonly from: string;
}

/** What one capped list reads: how many rows, after which cursor, and where that page starts. */
export interface ListWindow {
  readonly limit: number;
  readonly before: string | undefined;
  readonly from: number | undefined;
}

/**
 * Which rows a capped list shows (WP-SB5). From the newest, the list grows one step per Show More
 * up to `max` rows; past that, older pages of `max` rows follow, each read with the server cursor
 * the previous page returned. Anything malformed in the address falls back to the first step.
 */
export function listWindow(
  query: SearchParamsRecord,
  keys: ListKeys,
  sizes: { readonly step: number; readonly max: number },
): ListWindow {
  const before = parseCursor(query[keys.before]);
  if (!before)
    return { limit: parseShow(query[keys.show], sizes), before: undefined, from: undefined };
  const raw = firstParam(query[keys.from]);
  const from = raw && /^[1-9]\d{0,6}$/.test(raw) ? Number.parseInt(raw, 10) : undefined;
  return { limit: sizes.max, before, from };
}
