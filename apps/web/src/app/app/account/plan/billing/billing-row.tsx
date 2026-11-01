/** @jsxImportSource react */
'use client';

import { type ReactNode, useState } from 'react';

/**
 * One compact billing row that opens to its full details (Scroll Budget WP-SB9): the reference,
 * its status and one short line (amount, date) stay visible, and the invoice, receipts and any
 * way to pay or refund sit inside. Built on details and summary, so it opens from the keyboard,
 * works without script, and the browser opens it by itself when find-in-page or a link points
 * inside it. Used by the traveller's Billing History, the agency's Invoices page, the Plans page
 * and the platform owner's organization page, so these lists read the same way.
 *
 * It starts open or closed and then stays as the person left it (as `StickyDetails` does): a
 * server refresh after a save or a payment check never closes it over the result they need.
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
  /** The reference people quote (an invoice reference, a plan name). */
  readonly title: string;
  /** Status badges, shown on the closed row too, so the state is never hidden. */
  readonly badges?: ReactNode;
  /** One short line under the title, for example the amount and a date. */
  readonly line?: string;
  /** Whether it starts open. */
  readonly open?: boolean;
  readonly children: ReactNode;
}) {
  const [isOpen, setOpen] = useState(open);
  return (
    <details
      className="billing-row"
      id={id}
      open={isOpen}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
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
