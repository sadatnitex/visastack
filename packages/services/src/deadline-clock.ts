import { type Result, err, ok } from '@visastack/core';
import { and, asc, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import {
  ATTENTION_REQUEST_STATUSES,
  ATTENTION_TASK_STATUSES,
  type AttentionSubject,
  DUE_SOON_DAYS,
  FINISHED_CASE_STATES,
  compareText,
  dateOnly,
  daysUntilDueDay,
  recognisedTimeZone,
  todayIndex,
} from './attention';
import { schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { parseDocumentDate } from './expiry';
import { everydayDocumentCondition, lifecycleTablesPresent } from './lifecycle/foundation';

/**
 * The deadline clock (Growth G5): the next few dates that matter for one person, soonest first,
 * each with a count of days worked out where the person is. A read projection built only from
 * rules that already exist elsewhere, in the same places the calendar file reads them: current
 * documents with an expiry day, open or started tasks the traveller can act on, evidence requests
 * waiting on the traveller, and appointments, all on cases that are not over. Nothing is written
 * and nothing is decided: a date here is a date on file, never an approval, a promise or advice.
 *
 * Items carry a document type key (or a request's subject), a short task label, a date and a day
 * count. They never carry a saved value, a document number, a file name, an agency's note, an
 * appointment's title or place, or an amount. Day counts use the same rule as Needs Attention
 * (`daysUntilDueDay`): a day is past only once it has ended in the person's time zone, never UTC
 * midnight arithmetic.
 *
 * A date the system is unsure of carries a `doubt` and the web layer says "Check This Date": the
 * kind of a document was never accepted by the person (its expiry was read from the document, not
 * entered), the expiry falls before the document's own date, the date is implausibly far away, or
 * a time zone it depends on is not one this system recognises.
 */

/** How far back the clock reads, in days: older dates are on the Expiry page, not on the clock. */
export const DEADLINE_CLOCK_PAST_DAYS = 30;
/** Rows returned when the caller names no limit, and the most it may ask for. */
export const DEADLINE_CLOCK_DEFAULT_LIMIT = 3;
export const DEADLINE_CLOCK_MAX_LIMIT = 20;
/** "Within a month" for the colour and the word: this many days, today included. */
export const DEADLINE_MONTH_DAYS = 30;
/** A document expiry further away than this is not believed without a second look. */
const FAR_FUTURE_DAYS = 30 * 366;
/**
 * Rows read from each source (earliest first). Ranking and the limit are applied after day counts
 * are worked out in each item's own time zone, so the read is wide enough that stored-date order
 * and day-count order cannot disagree about what is soonest, and a few old overdue items cannot
 * crowd out what is ahead. Same bound as the calendar.
 */
export const DEADLINE_CLOCK_SOURCE_LIMIT = 50;
/** Longest task label carried, in characters; a longer one is cut. */
const TASK_LABEL_MAX = 80;

const DAY_MS = 86_400_000;

/** Overdue, within 7 days, within 30 days, later. Words as well as colour on every screen. */
export type DeadlineUrgency = 'overdue' | 'soon' | 'month' | 'later';

export function deadlineUrgency(daysUntil: number): DeadlineUrgency {
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= DUE_SOON_DAYS) return 'soon';
  if (daysUntil <= DEADLINE_MONTH_DAYS) return 'month';
  return 'later';
}

export type DeadlineKind = 'document_expires' | 'task_due' | 'request_due' | 'appointment';

/** Why a date is marked as one to check. Reasons only, never values. */
export type DeadlineDoubt =
  | 'kind_not_accepted'
  | 'date_before_issue'
  | 'far_future'
  | 'time_zone_unknown';

export interface DeadlineEntry {
  /** `${kind}:${resourceId}`: the same date always has the same key, and appears once. */
  readonly key: string;
  readonly kind: DeadlineKind;
  readonly applicantId: string;
  readonly applicantName: string;
  /** The calendar day, `YYYY-MM-DD` (an appointment's day where it happens). */
  readonly date: string;
  /** Whole days from today in the person's time zone to `date`; negative once past. */
  readonly daysUntil: number;
  readonly urgency: DeadlineUrgency;
  /** The document type key for a document; null for the rest or when the kind is not accepted. */
  readonly docType: string | null;
  /** What a request asks for, for the web layer to name. Null for anything else. */
  readonly subject: AttentionSubject | null;
  /** A task's own short description (at most 80 characters); null for anything else. */
  readonly label: string | null;
  /** Set when the system is unsure of this date: the web layer says "Check This Date". */
  readonly doubt: DeadlineDoubt | null;
  readonly caseId: string | null;
  /** Where it is dealt with. */
  readonly href: string;
}

export interface DeadlineClock {
  readonly applicantId: string;
  /** Soonest first, at most the limit asked for. */
  readonly entries: readonly DeadlineEntry[];
}

export interface DeadlineClockOptions {
  /** The clock (tests). Access is always decided by the gate on the real clock. */
  readonly now?: Date;
  /** How many dates to return. Default 3, at most 20; anything else is the default. */
  readonly limit?: number;
}

const KIND_ORDER: Record<DeadlineKind, number> = {
  request_due: 0,
  task_due: 1,
  appointment: 2,
  document_expires: 3,
};

function compareEntries(a: DeadlineEntry, b: DeadlineEntry): number {
  if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
  const date = compareText(a.date, b.date);
  if (date !== 0) return date;
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  const name = compareText(a.applicantName, b.applicantName);
  if (name !== 0) return name;
  return compareText(a.key, b.key);
}

/**
 * The dates to show from any number of lists (Home merges every person's clock), soonest first:
 * by day count, then by date, kind, name and key, so the order is the same for any input order. A
 * date that appears more than once (the same key) is kept once.
 *
 * One rule decides what is kept when there are more dates than room: the next date still ahead
 * always gets a place. Dates that have passed (shown first, as they are soonest) take the rest,
 * the most recent first, so a few old overdue items never push out the passport that expires next
 * week. With nothing ahead, the passed dates fill every place.
 */
export function rankDeadlines(
  entries: readonly DeadlineEntry[],
  limit: number = DEADLINE_CLOCK_DEFAULT_LIMIT,
): DeadlineEntry[] {
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const sorted = entries
    .filter((entry) => {
      if (seen.has(entry.key)) return false;
      seen.add(entry.key);
      return true;
    })
    .sort(compareEntries);
  const passed = sorted.filter((entry) => entry.daysUntil < 0);
  const ahead = sorted.filter((entry) => entry.daysUntil >= 0);
  const passedTaken = Math.min(passed.length, limit - Math.min(1, ahead.length));
  return [...passed.slice(passed.length - passedTaken), ...ahead.slice(0, limit - passedTaken)];
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return DEADLINE_CLOCK_DEFAULT_LIMIT;
  }
  return Math.min(limit, DEADLINE_CLOCK_MAX_LIMIT);
}

