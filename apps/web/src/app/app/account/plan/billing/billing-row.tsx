import type { ReactNode } from 'react';

/**
 * One compact billing row that opens to its full details (Scroll Budget WP-SB9): the reference,
 * its status and one short line (amount, date) stay visible, and the invoice, receipts and any
 * way to pay or refund sit inside. Built on details and summary, so it opens from the keyboard,
 * works without script, and the browser opens it by itself when find-in-page or a link points
 * inside it. Used by the traveller's Billing History, the agency's Invoices page and the platform
 * owner's organization page, so all three lists read the same way.
 *
 * Nothing about money is decided here: the caller passes what to show, and the row only folds it.
 */
export function BillingRow({
  id,
  title,
  badges,
  line,
  open = false,
  children,
}: {
  /** Unique on the page; Show More lands on it, so keyboard focus picks up at the new rows. */
  readonly id: string;
  /** The reference people quote (an invoice reference). */
  readonly title: string;
  /** Status badges, shown on the closed row too, so the state is never hidden. */
  readonly badges?: ReactNode;
  /** One short line under the title, for example the amount and a date. */
  readonly line?: string;
  readonly open?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <details className="billing-row" id={id} open={open || undefined}>
      <summary className="billing-row-summary">
        <span className="billing-row-main">
          <span className="billing-row-title">{title}</span>
          {line ? <span className="billing-row-line">{line}</span> : null}
        </span>
        {badges ? <span className="billing-row-badges">{badges}</span> : null}
      </summary>
      <div className="billing-row-body">{children}</div>
    </details>
  );
}

/** Rows a billing list shows per step (the traveller list step, also used for agency billing). */
export const BILLING_ROWS_STEP = 10;
/**
 * The most rows a billing list grows to through Show More. One below a service read's largest page
 * once rounded to the step, so the page can read one extra row to know whether more exist.
 */
export const BILLING_ROWS_MAX = 90;

/** The id Show More lands on: the row at this position (0 based) on the page. */
export function billingRowId(prefix: string, index: number): string {
  return `${prefix}-row-${index}`;
}
