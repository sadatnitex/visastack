import type { DeadlineUrgency } from '@visastack/services';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CHECK_THIS_DATE } from '../lib/deadline-words';
import { EmptyState } from './ui';

/**
 * The deadline clock: the next few dates that matter, soonest first, each said in plain words
 * ("Expires in 12 days"), with the exact date beside it and a flat tone by how soon it is. The tone
 * is always a word as well as a colour, so nothing depends on seeing colour. A date the system is
 * unsure of carries "Check This Date" and a plain reason, and is worded as "if the date is right",
 * never as certain.
 *
 * A date is a date on file, never an approval or a promise. The lines arrive already worded (the
 * day counts are worked out in the person's time zone by the service, the names by the server), so
 * this component draws, and decides nothing. No script runs for it, and it is flat: shared tokens,
 * no shadow, gradient or animation.
 */

/** The line a person sees when there is nothing dated yet: what appears here, and why it helps. */
export const CLOCK_EMPTY_TITLE = 'No Dates Yet';
export const CLOCK_EMPTY_BODY =
  'Add a passport and its expiry date appears here, so you hear about it before it matters.';
/** When the dates could not be read just now, which is not the same as having none. */
export const CLOCK_UNAVAILABLE_LINE = 'Dates are unavailable right now. Refresh to try again.';

export interface DeadlineLine {
  readonly key: string;
  /** What the date is for: "Passport", a task's own words, what a request asks for. */
  readonly label: string;
  /** "Expires in 12 days", "Due tomorrow", "Expired 3 days ago". */
  readonly phrase: string;
  /** The exact day, written out ("7 Nov 2026"). */
  readonly dateText: string;
  /** The same day as `YYYY-MM-DD`, for the time element. */
  readonly isoDate: string;
  /** Whose date it is, when the list covers more than one person; otherwise null. */
  readonly person: string | null;
  readonly urgency: DeadlineUrgency;
  /** The word for the tone: "Overdue", "Within a Week", "Within a Month", "Later". */
  readonly toneWord: string;
  readonly href: string;
  /** Why the date is unsure, in one plain sentence; null when it is not. */
  readonly check: string | null;
}

export interface DeadlineClockProps {
  /** The dates, soonest first; null when they could not be read. */
  readonly lines: readonly DeadlineLine[] | null;
  readonly heading: string;
  /** Unique on the page, for `aria-labelledby`. */
  readonly headingId: string;
  /** The small line above the heading. */
  readonly kicker?: string;
  /** `h2` on a page of its own sections, `h3` inside a rail. */
  readonly headingLevel?: 'h2' | 'h3';
  /** The way to add the first document, shown with the teaching line when there are no dates. */
  readonly addAction: { readonly href: string; readonly label: string };
  /** A link to the full list, under the dates. */
  readonly more?: { readonly href: string; readonly label: string };
  /** A short plain note under the dates (for example, that some people's dates could not be read). */
  readonly note?: string;
}

export function DeadlineClock({
  lines,
  heading,
  headingId,
  kicker = 'Dates That Matter',
  headingLevel = 'h2',
  addAction,
  more,
  note,
}: DeadlineClockProps): ReactNode {
  const Heading = headingLevel;
  return (
    <section className="card deadline-clock" aria-labelledby={headingId}>
      <p className="card-kicker">{kicker}</p>
      <Heading className="card-title" id={headingId}>
        {heading}
      </Heading>
      {lines === null ? (
        <p className="deadline-clock-note">{CLOCK_UNAVAILABLE_LINE}</p>
      ) : lines.length === 0 ? (
        <EmptyState icon="calendar" title={CLOCK_EMPTY_TITLE} action={addAction}>
          {CLOCK_EMPTY_BODY}
        </EmptyState>
      ) : (
        <ol className="deadline-list">
          {lines.map((line) => (
            <li
              key={line.key}
              className={`deadline-line deadline-tone-${line.urgency}${line.check ? ' deadline-line-check' : ''}`}
            >
              <Link className="deadline-link" href={line.href}>
                <span className="deadline-main">
                  <span className="deadline-name">{line.label}</span>
                  <span className="deadline-phrase">{line.phrase}</span>
                  <span className="deadline-date">
                    <time dateTime={line.isoDate}>{line.dateText}</time>
                    {line.person ? ` · ${line.person}` : ''}
                  </span>
                  {line.check ? <span className="deadline-why">{line.check}</span> : null}
                </span>
                <span className="deadline-tags">
                  <span className="deadline-tag deadline-tag-tone">{line.toneWord}</span>
                  {line.check ? (
                    <span className="deadline-tag deadline-tag-check">{CHECK_THIS_DATE}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {note ? <p className="deadline-clock-note">{note}</p> : null}
      {more && lines !== null && lines.length > 0 ? (
        <p className="deadline-more">
          <Link className="deadline-more-link" href={more.href}>
            {more.label}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
