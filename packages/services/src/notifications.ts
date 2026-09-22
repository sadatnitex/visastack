import { randomUUID } from 'node:crypto';
import type { Result } from '@visastack/core';
import { err, ok } from '@visastack/core';
import { and, asc, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { listMembershipsForAccount } from './organizations';
import type { EmailPort } from './ports';

/**
 * The Notification Outbox (NTF-02 + Part 5 §3): a transactional outbox.
 * `enqueueNotification`/`enqueueNotificationBothChannels` are always called
 * from INSIDE the same transaction as the domain change they report on
 * ("domain change and outbox entry commit together") - never as a
 * standalone follow-up call that could silently drop the notification if
 * the process crashes between the two. A separate worker
 * (`runNotificationWorker`) claims and dispatches queued rows later,
 * re-verifying the recipient's authorization at send time rather than
 * trusting who was authorized at enqueue time.
 *
 * Only two event types are wired to a real domain call site so far
 * (evidence-request creation, mission status change) - proof that the
 * mechanism works end to end. The rest of NTF-02's eleven-event list, the
 * date-threshold sweep (NTF-04), and a real email provider (NTF-03) are
 * later chunks; see `requirements-ledger.md` NTF-02/03/04.
 */

export type NotificationChannel = 'IN_APP' | 'EMAIL';
export type NotificationDeliveryStatus =
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'BOUNCED'
  | 'FAILED'
  | 'READ';

export type Notification = typeof schema.notifications.$inferSelect;

/**
 * Event types wired to a real enqueue call site so far. `eventType` itself
 * stays free text at the schema level (matching `auditEvents`), so this
 * union is a convenience for known callers, not an exhaustive gate.
 */
export type NotificationEventType = 'EVIDENCE_REQUEST_CREATED' | 'MISSION_STATUS_CHANGED';

/**
 * "Email content: neutral; minimal; authenticated deep link." / "Never
 * include: passport number; financial details; medical details; refusal
 * narrative." `subject` doubles as the in-app title; `deepLinkPath` is
 * relative (`/app/...`) - `runNotificationWorker` prefixes it with the
 * caller-supplied base URL only when actually composing an email, keeping
 * this service layer itself env-agnostic.
 */
export interface NotificationPayload {
  readonly subject: string;
  readonly summary: string;
  readonly deepLinkPath: string;
}

/** Deterministic composition of "event; recipient; channel; threshold where applicable" plus the driving resource, so two different resources of the same event/recipient/channel never collide. */
export function buildNotificationIdempotencyKey(input: {
  readonly eventType: string;
  readonly channel: NotificationChannel;
  readonly resourceId: string;
  readonly recipientAccountId?: string;
  readonly recipientEmail?: string;
  readonly threshold?: string;
}): string {
  const recipient = input.recipientAccountId ?? input.recipientEmail ?? '';
  return [input.eventType, recipient, input.channel, input.resourceId, input.threshold ?? ''].join(
    ':',
  );
}

export interface EnqueueNotificationInput {
  readonly eventType: string;
  readonly channel: NotificationChannel;
  /** The domain object driving this notification (e.g. an evidence request id) - always required, disambiguates the idempotency key across different resources for the same event/recipient/channel. */
  readonly resourceId: string;
  readonly recipientAccountId?: string;
  /** Only for a not-yet-registered recipient (e.g. an invitation) - this chunk's real call sites always use `recipientAccountId`. */
  readonly recipientEmail?: string;
  /** Set only for a recurring, threshold-based reminder (expiry, task deadline) so each threshold gets its own row; omitted for a one-time event. */
  readonly threshold?: string;
  readonly applicantId?: string;
  readonly organizationId?: string;
  readonly missionId?: string;
  readonly payload: NotificationPayload;
}

/**
 * Enqueue one outbox row. MUST be called with a transaction handle already
 * open for the domain change this reports on - never call this outside that
 * transaction, or a crash between the two commits could silently drop the
 * notification. Idempotent: a duplicate (event, recipient, channel,
 * resource, threshold) tuple is silently skipped via `ON CONFLICT DO
 * NOTHING`, never double-enqueued.
 */
export async function enqueueNotification(tx: Db, input: EnqueueNotificationInput): Promise<void> {
  if (!input.recipientAccountId && !input.recipientEmail) {
    throw new Error('enqueueNotification requires a recipientAccountId or recipientEmail');
  }
  const idempotencyKey = buildNotificationIdempotencyKey(input);
  await tx
    .insert(schema.notifications)
    .values({
      eventType: input.eventType,
      channel: input.channel,
      idempotencyKey,
      recipientAccountId: input.recipientAccountId ?? null,
      recipientEmail: input.recipientEmail ?? null,
      applicantId: input.applicantId ?? null,
      organizationId: input.organizationId ?? null,
      missionId: input.missionId ?? null,
      payload: input.payload,
    })
    .onConflictDoNothing({ target: schema.notifications.idempotencyKey });
}

/** "Implement in-app + email for: ..." - every event this chunk wires enqueues both channels, never just one. */
export async function enqueueNotificationBothChannels(
  tx: Db,
  input: Omit<EnqueueNotificationInput, 'channel'>,
): Promise<void> {
  await enqueueNotification(tx, { ...input, channel: 'IN_APP' });
  await enqueueNotification(tx, { ...input, channel: 'EMAIL' });
}

// --- Delivery worker ---------------------------------------------------

const LEASE_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_CLAIM_LIMIT = 20;
/** Delay before attempts 2/3/4/5 respectively - "maximum 5; spread over 24 hours with backoff." Summed, the last delay lands at the 24-hour mark. */
const RETRY_DELAY_MINUTES = [5, 60, 240, 1140];

function nextRetryDelayMs(attemptsSoFar: number): number | null {
  const idx = attemptsSoFar - 1;
  if (idx < 0 || idx >= RETRY_DELAY_MINUTES.length) return null;
  const minutes = RETRY_DELAY_MINUTES[idx];
  return minutes === undefined ? null : minutes * 60 * 1000;
}

/**
 * Claim due, unleased QUEUED rows for this worker pass. Mirrors
 * `erasure.ts`'s `claimErasureJobs`: `FOR UPDATE SKIP LOCKED` inside a short
 * transaction that commits immediately after stamping the lease, so no row
 * lock is ever held across the actual dispatch (an outbound email call).
 * `status` itself never changes here - it is not part of the directive's
 * six-state vocabulary to add a seventh "claimed" state, so claiming is
 * tracked entirely through `leaseOwner`/`leaseExpiresAt` instead.
 */
async function claimNotifications(db: Db, limit: number, now: Date): Promise<Notification[]> {
  const leaseOwner = randomUUID();
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.status, 'QUEUED'),
          lte(schema.notifications.nextAttemptAt, now),
          or(
            isNull(schema.notifications.leaseExpiresAt),
            lte(schema.notifications.leaseExpiresAt, now),
          ),
        ),
      )
      .orderBy(asc(schema.notifications.nextAttemptAt))
      .limit(limit)
      .for('update', { skipLocked: true });

    if (due.length === 0) return [];

    return tx
      .update(schema.notifications)
      .set({ leaseOwner, leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS) })
      .where(
        inArray(
          schema.notifications.id,
          due.map((d) => d.id),
        ),
      )
      .returning();
  });
}

