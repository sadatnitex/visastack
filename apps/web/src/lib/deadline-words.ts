import type { DeadlineDoubt, DeadlineKind, DeadlineUrgency } from '@visastack/services';

/**
 * The words for the deadline clock, in one place so the card, the pages and the tests all say it
 * the same way. Pure and safe to import from browser and server code alike. A date is a date on
 * file: nothing here says approved, cleared, guaranteed or ensured, and nothing promises what
 * happens when the day comes.
 *
 * The day count itself is worked out by the service in the person's time zone; these functions
 * only turn that whole number into a phrase, so there is no clock and no time zone in this file.
 */

/** Up to this many days the phrase counts days; beyond it, months and years ("about"). */
const DAYS_PHRASE_LIMIT = 60;
/** Months are shown up to this many, then years. */
const MONTHS_PHRASE_LIMIT = 24;
const DAYS_PER_MONTH = 30.4375;
const DAYS_PER_YEAR = 365.25;

/**
 * "today", "tomorrow", "yesterday", "in 12 days", "3 days ago". Past about two months the count
 * is rounded and says so: "in about 8 months", "in about 3 years".
 */
export function relativeDeadlineWords(daysUntil: number): string {
  if (daysUntil === 0 || Object.is(daysUntil, -0)) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  if (daysUntil === -1) return 'yesterday';
  const days = Math.abs(daysUntil);
  const future = daysUntil > 0;
  if (days <= DAYS_PHRASE_LIMIT) return future ? `in ${days} days` : `${days} days ago`;
  const months = Math.round(days / DAYS_PER_MONTH);
  if (months < MONTHS_PHRASE_LIMIT) {
    return future ? `in about ${months} months` : `about ${months} months ago`;
  }
  const years = Math.max(2, Math.round(days / DAYS_PER_YEAR));
  return future ? `in about ${years} years` : `about ${years} years ago`;
}

/**
 * The whole line under a date's name: "Expires in 12 days", "Due tomorrow", "Expired 3 days ago",
 * "Was due yesterday", "Takes place today". Past tense only once the day has ended.
 */
export function deadlinePhrase(kind: DeadlineKind, daysUntil: number): string {
  const past = daysUntil < 0;
  const words = relativeDeadlineWords(daysUntil);
  switch (kind) {
    case 'document_expires':
      return `${past ? 'Expired' : 'Expires'} ${words}`;
    case 'task_due':
    case 'request_due':
      return `${past ? 'Was due' : 'Due'} ${words}`;
    case 'appointment':
      return `${past ? 'Took place' : 'Takes place'} ${words}`;
  }
}

/** The word that goes with each colour, so the tone is never carried by colour alone. */
export const DEADLINE_TONE_WORDS: Record<DeadlineUrgency, string> = {
  overdue: 'Overdue',
  soon: 'Within a Week',
  month: 'Within a Month',
  later: 'Later',
};

/** The tag on a date the system is unsure of. */
export const CHECK_THIS_DATE = 'Check This Date';

/** One plain sentence for why a date is unsure, shown beside the tag. No values, no blame. */
export const CHECK_THIS_DATE_WHY: Record<DeadlineDoubt, string> = {
  kind_not_accepted: 'Read from a document whose type you have not confirmed yet. Check the date.',
  date_before_issue: 'This date falls before the document was issued. Look at it again.',
  far_future: 'This date is very far away. Look at it again.',
  time_zone_unknown: 'We could not read the time zone, so the day count may be a day off.',
};
