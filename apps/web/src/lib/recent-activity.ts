import { accessLogEventLabel } from './access-log-labels';
import { agencyAiAccessLine } from './agency-ai';
import { formatTimestamp } from './format-date';

/** How many events Home shows; the rest are one tap away on the activity page. */
export const RECENT_ACTIVITY_LIMIT = 5;

/** The anchor of the Access Log on the Sharing page, where See All leads. */
export const ACCESS_LOG_ANCHOR = 'access-log';

/** The activity page for one person: the Access Log on their Sharing page. */
export function seeAllActivityHref(applicantId: string): string {
  return `/app/applicant/${applicantId}/sharing#${ACCESS_LOG_ANCHOR}`;
}

/** The shape of an event as the access-log read returns it (only what Home uses). */
export interface RecentActivityEvent {
  readonly seq: number;
  readonly eventType: string;
  readonly actorEmail: string | null;
  readonly result: 'ALLOWED' | 'DENIED' | null;
  readonly occurredAt: Date;
  readonly agencyAi: { readonly agencyName: string; readonly appHost: string | null } | null;
}

/** One line of the Home statement: what happened, when, and who did it. */
export interface RecentActivityEntry {
  readonly id: string;
  readonly what: string;
  readonly at: string;
  readonly when: string;
  readonly who: string;
  readonly blocked: boolean;
}

/**
 * The newest events as Home words them: the same plain words the Access Log uses (never a raw
 * code), "You" for the person's own actions, and a Blocked mark for a refused attempt. At most
 * `RECENT_ACTIVITY_LIMIT`, newest first as the read gives them.
 */
export function recentActivityEntries(
  events: readonly RecentActivityEvent[],
  ownEmail: string,
): RecentActivityEntry[] {
  const own = ownEmail.trim().toLowerCase();
  return events.slice(0, RECENT_ACTIVITY_LIMIT).map((event) => ({
    id: String(event.seq),
    what: event.agencyAi
      ? agencyAiAccessLine(event.agencyAi.agencyName, event.agencyAi.appHost)
      : accessLogEventLabel(event.eventType),
    at: event.occurredAt.toISOString(),
    when: formatTimestamp(event.occurredAt),
    who: event.actorEmail
      ? event.actorEmail.trim().toLowerCase() === own
        ? 'You'
        : event.actorEmail
      : 'System',
    blocked: event.result === 'DENIED',
  }));
}

/**
 * Whose activity Home shows: the person's own record when there is one, else the first person
 * Home reads. One person, never a loop over everyone.
 */
export function activityPerson<T extends { readonly relationship: string }>(
  people: readonly T[],
): T | undefined {
  return people.find((person) => person.relationship === 'SELF') ?? people[0];
}
