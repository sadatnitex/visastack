import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { SystemScope } from './access';
import { AuthorizedApplicant } from './access/require-access';
import { type Db, schema } from './db';
import { type ExpiryEntry, expiryDay, isTypedMirror, toExpiryEntry } from './document-expiry-rules';
import { documentExpiryEntriesTablePresent } from './document-expiry-tables';
import { classifyExpiry, getReminderThresholds } from './expiry';
import {
  everydayApplicantCondition,
  everydayDocumentCondition,
  presentApplicantCondition,
  presentDocumentCondition,
} from './lifecycle/foundation/conditions';
import { lifecycleTablesPresent } from './lifecycle/foundation/presence';
import {
  getLiveAcknowledgement,
  incrementMaterialRevision,
  missionsSelectingDocument,
} from './material-revision';
import { titleDate } from './naming';
import {
  AGENCY_ACCESS_ENDING_EVENT,
  GRANT_ENDING_EVENT,
  enqueueNotificationBothChannels,
} from './notifications';
import { listRequirementDetails } from './pack-rule-details';
import { recordProductEvent } from './product-events';
import { INACTIVE_CASE_STATES, packageTablesPresent } from './umpe-package-tables';

/**
 * NTF-04 (Part 5 §4) "Timing": the periodic sweeps that turn NTF-01's
 * expiry classification and a mission task's own due date into an actual
 * enqueued reminder. "Subject timezone drives date notifications... Use
 * local-date thresholds. DST must not duplicate... Scheduler recovery:
 * send only still-relevant notifications; do not flood every historically
 * missed threshold."
 *
 * Both sweeps below rely entirely on `notifications.ts`'s own idempotency
 * key (event + recipient + channel + resource + threshold) for
 * "send only once per threshold, never flood, safe to re-run": a sweep can
 * run every hour, or resume after being down for a week, and re-attempting
 * an already-notified threshold is always a silent, safe no-op via `ON
 * CONFLICT DO NOTHING` -- no separate "already sent" bookkeeping needed
 * here, and a missed threshold is simply never retroactively sent, which is
 * exactly "do not flood every historically missed threshold."
 */

// --- Local-date math (DST-safe) -------------------------------------------

/**
 * The subject's own calendar date in `timezone`, as Y/M/D integers --
 * deliberately never raw millisecond arithmetic on the underlying instant,
 * which a DST transition would corrupt (a "day" is not always 24 hours of
 * wall-clock time). `en-CA` conveniently formats as `YYYY-MM-DD`. Also read by
 * `attention.ts` (Needs Attention) for "today" in the person's own time zone.
 */
