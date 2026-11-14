import { resolveDocumentType } from './document-lookup';
import { CATALOGUE_DOCUMENTS } from './documents';
import { isRepeatingFieldKey } from './queries';
import type { CatalogueDocument } from './types';

/**
 * The detail that holds the day a document was issued. Only single (non-repeating) records count:
 * a detail that can change over time and be settled against the profile ("Both Are Right, It
 * Changed") is always a single one. An earlier passport's own issue date is not this document's.
 */
const ISSUE_DATE_KEY_PATTERN = /_issue_date$/;

function singleIssueKey(key: string): boolean {
  return (
    ISSUE_DATE_KEY_PATTERN.test(key) && !key.startsWith('historical_') && !isRepeatingFieldKey(key)
  );
}

const ISSUE_DATE_KEYS: ReadonlySet<string> = new Set(
  CATALOGUE_DOCUMENTS.flatMap((document) => document.supports.filter(singleIssueKey)),
);

/** True for a detail that holds the day a document was issued (a passport's issue date). */
export function isIssueDateKey(fieldKey: string): boolean {
  return ISSUE_DATE_KEYS.has(fieldKey);
}

function issueKeysOf(document: CatalogueDocument): readonly string[] {
  return document.supports.filter(singleIssueKey);
}

/**
 * The issue-date details that belong to THIS document type and sit beside this detail on it (for a
 * passport's number: the passport issue date). Empty when the type is not known, does not carry
 * the detail, or has no issue-date detail (a national ID card), so nothing is offered, nothing is
 * implied and nothing is guessed. Read from the catalogue: a type that gains an issue-date detail
 * is covered by adding it there.
 */
export function issueDateKeysFor(
  documentType: string | null | undefined,
  fieldKey: string,
): readonly string[] {
  const document = documentType ? resolveDocumentType(documentType) : undefined;
  if (!document || !document.supports.includes(fieldKey)) return [];
  return issueKeysOf(document);
}

/** What the reading of a document's own issue date comes to. Never a guess. */
export type IssueDateReading =
  /** Exactly one readable day, not in the future: the day its values took effect. */
  | { readonly status: 'found'; readonly date: string }
  /** No issue date was read from this document, or the one read was skipped. */
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
