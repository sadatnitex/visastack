import { type Result, err, ok } from '@visastack/core';
import { type CalendarKind, currentTimeZoneName, isCalendarKind } from '@visastack/core/calendar';
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, min, or } from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import { appendAuditEvent } from './audit';
import { schema } from './db';
import { type ServiceError, serviceError } from './errors';
import {
  WAITING_ON_AGENCY_REQUEST_STATUSES,
  WAITING_ON_TRAVELLER_REQUEST_STATUSES,
} from './evidence-request-groups';
import { DEFAULT_EXPIRY_REMINDER_THRESHOLD_DAYS, getReminderThresholds } from './expiry';
import { toLocalDateParts } from './notification-sweep';
import { referenceCodesFor } from './reference-codes';

/**
 * Needs Attention (v1.2 B05, U03): one read projection of what is waiting on a person for one
 * applicant, built only from rules that already exist elsewhere. Nothing here writes, sends or
 * decides anything new:
 *
 * - evidence requests an agency sent (open, or sent back for a fix), the rows the traveller's
 *   evidence page lists, read here with only the columns an item needs (never the agency's note);
 * - open or started tasks on the applicant's active cases, the same statuses the task reminder
 *   sweep treats as live, that the traveller can act on: unassigned, or assigned to the traveller's
 *   own account (a task the agency gave one of its staff is the agency's to do);
 * - current documents whose expiry day is inside the document type's reminder window or has
 *   ended, counted in the applicant's time zone with the same due-day rule as tasks;
 * - cases whose confirmation was undone by a later change, by the same rule the case page uses
 *   for its "changed since you confirmed" alert;
 * - suggested details still waiting for a decision, as one item with a count.
 *
 * Items carry plain words, record ids for links, and catalogue keys (a document type or a field
 * key) for the web layer to name. They never carry a saved value, a document number, a file name,
 * an amount, an agency's note or a task note.
 *
 * The ranking (ADR 0016) is a pure function, `rankAttentionItems`, so Home can merge the lists
 * of several applicants and the account's own items and get the same order every time.
 */

/** Case states that are over; their tasks, requests and confirmations no longer need doing. */
export const FINISHED_CASE_STATES: ReadonlySet<string> = new Set(['CLOSED', 'CANCELLED']);

/** Request statuses still waiting on the traveller (ADR 0015 section 5: open or sent back). */
export const ATTENTION_REQUEST_STATUSES = WAITING_ON_TRAVELLER_REQUEST_STATUSES;
/** Request statuses where the traveller has answered and the agency has the next move. */
export const WITH_AGENCY_REQUEST_STATUSES = WAITING_ON_AGENCY_REQUEST_STATUSES;
const WAITING_ON_YOU: ReadonlySet<string> = new Set(ATTENTION_REQUEST_STATUSES);
const WITH_AGENCY: ReadonlySet<string> = new Set(WITH_AGENCY_REQUEST_STATUSES);
/** Task statuses the reminder sweep treats as live (`sweepTaskDeadlineReminders`). */
export const ATTENTION_TASK_STATUSES = ['OPEN', 'IN_PROGRESS'] as const;

/** "Due soon" means due within this many days, today included (ADR 0016, tier 3). */
export const DUE_SOON_DAYS = 7;

/**
 * Upper bound on rows read from each source for one applicant. Each query is ordered most urgent
 * first, so a person with more than this many open tasks still sees the most urgent ones.
 */
export const ATTENTION_SOURCE_LIMIT = 50;

/** How many active cases the projection returns for a compact "Active Requests and Work" list. */
export const ATTENTION_ACTIVE_CASE_LIMIT = 20;

const DAY_MS = 86_400_000;

export type AttentionKind =
  | 'evidence_request'
  | 'task'
  | 'case_changed'
  | 'document_expiry'
  | 'suggestions'
  | 'sharing_invitations';

export type AttentionDueState = 'overdue' | 'due_soon' | 'later' | 'unknown' | 'none';

/** 1 is first. See ADR 0016 for what each tier holds. */
export type AttentionTier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Catalogue keys the web layer turns into names. Never a value, never free text. */
export type AttentionSubject =
  | {
      readonly kind: 'request';
      readonly requestKind: 'FIELD' | 'DOCUMENT';
      readonly docType: string | null;
      readonly fieldKey: string | null;
    }
  | { readonly kind: 'document'; readonly docType: string | null };

