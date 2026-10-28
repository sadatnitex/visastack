import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hasConsent } from '../consent';
import { type Db, schema } from '../db';
import { isMissingRelationError } from '../missing-relation';
import { type AccountPrincipal, accountPrincipal } from './principal';
import { AuthorizedApplicant, requireAccess } from './require-access';

/**
 * The secret in a private calendar subscription link (v1.2 B05 live feed, ADR 0016).
 *
 * Calendar apps poll an address and cannot sign in, so the address itself is the credential: 32
 * random bytes (256 bits), written as 43 URL-safe base64 characters. Only a SHA-256 of it, with a
 * fixed prefix so the hash is never the same as any other token's, is stored. Resolving a secret
 * here answers only "which account made this link, for which traveller": it is identity, like a
 * session cookie, never permission. The feed then asks `requireAccess` as that account, against
 * live state, every time, so a link stops working as soon as that account no longer owns the
 * traveller, and an unknown, stopped or replaced link reads exactly like a made-up one.
 */

const SECRET_BYTES = 32;
/** 32 bytes in unpadded base64url. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PREFIX = 'visastack:calendar-feed:v1:';

/** A new secret for a calendar link. Shown to the person once and never stored. */
export function generateCalendarFeedSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

/** Whether a value has the exact shape of a secret, checked before any database work. */
export function isCalendarFeedSecretShape(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

/** The stored form of a secret: lower-case hex SHA-256 (the table refuses anything else). */
export function hashCalendarFeedSecret(secret: string): string {
  return createHash('sha256').update(`${HASH_PREFIX}${secret}`).digest('hex');
}

/**
 * A link that exists: which link (for its own rate limit) and which traveller. Deliberately
 * carries no principal: the account behind the link is kept here, out of reach, and is only ever
 * used by `requireCalendarFeedAccess` for the one thing a link may do, read the dates' metadata as
 * the owner. A copy of a holder is not a holder.
 */
export interface CalendarFeedHolder {
  readonly feedId: string;
  readonly applicantId: string;
}

const HOLDER_ACCOUNTS = new WeakMap<CalendarFeedHolder, AccountPrincipal>();

/**
 * The link behind a secret, or null for anything else: a malformed value, an unknown, stopped or
 * replaced link, or a database where the table does not exist yet. Nothing is readable with a
 * holder until `requireCalendarFeedAccess` has asked the gate.
 */
export async function resolveCalendarFeedSecret(
  db: Db,
  secret: string,
): Promise<CalendarFeedHolder | null> {
  if (!isCalendarFeedSecretShape(secret)) return null;
  let rows: { id: string; applicantId: string; ownerAccountId: string }[];
  try {
    rows = await db
      .select({
        id: schema.calendarFeeds.id,
        applicantId: schema.calendarFeeds.applicantId,
        ownerAccountId: schema.calendarFeeds.ownerAccountId,
      })
      .from(schema.calendarFeeds)
      .where(eq(schema.calendarFeeds.secretHash, hashCalendarFeedSecret(secret)))
      .limit(1);
  } catch (error) {
    // Before the migration runs there are no links; any other failure is a real one.
    if (isMissingRelationError(error)) return null;
    throw error;
  }
  const row = rows[0];
  if (!row) return null;
  const holder: CalendarFeedHolder = Object.freeze({
    feedId: row.id,
    applicantId: row.applicantId,
  });
  HOLDER_ACCOUNTS.set(holder, accountPrincipal(row.ownerAccountId));
  return holder;
}

/**
 * The owner's `VIEW_METADATA` proof for the link's traveller, asked of `requireAccess` as the
 * account that made the link, against live state, or null: when that account no longer owns the
 * traveller (a link never reads as anyone else, and never as someone shared with), when the owner
 * has turned sharing off, or when the holder did not come from `resolveCalendarFeedSecret`.
 */
export async function requireCalendarFeedAccess(
  db: Db,
  holder: CalendarFeedHolder,
): Promise<AuthorizedApplicant<'VIEW_METADATA'> | null> {
  const principal = HOLDER_ACCOUNTS.get(holder);
  if (!principal) return null;
  const access = await requireAccess(
    db,
    principal,
    'VIEW_METADATA',
    { applicantId: holder.applicantId },
    { purpose: 'self' },
  );
  if (!access.ok || access.value.actor.kind !== 'applicant_owner') return null;
  if (!AuthorizedApplicant.isGenuine(access.value, 'VIEW_METADATA')) return null;
  // A link anyone holding it can read is sharing: it stops while sharing is turned off.
  if (!(await hasConsent(db, access.value.applicant.ownerAccountId, 'SHARING'))) return null;
  return access.value;
}
