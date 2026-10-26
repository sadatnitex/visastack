import {
  type CalendarDates,
  accountPrincipal,
  listCalendarDates,
  recordCalendarExport,
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

/**
 * The download's one gated read and its audit entry, in the same session: the gate as the owner,
 * the person's dated items, the caller's choice of events from them, and then one audit entry
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
    const chosen = choose(listed.value);
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