/** A document expiry the system is unsure of, or null. Pure. */
export function documentExpiryDoubt(input: {
  readonly docType: string | null;
  readonly documentDate: string | null;
  readonly expiryDay: string;
  readonly daysUntil: number;
}): DeadlineDoubt | null {
  // The expiry was read from the document; the person never accepted what kind of document it is.
  if (!input.docType) return 'kind_not_accepted';
  const issued = parseDocumentDate(input.documentDate);
  if (issued && input.expiryDay < dateOnly(issued)) return 'date_before_issue';
  if (input.daysUntil > FAR_FUTURE_DAYS) return 'far_future';
  return null;
}

/**
 * The next dates for one person. Takes a proof from the central access gate and, exactly as
 * `listCalendarDates` does, further requires that it was issued to the applicant's owner for this
 * applicant: a sharing grant, a copied proof or a proof for another resource is refused, so a
 * person never sees another person's dates. Cost: one read for cases, then one each for
 * appointments, tasks, requests and documents, each capped at `DEADLINE_CLOCK_SOURCE_LIMIT`
 * rows, earliest first. Nothing is written.
 */
export async function listDeadlineClock(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
  options: DeadlineClockOptions = {},
): Promise<Result<DeadlineClock, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(access, 'VIEW_METADATA') ||
    access.actor.kind !== 'applicant_owner' ||
    access.resource.kind !== 'applicant'
  ) {
    return err(serviceError('forbidden', 'deadline dates are available to the owner only'));
  }
  const db = access.tx;
  const applicant = access.applicant;
  const applicantId = applicant.id;
  const applicantName = applicant.displayName;
  const now = options.now ?? new Date();
  const limit = clampLimit(options.limit);
  const readLimit = DEADLINE_CLOCK_SOURCE_LIMIT;
  // Without a zone this system recognises every count is against UTC: say so rather than guess.
  const personDoubt: DeadlineDoubt | null =
    recognisedTimeZone(applicant.timezone) === null ? 'time_zone_unknown' : null;
  // The first day read: a month before today where the traveller is. Date-only values are stored
  // as UTC midnight and appointments as a timezone-naive wall clock read in a UTC process, so the
  // same UTC-midnight value bounds both.
  const earliest = new Date(
    (todayIndex(now, applicant.timezone) - DEADLINE_CLOCK_PAST_DAYS) * DAY_MS,
  );

  const missions = await db
    .select({ id: schema.missions.id, state: schema.missions.state })
    .from(schema.missions)
    .where(eq(schema.missions.applicantId, applicantId));
  const activeIds = missions.filter((m) => !FINISHED_CASE_STATES.has(m.state)).map((m) => m.id);

  const lifecycle = await lifecycleTablesPresent(db);
  const [appointments, tasks, requests, documents] = await Promise.all([
    activeIds.length === 0
      ? []
      : db
          .select({
            id: schema.missionAppointments.id,
            missionId: schema.missionAppointments.missionId,
            localDateTime: schema.missionAppointments.localDateTime,
            timezone: schema.missionAppointments.timezone,
          })
          .from(schema.missionAppointments)
          .where(
            and(
              inArray(schema.missionAppointments.missionId, activeIds),
              inArray(schema.missionAppointments.status, [...ATTENTION_TASK_STATUSES]),
              gte(schema.missionAppointments.localDateTime, earliest),
            ),
          )
          .orderBy(
            asc(schema.missionAppointments.localDateTime),
            asc(schema.missionAppointments.id),
          )
          .limit(readLimit),
    activeIds.length === 0
      ? []
      : db
          .select({
            id: schema.missionTasks.id,
            missionId: schema.missionTasks.missionId,
            description: schema.missionTasks.description,
            dueDate: schema.missionTasks.dueDate,
            dueTimezone: schema.missionTasks.dueTimezone,
          })
          .from(schema.missionTasks)
          .where(
            and(
              inArray(schema.missionTasks.missionId, activeIds),
              inArray(schema.missionTasks.status, [...ATTENTION_TASK_STATUSES]),
              gte(schema.missionTasks.dueDate, earliest),
              // Only tasks the traveller can act on.
              or(
                isNull(schema.missionTasks.assigneeAccountId),
                eq(schema.missionTasks.assigneeAccountId, applicant.ownerAccountId),
              ),
            ),
          )
          .orderBy(asc(schema.missionTasks.dueDate), asc(schema.missionTasks.id))
          .limit(readLimit),
    db
      .select({
        id: schema.evidenceRequests.id,
        missionId: schema.evidenceRequests.missionId,
        kind: schema.evidenceRequests.kind,
        docType: schema.evidenceRequests.docType,
        fieldKey: schema.evidenceRequests.fieldKey,
        dueDate: schema.evidenceRequests.dueDate,
      })
      .from(schema.evidenceRequests)
      .where(
        and(
          eq(schema.evidenceRequests.applicantId, applicantId),
          inArray(schema.evidenceRequests.status, [...ATTENTION_REQUEST_STATUSES]),
          gte(schema.evidenceRequests.dueDate, earliest),
          // Not on a case that is over: no case, or an active one.
          activeIds.length === 0
            ? isNull(schema.evidenceRequests.missionId)
            : or(
                isNull(schema.evidenceRequests.missionId),
                inArray(schema.evidenceRequests.missionId, activeIds),
              ),
        ),
      )
      .orderBy(asc(schema.evidenceRequests.dueDate), asc(schema.evidenceRequests.id))
      .limit(readLimit),
    db
      .select({
        id: schema.documents.id,
        docType: schema.documents.docType,
        documentDate: schema.documents.documentDate,
        expiresAt: schema.documents.expiresAt,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.applicantId, applicantId),
          isNull(schema.documents.supersededByDocumentId),
          gte(schema.documents.expiresAt, earliest),
          // Reminders and dates: everydayDocumentCondition.
          lifecycle ? everydayDocumentCondition() : undefined,
        ),
      )
      .orderBy(asc(schema.documents.expiresAt), asc(schema.documents.id))
      .limit(readLimit),
  ]);

  const caseHref = (missionId: string) => `/app/mission/${missionId}`;
  const entries: DeadlineEntry[] = [];
  const add = (entry: Omit<DeadlineEntry, 'applicantId' | 'applicantName' | 'urgency'>): void => {
    entries.push({
      ...entry,
      applicantId,
      applicantName,
      urgency: deadlineUrgency(entry.daysUntil),
    });
  };

  for (const row of appointments) {
    // Stored timezone-naive and read in a UTC process, so the UTC fields are the wall clock.
    const date = row.localDateTime.toISOString().slice(0, 10);
    const zone = recognisedTimeZone(row.timezone);
    add({
      key: `appointment:${row.id}`,
      kind: 'appointment',
      date,
      // Today where the appointment is: its day is the day on the wall there.
      daysUntil: daysUntilDueDay(
        new Date(`${date}T00:00:00.000Z`),
        now,
        zone ?? applicant.timezone,
      ),
      docType: null,
      subject: null,
      label: null,
      doubt: zone === null ? 'time_zone_unknown' : null,
      caseId: row.missionId,
      href: caseHref(row.missionId),
    });
  }
  for (const row of tasks) {
    if (!row.dueDate) continue;
    // A task with its own zone that cannot be read is unsure; one with none follows the person.
    const zone = row.dueTimezone === null ? null : recognisedTimeZone(row.dueTimezone);
    const label = Array.from(row.description.trim()).slice(0, TASK_LABEL_MAX).join('');
    add({
      key: `task_due:${row.id}`,
      kind: 'task_due',
      date: dateOnly(row.dueDate),
      daysUntil: daysUntilDueDay(row.dueDate, now, zone ?? applicant.timezone),
      docType: null,
      subject: null,
      label: label.length > 0 ? label : null,
      doubt: row.dueTimezone !== null && zone === null ? 'time_zone_unknown' : personDoubt,
      caseId: row.missionId,
      href: caseHref(row.missionId),
    });
  }
  for (const row of requests) {
    if (!row.dueDate) continue;
    add({
      key: `request_due:${row.id}`,
      kind: 'request_due',
      date: dateOnly(row.dueDate),
      daysUntil: daysUntilDueDay(row.dueDate, now, applicant.timezone),
      docType: null,
      subject: {
        kind: 'request',
        requestKind: row.kind === 'DOCUMENT' ? 'DOCUMENT' : 'FIELD',
        docType: row.docType,
        fieldKey: row.fieldKey,
      },
      label: null,
      doubt: personDoubt,
      caseId: row.missionId,
      href: `/app/applicant/${applicantId}/evidence`,
    });
  }
  for (const row of documents) {
    if (!row.expiresAt) continue;
    const date = dateOnly(row.expiresAt);
    const daysUntil = daysUntilDueDay(row.expiresAt, now, applicant.timezone);
    add({
      key: `document_expires:${row.id}`,
      kind: 'document_expires',
      date,
      daysUntil,
      docType: row.docType,
      subject: null,
      label: null,
      doubt:
        documentExpiryDoubt({
          docType: row.docType,
          documentDate: row.documentDate,
          expiryDay: date,
          daysUntil,
        }) ?? personDoubt,
      caseId: null,
      href: `/app/applicant/${applicantId}/expiry`,
    });
  }

  return ok({ applicantId, entries: rankDeadlines(entries, limit) });
}