interface RecipientCheck {
  readonly authorized: boolean;
  readonly email: string | null;
}

/**
 * Re-verify the recipient's standing AT SEND TIME ("Recipients must be
 * authorized at SEND TIME, not merely at event creation"; "Agency
 * notifications: current assigned members or configured owners only").
 * An email-only (not-yet-an-account) recipient has no account state to
 * re-check, so it passes through unchanged for the worker to send.
 */
async function checkRecipient(
  db: Db,
  notification: Pick<
    Notification,
    'recipientAccountId' | 'recipientEmail' | 'applicantId' | 'organizationId'
  >,
): Promise<RecipientCheck> {
  if (!notification.recipientAccountId) {
    return { authorized: true, email: notification.recipientEmail };
  }
  const account = first(
    await db
      .select({ id: schema.accounts.id, email: schema.accounts.email })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, notification.recipientAccountId))
      .limit(1),
  );
  if (!account) return { authorized: false, email: null };

  if (notification.organizationId) {
    const memberships = await listMembershipsForAccount(db, notification.recipientAccountId);
    const authorized = memberships.some(
      (m) =>
        m.organization.id === notification.organizationId &&
        m.active &&
        m.organization.status === 'ACTIVE',
    );
    return { authorized, email: account.email };
  }
  if (notification.applicantId) {
    const applicant = first(
      await db
        .select({ ownerAccountId: schema.applicants.ownerAccountId })
        .from(schema.applicants)
        .where(eq(schema.applicants.id, notification.applicantId))
        .limit(1),
    );
    return {
      authorized: applicant?.ownerAccountId === notification.recipientAccountId,
      email: account.email,
    };
  }
  return { authorized: true, email: account.email };
}