export interface AttentionItem {
  /** `${kind}:${resourceId}`: the same event always has the same key, and appears once. */
  readonly key: string;
  readonly kind: AttentionKind;
  readonly tier: AttentionTier;
  /** A plain heading. The web layer may name the subject more exactly from `subject`. */
  readonly title: string;
  /** Why it matters, in one plain sentence. */
  readonly why: string;
  readonly applicantId: string | null;
  readonly applicantName: string | null;
  readonly caseId: string | null;
  readonly caseTitle: string | null;
  /**
   * The calendar day it is due (or, for a document, the day it expires), as `YYYY-MM-DD`. Null
   * when there is no date: never guessed.
   */
  readonly dueDate: string | null;
  /** `unknown`: this kind of item can have a date and this one has none. `none`: it never has one. */
  readonly dueState: AttentionDueState;
  /** Whole days until `dueDate`, negative once past; null without a date. */
  readonly daysUntilDue: number | null;
  /** An evidence request the agency sent back for a fix. */
  readonly sentBack: boolean;
  /** How many things the item stands for (suggestions, invitations); null for a single thing. */
  readonly count: number | null;
  readonly subject: AttentionSubject | null;
  /** Where it is dealt with. The web layer words the button. */
  readonly href: string;
  /** When the thing itself was created or happened, ISO 8601. The last tie-break but one. */
  readonly createdAt: string;
}

/** What `attentionTier` needs to place an item. */
export interface AttentionTierInput {
  readonly kind: AttentionKind;
  readonly dueState: AttentionDueState;
  readonly sentBack: boolean;
}

/**
 * The tier an item belongs to (owner-approved ranking, ADR 0016). An item takes the highest tier
 * that applies, so an overdue request that was sent back is tier 1, not tier 2.
 */
export function attentionTier(item: AttentionTierInput): AttentionTier {
  switch (item.kind) {
    case 'evidence_request':
    case 'task':
      if (item.dueState === 'overdue') return 1;
      if (item.sentBack) return 2;
      if (item.dueState === 'due_soon') return 3;
      return 5;
    case 'case_changed':
      return 4;
    case 'document_expiry':
      return 6;
    case 'suggestions':
    case 'sharing_invitations':
      return 7;
  }
}

export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareItems(a: AttentionItem, b: AttentionItem): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  // Dated before undated; then the earliest date first (oldest due when overdue, soonest
  // otherwise). A `YYYY-MM-DD` string sorts the same way as the day it names.
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return compareText(a.dueDate, b.dueDate);
  }
  const created = compareText(a.createdAt, b.createdAt);
  if (created !== 0) return created;
  const title = compareText(a.title, b.title);
  if (title !== 0) return title;
  return compareText(a.key, b.key);
}

/**
 * Rank and merge attention items from any number of lists (ADR 0016): by tier, then dated before
 * undated with the earliest date first, then oldest created, then title, then key, so the order
 * is the same for any input order. Each item's tier is worked out again here, so an item built
 * by hand (Home's sharing invitations) cannot claim a tier it does not have. An event that
 * appears more than once (the same key) is kept once, in its highest tier.
 */
export function rankAttentionItems(items: readonly AttentionItem[]): AttentionItem[] {
  const tiered = items.map((item) => {
    const tier = attentionTier(item);
    return tier === item.tier ? item : { ...item, tier };
  });
  tiered.sort(compareItems);
  const seen = new Set<string>();
  const ranked: AttentionItem[] = [];
  for (const item of tiered) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    ranked.push(item);
  }
  return ranked;
}