export function toLocalDateParts(
  date: Date,
  timezone: string,
): { readonly year: number; readonly month: number; readonly day: number } {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const [year, month, day] = formatted.split('-').map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

/**
 * Whole calendar-day difference between two instants IN a given timezone
 * (`to` minus `from`), computed from Y/M/D parts anchored to UTC purely for
 * subtraction -- never from the raw millisecond gap between the instants
 * themselves, which is what would make a 23- or 25-hour DST day miscount.
 */
export function localDateDiffInDays(from: Date, to: Date, timezone: string): number {
  const a = toLocalDateParts(from, timezone);
  const b = toLocalDateParts(to, timezone);
  const aUtc = Date.UTC(a.year, a.month - 1, a.day);
  const bUtc = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((bUtc - aUtc) / (24 * 60 * 60 * 1000));
}

/** "Bounded weekly overdue follow-up" -- not itself given an exact bound by the directive; 4 (about a month) is a provisional, documented default. */
const MAX_OVERDUE_WEEKLY_FOLLOWUPS = 4;

/**
 * "Tasks: 7 days before; 1 day before; overdue; bounded weekly overdue
 * follow-up." Returns the specific threshold crossed today, in this
 * timezone, or `null` if none applies right now. `overdue_0` fires the day
 * the due date arrives or has just passed; `overdue_1`/`overdue_2`/...
 * fire on each subsequent local-calendar week, capped at
 * `MAX_OVERDUE_WEEKLY_FOLLOWUPS`.
 */
export function computeTaskDeadlineThreshold(
  dueDate: Date,
  timezone: string,
  now: Date,
): string | null {
  const daysRemaining = localDateDiffInDays(now, dueDate, timezone);
  if (daysRemaining === 7) return 'due_7d';
  if (daysRemaining === 1) return 'due_1d';
  if (daysRemaining > 0) return null;
  const weeksOverdue = Math.floor(-daysRemaining / 7);
  if (weeksOverdue > MAX_OVERDUE_WEEKLY_FOLLOWUPS) return null;
  return `overdue_${weeksOverdue}`;
}

// --- Task deadline sweep ---------------------------------------------------

export interface SweepResult {
  readonly checked: number;
  readonly enqueued: number;
}

const TASK_SUBJECT = {
  upcoming: 'Task due soon',
  today: 'Task due today',
  overdue: 'Overdue task on your case',
} as const;

function taskSummary(caseTitle: string, day: string, timing: keyof typeof TASK_SUBJECT): string {
  if (timing === 'today') return `A task on "${caseTitle}" is due today, ${day}.`;
  if (timing === 'overdue') return `A task on "${caseTitle}" was due on ${day}.`;
  return `A task on "${caseTitle}" is due on ${day}.`;
}

/**
 * Walks every OPEN/IN_PROGRESS task with a due date and enqueues a reminder
 * for whichever threshold today crosses, in the task's own `dueTimezone`
 * (falling back to its applicant's `timezone`). Safe to call on any cadence
 * ("date checks at least hourly") -- idempotency, not call frequency, is
 * what prevents duplicates.
 */
export async function sweepTaskDeadlineReminders(
  db: Db,
  now: Date,
  options: { readonly limit?: number } = {},
): Promise<SweepResult> {
  const rows = await db
    .select({
      taskId: schema.missionTasks.id,
      dueDate: schema.missionTasks.dueDate,
      dueTimezone: schema.missionTasks.dueTimezone,
      missionId: schema.missionTasks.missionId,
      missionTitle: schema.missions.title,
      applicantId: schema.missions.applicantId,
      organizationId: schema.missions.ownerOrganizationId,
      ownerAccountId: schema.applicants.ownerAccountId,
      applicantTimezone: schema.applicants.timezone,
    })
    .from(schema.missionTasks)
    .innerJoin(schema.missions, eq(schema.missions.id, schema.missionTasks.missionId))
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.missions.applicantId))
    .where(
      and(
        isNotNull(schema.missionTasks.dueDate),
        or(eq(schema.missionTasks.status, 'OPEN'), eq(schema.missionTasks.status, 'IN_PROGRESS')),
        // A traveller record in Recently Deleted or being removed gets no reminders. An archived
        // one still does: its open cases carry on.
        (await lifecycleTablesPresent(db)) ? presentApplicantCondition() : undefined,
      ),
    )
    .limit(options.limit ?? 200);

  let enqueued = 0;
  for (const row of rows) {
    const dueDate = row.dueDate;
    if (!dueDate) continue;
    const timezone = row.dueTimezone ?? row.applicantTimezone;
    const threshold = computeTaskDeadlineThreshold(dueDate, timezone, now);
    if (!threshold) continue;
    const daysLeft = localDateDiffInDays(now, dueDate, timezone);
    const timing = daysLeft > 0 ? 'upcoming' : daysLeft === 0 ? 'today' : 'overdue';

    await db.transaction(async (tx) => {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'TASK_DEADLINE',
        resourceId: row.taskId,
        recipientAccountId: row.ownerAccountId,
        threshold,
        applicantId: row.applicantId,
        missionId: row.missionId,
        payload: {
          subject: TASK_SUBJECT[timing],
          // The date only, never the task's own words (they can be private).
          summary: taskSummary(row.missionTitle, titleDate(dueDate, timezone), timing),
          timing,
          deepLinkPath: `/app/mission/${row.missionId}`,
        },
      });
      // OPS-04 overdue tasks: the first sweep that finds a task past its due
      // date records it. The sweep revisits an overdue task on every run (the
      // notification above is deduplicated the same way), and `onceFor` makes
      // those repeat visits record nothing further.
      if (threshold.startsWith('overdue')) {
        await recordProductEvent(tx, {
          eventType: 'TASK_OVERDUE',
          accountId: row.ownerAccountId,
          organizationId: row.organizationId,
          onceFor: row.taskId,
        });
      }
    });
    enqueued++;
  }
  return { checked: rows.length, enqueued };
}

