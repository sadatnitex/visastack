import { type Result, err, ok } from '@visastack/core';
import { eq } from 'drizzle-orm';
import { generateCalendarFeedSecret, hashCalendarFeedSecret } from './access/calendar-feed-secret';
import { AuthorizedApplicant } from './access/require-access';
import { appendAuditEvent } from './audit';
import { hasConsent } from './consent';
import { type Db, schema } from './db';
import { serverErrorEvent } from './error-report';
import { type ServiceError, serviceError } from './errors';
import { isMissingRelationError } from './missing-relation';
import { formatObservabilityLine } from './observability-format';

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
 * the kind of change, never the link. Turning a link on or making a new one needs the owner's
 * sharing consent (the feed also stops while it is off). Until the table exists, status reads say
 * `unavailable` and changes refuse; any other failure is logged without the link.
 */

export const CALENDAR_FEED_TURNED_ON_EVENT = 'CALENDAR_FEED_TURNED_ON';
export const CALENDAR_FEED_LINK_REPLACED_EVENT = 'CALENDAR_FEED_LINK_REPLACED';
export const CALENDAR_FEED_TURNED_OFF_EVENT = 'CALENDAR_FEED_TURNED_OFF';

/** Said when the table is not there yet (the migration runs after the code goes live). */
export const CALENDAR_FEED_UNAVAILABLE = 'Subscribing in your calendar app is not available yet.';

/** Said when the owner has not allowed sharing: a link anyone holding it can read is sharing. */
export const CALENDAR_FEED_SHARING_NEEDED =
  'To turn on a calendar link, first turn on "Let Me Share with Others" in your privacy settings.';

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

/** The cause of a failed change, logged without the link or its hash (neither is ever in it). */
function logFailure(step: string, error: unknown): void {
  console.error(formatObservabilityLine(serverErrorEvent('calendarFeeds', error, { step })));
}

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

/**
 * Whether this traveller's link is on, and since when the current link exists. Takes the owner's
 * metadata proof, or the owner's `MANAGE` proof so a change that failed can say how things stand.
 */
export async function getCalendarFeedStatus(
  access: OwnerProof<'VIEW_METADATA'> | OwnerProof<'MANAGE'>,
): Promise<Result<CalendarFeedStatus, ServiceError>> {
  if (!isOwnerProof(access, 'VIEW_METADATA') && !isOwnerProof(access, 'MANAGE')) {
    return err(serviceError('forbidden', OWNER_ONLY));
  }
  try {
    const rows = await access.tx
      .select({ linkMadeAt: schema.calendarFeeds.linkMadeAt })
      .from(schema.calendarFeeds)
      .where(eq(schema.calendarFeeds.applicantId, access.applicant.id))
      .limit(1);
    const row = rows[0];
    return ok(row ? { state: 'on', linkMadeAt: row.linkMadeAt } : { state: 'off' });
  } catch (error) {
    if (isMissingRelationError(error)) return ok({ state: 'unavailable' });
    throw error;
  }
}

/** The answer for a change that threw: "not available yet" before the migration, else logged. */
function failed(step: string, error: unknown, message: string): ServiceError {
  if (isMissingRelationError(error)) return serviceError('invalid', CALENDAR_FEED_UNAVAILABLE);
  logFailure(step, error);
  return serviceError('upstream_error', message);
}

/** A link anyone holding it can read is sharing, so making one needs the sharing consent. */
async function sharingAllowed(access: OwnerProof<'MANAGE'>): Promise<boolean> {
  return hasConsent(access.tx, access.applicant.ownerAccountId, 'SHARING');
}

/**
 * Turns the link on. Refused with `consent_required` while sharing is not allowed, and with
 * `stale` when this traveller already has one (two clicks at once included, by the table's
 * one-link rule): the person makes a new link instead, on purpose.
 */
export async function turnOnCalendarFeed(
  access: OwnerProof<'MANAGE'>,
): Promise<Result<CalendarFeedLink, ServiceError>> {
  if (!isOwnerProof(access, 'MANAGE')) return err(serviceError('forbidden', OWNER_ONLY));
  if (!(await sharingAllowed(access))) {
    return err(serviceError('consent_required', CALENDAR_FEED_SHARING_NEEDED));
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
  } catch (error) {
    return err(failed('turn on', error, 'the calendar link could not be turned on'));
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
  if (!(await sharingAllowed(access))) {
    return err(serviceError('consent_required', CALENDAR_FEED_SHARING_NEEDED));
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
  } catch (error) {
    return err(failed('new link', error, 'a new calendar link could not be made'));
  }
}

/**
 * Stops the link: the row goes, so its address answers "not found". Stopping a link that is off is
 * fine, so this works even when the page could not tell whether the link is on. Never needs the
 * sharing consent: stopping must always be possible.
 */
export async function turnOffCalendarFeed(
  access: OwnerProof<'MANAGE'>,
): Promise<Result<void, ServiceError>> {
  if (!isOwnerProof(access, 'MANAGE')) return err(serviceError('forbidden', OWNER_ONLY));
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
  } catch (error) {
    return err(failed('stop', error, 'the calendar link could not be stopped'));
  }
}
