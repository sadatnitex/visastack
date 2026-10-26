import {
  type CalendarDates,
  accountPrincipal,
  listCalendarDates,
  requireAccess,
} from '@visastack/services';
import { withSession } from '../../../../../lib/session';

/**
 * The traveller's dated items for the calendar page and its download, through the central access
 * gate as the owner (`purpose: 'self'`). Anyone else, including someone the traveller shared with,
 * gets `denied`, which both callers answer with "not found", as sibling owner-only pages do.
 */
export async function loadCalendarDates(
  applicantId: string,
): Promise<
  | { readonly state: 'ready'; readonly dates: CalendarDates }
  | { readonly state: 'denied' }
  | { readonly state: 'failed' }
> {
  return withSession(async ({ db, accountId }) => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'self' },
    );
    if (!access.ok || access.value.actor.kind !== 'applicant_owner') {
      return { state: 'denied' as const };
    }
    const listed = await listCalendarDates(access.value);
    return listed.ok
      ? { state: 'ready' as const, dates: listed.value }
      : { state: 'failed' as const };
  });
}

/** At most this many keys are read from one request; more than any page can list. */
const MAX_KEYS = 500;
/** Longer than any real key (`document_expiry:` plus a uuid). */
const MAX_KEY_LENGTH = 80;

export interface CalendarSelection {
  readonly keys: readonly string[];
  readonly caseNames: boolean;
}

/**
 * The person's choices from the query string: the item keys and whether to add case names.
 * Only keys are read, never a title or a date; the caller matches them against its own items.
 */
export function readCalendarSelection(
  query: URLSearchParams | Readonly<Record<string, string | string[] | undefined>>,
): CalendarSelection {
  const all = (name: string): string[] => {
    if (query instanceof URLSearchParams) return query.getAll(name);
    const value = query[name];
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
  };
  const keys = [
    ...new Set(
      all('key')
        .slice(0, MAX_KEYS)
        .filter((key) => key.length > 0 && key.length <= MAX_KEY_LENGTH),
    ),
  ];
  return { keys, caseNames: all('names').includes('1') };
}
