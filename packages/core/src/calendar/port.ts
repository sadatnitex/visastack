import type { CalendarEvent } from './model';

/**
 * The seam for pushing events into someone else's calendar service, event by event. Type only:
 * nothing implements it yet. A Google or Microsoft adapter (in packages/adapters) would implement
 * it, and needs the owner's word and the v1.2 rule of no OAuth and no calendar credentials to be
 * lifted first.
 *
 * Contract for an implementation:
 * - Every call is idempotent and keyed by `CalendarEvent.uid` (the permanent scheme in `uid.ts`):
 *   sending the same events twice changes nothing the second time and reports `unchanged`.
 * - `sequence` decides which copy is newer; an older one never overwrites a newer one.
 * - Mapping a UID to the service's own id is the adapter's concern (its own store); callers only
 *   ever deal in UIDs. The id is reported back as `externalId` for the adapter's records.
 * - A date that is finished, cancelled or removed in VisaStack is sent as an event with
 *   `status: 'CANCELLED'` (through `upsert`) or through `remove`, never simply left out, so the
 *   person's calendar does not keep a date that no longer applies.
 * - A failure is reported per UID, with `retryable` saying whether trying again may help; one
 *   failed event never hides the outcome of the others.
 *
 * A live feed (a per-person, revocable address that calendar apps poll) does not use this port:
 * it is a read path that serves `serializeCalendar` output (ADR 0016).
 */
export interface CalendarSyncOutcome {
  readonly uid: string;
  readonly status: 'created' | 'updated' | 'unchanged' | 'removed' | 'failed';
  /** The calendar service's own id for the event, when it has one. */
  readonly externalId?: string;
  /** For `failed`: true when the same call may succeed later (a timeout, a rate limit). */
  readonly retryable?: boolean;
}

export interface CalendarPublisher {
  /** Create or update each event, matched by UID. One outcome per event, in the same order. */
  upsert(events: readonly CalendarEvent[]): Promise<readonly CalendarSyncOutcome[]>;
  /** Remove the events with these UIDs. One outcome per UID, in the same order. */
  remove(uids: readonly string[]): Promise<readonly CalendarSyncOutcome[]>;
}
