import type { DocumentLifecycle } from '../foundation/state';

/** What `documentLifecycleLabel` reads: the document's lifecycle, plus when it was replaced if known. */
export type DocumentLifecycleLabelInput = Pick<
  DocumentLifecycle,
  'state' | 'replaced' | 'deletedAt'
> & {
  /** When a newer document replaced this one (the newer document's link time), when known. */
  readonly replacedAt?: Date | null;
};

function shortDate(at: Date, now: Date, timeZone: string): string {
  const year = (date: Date) =>
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric' }).format(date);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    ...(year(at) === year(now) ? {} : { year: 'numeric' }),
  }).format(at);
}

/**
 * The plain label a case shows next to a document it used, when that document is no longer the
 * everyday current one (PROGRAMME 5.3; lane Z wires it into the case and agency views):
 * "Replaced on 3 Nov", "Archived", or "Removed by the traveller on 3 Nov". A removed document is
 * never named here, so the label carries no title. Null for a current document. The year is
 * added only when it is not the year of `now`.
 */
export function documentLifecycleLabel(
  lifecycle: DocumentLifecycleLabelInput,
  now: Date,
  options: { readonly timeZone?: string } = {},
): string | null {
  const timeZone = options.timeZone ?? 'UTC';
  if (lifecycle.state === 'RECENTLY_DELETED' || lifecycle.state === 'REMOVING') {
    return lifecycle.deletedAt
      ? `Removed by the traveller on ${shortDate(lifecycle.deletedAt, now, timeZone)}`
      : 'Removed by the traveller';
  }
  if (lifecycle.replaced) {
    return lifecycle.replacedAt
      ? `Replaced on ${shortDate(lifecycle.replacedAt, now, timeZone)}`
      : 'Replaced';
  }
  if (lifecycle.state === 'ARCHIVED') return 'Archived';
  return null;
}