/** A stored date-only value (a date entered as a day, saved as UTC midnight) as `YYYY-MM-DD`. */
export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** The day number of "today" in `timezone`; an unknown zone name counts as UTC rather than fail. */
export function todayIndex(now: Date, timezone: string): number {
  let parts: { readonly year: number; readonly month: number; readonly day: number };
  try {
    parts = toLocalDateParts(now, timezone);
  } catch {
    parts = toLocalDateParts(now, 'UTC');
  }
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

/**
 * Days from today (in the person's time zone) to a due day. A due date is a calendar day, so it
 * is past due only once that day has ended where the person is (ADR 0015 section 6, ADR 0016):
 * due today is 0 and not overdue.
 */
export function daysUntilDueDay(dueDate: Date, now: Date, timezone: string): number {
  return Math.floor(dueDate.getTime() / DAY_MS) - todayIndex(now, timezone);
}

function dueStateFor(days: number | null): AttentionDueState {
  if (days === null) return 'unknown';
  if (days < 0) return 'overdue';
  if (days <= DUE_SOON_DAYS) return 'due_soon';
  return 'later';
}

export interface AttentionActiveCase {
  readonly id: string;
  readonly title: string;
  readonly state: string;
}

export interface NeedsAttention {
  readonly applicantId: string;
  readonly applicantName: string;
  /** Ranked (ADR 0016). */
  readonly items: readonly AttentionItem[];
  /** Cases not closed or cancelled, newest first, at most `ATTENTION_ACTIVE_CASE_LIMIT`. */
  readonly activeCases: readonly AttentionActiveCase[];
  readonly activeCaseCount: number;
  readonly requests: {
    /** Open or sent back for a fix: the traveller has the next move. */
    readonly waitingOnYou: number;
    /** Answered, and the agency has the next move. Received is not reviewed. */
    readonly withAgency: number;
  };
}

export interface NeedsAttentionOptions {
  /** The clock for due days and expiry (tests). Access is always decided by the gate on the real clock. */
  readonly now?: Date;
}

/**
 * Needs Attention for one applicant. Takes a proof from the central access gate and further
 * requires that it was issued to the applicant's owner: what is asked of a traveller, their
 * suggestions and their confirmations are theirs alone, so a sharing grant (an agency or another
 * person) is refused even when it would allow viewing. Nothing is written.
 *
 * Cost: one read each for requests, cases, tasks, confirmations, documents and suggestions, plus
 * one reminder-threshold read per distinct document type among the documents read. The gate
 * already loaded the applicant, so it is not read again. Tasks and documents are capped at
 * `ATTENTION_SOURCE_LIMIT` rows, most urgent first; requests (only the four statuses that matter),
 * cases and confirmations are not capped. No per-case or per-task query.
 */
export async function listNeedsAttention(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
  options: NeedsAttentionOptions = {},
): Promise<Result<NeedsAttention, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(access, 'VIEW_METADATA') ||
    access.actor.kind !== 'applicant_owner' ||
    access.resource.kind !== 'applicant'
  ) {
    return err(serviceError('forbidden', 'needs attention is available to the owner only'));
  }
  const db = access.tx;
  const applicant = access.applicant;
  const applicantId = applicant.id;
  const applicantName = applicant.displayName;
  const timezone = applicant.timezone;
  const now = options.now ?? new Date();
  const evidenceHref = `/app/applicant/${applicantId}/evidence`;

  const [requests, missions, documents, pending] = await Promise.all([
    db
      .select({
        id: schema.evidenceRequests.id,
        missionId: schema.evidenceRequests.missionId,
        kind: schema.evidenceRequests.kind,
        docType: schema.evidenceRequests.docType,
        fieldKey: schema.evidenceRequests.fieldKey,
        dueDate: schema.evidenceRequests.dueDate,
        status: schema.evidenceRequests.status,
        createdAt: schema.evidenceRequests.createdAt,
      })
      .from(schema.evidenceRequests)
      .where(
        and(
          eq(schema.evidenceRequests.applicantId, applicantId),
          inArray(schema.evidenceRequests.status, [
            ...ATTENTION_REQUEST_STATUSES,
            ...WITH_AGENCY_REQUEST_STATUSES,
          ]),
        ),
      ),
    db
      .select({
        id: schema.missions.id,
        title: schema.missions.title,
        state: schema.missions.state,
        createdAt: schema.missions.createdAt,
      })
      .from(schema.missions)
      .where(eq(schema.missions.applicantId, applicantId)),
    db
      .select({
        id: schema.documents.id,
        docType: schema.documents.docType,
        expiresAt: schema.documents.expiresAt,
        createdAt: schema.documents.createdAt,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.applicantId, applicantId),
          isNull(schema.documents.supersededByDocumentId),
          isNotNull(schema.documents.expiresAt),
        ),
      )
      .orderBy(asc(schema.documents.expiresAt), asc(schema.documents.id))
      .limit(ATTENTION_SOURCE_LIMIT),
    // The same filter as `listPendingProposals`, counted rather than loaded with its evidence.
    db
      .select({ pending: count(), oldest: min(schema.fieldProposals.createdAt) })
      .from(schema.fieldProposals)
      .where(
        and(
          eq(schema.fieldProposals.applicantId, applicantId),
          eq(schema.fieldProposals.status, 'PENDING'),
        ),
      ),
  ]);
  const missionById = new Map(missions.map((m) => [m.id, m]));
  const active = missions
    .filter((m) => !FINISHED_CASE_STATES.has(m.state))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || compareText(a.id, b.id));
  const activeIds = active.map((m) => m.id);

  const [tasks, confirmations] =
    activeIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              id: schema.missionTasks.id,
              missionId: schema.missionTasks.missionId,
              description: schema.missionTasks.description,
              dueDate: schema.missionTasks.dueDate,
              dueTimezone: schema.missionTasks.dueTimezone,
              createdAt: schema.missionTasks.createdAt,
            })
            .from(schema.missionTasks)
            .where(
              and(
                inArray(schema.missionTasks.missionId, activeIds),
                inArray(schema.missionTasks.status, [...ATTENTION_TASK_STATUSES]),
                // Only tasks the traveller can act on.
                or(
                  isNull(schema.missionTasks.assigneeAccountId),
                  eq(schema.missionTasks.assigneeAccountId, applicant.ownerAccountId),
                ),
              ),
            )
            // Postgres puts undated tasks last when sorting ascending.
            .orderBy(asc(schema.missionTasks.dueDate), asc(schema.missionTasks.createdAt))
            .limit(ATTENTION_SOURCE_LIMIT),
          db
            .select({
              missionId: schema.acknowledgements.missionId,
              invalidatedAt: schema.acknowledgements.invalidatedAt,
            })
            .from(schema.acknowledgements)
            .where(
              and(
                inArray(schema.acknowledgements.missionId, activeIds),
                eq(schema.acknowledgements.decision, 'ACKNOWLEDGED'),
              ),
            ),
        ]);

  const items: AttentionItem[] = [];
  const caseFields = (missionId: string | null) => {
    const mission = missionId ? missionById.get(missionId) : undefined;
    return { caseId: mission?.id ?? null, caseTitle: mission?.title ?? null };
  };
  const push = (item: Omit<AttentionItem, 'tier'>) => {
    items.push({ ...item, tier: attentionTier(item) });
  };

  // a. Evidence requests: open or sent back. Declined, cancelled and answered ones never show.
  let waitingOnYou = 0;
  let withAgency = 0;
  for (const request of requests) {
    // A request tied to a case that is over is no longer asked of anyone.
    const mission = request.missionId ? missionById.get(request.missionId) : undefined;
    if (mission && FINISHED_CASE_STATES.has(mission.state)) continue;
    if (WITH_AGENCY.has(request.status)) withAgency++;
    if (!WAITING_ON_YOU.has(request.status)) continue;
    waitingOnYou++;
    const sentBack = request.status === 'NEEDS_REPLACEMENT';
    const days = request.dueDate ? daysUntilDueDay(request.dueDate, now, timezone) : null;
    const isDocument = request.kind === 'DOCUMENT';
    push({
      key: `evidence_request:${request.id}`,
      kind: 'evidence_request',
      title: sentBack
        ? 'Replacement Requested'
        : isDocument
          ? 'Document Requested'
          : 'Detail Requested',
      why: sentBack
        ? 'The agency looked at what you sent and asked for a new one.'
        : isDocument
          ? 'An agency asked you for a document. Reply with a file from your documents.'
          : 'An agency asked you for a detail. Reply from your profile.',
      applicantId,
      applicantName,
      ...caseFields(request.missionId),
      dueDate: request.dueDate ? dateOnly(request.dueDate) : null,
      dueState: dueStateFor(days),
      daysUntilDue: days,
      sentBack,
      count: null,
      subject: {
        kind: 'request',
        requestKind: isDocument ? 'DOCUMENT' : 'FIELD',
        docType: request.docType,
        fieldKey: request.fieldKey,
      },
      href: evidenceHref,
      createdAt: request.createdAt.toISOString(),
    });
  }

  // b. Tasks on active cases, due in the task's own time zone, else the applicant's.
  for (const task of tasks) {
    const days = task.dueDate
      ? daysUntilDueDay(task.dueDate, now, task.dueTimezone ?? timezone)
      : null;
    push({
      key: `task:${task.id}`,
      kind: 'task',
      title: task.description.trim().slice(0, 120),
      why: 'A task on this case is still open.',
      applicantId,
      applicantName,
      ...caseFields(task.missionId),
      dueDate: task.dueDate ? dateOnly(task.dueDate) : null,
      dueState: dueStateFor(days),
      daysUntilDue: days,
      sentBack: false,
      count: null,
      subject: null,
      href: `/app/mission/${task.missionId}`,
      createdAt: task.createdAt.toISOString(),
    });
  }

  // c. Cases changed since the person confirmed them: confirmed once, that confirmation undone by
  // a later change, and no new confirmation since (the case page's own rule).
  const confirmationState = new Map<string, { live: boolean; lastUndone: Date | null }>();
  for (const row of confirmations) {
    const state = confirmationState.get(row.missionId) ?? { live: false, lastUndone: null };
    if (row.invalidatedAt === null) state.live = true;
    else if (!state.lastUndone || row.invalidatedAt > state.lastUndone) {
      state.lastUndone = row.invalidatedAt;
    }
    confirmationState.set(row.missionId, state);
  }
  for (const mission of active) {
    const state = confirmationState.get(mission.id);
    if (!state || state.live || !state.lastUndone) continue;
    push({
      key: `case_changed:${mission.id}`,
      kind: 'case_changed',
      title: 'Changed Since You Confirmed It',
      why: 'Something on this case changed after you confirmed it. Check what changed and confirm again.',
      applicantId,
      applicantName,
      caseId: mission.id,
      caseTitle: mission.title,
      dueDate: null,
      dueState: 'none',
      daysUntilDue: null,
      sentBack: false,
      count: null,
      subject: null,
      href: `/app/mission/${mission.id}`,
      createdAt: state.lastUndone.toISOString(),
    });
  }

  // d. Current documents inside their type's reminder window or past their expiry day. The
  // expiry date is a calendar day like a due date: the document is expired only once that day has
  // ended where the person is (the same `daysUntilDueDay` rule), and it is in the window when the
  // days left are no more than the widest threshold (the window `classifyExpiry` uses for
  // reminders). A document with no expiry date is never read here: an unknown date stays unknown.
  const thresholdsByType = new Map<string, readonly number[]>();
  await Promise.all(
    [...new Set(documents.map((d) => d.docType ?? ''))].map(async (docType) => {
      thresholdsByType.set(docType, await getReminderThresholds(db, docType || null));
    }),
  );
  for (const document of documents) {
    if (!document.expiresAt) continue;
    const thresholds =
      thresholdsByType.get(document.docType ?? '') ?? DEFAULT_EXPIRY_REMINDER_THRESHOLD_DAYS;
    const window = Math.max(0, ...thresholds);
    const days = daysUntilDueDay(document.expiresAt, now, timezone);
    const expired = days < 0;
    if (!expired && days > window) continue;
    push({
      key: `document_expiry:${document.id}`,
      kind: 'document_expiry',
      title: expired ? 'Document Expired' : 'Document Expiring Soon',
      why: expired
        ? 'This document has expired. Add the new one when you have it.'
        : 'This document expires soon. Check whether it needs renewing.',
      applicantId,
      applicantName,
      caseId: null,
      caseTitle: null,
      dueDate: dateOnly(document.expiresAt),
      dueState: expired ? 'overdue' : dueStateFor(days),
      daysUntilDue: days,
      sentBack: false,
      count: null,
      subject: { kind: 'document', docType: document.docType },
      href: `/app/applicant/${applicantId}/expiry`,
      createdAt: document.createdAt.toISOString(),
    });
  }

  // e. Suggested details: one item with the count, never one per suggestion.
  const suggestions = pending[0];
  if (suggestions && suggestions.pending > 0) {
    push({
      key: `suggestions:${applicantId}`,
      kind: 'suggestions',
      title: 'Suggested Details Waiting for Your Decision',
      why: 'Details were read from a document. Nothing is added to the profile until you approve it.',
      applicantId,
      applicantName,
      caseId: null,
      caseTitle: null,
      dueDate: null,
      dueState: 'none',
      daysUntilDue: null,
      sentBack: false,
      count: suggestions.pending,
      subject: null,
      href: `/app/applicant/${applicantId}/documents`,
      createdAt: (suggestions.oldest ?? now).toISOString(),
    });
  }

  return ok({
    applicantId,
    applicantName,
    items: rankAttentionItems(items),
    activeCases: active
      .slice(0, ATTENTION_ACTIVE_CASE_LIMIT)
      .map((m) => ({ id: m.id, title: m.title, state: m.state })),
    activeCaseCount: active.length,
    requests: { waitingOnYou, withAgency },
  });
}

