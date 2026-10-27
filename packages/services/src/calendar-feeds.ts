import { type Result, err, ok } from '@visastack/core';
import { eq } from 'drizzle-orm';
import {
  calendarFeedsPresent,
  generateCalendarFeedSecret,
  hashCalendarFeedSecret,
} from './access/calendar-feed-secret';
import { AuthorizedApplicant } from './access/require-access';
import { appendAuditEvent } from './audit';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Private calendar subscription links (v1.2 B05 live feed, ADR 0016): the owner of a traveller's
 * record turns a link on, replaces it with a new one, or stops it. One link per traveller. The
 * secret is returned once, to the person who made it, and only its hash is kept
 * (`access/calendar-feed-secret.ts`). Reading the feed is not here: the feed route resolves the
 * secret to its account and asks the access gate as that account every time.
 *
 * Every function takes the owner's proof from `requireAccess` (`purpose: 'self'`): managing the
 * link with `MANAGE` (a setting of the owner's own record; `SHARE` would ask for a fresh sign-in
 * every time, too much friction for general titles and dates that the person can stop at any
 * moment); reading its status with `VIEW_METADATA`. Anyone else, including someone the traveller
 * shared with, is refused. Each change writes one audit entry in the same transaction, naming only
 * the kind of change, never the link. Until the table exists, status reads say `unavailable` and
 * changes refuse.
 */

export const CALENDAR_FEED_TURNED_ON_EVENT = 'CALENDAR_FEED_TURNED_ON';
export const CALENDAR_FEED_LINK_REPLACED_EVENT = 'CALENDAR_FEED_LINK_REPLACED';
export const CALENDAR_FEED_TURNED_OFF_EVENT = 'CALENDAR_FEED_TURNED_OFF';

/** Said when the table is not there yet (the migration runs after the code goes live). */
export const CALENDAR_FEED_UNAVAILABLE = 'Subscribing in your calendar app is not available yet.';

export type CalendarFeedStatus =
  | { readonly state: 'unavailable' }
  | { readonly state: 'off' }
  | { readonly state: 'on'; readonly linkMadeAt: Date };

/** A link just made: the secret is here once and nowhere else. */
export interface CalendarFeedLink {
  readonly secret: string;
  readonly linkMadeAt: Date;
}

type OwnerProof<A extends 'MANAGE' | 'VIEW_METADATA'> = AuthorizedApplicant<A>;

function isOwnerProof<A extends 'MANAGE' | 'VIEW_METADATA'>(
  access: OwnerProof<A>,
  action: A,
): boolean {
  return (
    AuthorizedApplicant.isGenuine(access, action) &&
    access.actor.kind === 'applicant_owner' &&
    access.resource.kind === 'applicant'
  );
}

const OWNER_ONLY = 'calendar links are available to the owner only';

async function audit(
  tx: Db,
  access: OwnerProof<'MANAGE'>,
  eventType: string,
  feedId: string,
): Promise<void> {
  await appendAuditEvent(tx, {
    eventType,
    actorAccountId: access.applicant.ownerAccountId,
    actorRole: 'applicant_owner',
    action: 'MANAGE',
    result: 'ALLOWED',
    method: 'MANUAL',
    applicantId: access.applicant.id,
    resourceType: 'calendar_feed',
    resourceId: feedId,
  });
}

/** Whether this traveller's link is on, and since when the current link exists. */
export async function getCalendarFeedStatus(
  access: OwnerProof<'VIEW_METADATA'>,
): Promise<Result<CalendarFeedStatus, ServiceError>> {
  if (!isOwnerProof(access, 'VIEW_METADATA')) return err(serviceError('forbidden', OWNER_ONLY));
  if (!(await calendarFeedsPresent(access.tx))) return ok({ state: 'unavailable' });
  const rows = await access.tx
    .select({ linkMadeAt: schema.calendarFeeds.linkMadeAt })
    .from(schema.calendarFeeds)
    .where(eq(schema.calendarFeeds.applicantId, access.applicant.id))
    .limit(1);
  const row = rows[0];
  return ok(row ? { state: 'on', linkMadeAt: row.linkMadeAt } : { state: 'off' });
}

