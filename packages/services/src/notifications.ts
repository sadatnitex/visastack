import { randomUUID } from 'node:crypto';
import type { Result } from '@visastack/core';
import { err, ok } from '@visastack/core';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { orgCaseRecordVisibleSql, withCaseExclusions } from './access/grant-scope';
import { type Db, first, schema } from './db';
import { notificationEmail, renderEmail } from './email-design';
import { type ServiceError, serviceError } from './errors';
import { type SealedInvitationLink, revealInvitationLink } from './invitation-email';
import { listMembershipsForAccount } from './organizations';
import type { EmailPort, KeyManagementPort } from './ports';

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
 * `cancelQueuedNotificationsForResource` is this outbox's other write path
 * besides enqueueing: Part 5 §4 ("Cancellation/replacement/revocation
 * invalidates obsolete notices") and A17 ("stale scheduled messages
 * cancelled") require that a still-QUEUED row tied to a resource that was
 * cancelled, replaced, or revoked before it ever sent never goes out at all.
 * Called from the SAME transaction as that cancellation, the same
 * "commits together" discipline as enqueueing itself - never a separate,
 * droppable follow-up call.
 *
 * See `requirements-ledger.md` NTF-02 for which of the directive's eleven
 * event types are wired to a real call site, which are honestly deferred,
 * and which are blocked on a later part's own concept not existing yet.
 */

export type NotificationChannel = 'IN_APP' | 'EMAIL';
export type NotificationDeliveryStatus =
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'BOUNCED'
  | 'FAILED'
  | 'READ'
  | 'CANCELLED';

export type Notification = typeof schema.notifications.$inferSelect;

/**
 * Event types wired to a real enqueue call site so far. `eventType` itself
 * stays free text at the schema level (matching `auditEvents`), so this
 * union is a convenience for known callers, not an exhaustive gate.
 */
export type NotificationEventType =
  | 'EVIDENCE_REQUEST_CREATED'
  | 'MISSION_STATUS_CHANGED'
  | 'EVIDENCE_REPLACEMENT_REQUESTED'
  | 'EVIDENCE_REVIEW_ACCEPTED'
  | 'APPOINTMENT_SCHEDULED'
  | 'PLATFORM_ROLE_GRANTED'
  | 'PLATFORM_ROLE_REVOKED'
  | 'TASK_DEADLINE'
  | 'DOCUMENT_EXPIRY'
  | 'VERIFICATION_EXPIRY'
  | 'DOWNGRADE_SCHEDULED'
  | 'DOWNGRADE_EXECUTED'
  | 'CASE_RETENTION_NOTICE';

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
  readonly sealedInvitationLink?: SealedInvitationLink;
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
      resourceId: input.resourceId,
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

/**
 * Part 5 §4 ("Cancellation/replacement/revocation invalidates obsolete
 * notices") / A17 ("stale scheduled messages cancelled"): cancels every
 * still-QUEUED notification tied to `resourceId`, so a reminder about
 * something no longer relevant never actually sends. MUST be called from
 * inside the same transaction as the domain cancellation/replacement/
 * revocation it reports on, same "commits together" discipline as
 * enqueueing. A no-op (returns `cancelled: 0`) when nothing is still
 * QUEUED for this resource - already-SENT notices are historical record,
 * never retroactively hidden, and this never touches them (the WHERE
 * clause matches only `status = 'QUEUED'`).
 */
export async function cancelQueuedNotificationsForResource(
  tx: Db,
  resourceId: string,
): Promise<{ readonly cancelled: number }> {
  const updated = await tx
    .update(schema.notifications)
    .set({ status: 'CANCELLED' })
    .where(
      and(
        eq(schema.notifications.resourceId, resourceId),
        eq(schema.notifications.status, 'QUEUED'),
      ),
    )
    .returning({ id: schema.notifications.id });
  return { cancelled: updated.length };
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
async function claimNotifications(
  db: Db,
  limit: number,
  now: Date,
  resourceId?: string,
): Promise<Notification[]> {
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
          resourceId === undefined ? undefined : eq(schema.notifications.resourceId, resourceId),
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
    | 'recipientAccountId'
    | 'recipientEmail'
    | 'applicantId'
    | 'organizationId'
    | 'missionId'
    | 'eventType'
    | 'resourceId'
  >,
): Promise<RecipientCheck> {
  if (notification.eventType === 'SHARING_INVITATION_CREATED') {
    const invite =
      notification.resourceId &&
      first(
        await db
          .select()
          .from(schema.sharingInvitations)
          .where(eq(schema.sharingInvitations.id, notification.resourceId))
          .limit(1),
      );
    const applicant =
      invite &&
      first(
        await db
          .select()
          .from(schema.applicants)
          .where(eq(schema.applicants.id, invite.applicantId))
          .limit(1),
      );
    const authorized =
      !!invite &&
      !!applicant &&
      invite.status === 'PENDING' &&
      invite.expiresAt.getTime() > Date.now() &&
      applicant.ownerAccountId === invite.invitedByAccountId &&
      invite.email === notification.recipientEmail;
    return { authorized, email: authorized ? notification.recipientEmail : null };
  }
  if (notification.eventType === 'CONTRIBUTOR_REQUEST_CREATED') {
    // A request for one document from someone else: only while it is still open, unexpired and
    // addressed to exactly this email.
    const request =
      notification.resourceId &&
      first(
        await db
          .select()
          .from(schema.contributorRequests)
          .where(eq(schema.contributorRequests.id, notification.resourceId))
          .limit(1),
      );
    const authorized =
      !!request &&
      request.status === 'PENDING' &&
      request.expiresAt.getTime() > Date.now() &&
      request.contributorEmail === notification.recipientEmail;
    return { authorized, email: authorized ? notification.recipientEmail : null };
  }
  if (['TEAM_INVITATION_CREATED', 'CLIENT_INVITATION_CREATED'].includes(notification.eventType)) {
    if (!notification.resourceId) return { authorized: false, email: null };
    const team = notification.eventType === 'TEAM_INVITATION_CREATED';
    const table = team ? schema.organizationInvitations : schema.clientInvitations;
    const invite = first(
      await db.select().from(table).where(eq(table.id, notification.resourceId)).limit(1),
    );
    const email = invite && ('email' in invite ? invite.email : invite.contactDestination);
    const authorized =
      !!invite &&
      invite.status === 'PENDING' &&
      invite.expiresAt.getTime() > Date.now() &&
      invite.organizationId === notification.organizationId &&
      email === notification.recipientEmail;
    return { authorized, email: authorized ? notification.recipientEmail : null };
  }
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

  if (notification.eventType === 'TEAM_MEMBER_ADDED') {
    if (!notification.resourceId) return { authorized: false, email: null };
    const membership = first(
      await db
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.id, notification.resourceId),
            eq(schema.memberships.accountId, notification.recipientAccountId),
            eq(schema.memberships.organizationId, notification.organizationId ?? ''),
            eq(schema.memberships.active, true),
          ),
        )
        .limit(1),
    );
    return { authorized: !!membership, email: membership ? account.email : null };
  }
  // Organization IDs also describe traveller-facing case events. Their
  // presence must not disqualify the applicant's actual current owner.
  if (notification.applicantId) {
    const applicant = first(
      await db
        .select({ ownerAccountId: schema.applicants.ownerAccountId })
        .from(schema.applicants)
        .where(eq(schema.applicants.id, notification.applicantId))
        .limit(1),
    );
    if (!applicant) return { authorized: false, email: null };
    if (applicant.ownerAccountId === notification.recipientAccountId) {
      return { authorized: true, email: account.email };
    }
  }
  if (notification.organizationId) {
    const memberships = await listMembershipsForAccount(db, notification.recipientAccountId);
    const member = memberships.find(
      (m) =>
        m.organization.id === notification.organizationId &&
        m.active &&
        m.organization.status === 'ACTIVE',
    );
    if (!member) return { authorized: false, email: null };
    if (notification.applicantId) {
      const now = new Date();
      const applicantId = notification.applicantId;
      const organizationId = notification.organizationId;
      const missionId = notification.missionId;
      // A case notice needs a grant that still reaches that case: the shared
      // case-scope rule, so a per-case sharing exception (ADR 0017) stops
      // notices about that one case too.
      const grant = first(
        await withCaseExclusions(db, (covers) =>
          db
            .select({ id: schema.grants.id })
            .from(schema.grants)
            .where(
              and(
                eq(schema.grants.applicantId, applicantId),
                eq(schema.grants.recipientOrganizationId, organizationId),
                eq(schema.grants.status, 'ACTIVE'),
                isNotNull(schema.grants.acceptedAt),
                lte(schema.grants.startAt, now),
                or(isNull(schema.grants.expiryAt), gt(schema.grants.expiryAt, now)),
                missionId ? covers(missionId) : isNull(schema.grants.missionId),
              ),
            )
            .limit(1),
        ),
      );
      if (!grant) return { authorized: false, email: null };
      if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
        if (!notification.missionId) return { authorized: false, email: null };
        const assignment = first(
          await db
            .select({ id: schema.assignments.id })
            .from(schema.assignments)
            .where(
              and(
                eq(schema.assignments.organizationId, notification.organizationId),
                eq(schema.assignments.memberAccountId, notification.recipientAccountId),
                eq(schema.assignments.missionId, notification.missionId),
              ),
            )
            .limit(1),
        );
        if (!assignment) return { authorized: false, email: null };
      }
    }
    return { authorized: true, email: account.email };
  }
  if (notification.applicantId) return { authorized: false, email: null };
  return { authorized: true, email: account.email };
}