// --- Calendar dates (v1.2 B05 calendar paragraph; ADR 0016 "Calendar export") ---------------

/**
 * When a dated item happens. A due day or an expiry day is a calendar day (`YYYY-MM-DD`). An
 * appointment is a wall-clock local date and time (`YYYY-MM-DDTHH:MM:SS`) in an IANA time zone,
 * exactly as stored; `timeZone` is null when the stored name is not one this runtime recognises,
 * so the time is never moved to a guessed zone.
 */
export type CalendarItemWhen =
  | { readonly kind: 'date'; readonly date: string }
  | {
      readonly kind: 'local';
      readonly localDateTime: string;
      readonly timeZone: string | null;
    };

/**
 * One dated item, neutral: no wording of its own. The web layer turns it into a calendar event
 * through the kinds registry in `@visastack/core/calendar`. Never a note, a task description, an
 * appointment title or place, a saved value, a file name, a document number or an amount.
 */
export interface CalendarItem {
  /** `${kind}:${resourceId}`, stable for the same thing. */
  readonly key: string;
  readonly kind: CalendarKind;
  readonly resourceId: string;
  readonly when: CalendarItemWhen;
  /** The case the item belongs to, when it belongs to one. */
  readonly caseTitle: string | null;
  /** That case's visible code (`C-7K2Q9M`, ADR 0018), when it has one. Never part of the UID. */
  readonly caseReference?: string | null;
  /** When the record last changed (ISO 8601), for the event's SEQUENCE. */
  readonly updatedAt: string;
}

