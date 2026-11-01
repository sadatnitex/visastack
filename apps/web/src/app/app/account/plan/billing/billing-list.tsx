import { type RowNoun, ShowMore } from '../../../../../components/show-more';
import { type SearchParamsRecord, nextShow, parseShow } from '../../../../../lib/paging';

/**
 * The paging every billing list shares (Scroll Budget WP-SB9): 10 rows, then Show More in steps
 * of 10, up to 90. A page reads one row more than it shows, only to know whether more exist, so
 * the read stays inside a service's largest page (100). Used by the traveller's Billing History
 * and Plan & Usage, the agency's Invoices page and the platform owner's organization page.
 */

/** Rows a billing list shows per step (the traveller list step, also used for agency billing). */
export const BILLING_ROWS_STEP = 10;
/** The most rows a billing list grows to through Show More. */
export const BILLING_ROWS_MAX = 90;

/** How many rows to show, from the page's `?show=`; junk gives one step, too much the ceiling. */
export function billingRowsShown(query: SearchParamsRecord): number {
  const { show } = query;
  return parseShow(show, { step: BILLING_ROWS_STEP, max: BILLING_ROWS_MAX });
}

export interface CappedRows<T> {
  readonly rows: readonly T[];
  /** True when the read found more rows than are shown. */
  readonly more: boolean;
  /** The `show` value for the next step, or null at the ceiling or when nothing more exists. */
  readonly next: number | null;
}

/** Cuts a read of `shown + 1` rows back to `shown`, and says whether and how to show more. */
export function capRows<T>(read: readonly T[], shown: number): CappedRows<T> {
  const more = read.length > shown;
  return {
    rows: read.slice(0, shown),
    more,
    next: more ? nextShow(shown, { step: BILLING_ROWS_STEP, max: BILLING_ROWS_MAX }) : null,
  };
}

/** The id Show More lands on: the row at this position (0 based) on the page. */
export function billingRowId(prefix: string, index: number): string {
  return `${prefix}-row-${index}`;
}

/**
 * The end of a billing list: Show More while another step exists. At the ceiling with older rows
 * still unread it says so plainly, rather than claiming everything is showing.
 */
export function BillingListEnd({
  prefix,
  pathname,
  searchParams,
  capped,
  shown,
  noun,
}: {
  /** The row id prefix, so Show More lands on the first new row. */
  readonly prefix: string;
  readonly pathname: string;
  readonly searchParams: SearchParamsRecord;
  readonly capped: CappedRows<unknown>;
  /** The `show` step the page read. */
  readonly shown: number;
  readonly noun: RowNoun;
}) {
  if (capped.more && capped.next === null) {
    return (
      <p className="show-more muted u-fs-085">
        {`Showing the newest ${capped.rows.length} ${noun.other}. Older ${noun.other} are not listed here.`}
      </p>
    );
  }
  return (
    <ShowMore
      id={`${prefix}-more`}
      pathname={pathname}
      searchParams={searchParams}
      next={capped.next === null ? null : { show: capped.next }}
      landOn={billingRowId(prefix, shown)}
      shown={capped.rows.length}
      noun={noun}
    />
  );
}
