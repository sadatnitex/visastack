import { isKnownTimeZone } from '@visastack/core/calendar';
import { formatTimestamp, formatTimestampDate } from './format-date';

/**
 * How much time an AI connection has left (WAL5, the clock ring on each connection tile).
 * Presentation only: it reads the end the services already stored and decides nothing about
 * access. Turning off and ending still happen in the services exactly as before.
 *
 * - `open`: no end; the connection works until the person turns it off.
 * - `running`: an end in the future, more than the ending-soon window away.
 * - `ending_soon`: the end is close (see `aiEndingSoonWindowMs`).
 * - `ended`: the end has passed, or the services say the connection is no longer live.
 *
 * The end is an exact moment, so the time left is the same wherever the person is: whole days
 * (never rounded up, so it never says more time than is left), then whole hours in the last day.
 * The end DATE is what depends on the zone, and it is written in the person's own zone
 * (`formatMomentIn`), UTC only when the zone is unknown.
 */
export type AiTimeLeftState = 'open' | 'running' | 'ending_soon' | 'ended';

export interface AiTimeLeft {
  readonly state: AiTimeLeftState;
  /** Share of the connection's length still left, 0 to 1 (1 for an open connection). */
  readonly fraction: number;
  /** Milliseconds left (0 once ended; null for an open connection). */
  readonly msLeft: number | null;
  /** Whole days left, never rounded up (null for an open one). */
  readonly daysLeft: number | null;
  /** Whole hours left, for an end less than a day away (null otherwise). */
  readonly hoursLeft: number | null;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The ending-soon window never exceeds this, however long the connection is. */
export const AI_ENDING_SOON_MAX_MS = 7 * DAY_MS;
/** ...and is a quarter of the connection's length for shorter ones. */
export const AI_ENDING_SOON_SHARE = 0.25;

/**
 * How close the end must be to count as ending soon: a quarter of the connection's length, at
 * most seven days (1 hour: the last 15 minutes; 24 hours: the last 6; 7 days: the last 42 hours;
 * 30 days: the last 7 days). A fixed window would mark every short connection as ending soon.
 */
export function aiEndingSoonWindowMs(lengthMs: number): number {
  return Math.min(AI_ENDING_SOON_MAX_MS, Math.max(0, lengthMs) * AI_ENDING_SOON_SHARE);
}

const knownZones = new Map<string, boolean>();

/** The zone to show times in: the person's own when the runtime knows it, else UTC. */
export function displayTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC';
  let known = knownZones.get(timeZone);
  if (known === undefined) {
    known = isKnownTimeZone(timeZone);
    knownZones.set(timeZone, known);
  }
  return known ? timeZone : 'UTC';
}

export function aiConnectionTimeLeft({
  start,
  end,
  now,
  live = true,
}: {
  /** When the connection was made. */
  readonly start: Date;
  /** When it ends, or null when it works until turned off. */
  readonly end: Date | null;
  readonly now: Date;
  /** False when the services say the connection is no longer live, whatever its end says. */
  readonly live?: boolean;
}): AiTimeLeft {
  if (!live || (end !== null && end.getTime() <= now.getTime())) {
    return { state: 'ended', fraction: 0, msLeft: 0, daysLeft: 0, hoursLeft: 0 };
  }
  if (end === null) {
    return { state: 'open', fraction: 1, msLeft: null, daysLeft: null, hoursLeft: null };
  }
  const msLeft = end.getTime() - now.getTime();
  const length = end.getTime() - start.getTime();
  const fraction = length > 0 ? Math.min(1, Math.max(0, msLeft / length)) : 0;
  const daysLeft = Math.floor(msLeft / DAY_MS);
  const hoursLeft = msLeft < DAY_MS ? Math.floor(msLeft / HOUR_MS) : null;
  const state = msLeft <= aiEndingSoonWindowMs(length) ? 'ending_soon' : 'running';
  return { state, fraction, msLeft, daysLeft, hoursLeft };
}

/**
 * A moment with its time ("5 Nov 2026, 16:00") in the person's zone. Without a zone it keeps the
 * shared formatter's behaviour (the agency pages, whose staff have no stored zone).
 */
export function formatMomentIn(value: Date, timeZone: string | null | undefined): string {
  if (timeZone === undefined) return formatTimestamp(value);
  return value.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: displayTimeZone(timeZone),
  });
}

/** A day ("6 Oct 2026") in the person's zone; without a zone, the shared formatter (UTC day). */
export function formatDayIn(value: Date, timeZone: string | null | undefined): string {
  if (timeZone === undefined) return formatTimestampDate(value);
  return value.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: displayTimeZone(timeZone),
  });
}