export interface CalendarDates {
  readonly applicantId: string;
  /** Earliest first; on the same day, all-day items before timed ones. */
  readonly items: readonly CalendarItem[];
  /** True when a source held more than `CALENDAR_SOURCE_LIMIT` rows and the latest were left out. */
  readonly truncated: boolean;
}

/** Upper bound on rows read from each of the four sources for one applicant (earliest first). */
export const CALENDAR_SOURCE_LIMIT = 50;

/**
 * How far back the calendar reads, in days before today in the traveller's time zone. Something
 * due or expiring in the last week is still worth a reminder; anything older is left out, so old
 * appointments and long-expired documents never push upcoming dates past the cap.
 */
export const CALENDAR_PAST_DAYS = 7;

/** Longest case title carried on an item, in characters; a longer one is cut. */
const CALENDAR_CASE_TITLE_MAX = 80;

/**
 * A time zone name only if it is a well-formed IANA name this runtime knows (letters, digits,
 * "_", "+", "-" and "/"; no spaces or line breaks), always in its latest official name
 * (`currentTimeZoneName`: "asia/dhaka" and "Asia/Dacca" become "Asia/Dhaka", "Asia/Calcutta"
 * becomes "Asia/Kolkata"); otherwise null. Owner rule, 26 Oct 2026. Used where a zone is saved
 * (appointments, task due zones) and where one is read back to place an appointment in UTC; the
 * zone's clock rules are the same under the old and the current name.
 */