// --- Sharing ends soon sweep ------------------------------------------------

/** The reminder window: from the day before a grant ends back to this many local days ahead. */
export const GRANT_ENDING_REMINDER_DAYS = 7;

/**
 * More than one reminder per grant is never wanted, so a grant that runs for the reminder window
 * or less in total (a short share on purpose) is not reminded on the day it starts.
 */
const GRANT_REMINDER_MIN_LENGTH_MS = GRANT_ENDING_REMINDER_DAYS * 24 * 60 * 60 * 1000;

/** The coarse database filter: wider than the window so any time zone's local day still falls inside. */
const GRANT_REMINDER_PREFILTER_DAYS = GRANT_ENDING_REMINDER_DAYS + 2;
const GRANT_REMINDER_PREFILTER_MS = GRANT_REMINDER_PREFILTER_DAYS * 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of a date in a time zone: the same local day always makes the same key. */
function localDateKey(date: Date, timezone: string): string {
  const { year, month, day } = toLocalDateParts(date, timezone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Another live grant from the same traveller to the same recipient that reaches these cases and ends later (or never). */
async function laterGrantOutlasts(
  db: Db,
  row: {
    readonly grantId: string;
    readonly applicantId: string;
    readonly missionId: string | null;
    readonly organizationId: string | null;
    readonly recipientAccountId: string | null;
  },
  expiryAt: Date,
  now: Date,
): Promise<boolean> {
  const grants = schema.grants;
  const sameRecipient = row.organizationId
    ? eq(grants.recipientOrganizationId, row.organizationId)
    : row.recipientAccountId
      ? eq(grants.recipientAccountId, row.recipientAccountId)
      : undefined;
  if (!sameRecipient) return false;
  const found = await db
    .select({ id: grants.id })
    .from(grants)
    .where(
      and(
        eq(grants.applicantId, row.applicantId),
        sameRecipient,
        ne(grants.id, row.grantId),
        eq(grants.status, 'ACTIVE'),
        isNotNull(grants.acceptedAt),
        lte(grants.startAt, now),
        or(isNull(grants.expiryAt), gt(grants.expiryAt, expiryAt)),
        // An all-cases grant reaches everything; a one-case grant reaches only its own case.
        row.missionId
          ? or(isNull(grants.missionId), eq(grants.missionId, row.missionId))
          : isNull(grants.missionId),
      ),
    )
    .limit(1);
  return found.length > 0;
}

/**
 * A week before an active sharing grant ends, tell the traveller who owns it, and for an agency's
 * grant the agency's active owners and admins too, in the app and by email. Fires on any local day
 * from 7 down to 1 days ahead (so a missed run is caught up), but the key is the local end date,
 * so each end date is reminded once: extending the grant moves the date and earns a new reminder.
 *
 * Only ACTIVE, accepted grants with an end date still ahead are looked at. A paused one is not
 * reminded (it cannot be extended until it is resumed), and revoked, pending or ended ones are
 * over. The agency's note is checked again when sent (the grant must still reach the case), so a
 * pause or revoke in between stops it. Grants with no end date have nothing to remind about.
 */
export async function sweepGrantExpiryReminders(
  db: Db,
  scope: SystemScope<'process-notification-sweeps'>,
  now: Date,
  options: { readonly limit?: number } = {},
): Promise<SweepResult> {
  if (!SystemScope.isGenuine(scope) || scope.job !== 'process-notification-sweeps') {
    return { checked: 0, enqueued: 0 };
  }
  const grants = schema.grants;
  const rows = await db
    .select({
      grantId: grants.id,
      applicantId: grants.applicantId,
      missionId: grants.missionId,
      organizationId: grants.recipientOrganizationId,
      recipientAccountId: grants.recipientAccountId,
      expiryAt: grants.expiryAt,
      acceptedAt: grants.acceptedAt,
      startAt: grants.startAt,
      ownerAccountId: schema.applicants.ownerAccountId,
      applicantName: schema.applicants.displayName,
      timezone: schema.applicants.timezone,
      organizationName: schema.organizations.name,
      recipientEmail: schema.accounts.email,
    })
    .from(grants)
    .innerJoin(schema.applicants, eq(schema.applicants.id, grants.applicantId))
    .leftJoin(schema.organizations, eq(schema.organizations.id, grants.recipientOrganizationId))
    .leftJoin(schema.accounts, eq(schema.accounts.id, grants.recipientAccountId))
    .where(
      and(
        eq(grants.status, 'ACTIVE'),
        isNotNull(grants.acceptedAt),
        isNotNull(grants.expiryAt),
        gt(grants.expiryAt, now),
        lte(grants.expiryAt, new Date(now.getTime() + GRANT_REMINDER_PREFILTER_MS)),
        // Already reminded for this end date: a reminder made inside the window before the end.
        // An extension moves the end 30 days out, so an earlier reminder never counts again.
        sql`not exists (select 1 from ${schema.notifications} where ${schema.notifications.resourceId} = ${grants.id}::text and ${schema.notifications.eventType} = ${GRANT_ENDING_EVENT} and ${schema.notifications.createdAt} > ${grants.expiryAt} - (${GRANT_REMINDER_PREFILTER_DAYS} * interval '1 day'))`,
        (await lifecycleTablesPresent(db)) ? presentApplicantCondition() : undefined,
      ),
    )
    .orderBy(asc(grants.expiryAt), asc(grants.id))
    .limit(options.limit ?? 500);

  // One lookup of an agency's owners and admins per run, however many of its grants end.
  const adminsByOrganization = new Map<string, readonly string[]>();
  const adminsOf = async (tx: Db, organizationId: string): Promise<readonly string[]> => {
    const known = adminsByOrganization.get(organizationId);
    if (known) return known;
    const admins = await tx
      .select({ accountId: schema.memberships.accountId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.organizationId, organizationId),
          eq(schema.memberships.active, true),
          inArray(schema.memberships.role, ['OWNER', 'ADMIN']),
        ),
      );
    const accountIds = admins.map((admin) => admin.accountId);
    adminsByOrganization.set(organizationId, accountIds);
    return accountIds;
  };

  let enqueued = 0;
  for (const row of rows) {
    const expiryAt = row.expiryAt;
    if (!expiryAt) continue;
    const daysLeft = localDateDiffInDays(now, expiryAt, row.timezone);
    if (daysLeft < 1 || daysLeft > GRANT_ENDING_REMINDER_DAYS) continue;
    const startedAt = row.acceptedAt ?? row.startAt;
    if (expiryAt.getTime() - startedAt.getTime() <= GRANT_REMINDER_MIN_LENGTH_MS) continue;
    // Sharing again was the only way to renew before extending existed: another live grant to the
    // same recipient that reaches the same cases and ends later means this one is not the end.
    if (await laterGrantOutlasts(db, row, expiryAt, now)) continue;

    const day = titleDate(expiryAt, row.timezone);
    const threshold = `ends_7d:${localDateKey(expiryAt, row.timezone)}`;
    const recipientLabel =
      row.organizationName ?? row.recipientEmail ?? 'the person you shared with';

    enqueued += await db.transaction(async (tx) => {
      let written = await enqueueNotificationBothChannels(tx, {
        eventType: GRANT_ENDING_EVENT,
        resourceId: row.grantId,
        recipientAccountId: row.ownerAccountId,
        threshold,
        applicantId: row.applicantId,
        payload: {
          subject: 'Your Sharing Ends Soon',
          summary: `Your sharing with ${recipientLabel} ends on ${day}. You can keep it going for 30 more days.`,
          emailSummary: `Your sharing with an agency or person ends on ${day}. You can keep it going for 30 more days.`,
          deepLinkPath: `/app/applicant/${row.applicantId}/sharing#extend-grant-${row.grantId}`,
        },
      });
      const organizationId = row.organizationId;
      if (organizationId) {
        for (const adminAccountId of await adminsOf(tx, organizationId)) {
          written += await enqueueNotificationBothChannels(tx, {
            eventType: AGENCY_ACCESS_ENDING_EVENT,
            resourceId: row.grantId,
            recipientAccountId: adminAccountId,
            threshold,
            applicantId: row.applicantId,
            organizationId,
            // A case-scoped grant is rechecked against that case when the note is sent.
            ...(row.missionId ? { missionId: row.missionId } : {}),
            payload: {
              subject: 'Client Access Ends Soon',
              summary: `Access to ${row.applicantName} ends on ${day}. The traveller can extend it.`,
              emailSummary: `Access to one of your clients ends on ${day}. Only the traveller can extend it.`,
              deepLinkPath: row.missionId
                ? `/app/agency/${organizationId}/cases#mission-${row.missionId}`
                : `/app/agency/${organizationId}/cases`,
            },
          });
        }
      }
      return written;
    });
  }
  return { checked: rows.length, enqueued };
}

// --- Expiry reminder sweep --------------------------------------------------

/**
 * Where an expiry reminder leads. With the resource lifecycle in place it opens Replace With a
 * Newer Document on that document (the Documents page's `?manage=&action=` link); before
 * migration 0113 there is no Replace flow yet, so it leads to the expiry list as before.
 */
export function expiryReminderPath(
  applicantId: string,
  documentId: string,
  lifecycle: boolean,
): string {
  if (!lifecycle) return `/app/applicant/${applicantId}/expiry`;
  const query = new URLSearchParams({ manage: documentId, action: 'REPLACE' });
  return `/app/applicant/${applicantId}/documents?${query.toString()}`;
}

export interface ExpirySweepResult extends SweepResult {
  /** Missions whose live acknowledgement was invalidated this run because selected evidence expired (directive Part 7 §5). */
  readonly missionsDirtied: number;
}

/**
 * Walks every current (non-superseded) document with a known intrinsic
 * expiry and every issuer verification with its `validUntil`, and enqueues
 * a reminder for whichever threshold today crosses -- NTF-01's
 * `classifyExpiry` decides the threshold; this sweep only decides whether
 * to enqueue it. "Unknown expiry remains unknown": a document with no
 * `expiresAt` is never visited here at all, never guessed at.
 *
 * Also directive Part 7 §5 ("If selected passport/evidence expires... mark
 * case dirty and invalidate submission-ready use"): once a document's own
 * classification reaches `expired` (not merely `reminder` -- this is a real,
 * past-tense event, distinct from the countdown ladder above), every mission
 * currently selecting it (`missionsSelectingDocument`) with a still-live
 * acknowledgement has that acknowledgement invalidated via
 * `incrementMaterialRevision`, the exact mechanism every other material
 * change already uses. Self-limiting without a new tracking column: once
 * invalidated, `getLiveAcknowledgement` returns nothing for that mission on
 * every later run, so this becomes a no-op until someone re-acknowledges
 * (over still-expired evidence, which the next run then correctly
 * invalidates again) -- continuous enforcement for as long as the underlying
 * defect persists, never a one-time flag that goes stale itself.
 */
export async function sweepExpiryReminders(
  db: Db,
  now: Date,
  options: { readonly limit?: number } = {},
): Promise<ExpirySweepResult> {
  // Resource lifecycle (migration 0113). A document in Recently Deleted or being removed, or of a
  // traveller record that is, is never visited. An archived document, or any document of an
  // archived traveller, still makes the cases that chose it need confirming again once it expires
  // (an explicit choice stays where it was made, owner decision D6), but sends no reminder.
  // Without the tables every document is current, exactly as before.
  const lifecycle = await lifecycleTablesPresent(db);
  const documentRows = await db
    .select({
      documentId: schema.documents.id,
      docType: schema.documents.docType,
      expiresAt: schema.documents.expiresAt,
      applicantId: schema.documents.applicantId,
      ownerAccountId: schema.applicants.ownerAccountId,
      displayName: schema.documents.originalName,
      everyday: lifecycle
        ? sql<boolean>`(${everydayDocumentCondition()} and ${everydayApplicantCondition()})`
        : sql<boolean>`true`,
    })
    .from(schema.documents)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.documents.applicantId))
    .where(
      and(
        isNotNull(schema.documents.expiresAt),
        isNull(schema.documents.supersededByDocumentId),
        lifecycle ? presentDocumentCondition() : undefined,
        lifecycle ? presentApplicantCondition() : undefined,
      ),
    )
    .limit(options.limit ?? 200);

  // A date the person typed can be corrected, and a corrected date must be reminded about again:
  // its reminders carry the day in their key. Every other date keeps the key it always had, so
  // nothing already sent is sent twice.
  const typedMirrors = new Set<string>();
  if (documentRows.length > 0 && (await documentExpiryEntriesTablePresent(db))) {
    const entryRows = await db
      .select({
        documentId: schema.documentExpiryEntries.documentId,
        source: schema.documentExpiryEntries.source,
        expiresOn: schema.documentExpiryEntries.expiresOn,
        mirrored: schema.documentExpiryEntries.mirrored,
      })
      .from(schema.documentExpiryEntries)
      .where(
        inArray(
          schema.documentExpiryEntries.documentId,
          documentRows.map((row) => row.documentId),
        ),
      )
      .orderBy(desc(schema.documentExpiryEntries.createdAt), desc(schema.documentExpiryEntries.id));
    const newestFirst = new Map<string, ExpiryEntry[]>();
    for (const entry of entryRows) {
      const list = newestFirst.get(entry.documentId) ?? [];
      list.push(toExpiryEntry(entry));
      newestFirst.set(entry.documentId, list);
    }
    for (const row of documentRows) {
      if (isTypedMirror(row.expiresAt, newestFirst.get(row.documentId) ?? [])) {
        typedMirrors.add(row.documentId);
      }
    }
  }

  let enqueued = 0;
  let missionsDirtied = 0;
  for (const row of documentRows) {
    if (!row.expiresAt) continue;
    const thresholds = await getReminderThresholds(db, row.docType);
    const classification = classifyExpiry(row.expiresAt, now, thresholds);

    if (classification.urgency === 'expired') {
      for (const missionId of await missionsSelectingDocument(db, row.documentId)) {
        const live = await getLiveAcknowledgement(db, missionId);
        if (!live) continue;
        await db.transaction(async (tx) => {
          await incrementMaterialRevision(tx, missionId);
        });
        missionsDirtied++;
      }
    }

    if (classification.urgency !== 'reminder' || classification.thresholdCrossed === null) continue;
    if (row.everyday !== true) continue;

    const expiresOn = expiryDay(row.expiresAt);
    await db.transaction(async (tx) => {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'DOCUMENT_EXPIRY',
        resourceId: row.documentId,
        recipientAccountId: row.ownerAccountId,
        threshold: typedMirrors.has(row.documentId)
          ? `${classification.thresholdCrossed}@${expiresOn}`
          : String(classification.thresholdCrossed),
        applicantId: row.applicantId,
        payload: {
          subject: 'A document is expiring soon',
          summary: `"${row.displayName}" is expiring soon -- check whether it needs renewing.`,
          deepLinkPath: expiryReminderPath(row.applicantId, row.documentId, lifecycle),
        },
      });
    });
    enqueued++;
  }

  const verificationRows = await db
    .select({
      verificationId: schema.issuerVerifications.id,
      validUntil: schema.issuerVerifications.validUntil,
      applicantId: schema.issuerVerifications.applicantId,
      ownerAccountId: schema.applicants.ownerAccountId,
      issuerIdentity: schema.issuerVerifications.issuerIdentity,
    })
    .from(schema.issuerVerifications)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.issuerVerifications.applicantId))
    .where(
      lifecycle
        ? and(
            everydayApplicantCondition(),
            // A confirmation about a document that is archived, in Recently Deleted or being
            // removed sends no reminder either.
            sql`(${schema.issuerVerifications.documentId} is null or exists (select 1 from ${schema.documents} where ${schema.documents.id} = ${schema.issuerVerifications.documentId} and ${everydayDocumentCondition()}))`,
          )
        : undefined,
    )
    .limit(options.limit ?? 200);

  for (const row of verificationRows) {
    const classification = classifyExpiry(row.validUntil, now);
    if (classification.urgency !== 'reminder' || classification.thresholdCrossed === null) continue;

    await db.transaction(async (tx) => {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'VERIFICATION_EXPIRY',
        resourceId: row.verificationId,
        recipientAccountId: row.ownerAccountId,
        threshold: String(classification.thresholdCrossed),
        applicantId: row.applicantId,
        payload: {
          subject: 'An issuer confirmation is expiring soon',
          summary: `The confirmation from "${row.issuerIdentity}" is expiring soon.`,
          deepLinkPath: `/app/applicant/${row.applicantId}/expiry`,
        },
      });
    });
    enqueued++;
  }

  return { checked: documentRows.length + verificationRows.length, enqueued, missionsDirtied };
}

