import 'server-only';
import { DEFAULT_CALENDAR_EXPORT_OPTIONS } from '@visastack/core/calendar';
import {
  type Db,
  RATE_LIMITS,
  checkRateLimit,
  isCalendarFeedSecretShape,
  isRateLimitReached,
  listCalendarDates,
  requireCalendarFeedAccess,
  resolveCalendarFeedSecret,
} from '@visastack/services';
import { hashedSubject } from './client-address';
import { buildIcsCalendar, calendarFeedName, selectCalendarEvents } from './ics';
import { withPublicDb } from './public-db';

/**
 * The live calendar feed (v1.2 B05, ADR 0016): what a calendar app gets when it checks a person's
 * private subscription link. Calendar apps cannot sign in, so the link's secret says which account
 * made it, and that account's access is then asked of the central gate, as the owner, against
 * live state, every time. The feed holds exactly what the one-time file holds with its default
 * choices (general titles such as "Task Due", one general description line, no case name, no
 * place, no reminder, every kind of date, the same permanent UIDs and SEQUENCE), named with the
 * traveller's first name so two subscribed calendars can be told apart.
 *
 * An unknown, stopped or replaced link, a link whose account no longer owns the traveller or has
 * turned sharing off, and a database without the table yet all answer `not_found`, the same as a
 * made-up link. Unknown links
 * are counted against the caller's network address (as a short hash) and each real link is bounded
 * on its own, so trying links in bulk is slowed while a large calendar service fetching many
 * people's links from one address is not.
 */

export type CalendarFeedAnswer =
  | { readonly state: 'feed'; readonly ics: string }
  | { readonly state: 'not_found' }
  | { readonly state: 'busy' };

/** The served file name and the published path, so a link and the route never disagree. */
export const CALENDAR_FEED_PATH = '/api/calendar-feed';
export const CALENDAR_FEED_SUFFIX = '.ics';

/**
 * A link's address, for the page that shows it once. Only https: a `webcal:` address is opened as
 * plain http by some apps, which would send the secret unencrypted.
 */
export function calendarFeedUrl(baseUrl: string, secret: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${CALENDAR_FEED_PATH}/${secret}${CALENDAR_FEED_SUFFIX}`;
}

/** The secret from the last part of the address, with or without the `.ics` ending. */
export function calendarFeedSecretFrom(segment: string): string | null {
  const secret = segment.endsWith(CALENDAR_FEED_SUFFIX)
    ? segment.slice(0, -CALENDAR_FEED_SUFFIX.length)
    : segment;
  return isCalendarFeedSecretShape(secret) ? secret : null;
}

async function feedFor(
  db: Db,
  secret: string,
  address: string,
  now: Date,
): Promise<CalendarFeedAnswer> {
  // Only unknown links are charged to the address, so a large calendar service that fetches many
  // people's real links (and some stopped ones) from one address keeps getting the real ones. The
  // bucket is checked before the lookup without charging, so a full one is refused at once.
  const miss = {
    subjectId: hashedSubject('net', address),
    action: 'calendar_feed.miss_ip',
    label: 'calendar',
  };
  if (await isRateLimitReached(db, miss, RATE_LIMITS.CALENDAR_FEED_MISS_IP, now)) {
    return { state: 'busy' };
  }
  const holder = await resolveCalendarFeedSecret(db, secret);
  if (!holder) {
    const charged = await checkRateLimit(db, miss, RATE_LIMITS.CALENDAR_FEED_MISS_IP, now);
    return charged.allowed ? { state: 'not_found' } : { state: 'busy' };
  }

  const read = await checkRateLimit(
    db,
    {
      subjectId: `calendar_feed:${holder.feedId}`,
      action: 'calendar_feed.read',
      label: 'calendar',
    },
    RATE_LIMITS.CALENDAR_FEED_READ,
    now,
  );
  if (!read.allowed) return { state: 'busy' };

  // The gate, as the account that made the link, for the owner's metadata view only, and only
  // while the owner allows sharing.
  const access = await requireCalendarFeedAccess(db, holder);
  if (!access) return { state: 'not_found' };
  const listed = await listCalendarDates(access, { now });
  if (!listed.ok) return { state: 'not_found' };

  const { events } = selectCalendarEvents(
    listed.value.items,
    listed.value.items.map((item) => item.key),
    DEFAULT_CALENDAR_EXPORT_OPTIONS,
  );
  return {
    state: 'feed',
    ics: buildIcsCalendar(events, {
      now,
      calendarName: calendarFeedName(access.applicant.displayName),
    }),
  };
}

/**
 * The feed for a link's secret (already shape-checked by the route), as seen from `address`. A
 * database failure throws: the route answers it as a temporary problem, never as an empty
 * calendar, so a calendar app keeps the dates it already has instead of deleting them.
 */
export async function loadCalendarFeed(
  secret: string,
  address: string,
  now: Date = new Date(),
): Promise<CalendarFeedAnswer> {
  return withPublicDb((db) => feedFor(db, secret, address, now));
}