export function recognisedTimeZone(name: string): string | null {
  const trimmed = name.trim();
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(trimmed)) return null;
  return currentTimeZoneName(trimmed);
}

/**
 * A task's due zone in its latest official name when the runtime knows it ("Asia/Dacca" becomes
 * "Asia/Dhaka"); any other value, or none, is kept as before, so a task is never refused here.
 */
export function latestTimeZoneName(name: string | null): string | null {
  if (name === null) return null;
  return recognisedTimeZone(name) ?? name;
}

/** The order key of an item: a date-only key sorts before any time on the same day. */
function calendarSortKey(when: CalendarItemWhen): string {
  return when.kind === 'date' ? when.date : when.localDateTime;
}

export interface CalendarDatesOptions {
  /** The clock for the earliest day read (tests). Access is always decided by the gate. */
  readonly now?: Date;
}

/**
 * The traveller's dated items, for a calendar file (v1.2 B05). The same owner-only rule as
 * `listNeedsAttention`: the proof must be genuine, issued to the applicant's owner, for this
 * applicant; a sharing grant, a copied proof or a proof for another resource is refused. Sources:
 *
 * - appointments on active cases that are open or started, at their stored local date and time
 *   in their stored time zone (the case page lists every appointment to the owner, and the
 *   single-appointment calendar download has the same reach);
 * - open or started tasks with a due day on active cases that the traveller can act on
 *   (unassigned or assigned to the traveller's own account, the Needs Attention rule);
 * - evidence requests that are open or sent back for a fix, with a due day, not on a closed or
 *   cancelled case;
 * - current (not replaced) documents with an expiry day.
 *
 * Anything without a date is not a calendar item, and so is anything dated more than
 * `CALENDAR_PAST_DAYS` before today in the traveller's time zone. Cost: one read for cases, then
 * one each for appointments, tasks, requests and documents, each capped at
 * `CALENDAR_SOURCE_LIMIT` rows, earliest first. Nothing is written.
 */
