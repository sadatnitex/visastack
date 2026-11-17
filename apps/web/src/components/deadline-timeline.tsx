import { evaluateTripChecks } from '@visastack/core';
import type { Locale } from '@visastack/i18n';
import { daysUntilDueDay } from '@visastack/services';
import type { ReactNode } from 'react';
import { relativeDeadlineWords } from '../lib/deadline-words';
import { formatDateOnly } from '../lib/format-date';
import { tileParts } from './deadline-clock';

/**
 * The deadline timeline: today, the next appointment, the passport end and the trip start on one
 * line that wraps on a phone, each a small picture with its date and a short word. A gap that
 * matters (the passport ending within six months of the trip) gets a plain marker with the
 * wording the trip date checks already use, never a verdict.
 *
 * Every date comes from data the page already loads. A day is past only once it has ended in the
 * traveller's time zone (the same helper the deadline clock uses). It is server markup only: no
 * script, no ids, flat tokens, and every state is a word as well as a picture. When no date
 * besides today is known, `buildTimeline` returns null and the page keeps the plain list.
 */

export type TimelineKind = 'today' | 'appointment' | 'trip' | 'passport';

export interface TimelineItem {
  readonly kind: TimelineKind;
  /** The short word under the picture: "Passport Ends". */
  readonly label: string;
  /** `YYYY-MM-DD`, for the time element. */
  readonly isoDate: string;
  /** The day written out ("7 Nov 2026"). */
  readonly dateText: string;
  /** Whole days from today in the traveller's time zone; negative once the day has ended. */
  readonly daysUntil: number;
  /** "in 20 days", "3 days ago"; empty for today itself. */
  readonly phrase: string;
}

export interface Timeline {
  readonly items: readonly TimelineItem[];
  /** The gap that matters, in the existing wording; null when there is none. */
  readonly warning: { readonly title: string } | null;
}

export interface TimelineInput {
  readonly now: Date;
  /** The traveller's time zone; UTC only when it is not known. */
  readonly timezone: string;
  /** The next appointment, already worked out by the deadline clock; null when none. */
  readonly appointment: { readonly date: string; readonly daysUntil: number } | null;
  readonly passportExpiry: Date | null;
  readonly travelStart: Date | null;
  readonly travelEnd: Date | null;
  readonly locale?: Locale | undefined;
}

const LABELS: Record<TimelineKind, string> = {
  today: 'Today',
  appointment: 'Next Appointment',
  trip: 'Trip Starts',
  passport: 'Passport Ends',
};
const TRIP_ENDS_LABEL = 'Trip Ends';
/** The order of dates that fall on the same day. */
const KIND_ORDER: readonly TimelineKind[] = ['today', 'appointment', 'trip', 'passport'];

/** `YYYY-MM-DD` of a stored date (stored at UTC midnight), or of today where the person is. */
function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function todayIso(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return isoOf(now);
  }
}

export function buildTimeline(input: TimelineInput): Timeline | null {
  const { now, timezone, appointment, passportExpiry, travelStart, travelEnd, locale } = input;
  const item = (
    kind: TimelineKind,
    isoDate: string,
    daysUntil: number,
    label: string = LABELS[kind],
  ): TimelineItem | null =>
    // A day that does not exist is not a date: draw nothing rather than a wrong one.
    tileParts(isoDate) === null
      ? null
      : {
          kind,
          label,
          isoDate,
          dateText: formatDateOnly(isoDate, locale),
          daysUntil,
          phrase: daysUntil === 0 ? '' : relativeDeadlineWords(daysUntil),
        };
  const days = (date: Date) => daysUntilDueDay(date, now, timezone);
  const tripDate = travelStart ?? travelEnd;

  const dated = [
    appointment ? item('appointment', appointment.date, appointment.daysUntil) : null,
    tripDate
      ? item('trip', isoOf(tripDate), days(tripDate), travelStart ? LABELS.trip : TRIP_ENDS_LABEL)
      : null,
    passportExpiry ? item('passport', isoOf(passportExpiry), days(passportExpiry)) : null,
  ].filter((entry): entry is TimelineItem => entry !== null);
  if (dated.length === 0) return null;

  const today = item('today', todayIso(now, timezone), 0);
  const items = [...dated, ...(today ? [today] : [])].sort(
    (a, b) => a.daysUntil - b.daysUntil || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );

  // The gap is the trip date checks' own finding, in their own words.
  let warning: Timeline['warning'] = null;
  if (passportExpiry && tripDate) {
    const found = evaluateTripChecks({
      now,
      travelStart,
      travelEnd,
      targetDeadline: null,
      passportExpiry,
      insurancePolicies: [],
    }).find(
      (check) =>
        check.key === 'passport_validity' && (check.level === 'check' || check.level === 'problem'),
    );
    if (found) warning = { title: found.title };
  }
  return { items, warning };
}

