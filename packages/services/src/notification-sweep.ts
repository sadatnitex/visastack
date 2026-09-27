import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { type Db, schema } from './db';
import { classifyExpiry, getReminderThresholds } from './expiry';
import {
  getLiveAcknowledgement,
  incrementMaterialRevision,
  missionsSelectingDocument,
} from './material-revision';
import { enqueueNotificationBothChannels } from './notifications';

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
 * wall-clock time). `en-CA` conveniently formats as `YYYY-MM-DD`.
 */
function toLocalDateParts(
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
function localDateDiffInDays(from: Date, to: Date, timezone: string): number {
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
      ),
    )
    .limit(options.limit ?? 200);

  let enqueued = 0;
  for (const row of rows) {
    if (!row.dueDate) continue;
    const timezone = row.dueTimezone ?? row.applicantTimezone;
    const threshold = computeTaskDeadlineThreshold(row.dueDate, timezone, now);
    if (!threshold) continue;

    await db.transaction(async (tx) => {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'TASK_DEADLINE',
        resourceId: row.taskId,
        recipientAccountId: row.ownerAccountId,
        threshold,
        applicantId: row.applicantId,
        missionId: row.missionId,
        payload: {
          subject: threshold.startsWith('overdue') ? 'Overdue task on your case' : 'Task due soon',
          summary: `A task on "${row.missionTitle}" needs your attention.`,
          deepLinkPath: `/app/mission/${row.missionId}`,
        },
      });
    });
    enqueued++;
  }
  return { checked: rows.length, enqueued };
}

// --- Expiry reminder sweep --------------------------------------------------

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
  const documentRows = await db
    .select({
      documentId: schema.documents.id,
      docType: schema.documents.docType,
      expiresAt: schema.documents.expiresAt,
      applicantId: schema.documents.applicantId,
      ownerAccountId: schema.applicants.ownerAccountId,
      displayName: schema.documents.originalName,
    })
    .from(schema.documents)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.documents.applicantId))
    .where(
      and(isNotNull(schema.documents.expiresAt), isNull(schema.documents.supersededByDocumentId)),
    )
    .limit(options.limit ?? 200);

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

    await db.transaction(async (tx) => {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'DOCUMENT_EXPIRY',
        resourceId: row.documentId,
        recipientAccountId: row.ownerAccountId,
        threshold: String(classification.thresholdCrossed),
        applicantId: row.applicantId,
        payload: {
          subject: 'A document is expiring soon',
          summary: `"${row.displayName}" is expiring soon -- check whether it needs renewing.`,
          deepLinkPath: `/app/applicant/${row.applicantId}/expiry`,
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
