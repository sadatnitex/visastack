import {
  type AuthorizedApplicant,
  type CalendarDates,
  type CalendarFeedStatus,
  accountPrincipal,
  getCalendarFeedStatus,
  isMissingRelationError,
  listCalendarDates,
  recordCalendarExport,
  requireAccess,
} from '@visastack/services';
import { reportServerError } from '../../../../../lib/server-error';
import { withSession } from '../../../../../lib/session';

/** The calendar link's state for the page; `unknown` when it could not be read (logged). */
export type CalendarFeedPageStatus = CalendarFeedStatus | { readonly state: 'unknown' };

/**
 * The link's state with the proof the page already holds. "Not available yet" only before the
 * table exists; any other failure is logged and shown as "could not check", which still offers
 * Stop Sharing (stopping works without knowing the state).
 */
async function feedStatusFor(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<CalendarFeedPageStatus> {
  try {
    const status = await getCalendarFeedStatus(access);
    if (status.ok) return status.value;
    reportServerError('calendarFeedStatus', new Error(status.error.message));
    return { state: 'unknown' };
  } catch (error) {
    if (isMissingRelationError(error)) return { state: 'unavailable' };
    reportServerError('calendarFeedStatus', error);
    return { state: 'unknown' };
  }
}

/**
 * The traveller's dated items for the calendar page, and the state of their calendar link, through
 * the central access gate as the owner (`purpose: 'self'`), one proof for both. Anyone else,
 * including someone the traveller shared with, gets `denied`, which the page and the download
 * answer with "not found", as sibling owner-only pages do. `timeZone` is the traveller's, for
 * showing moments.
 */
export async function loadCalendarDates(applicantId: string): Promise<
  | {
      readonly state: 'ready';
      readonly dates: CalendarDates;
      readonly feed: CalendarFeedPageStatus;
      readonly timeZone: string;
    }
  | { readonly state: 'denied' }
  | {
      readonly state: 'failed';
      readonly feed: CalendarFeedPageStatus;
      readonly timeZone: string;
    }
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
    const timeZone = access.value.applicant.timezone || 'UTC';
    const [listed, feed] = await Promise.all([
      listCalendarDates(access.value),
      feedStatusFor(access.value),
    ]);
    return listed.ok
      ? { state: 'ready' as const, dates: listed.value, feed, timeZone }
      : { state: 'failed' as const, feed, timeZone };
  });
}

/**
 * The download's one gated read and its audit entry, in the same session: the gate as the owner,
 * the person's dated items, the caller's choice of events from them and the file built from them
 * (a throw there is `failed`, with no entry), and then one audit entry
 * (`recordCalendarExport`: count and kinds only) before any file is returned. When the entry cannot
 * be written the download fails, so no file leaves without its record.
 */
export async function exportCalendarDates<
  T extends { readonly eventCount: number; readonly kinds: readonly string[] },
>(
  applicantId: string,
  choose: (dates: CalendarDates) => T,
): Promise<
  | { readonly state: 'ready'; readonly chosen: T }
  | { readonly state: 'empty' }
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
    if (!listed.ok) return { state: 'failed' as const };
    // The caller builds the file here, before the entry: a file that cannot be built is never
    // recorded as sent.
    let chosen: T;
    try {
      chosen = choose(listed.value);
    } catch {
      return { state: 'failed' as const };
    }
    if (chosen.eventCount === 0) return { state: 'empty' as const };
    const recorded = await recordCalendarExport(access.value, {
      eventCount: chosen.eventCount,
      kinds: chosen.kinds,
      source: 'dates',
    });
    return recorded.ok ? { state: 'ready' as const, chosen } : { state: 'failed' as const };
  });
}

/** At most this many keys are read from one request; more than any page can list. */
const MAX_KEYS = 500;
/** Longer than any real key (`document_expires:` plus a uuid). */
const MAX_KEY_LENGTH = 80;

/** The form field that carries each chosen item's key. */
export const CALENDAR_KEY_FIELD = 'key';

/**
 * The chosen item keys from form data, URL parameters or a Next.js query record. Only keys are
 * read, never a title or a date; the caller matches them against its own items. Choices about
 * titles and reminders are read separately, by `parseCalendarExportOptions`.
 */
export function readCalendarKeys(
  input:
    | { readonly getAll: (name: string) => readonly unknown[] }
    | Readonly<Record<string, string | readonly string[] | undefined>>,
): readonly string[] {
  const raw: readonly unknown[] =
    'getAll' in input && typeof input.getAll === 'function'
      ? input.getAll(CALENDAR_KEY_FIELD)
      : ((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]))(
          (input as Readonly<Record<string, unknown>>)[CALENDAR_KEY_FIELD],
        );
  return [
    ...new Set(
      raw
        .slice(0, MAX_KEYS)
        .filter(
          (key): key is string =>
            typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH,
        ),
    ),
  ];
}