export async function listCalendarDates(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
  options: CalendarDatesOptions = {},
): Promise<Result<CalendarDates, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(access, 'VIEW_METADATA') ||
    access.actor.kind !== 'applicant_owner' ||
    access.resource.kind !== 'applicant'
  ) {
    return err(serviceError('forbidden', 'calendar dates are available to the owner only'));
  }
  const db = access.tx;
  const applicant = access.applicant;
  const applicantId = applicant.id;
  const readLimit = CALENDAR_SOURCE_LIMIT + 1;
  // The first day read: a week before today where the traveller is. Date-only values are stored
  // as UTC midnight and appointments as a timezone-naive wall clock read in a UTC process, so the
  // same UTC-midnight value bounds both.
  const earliest = new Date(
    (todayIndex(options.now ?? new Date(), applicant.timezone) - CALENDAR_PAST_DAYS) * DAY_MS,
  );

  const missions = await db
    .select({ id: schema.missions.id, title: schema.missions.title, state: schema.missions.state })
    .from(schema.missions)
    .where(eq(schema.missions.applicantId, applicantId));
  const missionById = new Map(missions.map((m) => [m.id, m]));
  // The cases' visible codes (ADR 0018), one query; none before migration 0091.
  const caseCodes = await referenceCodesFor(
    db,
    'C',
    missions.map((m) => m.id),
  );
  const activeIds = missions.filter((m) => !FINISHED_CASE_STATES.has(m.state)).map((m) => m.id);

  const [appointments, tasks, requests, documents] = await Promise.all([
    activeIds.length === 0
      ? []
      : db
          .select({
            id: schema.missionAppointments.id,
            missionId: schema.missionAppointments.missionId,
            localDateTime: schema.missionAppointments.localDateTime,
            timezone: schema.missionAppointments.timezone,
            updatedAt: schema.missionAppointments.updatedAt,
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
            dueDate: schema.missionTasks.dueDate,
            updatedAt: schema.missionTasks.updatedAt,
          })
          .from(schema.missionTasks)
          .where(
            and(
              inArray(schema.missionTasks.missionId, activeIds),
              inArray(schema.missionTasks.status, [...ATTENTION_TASK_STATUSES]),
              gte(schema.missionTasks.dueDate, earliest),
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
        dueDate: schema.evidenceRequests.dueDate,
        updatedAt: schema.evidenceRequests.updatedAt,
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
        expiresAt: schema.documents.expiresAt,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.applicantId, applicantId),
          isNull(schema.documents.supersededByDocumentId),
          gte(schema.documents.expiresAt, earliest),
        ),
      )
      .orderBy(asc(schema.documents.expiresAt), asc(schema.documents.id))
      .limit(readLimit),
  ]);

  const truncated = [appointments, tasks, requests, documents].some(
    (rows) => rows.length > CALENDAR_SOURCE_LIMIT,
  );
  const caseTitle = (missionId: string | null): string | null => {
    const title = missionId ? missionById.get(missionId)?.title.trim() : undefined;
    // Cut by characters, never inside one.
    return title ? Array.from(title).slice(0, CALENDAR_CASE_TITLE_MAX).join('') : null;
  };
  const item = (
    kind: CalendarKind,
    id: string,
    when: CalendarItemWhen,
    missionId: string | null,
    updatedAt: Date,
  ): CalendarItem => ({
    key: `${kind}:${id}`,
    kind,
    resourceId: id,
    when,
    caseTitle: caseTitle(missionId),
    caseReference: missionId ? (caseCodes.get(missionId) ?? null) : null,
    updatedAt: updatedAt.toISOString(),
  });

  const items: CalendarItem[] = [];
  for (const row of appointments.slice(0, CALENDAR_SOURCE_LIMIT)) {
    // Stored timezone-naive and read in a UTC process, so the UTC fields are the wall clock.
    const when: CalendarItemWhen = {
      kind: 'local',
      localDateTime: row.localDateTime.toISOString().slice(0, 19),
      timeZone: recognisedTimeZone(row.timezone),
    };
    items.push(item('appointment', row.id, when, row.missionId, row.updatedAt));
  }
  for (const row of tasks.slice(0, CALENDAR_SOURCE_LIMIT)) {
    if (!row.dueDate) continue;
    const when = { kind: 'date', date: dateOnly(row.dueDate) } as const;
    items.push(item('task_due', row.id, when, row.missionId, row.updatedAt));
  }
  for (const row of requests.slice(0, CALENDAR_SOURCE_LIMIT)) {
    if (!row.dueDate) continue;
    const when = { kind: 'date', date: dateOnly(row.dueDate) } as const;
    items.push(item('request_due', row.id, when, row.missionId, row.updatedAt));
  }
  for (const row of documents.slice(0, CALENDAR_SOURCE_LIMIT)) {
    if (!row.expiresAt) continue;
    const when = { kind: 'date', date: dateOnly(row.expiresAt) } as const;
    items.push(item('document_expires', row.id, when, null, row.updatedAt));
  }

  items.sort(
    (a, b) =>
      compareText(calendarSortKey(a.when), calendarSortKey(b.when)) ||
      compareText(a.kind, b.kind) ||
      compareText(a.key, b.key),
  );
  return ok({ applicantId, items, truncated });
}