/**
 * Turns the link on. Refused with `stale` when this traveller already has one (two clicks at once
 * included, by the table's one-link rule): the person makes a new link instead, on purpose.
 */
export async function turnOnCalendarFeed(
  access: OwnerProof<'MANAGE'>,
): Promise<Result<CalendarFeedLink, ServiceError>> {
  if (!isOwnerProof(access, 'MANAGE')) return err(serviceError('forbidden', OWNER_ONLY));
  if (!(await calendarFeedsPresent(access.tx))) {
    return err(serviceError('invalid', CALENDAR_FEED_UNAVAILABLE));
  }
  const secret = generateCalendarFeedSecret();
  try {
    const linkMadeAt = await access.tx.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.calendarFeeds)
        .values({
          applicantId: access.applicant.id,
          ownerAccountId: access.applicant.ownerAccountId,
          secretHash: hashCalendarFeedSecret(secret),
        })
        .onConflictDoNothing({ target: schema.calendarFeeds.applicantId })
        .returning({ id: schema.calendarFeeds.id, linkMadeAt: schema.calendarFeeds.linkMadeAt });
      const row = inserted[0];
      if (!row) return null;
      await audit(tx, access, CALENDAR_FEED_TURNED_ON_EVENT, row.id);
      return row.linkMadeAt;
    });
    if (!linkMadeAt) {
      return err(
        serviceError('stale', 'this calendar link is already on; make a new link instead'),
      );
    }
    return ok({ secret, linkMadeAt });
  } catch {
    return err(serviceError('upstream_error', 'the calendar link could not be turned on'));
  }
}

/**
 * Replaces the link with a new one: the old address stops working at once and calendar apps that
 * use it stop getting dates. Refused with `not_found` when the link is not on.
 */
export async function replaceCalendarFeedLink(
  access: OwnerProof<'MANAGE'>,
): Promise<Result<CalendarFeedLink, ServiceError>> {
  if (!isOwnerProof(access, 'MANAGE')) return err(serviceError('forbidden', OWNER_ONLY));
  if (!(await calendarFeedsPresent(access.tx))) {
    return err(serviceError('invalid', CALENDAR_FEED_UNAVAILABLE));
  }
  const secret = generateCalendarFeedSecret();
  try {
    const linkMadeAt = await access.tx.transaction(async (tx) => {
      const updated = await tx
        .update(schema.calendarFeeds)
        .set({
          secretHash: hashCalendarFeedSecret(secret),
          // The account that asks now is the one the feed reads as from here on.
          ownerAccountId: access.applicant.ownerAccountId,
          linkMadeAt: new Date(),
        })
        .where(eq(schema.calendarFeeds.applicantId, access.applicant.id))
        .returning({ id: schema.calendarFeeds.id, linkMadeAt: schema.calendarFeeds.linkMadeAt });
      const row = updated[0];
      if (!row) return null;
      await audit(tx, access, CALENDAR_FEED_LINK_REPLACED_EVENT, row.id);
      return row.linkMadeAt;
    });
    if (!linkMadeAt) return err(serviceError('not_found', 'this calendar link is not on'));
    return ok({ secret, linkMadeAt });
  } catch {
    return err(serviceError('upstream_error', 'a new calendar link could not be made'));
  }
}

/** Stops the link: the row goes, so its address answers "not found". Stopping a link that is off is fine. */
export async function turnOffCalendarFeed(
  access: OwnerProof<'MANAGE'>,
): Promise<Result<void, ServiceError>> {
  if (!isOwnerProof(access, 'MANAGE')) return err(serviceError('forbidden', OWNER_ONLY));
  if (!(await calendarFeedsPresent(access.tx))) {
    return err(serviceError('invalid', CALENDAR_FEED_UNAVAILABLE));
  }
  try {
    await access.tx.transaction(async (tx) => {
      const deleted = await tx
        .delete(schema.calendarFeeds)
        .where(eq(schema.calendarFeeds.applicantId, access.applicant.id))
        .returning({ id: schema.calendarFeeds.id });
      const row = deleted[0];
      if (row) await audit(tx, access, CALENDAR_FEED_TURNED_OFF_EVENT, row.id);
    });
    return ok(undefined);
  } catch {
    return err(serviceError('upstream_error', 'the calendar link could not be stopped'));
  }
}