async function dispatchOne(
  db: Db,
  notification: Notification,
  emailPort: EmailPort,
  baseUrl: string,
  now: Date,
): Promise<'sent' | 'failed' | 'retrying'> {
  const recipient = await checkRecipient(db, notification);
  const attempts = notification.attempts + 1;

  if (!recipient.authorized) {
    await db
      .update(schema.notifications)
      .set({
        status: 'FAILED',
        attempts,
        lastError: 'recipient no longer authorized',
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(schema.notifications.id, notification.id));
    return 'failed';
  }

  const payload = notification.payload as NotificationPayload;

  if (notification.channel === 'IN_APP') {
    await db
      .update(schema.notifications)
      .set({ status: 'SENT', attempts, sentAt: now, leaseOwner: null, leaseExpiresAt: null })
      .where(eq(schema.notifications.id, notification.id));
    return 'sent';
  }

  if (!recipient.email) {
    await db
      .update(schema.notifications)
      .set({
        status: 'FAILED',
        attempts,
        lastError: 'no recipient email resolvable',
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(schema.notifications.id, notification.id));
    return 'failed';
  }

  try {
    await emailPort.send({
      to: recipient.email,
      subject: payload.subject,
      body: `${payload.summary}\n\n${baseUrl}${payload.deepLinkPath}`,
    });
    await db
      .update(schema.notifications)
      .set({ status: 'SENT', attempts, sentAt: now, leaseOwner: null, leaseExpiresAt: null })
      .where(eq(schema.notifications.id, notification.id));
    return 'sent';
  } catch (error) {
    const delay = nextRetryDelayMs(attempts);
    const lastError = error instanceof Error ? error.message : String(error);
    if (delay === null) {
      await db
        .update(schema.notifications)
        .set({ status: 'FAILED', attempts, lastError, leaseOwner: null, leaseExpiresAt: null })
        .where(eq(schema.notifications.id, notification.id));
      return 'failed';
    }
    await db
      .update(schema.notifications)
      .set({
        attempts,
        lastError,
        nextAttemptAt: new Date(now.getTime() + delay),
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(schema.notifications.id, notification.id));
    return 'retrying';
  }
}

export interface NotificationWorkerResult {
  readonly sent: number;
  readonly retrying: number;
  readonly failed: number;
}

/**
 * Claim and dispatch up to `limit` due notifications. Safe to call
 * opportunistically (right after an enqueue, for near-instant delivery) and
 * from a periodic sweep (durability backstop, matching `runErasureWorker`'s
 * own dual-trigger rationale).
 */
export async function runNotificationWorker(
  db: Db,
  emailPort: EmailPort,
  baseUrl: string,
  options: { readonly limit?: number; readonly now?: Date } = {},
): Promise<NotificationWorkerResult> {
  const now = options.now ?? new Date();
  const claimed = await claimNotifications(db, options.limit ?? DEFAULT_CLAIM_LIMIT, now);
  let sent = 0;
  let retrying = 0;
  let failed = 0;
  for (const notification of claimed) {
    const outcome = await dispatchOne(db, notification, emailPort, baseUrl, now);
    if (outcome === 'sent') sent++;
    else if (outcome === 'retrying') retrying++;
    else failed++;
  }
  return { sent, retrying, failed };
}

// --- In-app read model ---------------------------------------------------

export interface InAppNotificationView {
  readonly id: string;
  readonly eventType: string;
  readonly subject: string;
  readonly summary: string;
  readonly deepLinkPath: string;
  readonly read: boolean;
  readonly createdAt: Date;
}

/** The account's own IN_APP notifications that have actually been sent (never a still-QUEUED or FAILED row), newest first. */
export async function listNotificationsForAccount(
  db: Db,
  accountId: string,
  options: { readonly limit?: number } = {},
): Promise<InAppNotificationView[]> {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.recipientAccountId, accountId),
        eq(schema.notifications.channel, 'IN_APP'),
        or(eq(schema.notifications.status, 'SENT'), eq(schema.notifications.status, 'READ')),
      ),
    )
    .orderBy(desc(schema.notifications.createdAt))
    .limit(options.limit ?? 50);
  return rows.map((row) => {
    const payload = row.payload as NotificationPayload;
    return {
      id: row.id,
      eventType: row.eventType,
      subject: payload.subject,
      summary: payload.summary,
      deepLinkPath: payload.deepLinkPath,
      read: row.status === 'READ',
      createdAt: row.createdAt,
    };
  });
}

