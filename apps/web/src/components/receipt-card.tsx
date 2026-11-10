'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useRef } from 'react';
import { Icon } from './icons';
import { ReferenceCode } from './reference-code';

/**
 * The receipt after an action that matters, in the way a bKash or bank transaction receipt reads
 * (owner direction, 10 Nov 2026, batch F2): a large tick in the green tone, what happened in
 * plain words, when, to whom, a reference code where one already exists, and two buttons, the
 * natural next step and Done.
 *
 * It states only what the action already returned. It never says a thing was reviewed, accepted
 * or approved: where a person still has to look at it, `honestLine` says so ("Received, not yet
 * reviewed"). Focus moves to the heading when the receipt appears, so a screen reader hears it at
 * once; Done hands focus back to where the person started (`returnFocusTo`).
 *
 * Focus is not taken from a field the person is typing in, or from elsewhere on the page. Colour comes only from the green tone of `[data-tone]` (WP-PLAIN-TONE).
 */

export interface ReceiptNext {
  readonly label: string;
  readonly href: string;
}

/** The date and time as the person reads them, with the zone named, for example `10 Nov 2026, 2:05 pm GMT+6`. */
export function receiptTime(value: Date | string | number, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const zone = timeZone ? { timeZone } : {};
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
      ...zone,
    }).format(date);
  } catch {
    // An unknown zone name: say the time in the device's own zone rather than nothing.
    return receiptTime(date);
  }
}

export function ReceiptCard({
  title,
  what,
  at,
  to,
  toLabel = 'To',
  reference,
  honestLine,
  next,
  onDone,
  returnFocusTo,
  timeZone,
  onlyIfIdle = false,
}: {
  /** What happened, as a short Title Case heading, for example `Document Saved`. */
  readonly title: string;
  /** What happened, in a plain sentence. */
  readonly what: string;
  /** When it happened. */
  readonly at: Date | string | number;
  /** Who it went to (sharing and answers). Left out when it went to nobody. */
  readonly to?: string | undefined;
  readonly toLabel?: string;
  /** A reference code that already exists for the record; never made up for the receipt. */
  readonly reference?: { readonly code: string; readonly label?: string } | undefined;
  /** The honest line where someone still has to look, for example `Received, not yet reviewed.` */
  readonly honestLine?: string | undefined;
  /** The natural next step. */
  readonly next: ReceiptNext;
  /** Done: close the receipt. */
  readonly onDone: () => void;
  /** Where focus goes when Done is pressed. */
  readonly returnFocusTo?: () => HTMLElement | null;
  /** The person's time zone name when it is known; the device's own zone otherwise. */
  readonly timeZone?: string | undefined;
  /**
   * For a receipt that appears when background work finishes (an upload), not because the person
   * just pressed something: focus moves to the heading only when it is on nothing in particular,
   * so the person's place in the page, and the buttons for adding more, are never taken from them.
   */
  readonly onlyIfIdle?: boolean;
}) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const card = useRef<HTMLElement>(null);

  useEffect(() => {
    // Moves focus to the heading so a screen reader hears the receipt at once, unless the person
    // is typing somewhere else (a receipt that appears when a background upload finishes must not
    // take the keys from the field they are in): the heading is then announced by the page's own
    // status line instead.
    const active = document.activeElement;
    const typing =
      active instanceof HTMLElement &&
      (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
    // Nor from somewhere else on the page: focus moves only from nowhere in particular or from
    // the place the person started (the form, or the list, this receipt sits in).
    const scope = card.current?.closest('form') ?? card.current?.parentElement ?? null;
    const elsewhere =
      active instanceof HTMLElement &&
      active !== document.body &&
      !(scope?.contains(active) ?? false);
    const onSomething = active instanceof HTMLElement && active !== document.body;
    if (typing || elsewhere || (onlyIfIdle && onSomething)) return;
    heading.current?.focus();
  }, [onlyIfIdle]);

  const when = useMemo(() => receiptTime(at, timeZone), [at, timeZone]);

  return (
    <section className="receipt-card" data-tone="green" aria-labelledby={headingId} ref={card}>
      <span className="receipt-mark" aria-hidden="true">
        <Icon name="check" size={32} />
      </span>
      <h3 className="receipt-title" id={headingId} ref={heading} tabIndex={-1}>
        {title}
      </h3>
      <p className="receipt-what">{what}</p>
      <dl className="receipt-facts">
        {when ? (
          <div>
            <dt>When</dt>
            <dd>
              <time dateTime={new Date(at).toISOString()}>{when}</time>
            </dd>
          </div>
        ) : null}
        {to ? (
          <div>
            <dt>{toLabel}</dt>
            <dd translate="no">{to}</dd>
          </div>
        ) : null}
      </dl>
      {reference ? (
        <p className="receipt-reference">
          <ReferenceCode code={reference.code} label={reference.label ?? 'Reference'} />
        </p>
      ) : null}
      {honestLine ? <p className="receipt-honest">{honestLine}</p> : null}
      <div className="receipt-actions">
        <Link className="btn btn-primary" href={next.href}>
          {next.label}
        </Link>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            onDone();
            // After the receipt is gone, so the element it hands focus to is on the page.
            requestAnimationFrame(() => returnFocusTo?.()?.focus());
          }}
        >
          Done
        </button>
      </div>
    </section>
  );
}