async function dispatchOne(
  db: Db,
  notification: Notification,
  emailPort: EmailPort,
  baseUrl: string,
  now: Date,
  encryption: KeyManagementPort | undefined,
): Promise<'sent' | 'failed' | 'retrying' | 'deferred'> {
  if (!notification.leaseOwner) return 'deferred';
  const ownedQueue = and(
    eq(schema.notifications.id, notification.id),
    eq(schema.notifications.leaseOwner, notification.leaseOwner),
    eq(schema.notifications.status, 'QUEUED'),
  );
  const recipient = await checkRecipient(db, notification);
  const current = first(
    await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(and(ownedQueue, gt(schema.notifications.leaseExpiresAt, new Date())))
      .limit(1),
  );
  if (!current) return 'deferred';
  const attempts = notification.attempts + 1;

  if (!recipient.authorized) {
    const updated = await db
      .update(schema.notifications)
      .set({
        status: 'FAILED',
        attempts,
        lastError: 'recipient no longer authorized',
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(ownedQueue)
      .returning({ id: schema.notifications.id });
    return updated.length ? 'failed' : 'deferred';
  }

  const payload = notification.payload as NotificationPayload;

  if (notification.channel === 'IN_APP') {
    const updated = await db
      .update(schema.notifications)
      .set({ status: 'SENT', attempts, sentAt: now, leaseOwner: null, leaseExpiresAt: null })
      .where(ownedQueue)
      .returning({ id: schema.notifications.id });
    return updated.length ? 'sent' : 'deferred';
  }

  if (!recipient.email) {
    const updated = await db
      .update(schema.notifications)
      .set({
        status: 'FAILED',
        attempts,
        lastError: 'no recipient email resolvable',
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(ownedQueue)
      .returning({ id: schema.notifications.id });
    return updated.length ? 'failed' : 'deferred';
  }

  try {
    let path = payload.deepLinkPath;
    if (payload.sealedInvitationLink) {
      if (!encryption || !notification.resourceId)
        throw new Error('Invitation email encryption unavailable');
      const kind =
        notification.eventType === 'TEAM_INVITATION_CREATED'
          ? 'team'
          : notification.eventType === 'SHARING_INVITATION_CREATED'
            ? 'sharing'
            : notification.eventType === 'CONTRIBUTOR_REQUEST_CREATED'
              ? 'contributor'
              : 'client';
      path = await revealInvitationLink(
        payload.sealedInvitationLink,
        kind,
        notification.resourceId,
        encryption,
      );
    }
    const email = renderEmail(
      notificationEmail({
        eventType: notification.eventType,
        subject: payload.subject,
        summary: payload.summary,
        url: `${baseUrl}${path}`,
      }),
      { baseUrl, recipient: recipient.email },
    );
    const sent = await emailPort.send({
      to: recipient.email,
      subject: payload.subject,
      body: email.text,
      html: email.html,
      idempotencyKey: `notification-${notification.id}`,
    });
    const updated = await db
      .update(schema.notifications)
      .set({
        status: 'SENT',
        attempts,
        sentAt: now,
        providerMessageId: sent.providerMessageId ?? null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(ownedQueue)
      .returning({ id: schema.notifications.id });
    return updated.length ? 'sent' : 'deferred';
  } catch (error) {
    const delay = nextRetryDelayMs(attempts);
    // Provider/network exceptions may contain message content or credentials.
    // Retain only the adapter's exact fixed diagnostic vocabulary.
    const message = error instanceof Error ? error.message : '';
    const lastError =
      /^(?:Email provider (?:not configured|unavailable or request timed out|did not confirm acceptance|returned status [1-5][0-9]{2})|Invalid email idempotency key)$/.test(
        message,
      )
        ? message
        : 'Email delivery failed; provider acceptance was not confirmed';
    if (delay === null) {
      const updated = await db
        .update(schema.notifications)
        .set({ status: 'FAILED', attempts, lastError, leaseOwner: null, leaseExpiresAt: null })
        .where(ownedQueue)
        .returning({ id: schema.notifications.id });
      return updated.length ? 'failed' : 'deferred';
    }
    const updated = await db
      .update(schema.notifications)
      .set({
        attempts,
        lastError,
        nextAttemptAt: new Date(now.getTime() + delay),
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(ownedQueue)
      .returning({ id: schema.notifications.id });
    return updated.length ? 'retrying' : 'deferred';
  }
}

export interface NotificationWorkerResult {
  readonly sent: number;
  readonly retrying: number;
  readonly failed: number;
  /** Claimed work not attempted. Queued budget-deferred work has its lease released. */
  readonly deferred?: number;
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
  options: {
    readonly limit?: number;
    readonly now?: Date;
    readonly timeBudgetMs?: number;
    readonly encryption?: KeyManagementPort;
    /**
     * Send only the messages about this one record (an invitation just created), so a person
     * waiting on the screen gets their own email at once instead of whatever is oldest.
     */
    readonly resourceId?: string;
  } = {},
): Promise<NotificationWorkerResult> {
  if (
    options.timeBudgetMs !== undefined &&
    (!Number.isFinite(options.timeBudgetMs) || options.timeBudgetMs < 0)
  ) {
    throw new Error('Invalid notification time budget');
  }
  const deadline =
    options.timeBudgetMs === undefined
      ? Number.POSITIVE_INFINITY
      : Date.now() + options.timeBudgetMs;
  const now = options.now ?? new Date();
  const claimed = await claimNotifications(
    db,
    options.limit ?? DEFAULT_CLAIM_LIMIT,
    now,
    options.resourceId,
  );
  let sent = 0;
  let retrying = 0;
  let failed = 0;
  let deferred = 0;
  for (const [index, notification] of claimed.entries()) {
    if (Date.now() >= deadline) {
      const owner = notification.leaseOwner;
      if (!owner) throw new Error('Notification lease missing');
      const remaining = claimed.slice(index);
      // Never release a lease that another invocation has already reclaimed.
      await db
        .update(schema.notifications)
        .set({ leaseOwner: null, leaseExpiresAt: null })
        .where(
          and(
            inArray(
              schema.notifications.id,
              remaining.map((row) => row.id),
            ),
            eq(schema.notifications.leaseOwner, owner),
            eq(schema.notifications.status, 'QUEUED'),
          ),
        );
      return { sent, retrying, failed, deferred: deferred + remaining.length };
    }
    const outcome = await dispatchOne(
      db,
      notification,
      emailPort,
      baseUrl,
      now,
      options.encryption,
    );
    if (outcome === 'sent') sent++;
    else if (outcome === 'retrying') retrying++;
    else if (outcome === 'deferred') deferred++;
    else failed++;
  }
  return deferred ? { sent, retrying, failed, deferred } : { sent, retrying, failed };
}

// --- In-app read model ---------------------------------------------------

export interface InAppNotificationView {
  readonly id: string;
  readonly eventType: string;
  readonly subject: string;
  readonly summary: string;
  readonly deepLinkPath: string;
  readonly sealedInvitationLink?: SealedInvitationLink;
  readonly read: boolean;
  readonly createdAt: Date;
}

/** The account's own IN_APP notifications that have actually been sent (never a still-QUEUED or FAILED row), newest first. */
export async function listNotificationsForAccount(
  db: Db,
  accountId: string,
  options: { readonly limit?: number } = {},
): Promise<InAppNotificationView[]> {
  const n = schema.notifications;
  const now = new Date();
  // A notice already delivered about a case an organization no longer reaches
  // (a per-case sharing exception, ADR 0017) leaves the member's bell too: the
  // same rule as the organization's evidence request list. Notices to the
  // person who owns the record, and notices not about a case, are untouched.
  const rows = await withCaseExclusions(db, (covers) =>
    db
      .select()
      .from(n)
      .where(
        and(
          eq(n.recipientAccountId, accountId),
          eq(n.channel, 'IN_APP'),
          or(eq(n.status, 'SENT'), eq(n.status, 'READ')),
          or(
            isNull(n.missionId),
            isNull(n.organizationId),
            isNull(n.applicantId),
            sql`exists (select 1 from ${schema.applicants} where ${schema.applicants.id} = ${n.applicantId} and ${schema.applicants.ownerAccountId} = ${n.recipientAccountId})`,
            orgCaseRecordVisibleSql(covers, {
              organizationId: n.organizationId,
              applicantId: n.applicantId,
              missionId: n.missionId,
              now,
            }),
          ),
        ),
      )
      .orderBy(desc(n.createdAt))
      .limit(options.limit ?? 50),
  );
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

/**
 * NTF-03 (Part 5 §5) delivery/bounce webhook: applies a provider-confirmed
 * outcome to the one row it names, via `providerMessageId` (set when the
 * row was originally SENT). "DELIVERED only if provider confirms" -- this
 * is that confirmation's only entry point; nothing else in this file ever
 * sets DELIVERED. Idempotent by construction, not by a separate dedup log:
 * delivery/rejection only transition SENT; bounce/complaint also supersede
 * DELIVERED because complaints can arrive after delivery. Replaying the same webhook event twice is a harmless
 * second no-op update, and an already-BOUNCED row can never be
 * "un-bounced" by a late/out-of-order `delivered` event.
 */
export async function applyEmailDeliveryEvent(
  db: Db,
  input: {
    readonly providerMessageId: string;
    readonly outcome: 'delivered' | 'bounced' | 'complained' | 'failed';
  },
): Promise<{ readonly applied: boolean }> {
  const now = new Date();
  const set =
    input.outcome === 'delivered'
      ? { status: 'DELIVERED' as const, deliveredAt: now }
      : input.outcome === 'failed'
        ? { status: 'FAILED' as const, lastError: 'The email provider rejected this message.' }
        : { status: 'BOUNCED' as const, bouncedAt: now };
  const updated = await db
    .update(schema.notifications)
    .set(set)
    .where(
      and(
        eq(schema.notifications.providerMessageId, input.providerMessageId),
        input.outcome === 'delivered' || input.outcome === 'failed'
          ? eq(schema.notifications.status, 'SENT')
          : inArray(schema.notifications.status, ['SENT', 'DELIVERED']),
      ),
    )
    .returning({ id: schema.notifications.id });
  return { applied: updated.length > 0 };
}
