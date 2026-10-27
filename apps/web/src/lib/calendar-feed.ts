import 'server-only';
import { DEFAULT_CALENDAR_EXPORT_OPTIONS } from '@visastack/core/calendar';
import {
  type Db,
  RATE_LIMITS,
  checkRateLimit,
  isCalendarFeedSecretShape,
  listCalendarDates,
  requireCalendarFeedAccess,
  resolveCalendarFeedSecret,
} from '@visastack/services';
import { hashedSubject } from './client-address';
import { buildIcsCalendar, selectCalendarEvents } from './ics';
import { withPublicDb } from './public-db';

/**
 * The live calendar feed (v1.2 B05, ADR 0016): what a calendar app gets when it checks a person's
 * private subscription link. Calendar apps cannot sign in, so the link's secret says which account
 * made it, and that account's access is then asked of the central gate, as the owner, against
 * live state, every time. The feed holds exactly what the one-time file holds with its default
 * choices: general titles ("Task Due"), one general description line, no case name, no place, no
 * reminder, every kind of date, the same permanent UIDs and SEQUENCE.
 *
 * An unknown, stopped or replaced link, a link whose account no longer owns the traveller, and a
 * database without the table yet all answer `not_found`, the same as a made-up link. Unknown links
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

/** The https and webcal forms of a link, for the page that shows it once. */
export function calendarFeedUrls(
  baseUrl: string,
  secret: string,
): { readonly https: string; readonly webcal: string } {
  const https = `${baseUrl.replace(/\/+$/, '')}${CALENDAR_FEED_PATH}/${secret}${CALENDAR_FEED_SUFFIX}`;
  return { https, webcal: https.replace(/^https?:\/\//, 'webcal://') };
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
  const holder = await resolveCalendarFeedSecret(db, secret);
  if (!holder) {
    // Only unknown links count against the address, after the lookup: a large calendar service
    // that fetches many people's real links (and some stopped ones) from one address keeps getting
    // the real ones. A secret has 256 random bits, so this bounds load, not guessing odds.
    const miss = await checkRateLimit(
      db,
      {
        subjectId: hashedSubject('net', address),
        action: 'calendar_feed.miss_ip',
        label: 'calendar',
      },
      RATE_LIMITS.CALENDAR_FEED_MISS_IP,
      now,
    );
    return miss.allowed ? { state: 'not_found' } : { state: 'busy' };
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

  // The gate, as the account that made the link, for the owner's metadata view only.
  const access = await requireCalendarFeedAccess(db, holder);
  if (!access) return { state: 'not_found' };
  const listed = await listCalendarDates(access, { now });
  if (!listed.ok) return { state: 'not_found' };

  const { events } = selectCalendarEvents(
    listed.value.items,
    listed.value.items.map((item) => item.key),
    DEFAULT_CALENDAR_EXPORT_OPTIONS,
  );
  return { state: 'feed', ics: buildIcsCalendar(events, { now }) };
}

/**
 * The feed for a link's secret, as seen from `address`. A database failure throws: the route
 * answers it as a temporary problem, never as an empty calendar, so a calendar app keeps the dates
 * it already has instead of deleting them.
 */
export async function loadCalendarFeed(
  secret: string,
  address: string,
  now: Date = new Date(),
): Promise<CalendarFeedAnswer> {
  if (!isCalendarFeedSecretShape(secret)) return { state: 'not_found' };
  return withPublicDb((db) => feedFor(db, secret, address, now));
}