/** Mark one of the account's own in-app notifications read ("READ if legitimately observable" - a real, actively-taken action, never inferred). */
export async function markNotificationRead(
  db: Db,
  input: { readonly actorAccountId: string; readonly notificationId: string },
): Promise<Result<void, ServiceError>> {
  const notification = first(
    await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, input.notificationId))
      .limit(1),
  );
  if (!notification) return err(serviceError('not_found', 'notification not found'));
  if (notification.recipientAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to read this notification'));
  }
  if (notification.status !== 'SENT') return ok(undefined);
  await db
    .update(schema.notifications)
    .set({ status: 'READ', readAt: new Date() })
    .where(eq(schema.notifications.id, notification.id));
  return ok(undefined);
}

/** FAILED or BOUNCED rows needing admin attention - never the message payload itself in this listing shape ("Admin retry: permitted; does not expose sensitive message content"). */
export interface NotificationNeedingAttention {
  readonly id: string;
  readonly eventType: string;
  readonly channel: NotificationChannel;
  readonly status: NotificationDeliveryStatus;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly createdAt: Date;
}

export async function listNotificationsNeedingAttention(
  db: Db,
  limit = 50,
): Promise<NotificationNeedingAttention[]> {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(
      or(eq(schema.notifications.status, 'FAILED'), eq(schema.notifications.status, 'BOUNCED')),
    )
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    channel: row.channel,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
  }));
}

/** "Admin retry: permitted" - requeues a FAILED row for another attempt. Service-level only this chunk; the admin UI surface is ADM-01's. */
export async function retryNotification(
  db: Db,
  input: { readonly notificationId: string },
): Promise<Result<void, ServiceError>> {
  const notification = first(
    await db
      .select({ id: schema.notifications.id, status: schema.notifications.status })
      .from(schema.notifications)
      .where(eq(schema.notifications.id, input.notificationId))
      .limit(1),
  );
  if (!notification) return err(serviceError('not_found', 'notification not found'));
  if (notification.status !== 'FAILED') {
    return err(serviceError('invalid', 'only a FAILED notification can be retried'));
  }
  await db
    .update(schema.notifications)
    .set({ status: 'QUEUED', nextAttemptAt: new Date(), leaseOwner: null, leaseExpiresAt: null })
    .where(eq(schema.notifications.id, notification.id));
  return ok(undefined);
}
