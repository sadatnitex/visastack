import { CATALOGUE_DOCUMENTS } from './documents';
import { isRepeatingFieldKey } from './queries';

/**
 * The detail that holds the day a document was issued, for a detail that document type carries.
 * Only single (non-repeating) records count: a detail that can change over time and be settled
 * against the profile ("Both Are Right, It Changed") is always a single one. Read from what each
 * document type is known to carry, so a type with no issue-date detail never invents one, and a
 * new type with one is covered by adding it to the catalogue, with no other change.
 */
const ISSUE_DATE_KEY_PATTERN = /_issue_date$/;

const ISSUE_DATE_KEYS_BY_FIELD: ReadonlyMap<string, readonly string[]> = (() => {
  const byField = new Map<string, Set<string>>();
  for (const document of CATALOGUE_DOCUMENTS) {
    const issueKeys = document.supports.filter(
      (key) =>
        ISSUE_DATE_KEY_PATTERN.test(key) &&
        !key.startsWith('historical_') &&
        !isRepeatingFieldKey(key),
    );
    if (issueKeys.length === 0) continue;
    for (const field of document.supports) {
      const set = byField.get(field) ?? new Set<string>();
      for (const key of issueKeys) set.add(key);
      byField.set(field, set);
    }
  }
  return new Map([...byField].map(([field, keys]) => [field, [...keys]] as const));
})();

/**
 * The issue-date details a document type that carries this detail also carries (for a passport
 * detail: the passport issue date). Empty when no known document type that carries the detail has
 * an issue date, so nothing is offered and nothing is guessed.
 */
export function issueDateKeysFor(fieldKey: string): readonly string[] {
  return ISSUE_DATE_KEYS_BY_FIELD.get(fieldKey) ?? [];
}

/** What the reading of a document's own issue date comes to. Never a guess. */
export type IssueDateReading =
  /** Exactly one readable day, not in the future: the day its values took effect. */
  | { readonly status: 'found'; readonly date: string }
  /** The document has no issue date reading, or none was found for this detail. */
  | { readonly status: 'none' }
  /** A reading exists but is not a calendar day written year-month-day. */
  | { readonly status: 'unreadable' }
  /** Two or more different issue dates were read from the same document. */
  | { readonly status: 'conflict' }
  /** The one issue date read is after today. */
  | { readonly status: 'future' };

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day written year-month-day (no 31 February), or null. */
export function realIsoDay(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!ISO_DAY.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

/**
 * Decides which issue date, if any, a document supports from every value read for its issue-date
 * details. Several readings of the same day count as one (a second reading of the same file);
 * different days are a conflict and none is chosen. A day after today (UTC, as the save rule
 * counts it) is refused.
 */
export function resolveIssueDate(
  values: readonly (string | null)[],
  now: Date = new Date(),
): IssueDateReading {
  const present = values.map((value) => (value ?? '').trim()).filter((value) => value.length > 0);
  if (present.length === 0) return { status: 'none' };
  const days = new Set<string>();
  let unreadable = false;
  for (const value of present) {
    const day = realIsoDay(value);
    if (day) days.add(day);
    else unreadable = true;
  }
  if (days.size === 0) return { status: 'unreadable' };
  // A reading that could not be read might be a different day, so it is never set aside quietly.
  if (days.size > 1 || unreadable) return { status: 'conflict' };
  const [day] = [...days] as [string];
  return day > now.toISOString().slice(0, 10)
    ? { status: 'future' }
    : { status: 'found', date: day };
}