/** One decorative 28 px drawing frame; the word beside it carries the meaning. */
function Svg({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <svg
      width={28}
      height={28}
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** A small drawing for each kind of date. Decorative: the word beside it says the same. */
function Picture({ kind }: { readonly kind: TimelineKind | 'gap' }): ReactNode {
  switch (kind) {
    case 'today':
      return (
        <Svg>
          <circle cx="14" cy="14" r="9" />
          <circle cx="14" cy="14" r="3" fill="currentColor" />
        </Svg>
      );
    case 'appointment':
      return (
        <Svg>
          <rect x="4" y="6" width="20" height="18" rx="3" />
          <path d="M4 12h20M9 3v5M19 3v5" />
        </Svg>
      );
    case 'passport':
      return (
        <Svg>
          <rect x="6" y="3" width="16" height="22" rx="2.5" />
          <circle cx="14" cy="12" r="4" />
          <path d="M10 20h8" />
        </Svg>
      );
    case 'trip':
      return (
        <Svg>
          <path d="M3 16l22-9-8 18-3-8-11-1z" />
        </Svg>
      );
    case 'gap':
      return (
        <Svg>
          <path d="M14 4l11 19H3z" />
          <path d="M14 11v6M14 20.5v.5" />
        </Svg>
      );
  }
}

export interface DeadlineTimelineProps {
  /** From `buildTimeline`; null draws nothing, and the plain list below it stays. */
  readonly timeline: Timeline | null;
}

export function DeadlineTimeline({ timeline }: DeadlineTimelineProps): ReactNode {
  if (timeline === null) return null;
  // The gap sits right after the later of the two dates it is about.
  const anchor = Math.max(
    timeline.items.findIndex((entry) => entry.kind === 'passport'),
    timeline.items.findIndex((entry) => entry.kind === 'trip'),
  );
  return (
    <ol className="deadline-timeline" aria-label="Your Dates on One Line">
      {timeline.items.flatMap((entry, index) => {
        const marker = (
          <li
            key={entry.kind}
            className={`deadline-timeline-item deadline-timeline-${entry.kind}${entry.daysUntil < 0 ? ' deadline-timeline-past' : ''}`}
          >
            <span className="deadline-timeline-picture">
              <Picture kind={entry.kind} />
            </span>
            <span className="deadline-timeline-label">{entry.label}</span>
            <time className="deadline-timeline-date" dateTime={entry.isoDate}>
              {entry.dateText}
            </time>
            {entry.phrase ? <span className="deadline-timeline-phrase">{entry.phrase}</span> : null}
          </li>
        );
        return timeline.warning && index === anchor
          ? [
              marker,
              <li key="gap" className="deadline-timeline-item deadline-timeline-gap">
                <span className="deadline-timeline-picture">
                  <Picture kind="gap" />
                </span>
                <span className="deadline-timeline-label">Worth a Look</span>
                <span className="deadline-timeline-phrase">{timeline.warning.title}</span>
              </li>,
            ]
          : [marker];
      })}
    </ol>
  );
}
