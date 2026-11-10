/**
 * The rules that decide where a document's expiry date came from, with no database access, so one
 * copy serves the writer, the passport reading, the copy to another person and the lists.
 *
 * A document's in-force date is `documents.expires_at`. It is a TYPED MIRROR only when the newest
 * entry is a typed one that was saved as the in-force date (its `mirrored` flag) and its day equals
 * the in-force day. A typed date that merely agrees with a read date is not a mirror, so clearing it
 * can never remove the read date. Anything else that is set is a READ
 * date: it came from the passport's machine-readable lines, or was set before typed dates existed.
 * A typed date is never mirrored over a read date, and clearing a typed date never removes a read
 * date. When a typed date and the in-force read date disagree, both are kept and the person is told.
 */

export type ExpirySource = 'TYPED' | 'READ';
export type ExpiryOrigin = 'NONE' | 'READ' | 'TYPED';

/** One row of the entries table, newest first when in a list. */
export interface ExpiryEntry {
  readonly source: ExpirySource;
  /** `YYYY-MM-DD`; null on a typed row means the person cleared their date. */
  readonly expiresOn: string | null;
  /** True only on a typed entry whose date was also saved as the document's date. */
  readonly mirrored: boolean;
}

/** A stored row as the rules read it. */
export function toExpiryEntry(row: {
  readonly source: string;
  readonly expiresOn: string | null;
  readonly mirrored: boolean;
}): ExpiryEntry {
  return {
    source: row.source === 'READ' ? 'READ' : 'TYPED',
    expiresOn: row.expiresOn,
    mirrored: row.mirrored,
  };
}

export interface ExpiryState {
  /** Where the in-force date came from. */
  readonly origin: ExpiryOrigin;
  /** The day the person typed and has not cleared, or null. */
  readonly typedOn: string | null;
  /** A typed day differs from an in-force read date: show both and ask the person to check. */
  readonly mismatch: boolean;
}

/** The calendar day of a stored date (documents keep midnight UTC). */
export function expiryDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The newest typed row's day (null when none, or when the person cleared it). */
export function latestTypedDay(newestFirst: readonly ExpiryEntry[]): string | null {
  const typed = newestFirst.find((entry) => entry.source === 'TYPED');
  return typed ? typed.expiresOn : null;
}

/** True only when the newest entry is a typed, mirrored one and its day is the in-force day. */
export function isTypedMirror(
  expiresAt: Date | null,
  newestFirst: readonly ExpiryEntry[],
): boolean {
  const newest = newestFirst[0];
  return (
    expiresAt !== null &&
    newest !== undefined &&
    newest.source === 'TYPED' &&
    newest.mirrored &&
    newest.expiresOn !== null &&
    newest.expiresOn === expiryDay(expiresAt)
  );
}

export function describeExpiry(
  expiresAt: Date | null,
  newestFirst: readonly ExpiryEntry[],
): ExpiryState {
  const typedOn = latestTypedDay(newestFirst);
  if (expiresAt === null) return { origin: 'NONE', typedOn, mismatch: false };
  if (isTypedMirror(expiresAt, newestFirst)) return { origin: 'TYPED', typedOn, mismatch: false };
  return {
    origin: 'READ',
    typedOn,
    mismatch: typedOn !== null && typedOn !== expiryDay(expiresAt),
  };
}

/** Typed dates cannot be absurd: a real day from 1950 to fifty years after `now`. */
export const EXPIRY_EARLIEST_YEAR = 1950;
export const EXPIRY_LATEST_YEARS_AHEAD = 50;

export function expiryDayInRange(day: string, now: Date): boolean {
  const year = Number(day.slice(0, 4));
  return year >= EXPIRY_EARLIEST_YEAR && year <= now.getUTCFullYear() + EXPIRY_LATEST_YEARS_AHEAD;
}

/**
 * A day on or before today (UTC). The readiness, wallet and package rules treat a document as
 * expired from the start of its date, so a date of today already makes the document expired there
 * even though the reminders still count it as "0 days left": the person is asked before saving it.
 */
export function expiryDayCountsAsExpired(day: string, now: Date): boolean {
  return day <= expiryDay(now);
}