// --- UMPE G2 (R22): a case-aware expiry check -------------------------------------------------------

/** One document chosen for a case that stops being valid before the case needs it to. */
export interface CaseExpiryConflict {
  readonly documentId: string;
  readonly displayName: string;
  readonly expiresAt: Date;
  /** The case's travel end date, plus any months the checklist says it must stay valid after. */
  readonly neededUntil: Date;
}

/** The same calendar day `months` later in UTC, clamped to the month's last day. */
function addUtcMonths(date: Date, months: number): Date {
  if (months === 0) return date;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    ),
  );
}

const INACTIVE_STATES: ReadonlySet<string> = new Set(INACTIVE_CASE_STATES);

/**
 * Documents chosen for this case that expire before its travel end date, or before the months
 * after it that the checklist declares (`valid_months_after_travel`). The fixed 90/60/30/7/0 day
 * reminders and the expiry centre stay as they are; this answers only "will it last this trip".
 *
 * Read through the case owner's own gate proof (mission scope); any other proof gets nothing, as
 * the trip checks do. Only choices for items of the checklist the case uses now count, and not an
 * item left out of the package. Nothing is returned for a case that is closed, cancelled or handed
 * in, or that has no travel end date or checklist (an unknown date is never guessed). One entry per document, however many checklist items chose it. Never raises on a
 * database without the G2 tables: a missing validity rule reads as "until the trip ends".
 */