/** The audit event a calendar file download writes (one per file, never its contents). */
export const CALENDAR_EXPORTED_EVENT = 'CALENDAR_EXPORTED';

export interface CalendarExportRecord {
  /** How many events the file holds. */
  readonly eventCount: number;
  /** Which kinds of date it holds; unknown names are dropped. */
  readonly kinds: readonly string[];
  /** The page the file came from: the dates page or one appointment. */
  readonly source: 'dates' | 'appointment';
}

/**
 * Records that the owner downloaded a calendar file, as the account data export does: who, for
 * which person (and which case, for one appointment's file), how many events and which kinds. Never a date, a title or a case name, so the audit
 * trail holds no more than the fact of the export. Owner only, through the same proof as
 * `listCalendarDates`; written in its own savepoint on the proof's transaction. A failed write
 * fails the download (the audit is fail-closed, like every other mutation's audit).
 */
export async function recordCalendarExport(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
  record: CalendarExportRecord,
): Promise<Result<void, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(access, 'VIEW_METADATA') ||
    access.actor.kind !== 'applicant_owner' ||
    (access.resource.kind !== 'applicant' && access.resource.kind !== 'mission')
  ) {
    return err(serviceError('forbidden', 'calendar files are available to the owner only'));
  }
  // One appointment's file is checked on its case; the dates file on the person.
  const missionId = access.resource.kind === 'mission' ? access.resource.mission.id : null;
  const eventCount = Number.isInteger(record.eventCount) ? Math.max(0, record.eventCount) : 0;
  if (eventCount === 0)
    return err(serviceError('invalid', 'a calendar file needs at least one date'));
  const kinds = [...new Set(record.kinds.filter((kind) => isCalendarKind(kind)))].sort();
  const applicant = access.applicant;
  try {
    await access.tx.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: CALENDAR_EXPORTED_EVENT,
        actorAccountId: applicant.ownerAccountId,
        actorRole: 'applicant_owner',
        action: 'VIEW_METADATA',
        result: 'ALLOWED',
        method: 'API',
        applicantId: applicant.id,
        resourceType: 'calendar_export',
        resourceId: applicant.id,
        missionId,
        metadata: {
          eventCount,
          kinds,
          source: record.source === 'appointment' ? 'appointment' : 'dates',
        },
      });
    });
  } catch {
    // Fail closed: no entry, no file. The caller shows a plain "try again". The service codes
    // have no "internal"; the database is the dependency that failed.
    return err(serviceError('upstream_error', 'the calendar export could not be recorded'));
  }
  return ok(undefined);
}
