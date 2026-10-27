import { randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Staff view of application email that did not arrive (Email Delivery page).
 *
 * Every application email goes through the `notifications` outbox. This module reads only the
 * delivery facts staff need to act on (kind, status, tries, last diagnostic, timing) and the
 * domain part of a stored recipient address. It never reads the full address or the message
 * payload, so the page cannot show either. Sending again is limited to FAILED rows: a BOUNCED
 * row means the receiving address refused the email, and repeating it would not help and could
 * harm the sending reputation.
 */

/** How many rows each list shows. */
export const EMAIL_DELIVERY_LIST_LIMIT = 50;

/** An email still QUEUED after this long is shown as waiting. */
export const EMAIL_DELIVERY_WAITING_AFTER_MS = 10 * 60 * 1000;

/** The counts cover this window ("today" on the page). */
export const EMAIL_DELIVERY_DAY_MS = 24 * 60 * 60 * 1000;

export const EMAIL_RESEND_REFUSED = {
  notFound: 'email not found',
  notEmail: 'only an email can be sent again',
  bounced: 'the receiving address refused this email, so it cannot be sent again',
  notFailed: 'only an email that failed can be sent again',
  noLongerValid: 'what this email was about no longer applies, so it cannot be sent again',
} as const;

/** Failures that sending again cannot fix: the invitation or person is no longer valid. */
const FINAL_FAILURES = new Set(['recipient no longer authorized', 'no recipient email resolvable']);

export interface EmailDeliveryRow {
  readonly id: string;
  readonly eventType: string;
  readonly status: (typeof schema.notificationDeliveryStatus.enumValues)[number];
  readonly attempts: number;
  readonly lastError: string | null;
  readonly createdAt: Date;
  readonly nextAttemptAt: Date;
  /** Only the part after `@` of the stored recipient address, lower case; null when none is stored. */
  readonly recipientDomain: string | null;
}

export interface EmailDeliveryCounts {
  readonly sentToday: number;
  readonly deliveredToday: number;
  readonly failedToday: number;
  readonly waitingNow: number;
}

export interface EmailDeliveryProblems {
  readonly failed: readonly EmailDeliveryRow[];
  readonly waiting: readonly EmailDeliveryRow[];
  readonly counts: EmailDeliveryCounts;
}

// The full address never leaves the database: only its domain is selected. Built per call, never
// at module load (tests that stub the database would crash on import).
function rowColumns() {
  const n = schema.notifications;
  return {
    id: n.id,
    eventType: n.eventType,
    status: n.status,
    attempts: n.attempts,
    lastError: n.lastError,
    createdAt: n.createdAt,
    nextAttemptAt: n.nextAttemptAt,
    recipientDomain: sql<
      string | null
    >`nullif(lower(split_part(coalesce(${n.recipientEmail}, ''), '@', 2)), '')`,
  };
}

/** Failed and long-waiting application emails, newest failures first, oldest waiting first. */
export async function listEmailDeliveryProblems(
  db: Db,
  staff: StaffScope<'PROCESSING_JOB_RETRY'>,
  now: Date = new Date(),
): Promise<Result<EmailDeliveryProblems, ServiceError>> {
  const problem = staffScopeProblem(staff, 'PROCESSING_JOB_RETRY');
  if (problem) return err(problem);
  // Read here, never at module load: tests that stub the database would crash on import.
  const n = schema.notifications;

  const waitingBefore = new Date(now.getTime() - EMAIL_DELIVERY_WAITING_AFTER_MS);
  const since = new Date(now.getTime() - EMAIL_DELIVERY_DAY_MS).toISOString();

  const [failed, waiting, totals] = await Promise.all([
    db
      .select(rowColumns())
      .from(n)
      .where(and(eq(n.channel, 'EMAIL'), inArray(n.status, ['FAILED', 'BOUNCED'])))
      .orderBy(desc(n.createdAt), desc(n.id))
      .limit(EMAIL_DELIVERY_LIST_LIMIT),
    db
      .select(rowColumns())
      .from(n)
      .where(and(eq(n.channel, 'EMAIL'), eq(n.status, 'QUEUED'), lt(n.createdAt, waitingBefore)))
      .orderBy(asc(n.createdAt), asc(n.id))
      .limit(EMAIL_DELIVERY_LIST_LIMIT),
    db
      .select({
        sentToday: sql<number>`count(*) filter (where ${n.sentAt} >= ${since}::timestamptz)`,
        deliveredToday: sql<number>`count(*) filter (where ${n.deliveredAt} >= ${since}::timestamptz)`,
        // A failure has no time of its own: count the ones created in the window, and bounces
        // by when the bounce arrived.
        // No failed-at time is stored: a FAILED row's last activity is its last scheduled try (or
        // its send, for one the mail service took and then reported as failed).
        failedToday: sql<number>`count(*) filter (where (${n.status} = 'FAILED' and greatest(${n.createdAt}, ${n.nextAttemptAt}, coalesce(${n.sentAt}, ${n.createdAt})) >= ${since}::timestamptz) or (${n.status} = 'BOUNCED' and coalesce(${n.bouncedAt}, ${n.createdAt}) >= ${since}::timestamptz))`,
        waitingNow: sql<number>`count(*) filter (where ${n.status} = 'QUEUED')`,
      })
      .from(n)
      .where(eq(n.channel, 'EMAIL')),
  ]);

  const total = first(totals);
  return ok({
    failed: failed.map(toRow),
    waiting: waiting.map(toRow),
    counts: {
      sentToday: Number(total?.sentToday ?? 0),
      deliveredToday: Number(total?.deliveredToday ?? 0),
      failedToday: Number(total?.failedToday ?? 0),
      waitingNow: Number(total?.waitingNow ?? 0),
    },
  });
}

function toRow(row: {
  id: string;
  eventType: string;
  status: EmailDeliveryRow['status'];
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  nextAttemptAt: Date;
  recipientDomain: string | null;
}): EmailDeliveryRow {
  return {
    id: row.id,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: new Date(row.createdAt),
    nextAttemptAt: new Date(row.nextAttemptAt),
    recipientDomain: row.recipientDomain ?? null,
  };
}

export interface ResendEmailInput {
  readonly notificationId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Put one FAILED application email back in the outbox with a fresh set of tries, and record who
 * asked. The send itself happens on the next worker pass, which re-checks that the recipient is
 * still allowed to receive it. The row is locked and its state re-checked inside the transaction,
 * so two staff pressing at once requeue it only once.
 */
export async function resendEmail(
  db: Db,
  staff: StaffScope<'PROCESSING_JOB_RETRY'>,
  input: ResendEmailInput,
): Promise<Result<{ readonly id: string; readonly resourceId: string | null }, ServiceError>> {
  const problem = staffScopeProblem(staff, 'PROCESSING_JOB_RETRY');
  if (problem) return err(problem);
  // Read here, never at module load: tests that stub the database would crash on import.
  const n = schema.notifications;
  const id = input.notificationId.trim();
  if (!UUID.test(id)) return err(serviceError('not_found', EMAIL_RESEND_REFUSED.notFound));

  return db.transaction(async (tx) => {
    const row = first(await tx.select().from(n).where(eq(n.id, id)).for('update'));
    if (!row) return err(serviceError('not_found', EMAIL_RESEND_REFUSED.notFound));
    if (row.channel !== 'EMAIL') return err(serviceError('invalid', EMAIL_RESEND_REFUSED.notEmail));
    if (row.status === 'BOUNCED') {
      return err(serviceError('invalid', EMAIL_RESEND_REFUSED.bounced));
    }
    if (row.status !== 'FAILED') {
      return err(serviceError('invalid', EMAIL_RESEND_REFUSED.notFailed));
    }
    if (row.lastError && FINAL_FAILURES.has(row.lastError)) {
      return err(serviceError('invalid', EMAIL_RESEND_REFUSED.noLongerValid));
    }

    // A fresh copy, not the same row put back: the mail service treats a repeated send key as the
    // same email for a day, so an email it took and then reported as failed would never go again.
    // The failed one is closed so it leaves the list; the copy is checked again before sending.
    const copy = first(
      await tx
        .insert(n)
        .values({
          eventType: row.eventType,
          channel: row.channel,
          idempotencyKey: `${row.idempotencyKey}:resend:${randomUUID()}`,
          recipientAccountId: row.recipientAccountId,
          recipientEmail: row.recipientEmail,
          applicantId: row.applicantId,
          organizationId: row.organizationId,
          missionId: row.missionId,
          resourceId: row.resourceId,
          payload: row.payload,
        })
        .returning({ id: n.id }),
    );
    if (!copy) throw new Error('email copy not created');
    await tx
      .update(n)
      .set({ status: 'CANCELLED', leaseOwner: null, leaseExpiresAt: null })
      .where(and(eq(n.id, row.id), eq(n.status, 'FAILED')));
    await appendAuditEvent(tx, {
      eventType: 'EMAIL_RESEND_REQUESTED',
      actorAccountId: staff.accountId,
      actorRole: 'staff',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'notification',
      resourceId: copy.id,
      metadata: { eventType: row.eventType, replaces: row.id },
    });
    return ok({ id: copy.id, resourceId: row.resourceId });
  });
}