export async function caseExpiryConflicts(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<readonly CaseExpiryConflict[]> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') ||
    proof.actor.kind !== 'applicant_owner' ||
    proof.resource.kind !== 'mission'
  ) {
    return [];
  }
  const mission = proof.resource.mission;
  if (INACTIVE_STATES.has(mission.state) || !mission.travelEndDate || !mission.packVersionId) {
    return [];
  }
  const travelEnd = mission.travelEndDate;
  const db = proof.tx;
  const [lifecycle, packageTables] = await Promise.all([
    lifecycleTablesPresent(db),
    packageTablesPresent(db),
  ]);
  const rows = await db
    .select({
      documentId: schema.documents.id,
      displayName: schema.documents.originalName,
      expiresAt: schema.documents.expiresAt,
      packRequirementId: schema.selectedEvidence.packRequirementId,
    })
    .from(schema.selectedEvidence)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.selectedEvidence.documentId))
    // Only items of the checklist the case uses now: a choice left from an earlier checklist
    // asks nothing of this trip.
    .innerJoin(
      schema.packRequirements,
      eq(schema.packRequirements.id, schema.selectedEvidence.packRequirementId),
    )
    .where(
      and(
        eq(schema.selectedEvidence.missionId, mission.id),
        eq(schema.packRequirements.packVersionId, mission.packVersionId),
        eq(schema.documents.applicantId, proof.applicant.id),
        isNotNull(schema.documents.expiresAt),
        lifecycle ? presentDocumentCondition() : undefined,
        // An item the person left out of the package (UMPE P4 Exclude) needs no document.
        packageTables
          ? sql`not exists (select 1 from ${schema.umpePackageChoices} where ${schema.umpePackageChoices.missionId} = ${mission.id} and ${schema.umpePackageChoices.packRequirementId} = ${schema.selectedEvidence.packRequirementId} and ${schema.umpePackageChoices.choice} = 'EXCLUDE' and ${schema.umpePackageChoices.supersededAt} is null)`
          : undefined,
      ),
    )
    .limit(200);
  if (rows.length === 0) return [];
  const details = await listRequirementDetails(
    db,
    rows.map((row) => row.packRequirementId),
  );
  const byDocument = new Map<string, CaseExpiryConflict>();
  for (const row of rows) {
    if (!row.expiresAt) continue;
    const months = details.get(row.packRequirementId)?.validMonthsAfterTravel ?? 0;
    const neededUntil = addUtcMonths(travelEnd, months);
    if (row.expiresAt.getTime() >= neededUntil.getTime()) continue;
    const seen = byDocument.get(row.documentId);
    if (seen && seen.neededUntil.getTime() >= neededUntil.getTime()) continue;
    byDocument.set(row.documentId, {
      documentId: row.documentId,
      displayName: row.displayName,
      expiresAt: row.expiresAt,
      neededUntil,
    });
  }
  return [...byDocument.values()].sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
}
