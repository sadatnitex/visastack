import { CONSENT_TYPES, type ConsentType, isOk } from '@visastack/core';
import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { AI_CONNECTION_REVOKED_REASON } from './access/ai-connection-manage';
import { caseExclusionsTablePresent } from './access/grant-scope';
import { aiFilesAvailable } from './ai-files-ready';
import { appendAuditEvent } from './audit';
import { purgeMissionUnconditionally } from './case-retention';
import { getConsents } from './consent';
import { type Db, first, schema } from './db';
import { executeAccountDeletion } from './deletion';
import {
  DOCUMENT_ROW_REASONS,
  type ErasureJobReason,
  enqueueErasureJob,
  safeCopyDrawingIds,
} from './erasure';
import { lifecycleTablesPresent } from './lifecycle/foundation/presence';
import { incrementMaterialRevision, missionsSelectingDocument } from './material-revision';
import { isMissingRelationError } from './missing-relation';
import { redactionMasksTablePresent } from './redaction-table';
import { personBillingPresent } from './traveller-billing';

/**
 * Backup resurrection reconciliation (master directive Part 7 §15). See
 * docs/operations/backup-resurrection-reconciliation.md for the full design
 * this implements -- read that first.
 *
 * Reconciles a freshly-restored database branch against the branch it is
 * replacing: every reconciliation-relevant audit event on the OLD
 * (pre-incident) branch, occurring after the restore point, is replayed as
 * the equivalent forcing action on the NEW (restored) branch. Events are
 * processed in the order they actually happened (oldest first) across every
 * event type together, never per-type in isolation -- a hold placed then
 * released, or an organization suspended then terminated, must be applied
 * in that same order to end up correct.
 *
 * Most rules here force a single already-existing row's status/flag column,
 * or insert a full row that is missing entirely. Account deletion,
 * case-retention purge, and document/storage-object erasure are the three
 * exceptions that reuse or re-derive a more complex mechanism rather than
 * hand-rolling a second cascade:
 *
 * - Account deletion calls `executeAccountDeletion` itself -- safe here
 *   specifically because the function's own precondition (a PENDING
 *   deletion request whose grace window has elapsed) naturally already
 *   holds: the request is created long before execution (a 30+ day grace
 *   window dwarfs this codebase's <=5 minute RPO), so it is essentially
 *   always mirrored onto the restored branch already, and calling the real
 *   function with the original event's own `occurredAt` as `now`
 *   reproduces the exact same grace-window check that already passed on
 *   the old branch.
 * - Case-retention purge calls `purgeMissionUnconditionally`
 *   (`case-retention.ts`) -- the unconditional purge mechanism extracted
 *   out of `sweepCaseRetentionPurge` for exactly this reuse. Unlike account
 *   deletion, reconciliation does NOT call the sweep itself: the sweep's
 *   own eligibility gate (grace days, an active legal hold, an unresolved
 *   complaint) is the wrong precondition to recheck here -- a
 *   `MISSION_RETENTION_PURGED` event on the pre-incident branch is already
 *   proof the purge was correctly decided there, and the restored branch's
 *   own current hold/complaint state may be stale or have genuinely
 *   diverged. Reconciliation forces the exact end state that was already
 *   decided, nothing more.
 * - Erasure (`ERASURE_VERIFIED`, `erasure.ts`) has two kinds of enqueue
 *   source -- account deletion (a single, ungated storage-object delete)
 *   and the document-row reasons (`DOCUMENT_ROW_REASONS`: `retention.ts`'s
 *   `purgeExpiredDocuments`, and a lifecycle removal from
 *   `enqueueDocumentRemoval`), each gated behind every
 *   sibling storage object a document ever referenced also reaching
 *   VERIFIED, per `finalizeVerifiedJob`'s own completion check). Rather
 *   than reconstructing that job-by-job gating state machine on the
 *   restored branch, `forceErasureVerified` asks the one branch that
 *   actually knows the ground truth -- OLD db, right now -- whether the
 *   document is already gone there; if so, the full cascade genuinely
 *   completed on the old branch at some point, so the identical end state
 *   is forced onto NEW db. The underlying bytes are already gone for real
 *   on both branches simultaneously by the time any of this runs -- Vercel
 *   Blob's `del()` is external, never branched alongside Postgres -- so no
 *   `erasureJobs` bookkeeping row is recreated on the restored branch at
 *   all; that table is pure operational queue state, not the
 *   privacy-relevant fact itself.
 *
 * Every forced change is itself audited on the NEW branch (method SYSTEM,
 * no actor -- this is a system process, not a person), so the restored
 * branch's own audit trail honestly reflects that reconciliation ran and
 * exactly what it changed. A per-event failure (e.g. a legal hold whose
 * applicant does not exist on the new branch either) is recorded in the
 * report's `errors` rather than aborting the whole run -- one bad row must
 * never block reconciling everything else.
 */

const RECONCILED_EVENT_TYPES = [
  'GRANT_REVOKED',
  'CONSENT_REVOKED',
  'MEMBERSHIP_DEACTIVATED',
  'LEGAL_HOLD_PLACED',
  'LEGAL_HOLD_RELEASED',
  'PLATFORM_ROLE_REVOKED',
  'ORGANIZATION_SUSPENDED',
  'ORGANIZATION_TERMINATED',
  'ACCOUNT_DELETION_EXECUTED',
  'MISSION_RETENTION_PURGED',
  'ERASURE_VERIFIED',
  'GRANT_CASE_EXCLUDED',
  'GRANT_CASE_EXCLUSION_REMOVED',
  'AI_CONNECTION_REVOKED',
  'AI_CONNECTION_CHANGED',
  'DOCUMENT_REDACTION_SAVED',
  'DOCUMENT_REDACTION_CLEARED',
  'GRANT_AI_ASSIST_CHANGED',
  'ORGANIZATION_AI_SETTING_UPDATED',
  // LC-F: a deleted document with no stored file is removed at once (no erasure job, so no
  // ERASURE_VERIFIED); its `removed: true` event is replayed here instead (owner decision D10).
  'DOCUMENT_REMOVAL_QUEUED',
  // LC-G3: an agency application withdrawn after the restore point never comes back to waiting
  // for review, and its unused team invitations stay revoked. Its memberships end through their
  // own MEMBERSHIP_DEACTIVATED events, replayed above.
  'ORGANIZATION_APPLICATION_WITHDRAWN',
  // Owner decision "Founding A": a subscription ended after the restore point never comes back
  // (an agency's plan when it closes, or one the owner ended), and an application rejected after
  // it never comes back to waiting for review. Only a REJECTED review is replayed.
  'SUBSCRIPTION_ENDED',
  'ORGANIZATION_REVIEWED',
] as const;

type ReconciledEventType = (typeof RECONCILED_EVENT_TYPES)[number];

export interface ReconciliationCounts {
  readonly grantsRevoked: number;
  readonly consentsRevoked: number;
  readonly membershipsDeactivated: number;
  readonly legalHoldsPlaced: number;
  readonly legalHoldsReleased: number;
  readonly platformRolesRevoked: number;
  readonly organizationsForced: number;
  readonly accountsDeleted: number;
  readonly missionsPurged: number;
  readonly erasuresVerified: number;
  /** Per-case sharing exceptions (ADR 0017) written again on the restored branch. */
  readonly caseExceptionsAdded: number;
  /** Per-case sharing exceptions the owner removed after the restore point, removed again. */
  readonly caseExceptionsRemoved: number;
  /** AI connections the owner turned off after the restore point, turned off again (S15). */
  readonly aiConnectionsRevoked: number;
  /** AI connections whose access the owner narrowed after the restore point, narrowed again. */
  readonly aiConnectionsNarrowed: number;
  /** Document versions whose safe copy boxes were set back to the pre-incident branch's (S23). */
  readonly redactionMasksReconciled: number;
  /** Agency grants whose AI tools the traveller turned off after the restore point, again (S22). */
  readonly aiAssistRemoved: number;
  /** Agencies that turned their AI connections off after the restore point, again (S22). */
  readonly agencyAiSettingsOff: number;
  /** Subscriptions ended after the restore point, ended again (owner decision "Founding A"). */
  readonly subscriptionsEnded: number;
}

export interface ReconciliationError {
  readonly eventType: string;
  readonly resourceId: string | null;
  readonly message: string;
}

export interface ReconciliationReport {
  readonly checked: number;
  readonly counts: ReconciliationCounts;
  readonly errors: readonly ReconciliationError[];
  /** Every plan the restore ended, for the owner to check (see `PlanToCheck`). */
  readonly plansToCheck: readonly PlanToCheck[];
}

type AuditEventRow = typeof schema.auditEvents.$inferSelect;

async function forceGrantRevoked(newDb: Db, resourceId: string): Promise<boolean> {
  const rows = await newDb
    .update(schema.grants)
    .set({ status: 'REVOKED', updatedAt: new Date() })
    .where(and(eq(schema.grants.id, resourceId), ne(schema.grants.status, 'REVOKED')))
    .returning({ id: schema.grants.id });
  return rows.length > 0;
}

async function forceConsentRevoked(newDb: Db, resourceId: string): Promise<boolean> {
  const [accountId, type] = resourceId.split(':');
  if (!accountId || !type || !CONSENT_TYPES.includes(type as ConsentType)) return false;
  const current = await getConsents(newDb, accountId);
  if (current[type as ConsentType] === false) return false;
  await newDb.insert(schema.consentRecords).values({
    accountId,
    type: type as ConsentType,
    grantedAt: null,
    revokedAt: new Date(),
  });
  return true;
}

async function forceMembershipDeactivated(newDb: Db, resourceId: string): Promise<boolean> {
  const rows = await newDb
    .update(schema.memberships)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(schema.memberships.id, resourceId), eq(schema.memberships.active, true)))
    .returning({ id: schema.memberships.id });
  return rows.length > 0;
}

async function forceLegalHoldPlaced(oldDb: Db, newDb: Db, resourceId: string): Promise<boolean> {
  const oldHold = first(
    await oldDb
      .select()
      .from(schema.legalHolds)
      .where(eq(schema.legalHolds.id, resourceId))
      .limit(1),
  );
  if (!oldHold) return false;
  const existing = first(
    await newDb
      .select()
      .from(schema.legalHolds)
      .where(eq(schema.legalHolds.id, resourceId))
      .limit(1),
  );
  if (existing) {
    if (existing.active) return false;
    await newDb
      .update(schema.legalHolds)
      .set({ active: true, releasedAt: null, updatedAt: new Date() })
      .where(eq(schema.legalHolds.id, resourceId));
    return true;
  }
  await newDb.insert(schema.legalHolds).values({
    id: oldHold.id,
    applicantId: oldHold.applicantId,
    reason: oldHold.reason,
    placedByAccountId: oldHold.placedByAccountId,
    active: true,
    releasedAt: null,
    reviewAt: oldHold.reviewAt,
    createdAt: oldHold.createdAt,
    updatedAt: oldHold.updatedAt,
  });
  return true;
}

async function forceLegalHoldReleased(newDb: Db, resourceId: string): Promise<boolean> {
  const rows = await newDb
    .update(schema.legalHolds)
    .set({ active: false, releasedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.legalHolds.id, resourceId), eq(schema.legalHolds.active, true)))
    .returning({ id: schema.legalHolds.id });
  return rows.length > 0;
}

async function forcePlatformRoleRevoked(newDb: Db, resourceId: string): Promise<boolean> {
  const rows = await newDb
    .update(schema.platformRoles)
    .set({ revokedAt: new Date(), revokedReason: 'backup_resurrection_reconciliation' })
    .where(and(eq(schema.platformRoles.id, resourceId), isNull(schema.platformRoles.revokedAt)))
    .returning({ id: schema.platformRoles.id });
  return rows.length > 0;
}

async function forceOrganizationStatus(
  newDb: Db,
  resourceId: string,
  targetStatus: 'SUSPENDED' | 'CLOSED',
): Promise<boolean> {
  const org = first(
    await newDb
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, resourceId))
      .limit(1),
  );
  if (!org) return false;
  if (org.status === 'CLOSED' || org.status === targetStatus) {
    // Owner decision "Founding A": a closed agency keeps no plan on the restored branch either.
    return org.status === 'CLOSED' && targetStatus === 'CLOSED'
      ? newDb.transaction((tx) => forceAgencyKeepsNoPlan(tx, resourceId, new Date()))
      : false;
  }
  return newDb.transaction(async (tx) => {
    await tx
      .update(schema.organizations)
      .set({ status: targetStatus, updatedAt: new Date() })
      .where(eq(schema.organizations.id, resourceId));
    if (targetStatus === 'CLOSED') await forceAgencyKeepsNoPlan(tx, resourceId, new Date());
    return true;
  });
}

/**
 * Replays a withdrawn agency application: the organization is CLOSED (the status a withdrawal
 * sets, and the most restrictive one, so nothing is ever downgraded) and its team invitations that
 * were never used are revoked, as `withdrawOrganizationApplication` does. The organization row is
 * locked first, the order that function takes. A no-op once the restored branch already matches,
 * or when the organization was created after the restore point.
 */
async function forceOrganizationApplicationWithdrawn(
  newDb: Db,
  organizationId: string,
): Promise<boolean> {
  return newDb.transaction(async (tx) => {
    const org = first(
      await tx
        .select({ status: schema.organizations.status })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, organizationId))
        .for('update'),
    );
    if (!org) return false;
    const now = new Date();
    const closed = org.status !== 'CLOSED';
    if (closed) {
      await tx
        .update(schema.organizations)
        .set({ status: 'CLOSED', updatedAt: now })
        .where(eq(schema.organizations.id, organizationId));
    }
    const revoked = await tx
      .update(schema.organizationInvitations)
      .set({ status: 'REVOKED', revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.organizationInvitations.organizationId, organizationId),
          eq(schema.organizationInvitations.status, 'PENDING'),
        ),
      )
      .returning({ id: schema.organizationInvitations.id });
    // Owner decision "Founding A": the withdrawn agency keeps no plan on the restored branch.
    const planEnded = await forceAgencyKeepsNoPlan(tx, organizationId, now);
    return closed || revoked.length > 0 || planEnded;
  });
}

/**
 * Owner decision "Founding A": an agency that keeps no plan (closed or rejected) has none on the
 * restored branch either. Ends whatever subscription is current there (a plan changed after the
 * restore point may be a different row from the one the old branch ended), and cancels a downgrade
 * still waiting, with its queued notice, as the closing did. Runs inside the caller's transaction,
 * after the organization row. True when anything changed.
 */
async function forceAgencyKeepsNoPlan(tx: Db, organizationId: string, at: Date): Promise<boolean> {
  const ended = await tx
    .update(schema.subscriptions)
    .set({ endedAt: at })
    .where(
      and(
        eq(schema.subscriptions.organizationId, organizationId),
        isNull(schema.subscriptions.endedAt),
      ),
    )
    .returning({ id: schema.subscriptions.id });
  const cancelled = await cancelWaitingDowngrades(tx, organizationId, at);
  return ended.length > 0 || cancelled;
}

/** Cancels the agency's downgrades still waiting on the restored branch, and their queued notices. */
async function cancelWaitingDowngrades(tx: Db, organizationId: string, at: Date): Promise<boolean> {
  const cancelled = await tx
    .update(schema.scheduledDowngrades)
    .set({
      status: 'CANCELLED',
      cancelledAt: at,
      cancelledReason: 'backup_resurrection_reconciliation',
      updatedAt: at,
    })
    .where(
      and(
        eq(schema.scheduledDowngrades.organizationId, organizationId),
        eq(schema.scheduledDowngrades.status, 'PENDING'),
      ),
    )
    .returning({ id: schema.scheduledDowngrades.id });
  if (cancelled.length > 0) {
    await tx
      .update(schema.notifications)
      .set({ status: 'CANCELLED' })
      .where(
        and(
          inArray(
            schema.notifications.resourceId,
            cancelled.map((row) => row.id),
          ),
          eq(schema.notifications.status, 'QUEUED'),
        ),
      );
  }
  return cancelled.length > 0;
}

/** The rows of a raw query, whichever shape the driver returns them in. */
function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] } | null)?.rows ?? []) as T[];
}

/** Endings that put another agency plan in place: the recorded replacement is replayed too. */
const REPLACED_AGENCY_PLAN: ReadonlySet<string> = new Set(['plan_changed', 'downgrade_executed']);

interface RecordedReplacement {
  readonly planKey: string | null;
  readonly planId: string | null;
  readonly at: Date;
  readonly actorAccountId: string | null;
  readonly scheduledDowngradeId: string | null;
}

/**
 * The plan that replaced an ended one, as the audit chain recorded it when it started
 * (SUBSCRIPTION_ACTIVATED, DOWNGRADE_EXECUTED or PERSON_PLAN_PURCHASED for that subscription),
 * never the pre-incident branch's live rows, which the incident may have damaged.
 */
async function recordedReplacement(
  oldDb: Db,
  subscriptionId: string,
): Promise<RecordedReplacement | null> {
  const event = first(
    await oldDb
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.resourceId, subscriptionId),
          inArray(schema.auditEvents.eventType, [
            'SUBSCRIPTION_ACTIVATED',
            'DOWNGRADE_EXECUTED',
            'PERSON_PLAN_PURCHASED',
          ]),
        ),
      )
      .orderBy(asc(schema.auditEvents.seq))
      .limit(1),
  );
  if (!event) return null;
  const text = (key: string) => {
    const value = metadataValue(event.metadata, key);
    return typeof value === 'string' ? value : null;
  };
  return {
    planKey: text('planKey'),
    planId: text('planId'),
    at: event.occurredAt,
    actorAccountId: event.actorAccountId,
    scheduledDowngradeId: text('scheduledDowngradeId'),
  };
}

/**
 * Replays an ended subscription (owner decisions "Founding A", 1 Nov 2026): every way a plan ends
 * records SUBSCRIPTION_ENDED, and only those recorded decisions are replayed (an ending the
 * incident itself caused wrote no record and is not copied back).
 *
 * - An agency plan replaced by another (`plan_changed`, `downgrade_executed`): the change is
 *   replayed whole, the old plan ends and the recorded replacement starts with its own id (so a
 *   later ending of it replays too), never leaving the agency with no plan, which would lift every
 *   limit. When the replacement cannot be made (its plan is not on the restored branch, or the
 *   agency has another current plan there), nothing changes and the owner's list says what to give.
 * - Any other ending (a closing, the owner, a traveller's lapse, refund or plan switch): it ends
 *   again at the moment it ended; an agency's waiting downgrade is cancelled with its notice; a
 *   traveller plan's renewal reminders still waiting to go out stop.
 *
 * A no-op once the restored branch already matches, or when the subscription was created after
 * the restore point (its own start is then replayed by the ending it replaced, if any).
 */
async function forceSubscriptionEnded(
  oldDb: Db,
  newDb: Db,
  subscriptionId: string,
  event: AuditEventRow,
): Promise<boolean> {
  const replacedBy = metadataValue(event.metadata, 'replacedBy');
  if (event.reason && REPLACED_AGENCY_PLAN.has(event.reason) && typeof replacedBy === 'string') {
    return forceAgencyPlanReplaced(oldDb, newDb, subscriptionId, replacedBy, event);
  }
  return newDb.transaction(async (tx) => {
    const ended = await tx
      .update(schema.subscriptions)
      .set({ endedAt: event.occurredAt })
      .where(and(eq(schema.subscriptions.id, subscriptionId), isNull(schema.subscriptions.endedAt)))
      .returning({ organizationId: schema.subscriptions.organizationId });
    const row = ended[0];
    if (!row) return false;
    if (row.organizationId !== null) {
      await cancelWaitingDowngrades(tx, row.organizationId, event.occurredAt);
    } else {
      // A traveller's plan: its renewal reminders still waiting to go out stop, as its lapse,
      // refund or switch stopped them (the daily run voids the renewal itself).
      await tx
        .update(schema.notifications)
        .set({ status: 'CANCELLED' })
        .where(
          and(
            eq(schema.notifications.status, 'QUEUED'),
            sql`${schema.notifications.resourceId}::text in (select id::text from invoices
              where subscription_id = ${subscriptionId}::uuid and status in ('OPEN', 'PARTIALLY_PAID'))`,
          ),
        );
    }
    return true;
  });
}

/** Replays a recorded agency plan change or executed downgrade whole (see above). */
async function forceAgencyPlanReplaced(
  oldDb: Db,
  newDb: Db,
  subscriptionId: string,
  replacedBy: string,
  event: AuditEventRow,
): Promise<boolean> {
  const replacement = await recordedReplacement(oldDb, replacedBy);
  return newDb.transaction(async (tx) => {
    const found = first(
      await tx
        .select({ organizationId: schema.subscriptions.organizationId })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.id, subscriptionId)),
    );
    if (!found?.organizationId) return false;
    const organizationId = found.organizationId;
    // The organization row first, then its plans: the order every plan change takes.
    const org = first(
      await tx
        .select({ status: schema.organizations.status })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, organizationId))
        .for('update'),
    );
    if (!org) return false;
    const old = first(
      await tx
        .select({
          endedAt: schema.subscriptions.endedAt,
          assignedByAccountId: schema.subscriptions.assignedByAccountId,
        })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.id, subscriptionId))
        .for('update'),
    );
    if (!old || old.endedAt !== null) return false;
    if (org.status === 'CLOSED' || org.status === 'REJECTED') {
      // A closed or rejected agency keeps no plan: nothing is put in its place.
      return forceAgencyKeepsNoPlan(tx, organizationId, event.occurredAt);
    }
    if (!replacement?.planKey) return false;
    const plan = first(
      await tx
        .select({ id: schema.plans.id })
        .from(schema.plans)
        .where(eq(schema.plans.key, replacement.planKey)),
    );
    const other = first(
      await tx
        .select({ id: schema.subscriptions.id })
        .from(schema.subscriptions)
        .where(
          and(
            eq(schema.subscriptions.organizationId, organizationId),
            isNull(schema.subscriptions.endedAt),
            ne(schema.subscriptions.id, subscriptionId),
          ),
        ),
    );
    if (!plan || other) return false;
    await tx
      .update(schema.subscriptions)
      .set({ endedAt: event.occurredAt })
      .where(eq(schema.subscriptions.id, subscriptionId));
    await tx
      .insert(schema.subscriptions)
      .values({
        id: replacedBy,
        organizationId,
        planId: plan.id,
        startedAt: replacement.at,
        assignedByAccountId: old.assignedByAccountId ?? replacement.actorAccountId,
        reason: `Restored from backup: ${event.reason ?? 'plan changed'}`,
      })
      .onConflictDoNothing();
    if (event.reason === 'downgrade_executed' && replacement.scheduledDowngradeId) {
      // Done already: the daily run must not apply it a second time.
      await tx
        .update(schema.scheduledDowngrades)
        .set({ status: 'EXECUTED', executedAt: replacement.at, updatedAt: replacement.at })
        .where(
          and(
            eq(schema.scheduledDowngrades.id, replacement.scheduledDowngradeId),
            eq(schema.scheduledDowngrades.status, 'PENDING'),
          ),
        );
    } else {
      // An immediate plan change made any waiting downgrade stale, as activateSubscription does.
      await cancelWaitingDowngrades(tx, organizationId, event.occurredAt);
    }
    return true;
  });
}

/**
 * Replays a rejected agency application: still waiting for review on the restored branch, it is
 * REJECTED again, and it keeps no plan there (`forceAgencyKeepsNoPlan`). An application already
 * decided or closed there keeps its status. The organization row is locked first, the order
 * `reviewOrganization` takes.
 */
async function forceApplicationRejected(newDb: Db, organizationId: string): Promise<boolean> {
  return newDb.transaction(async (tx) => {
    const org = first(
      await tx
        .select({ status: schema.organizations.status })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, organizationId))
        .for('update'),
    );
    if (!org) return false;
    const now = new Date();
    const rejected = org.status === 'PENDING_VERIFICATION';
    if (rejected) {
      await tx
        .update(schema.organizations)
        .set({ status: 'REJECTED', updatedAt: now })
        .where(eq(schema.organizations.id, organizationId));
    }
    const keepsNone =
      rejected || org.status === 'REJECTED' || org.status === 'CLOSED'
        ? await forceAgencyKeepsNoPlan(tx, organizationId, now)
        : false;
    return rejected || keepsNone;
  });
}

/** Ends every live token of one AI connection on the restored branch. */
async function revokeAiConnectionTokens(tx: Db, connectionId: string, now: Date): Promise<number> {
  const rows = await tx
    .update(schema.aiConnectionTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.aiConnectionTokens.connectionId, connectionId),
        isNull(schema.aiConnectionTokens.revokedAt),
      ),
    )
    .returning({ id: schema.aiConnectionTokens.id });
  return rows.length;
}

/**
 * `AI_CONNECTION_REVOKED` (the owner's Turn Off, S15): the connection and every token it has end
 * on the restored branch too, exactly as the original did in one transaction, with the original
 * time and reason. The connection's
 * own `revoked_at` is what every use checks; its tokens are revoked as well so none is left live.
 * A restored branch from before the AI connection tables existed has no such connection: no-op.
 */
async function forceAiConnectionRevoked(
  newDb: Db,
  resourceId: string,
  occurredAt: Date,
): Promise<boolean> {
  try {
    return await newDb.transaction(async (tx) => {
      // The owner's own turn-off, as it happened: its time and its reason. The
      // RECONCILIATION_AI_CONNECTION_REVOKED audit row records that reconciliation applied it.
      const now = occurredAt;
      const connections = await tx
        .update(schema.aiConnections)
        .set({ revokedAt: now, revokedReason: AI_CONNECTION_REVOKED_REASON })
        .where(and(eq(schema.aiConnections.id, resourceId), isNull(schema.aiConnections.revokedAt)))
        .returning({ id: schema.aiConnections.id });
      const tokens = await revokeAiConnectionTokens(tx, resourceId, now);
      return connections.length > 0 || tokens > 0;
    });
  } catch (error) {
    if (isMissingRelationError(error)) return false;
    throw error;
  }
}

/** A boolean in an audit record's metadata, or undefined. */
/** One value of an audit event's metadata, or undefined when there is none. */
function metadataValue(metadata: unknown, key: string): unknown {
  if (typeof metadata !== 'object' || metadata === null) return undefined;
  return Reflect.get(metadata, key);
}

function metadataFlag(metadata: unknown, key: string): boolean | undefined {
  const value = metadataValue(metadata, key);
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * S22: a traveller turned an agency's AI tools off after the restore point; the restored grant
 * loses `AI_ASSIST` again. Compared as text, so a branch from before migration 0108 (which cannot
 * hold the permission at all) is left as it is.
 */
async function forceAiAssistRemoved(newDb: Db, grantId: string): Promise<boolean> {
  const rows = await newDb
    .update(schema.grants)
    .set({
      actions: sql`array_remove(${schema.grants.actions}::text[], 'AI_ASSIST')::permission_action[]`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.grants.id, grantId), sql`'AI_ASSIST' = any(${schema.grants.actions}::text[])`),
    )
    .returning({ id: schema.grants.id });
  return rows.length > 0;
}

/** S22: an agency turned its AI connections off after the restore point; off again. */
async function forceAgencyAiSettingOff(newDb: Db, organizationId: string): Promise<boolean> {
  try {
    const rows = await newDb
      .update(schema.organizationAiSettings)
      .set({ aiConnectionsEnabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.organizationAiSettings.organizationId, organizationId),
          eq(schema.organizationAiSettings.aiConnectionsEnabled, true),
        ),
      )
      .returning({ id: schema.organizationAiSettings.organizationId });
    return rows.length > 0;
  } catch (error) {
    if (isMissingRelationError(error)) return false;
    throw error;
  }
}

type AiConnectionRow = typeof schema.aiConnections.$inferSelect;

/** The earlier of two ends; `null` is "until turned off", which is later than any date. */
function earlierEnd(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

/**
 * The cases both branches allow: none beats one case beats all current cases, and two different
 * single cases leave none. `ONE` with no case (its case was deleted) already covers none. When
 * one side has one case and the other all current cases, the one case is allowed by both only
 * while it is current (`mustBeCurrent`): a closed or cancelled case is not among all current
 * cases, so keeping it would widen the side that had all current cases.
 */
function narrowerCases(
  restored: AiConnectionRow,
  source: AiConnectionRow,
): Pick<AiConnectionRow, 'caseMode' | 'missionId'> & { readonly mustBeCurrent: boolean } {
  const none = { caseMode: 'NONE' as const, missionId: null, mustBeCurrent: false };
  const covers = (row: AiConnectionRow) =>
    row.caseMode === 'ONE' && row.missionId === null ? 'NONE' : row.caseMode;
  const restoredMode = covers(restored);
  const sourceMode = covers(source);
  if (restoredMode === 'NONE' || sourceMode === 'NONE') return none;
  if (sourceMode === 'ALL_CURRENT' && restoredMode === 'ALL_CURRENT') {
    return { caseMode: 'ALL_CURRENT', missionId: null, mustBeCurrent: false };
  }
  if (sourceMode === 'ALL_CURRENT') {
    return { caseMode: 'ONE', missionId: restored.missionId, mustBeCurrent: true };
  }
  if (restoredMode === 'ALL_CURRENT') {
    return { caseMode: 'ONE', missionId: source.missionId, mustBeCurrent: true };
  }
  return restored.missionId === source.missionId
    ? { caseMode: 'ONE', missionId: restored.missionId, mustBeCurrent: false }
    : none;
}

/**
 * `AI_CONNECTION_CHANGED` (Change Access, S15). The change may have narrowed access (fewer
 * parts, fewer cases, full numbers off, an earlier end) or widened it. Following the principle
 * that reconciliation only ever tightens, the restored connection is narrowed to what BOTH
 * branches allow, comparing against the pre-incident branch's current row (the ground truth, as
 * for erasure): the parts both allow, the narrower case choice, full numbers only if both have
 * them, and the earlier end. A widening is never replayed; the owner can change access again. When
 * the earlier end has already passed, the connection's tokens are revoked too, so a connection
 * whose end came sooner after the restore point is off on the restored branch with its tokens
 * dead. A connection whose own stored end passes needs no replay: the restored branch holds that
 * end and every use checks it.
 */
async function forceAiConnectionNarrowed(
  oldDb: Db,
  newDb: Db,
  resourceId: string,
): Promise<boolean> {
  try {
    const source = first(
      await oldDb
        .select()
        .from(schema.aiConnections)
        .where(eq(schema.aiConnections.id, resourceId))
        .limit(1),
    );
    if (!source) return false;
    return await newDb.transaction(async (tx) => {
      const restored = first(
        await tx
          .select()
          .from(schema.aiConnections)
          .where(eq(schema.aiConnections.id, resourceId))
          .limit(1)
          .for('update'),
      );
      // An agency connection (S22) has no record and no choices to narrow; turning it off is the
      // only change it gets, reconciled with AI_CONNECTION_REVOKED.
      if (!restored || restored.applicantId === null) return false;
      const restoredRecord = restored.applicantId;
      const now = new Date();
      const narrowestCases = narrowerCases(restored, source);
      let cases: Pick<AiConnectionRow, 'caseMode' | 'missionId'> = narrowestCases;
      if (narrowestCases.missionId !== null) {
        const mission = first(
          await tx
            .select({ id: schema.missions.id, state: schema.missions.state })
            .from(schema.missions)
            .where(
              and(
                eq(schema.missions.id, narrowestCases.missionId),
                eq(schema.missions.applicantId, restoredRecord),
              ),
            )
            .limit(1),
        );
        const closed = mission?.state === 'CLOSED' || mission?.state === 'CANCELLED';
        if (!mission || (narrowestCases.mustBeCurrent && closed)) {
          cases = { caseMode: 'NONE', missionId: null };
        }
      }
      const narrowed = {
        scopes: restored.scopes.filter((scope) => source.scopes.includes(scope)),
        caseMode: cases.caseMode,
        missionId: cases.missionId,
        revealIdentifiers: restored.revealIdentifiers && source.revealIdentifiers,
        expiresAt: earlierEnd(restored.expiresAt, source.expiresAt),
      };
      const changed =
        narrowed.scopes.length !== restored.scopes.length ||
        narrowed.caseMode !== restored.caseMode ||
        narrowed.missionId !== restored.missionId ||
        narrowed.revealIdentifiers !== restored.revealIdentifiers ||
        narrowed.expiresAt?.getTime() !== restored.expiresAt?.getTime();
      if (changed) {
        await tx
          .update(schema.aiConnections)
          .set(narrowed)
          .where(eq(schema.aiConnections.id, resourceId));
      }
      const ended = narrowed.expiresAt !== null && narrowed.expiresAt.getTime() <= now.getTime();
      const tokens = ended ? await revokeAiConnectionTokens(tx, resourceId, now) : 0;
      const files = await narrowAiConnectionFiles(oldDb, tx, resourceId);
      return changed || tokens > 0 || files;
    });
  } catch (error) {
    if (isMissingRelationError(error)) return false;
    throw error;
  }
}

/**
 * "Original Files" (S20) under the same rule: the restored connection keeps only the documents
 * both branches have ticked, and an Original only where both have it (a Safe Copy otherwise). A
 * branch without the table has none ticked. Nothing is ever added.
 */
async function narrowAiConnectionFiles(oldDb: Db, tx: Db, connectionId: string): Promise<boolean> {
  if (!(await aiFilesAvailable(tx))) return false;
  const read = (db: Db) =>
    db
      .select({
        documentId: schema.aiConnectionDocuments.documentId,
        variant: schema.aiConnectionDocuments.variant,
      })
      .from(schema.aiConnectionDocuments)
      .where(eq(schema.aiConnectionDocuments.connectionId, connectionId));
  const source = new Map(
    (await aiFilesAvailable(oldDb))
      ? (await read(oldDb)).map((row) => [row.documentId, row.variant] as const)
      : [],
  );
  let changed = false;
  for (const row of await read(tx)) {
    const where = and(
      eq(schema.aiConnectionDocuments.connectionId, connectionId),
      eq(schema.aiConnectionDocuments.documentId, row.documentId),
    );
    const kept = source.get(row.documentId);
    if (kept === undefined) {
      await tx.delete(schema.aiConnectionDocuments).where(where);
      changed = true;
    } else if (row.variant === 'ORIGINAL' && kept !== 'ORIGINAL') {
      await tx.update(schema.aiConnectionDocuments).set({ variant: 'SAFE_COPY' }).where(where);
      changed = true;
    }
  }
  return changed;
}

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type RedactionMaskRow = typeof schema.redactionMasks.$inferSelect;

/**
 * Whether the restored rows already match the pre-incident rows: the same pages, boxes, source,
 * author and revision, and the same drawings (finished, or still being stored). A drawing the
 * pre-incident branch has and the restored row lacks counts as matching only once it is
 * registered on the restored branch with an erasure job (`queuedOnRestored`), which is what an
 * earlier run of this rule leaves behind; otherwise that file would be left in storage with
 * nothing on the restored branch pointing at it. A restored drawing that differs never matches.
 */
function sameMasks(
  restored: readonly RedactionMaskRow[],
  source: readonly RedactionMaskRow[],
  queuedOnRestored: ReadonlySet<string>,
): boolean {
  if (restored.length !== source.length) return false;
  const key = (row: RedactionMaskRow) =>
    JSON.stringify([row.page, row.source, row.createdByAccountId, row.boxes, row.maskRevision]);
  const byPage = new Map(source.map((row) => [row.page, row]));
  const sameDrawing = (mine: string | null, theirs: string | null) =>
    mine === theirs || (mine === null && theirs !== null && queuedOnRestored.has(theirs));
  return restored.every((row) => {
    const match = byPage.get(row.page);
    if (!match || key(match) !== key(row)) return false;
    return (
      sameDrawing(row.renderedStorageObjectId, match.renderedStorageObjectId) &&
      sameDrawing(row.pendingStorageObjectId, match.pendingStorageObjectId)
    );
  });
}

/**
 * `DOCUMENT_REDACTION_SAVED` / `DOCUMENT_REDACTION_CLEARED` (safe copies, S23). The owner changed
 * which parts of one document version are hidden after the restore point. The pre-incident
 * branch's current boxes for that version are the ground truth (as for erasure), so the restored
 * branch is set to exactly them. Fail closed: the restored rows are removed first, in their own
 * transaction, and only then are the pre-incident rows copied in; if the copy fails (say the
 * version or the owner's account is not on the restored branch), the version is left with no
 * boxes, which means "Not Prepared Yet", never an older set of boxes that hides less. A restored
 * branch from before migration 0102 has no boxes to correct: no-op.
 */
async function forceRedactionMasks(
  oldDb: Db,
  newDb: Db,
  metadata: AuditEventRow['metadata'],
): Promise<boolean> {
  const versionId =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as { readonly documentVersionId?: unknown }).documentVersionId
      : undefined;
  if (typeof versionId !== 'string' || !UUID_TEXT.test(versionId)) return false;
  if (!(await redactionMasksTablePresent(newDb))) return false;
  const source = (await redactionMasksTablePresent(oldDb))
    ? await oldDb
        .select()
        .from(schema.redactionMasks)
        .where(eq(schema.redactionMasks.documentVersionId, versionId))
    : [];
  const restored = await newDb
    .select()
    .from(schema.redactionMasks)
    .where(eq(schema.redactionMasks.documentVersionId, versionId));
  const restoredDrawings = safeCopyDrawingIds(restored);
  const sourceDrawings = safeCopyDrawingIds(source);
  const queuedOnRestored = new Set(
    sourceDrawings.length > 0
      ? (
          await newDb
            .select({ id: schema.erasureJobs.storageObjectId })
            .from(schema.erasureJobs)
            .where(inArray(schema.erasureJobs.storageObjectId, sourceDrawings))
        ).map((row) => row.id)
      : [],
  );
  if (sameMasks(restored, source, queuedOnRestored)) return false;
  // Every stored page drawing involved, on either branch (finished, or still being stored), is
  // erased on the restored branch: the restored rows' own, and the pre-incident branch's
  // (registered here first, since the restored branch never knew them, so their files are not
  // left behind unreferenced).
  const sourceObjects =
    sourceDrawings.length > 0
      ? await oldDb
          .select()
          .from(schema.storageObjects)
          .where(inArray(schema.storageObjects.id, sourceDrawings))
      : [];
  const removed = await newDb.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.redactionMasks)
      .where(eq(schema.redactionMasks.documentVersionId, versionId))
      .returning({ id: schema.redactionMasks.id });
    for (const object of sourceObjects) {
      await tx.insert(schema.storageObjects).values(object).onConflictDoNothing();
    }
    const ids = [...new Set([...restoredDrawings, ...sourceObjects.map((object) => object.id)])];
    const drawings =
      ids.length > 0
        ? await tx
            .select()
            .from(schema.storageObjects)
            .where(inArray(schema.storageObjects.id, ids))
        : [];
    for (const drawing of drawings) {
      await enqueueErasureJob(tx, {
        reason: 'SAFE_COPY_REMOVAL',
        bucket: drawing.bucket,
        objectKey: drawing.objectKey,
        expectedHash: drawing.contentHash,
        storageObjectId: drawing.id,
      });
    }
    return deleted;
  });
  if (source.length === 0) return removed.length > 0;
  const version = first(
    await newDb
      .select({ id: schema.documentVersions.id })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, versionId))
      .limit(1),
  );
  if (!version) return removed.length > 0;
  // The boxes come back without their drawings: the copy is "preparing" until the owner's editor
  // draws it again, so nothing drawn under either branch is ever served.
  await newDb.transaction(async (tx) => {
    await tx.insert(schema.redactionMasks).values(
      source.map((row) => ({
        ...row,
        renderedStorageObjectId: null,
        renderedContentType: null,
        renderedByteSize: null,
        renderedWidthPt: null,
        renderedHeightPt: null,
        renderedAt: null,
        pendingStorageObjectId: null,
      })),
    );
  });
  return true;
}

/**
 * Unlike every other rule above, this reuses `executeAccountDeletion` itself
 * rather than hand-rolling its (large, carefully lock-ordered) cascade a
 * second time -- exactly the design's own stated preference for "the effect
 * is more than a single-column flip." Passing the original event's own
 * `occurredAt` as `now` reproduces the identical grace-window check that
 * already passed once on the old branch; a missing account (already deleted
 * by an earlier reconciliation run, or never existed here) is a clean no-op,
 * never an error -- matching every other rule's idempotency. Any OTHER
 * refusal (no pending request, an active hold, sole-platform-owner) means
 * the two branches have genuinely diverged in a way this function cannot
 * safely force past -- surfaced as a real error rather than silently
 * swallowed, exactly like a legal hold's missing applicant elsewhere in this
 * file.
 */
async function forceAccountDeletionExecuted(
  newDb: Db,
  resourceId: string,
  occurredAt: Date,
): Promise<boolean> {
  const stillExists = first(
    await newDb
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, resourceId))
      .limit(1),
  );
  if (!stillExists) return false;
  const result = await executeAccountDeletion(newDb, { accountId: resourceId, now: occurredAt });
  if (!isOk(result)) {
    throw new Error(
      `account deletion replay refused (${result.error.code}): ${result.error.message}`,
    );
  }
  return true;
}

// --- Per-case sharing exceptions (ADR 0017) ----------------------------------
//
// A "no" for one case (GRANT_CASE_EXCLUDED) narrows an all-cases grant or a
// pending all-cases invitation, so a restore that lost it would silently give
// the recipient that case again: it is replayed like a revocation. The
// owner's later "Allow This Case" (GRANT_CASE_EXCLUSION_REMOVED) is an
// explicit access decision, replayed in order exactly like a legal hold
// release, so the restored branch ends where the owner left it. Only the last
// event for each grant-or-invitation and case is applied (see
// `lastExceptionEvents`), so a second run is a clean no-op. The answers for a
// case are one-shot and every row written or removed is audited (including an
// exception carried forward to a new grant or invitation for the same
// recipient, reason `carried_forward`), so the last event per pair always
// matches the table. A grant or invitation made after the restore point does
// not exist on the restored branch: its events are a clean no-op there.

type ExceptionParent =
  | { readonly kind: 'grant'; readonly id: string }
  | { readonly kind: 'sharing_invitation'; readonly id: string };

function exceptionParent(event: AuditEventRow): ExceptionParent | undefined {
  if (!event.resourceId) return undefined;
  if (event.resourceType === 'grant') return { kind: 'grant', id: event.resourceId };
  if (event.resourceType === 'sharing_invitation') {
    return { kind: 'sharing_invitation', id: event.resourceId };
  }
  return undefined;
}

function exceptionKey(event: AuditEventRow): string | undefined {
  const parent = exceptionParent(event);
  if (!parent || !event.missionId) return undefined;
  return `${parent.kind}:${parent.id}:${event.missionId}`;
}

/** Sequence numbers of the last exception event for each grant-or-invitation and case. */
function lastExceptionEvents(events: readonly AuditEventRow[]): ReadonlySet<number> {
  const last = new Map<string, number>();
  for (const event of events) {
    if (
      event.eventType !== 'GRANT_CASE_EXCLUDED' &&
      event.eventType !== 'GRANT_CASE_EXCLUSION_REMOVED'
    ) {
      continue;
    }
    const key = exceptionKey(event);
    if (key) last.set(key, event.seq);
  }
  return new Set(last.values());
}

/**
 * The exception cannot be written on the restored branch (for example the
 * branch predates migration 0090), so the parent is closed instead: the grant
 * (active, paused or awaiting acceptance) or the pending invitation is
 * REVOKED. A pause could be undone by "Resume" and silently give the case
 * back; a revocation cannot, so the recipient never regains the case without
 * the owner sharing again on purpose. Audited on the restored branch as
 * RECONCILIATION_CASE_EXCEPTION_FAIL_CLOSED.
 */
async function closeExceptionParent(newDb: Db, parent: ExceptionParent, missionId: string) {
  if (parent.kind === 'grant') {
    const revoked = await newDb
      .update(schema.grants)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(
        and(
          eq(schema.grants.id, parent.id),
          inArray(schema.grants.status, ['ACTIVE', 'PAUSED', 'PENDING_ACCEPTANCE']),
        ),
      )
      .returning({ id: schema.grants.id });
    if (revoked.length === 0) return;
  } else {
    const revoked = await newDb
      .update(schema.sharingInvitations)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(
        and(
          eq(schema.sharingInvitations.id, parent.id),
          eq(schema.sharingInvitations.status, 'PENDING'),
        ),
      )
      .returning({ id: schema.sharingInvitations.id });
    if (revoked.length === 0) return;
  }
  await appendAuditEvent(newDb, {
    eventType: 'RECONCILIATION_CASE_EXCEPTION_FAIL_CLOSED',
    method: 'SYSTEM',
    result: 'ALLOWED',
    resourceType: parent.kind,
    resourceId: parent.id,
    missionId,
    grantId: parent.kind === 'grant' ? parent.id : null,
    reason: 'backup_resurrection_reconciliation',
  });
}

async function exceptionTargetsExist(
  newDb: Db,
  parent: ExceptionParent,
  missionId: string,
): Promise<{ readonly applicantId: string } | undefined> {
  const mission = first(
    await newDb
      .select({ applicantId: schema.missions.applicantId })
      .from(schema.missions)
      .where(eq(schema.missions.id, missionId))
      .limit(1),
  );
  if (!mission) return undefined;
  const owner =
    parent.kind === 'grant'
      ? first(
          await newDb
            .select({ applicantId: schema.grants.applicantId })
            .from(schema.grants)
            .where(eq(schema.grants.id, parent.id))
            .limit(1),
        )
      : first(
          await newDb
            .select({ applicantId: schema.sharingInvitations.applicantId })
            .from(schema.sharingInvitations)
            .where(eq(schema.sharingInvitations.id, parent.id))
            .limit(1),
        );
  if (!owner) return undefined;
  if (owner.applicantId !== mission.applicantId) {
    throw new Error(`case exception ${parent.id}/${missionId} names two different people`);
  }
  return mission;
}

/**
 * Writes the exception again. Nothing to do when the grant, invitation or
 * case does not exist on the restored branch (it was made after the restore
 * point, so nobody can reach the case through it there). If the row cannot
 * be written, the parent is closed (`closeExceptionParent`) and the error is
 * reported: never left open.
 */
async function forceCaseExcluded(newDb: Db, event: AuditEventRow): Promise<boolean> {
  const parent = exceptionParent(event);
  const missionId = event.missionId;
  if (!parent || !missionId) throw new Error('case exception event without its grant and case');
  const target = await exceptionTargetsExist(newDb, parent, missionId);
  if (!target) return false;
  try {
    if (!(await caseExclusionsTablePresent(newDb))) {
      throw new Error('grant_case_exclusions does not exist on the restored branch');
    }
    const inserted = await newDb
      .insert(schema.grantCaseExclusions)
      .values({
        grantId: parent.kind === 'grant' ? parent.id : null,
        sharingInvitationId: parent.kind === 'sharing_invitation' ? parent.id : null,
        missionId,
        applicantId: target.applicantId,
        createdByAccountId: event.actorAccountId,
        createdAt: event.occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: schema.grantCaseExclusions.id });
    return inserted.length > 0;
  } catch (error) {
    await closeExceptionParent(newDb, parent, missionId);
    throw new Error(
      `case exception not written, ${parent.kind} closed instead: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Removes the exception again. A failure leaves the case excluded and is reported. */
async function forceCaseExclusionRemoved(newDb: Db, event: AuditEventRow): Promise<boolean> {
  const parent = exceptionParent(event);
  const missionId = event.missionId;
  if (!parent || !missionId) throw new Error('case exception event without its grant and case');
  if (!(await caseExclusionsTablePresent(newDb))) return false;
  const removed = await newDb
    .delete(schema.grantCaseExclusions)
    .where(
      and(
        parent.kind === 'grant'
          ? eq(schema.grantCaseExclusions.grantId, parent.id)
          : eq(schema.grantCaseExclusions.sharingInvitationId, parent.id),
        eq(schema.grantCaseExclusions.missionId, missionId),
      ),
    )
    .returning({ id: schema.grantCaseExclusions.id });
  return removed.length > 0;
}

/**
 * Like account deletion above, reuses a complex cascading mechanism
 * directly (`purgeMissionUnconditionally`) rather than hand-rolling it --
 * but unlike account deletion, deliberately does NOT call the sweep that
 * normally guards it (`sweepCaseRetentionPurge`): that sweep's own
 * eligibility gate re-checks grace days, an active legal hold, and an
 * unresolved complaint against CURRENT state, which is exactly wrong here
 * -- the `MISSION_RETENTION_PURGED` event being replayed is already proof
 * the purge was correctly decided on the old branch, and the restored
 * branch's own hold/complaint state may be stale or have genuinely
 * diverged since. Reads the mission's own pre-purge field values fresh
 * from the restored branch (never from the old event's metadata) so the
 * forced redaction reflects what is actually being redacted here. A
 * missing mission (never existed on this branch) or one already purged
 * (idempotent re-run) is a clean no-op, never an error.
 */
async function forceMissionRetentionPurged(newDb: Db, resourceId: string): Promise<boolean> {
  return newDb.transaction(async (tx) => {
    const mission = first(
      await tx
        .select({
          missionId: schema.missions.id,
          applicantId: schema.missions.applicantId,
          title: schema.missions.title,
          state: schema.missions.state,
          closedAt: schema.missions.closedAt,
          retentionNoticeSentAt: schema.missions.retentionNoticeSentAt,
          purgedAt: schema.missions.purgedAt,
        })
        .from(schema.missions)
        .where(eq(schema.missions.id, resourceId))
        .limit(1),
    );
    if (!mission || mission.purgedAt) return false;
    await purgeMissionUnconditionally(tx, mission, 'backup_resurrection_reconciliation');
    return true;
  });
}

/**
 * Unlike the two rules above, this does NOT recreate any erasure-worker
 * bookkeeping (an `erasureJobs` row) on the restored branch -- see this
 * module's own doc comment for why that is deliberate, not an oversight.
 *
 * `ACCOUNT_DELETION` and `PROFILE_PHOTO_REMOVAL` reasons: `finalizeVerifiedJob`'s
 * real logic unconditionally deletes exactly the one `storageObjects` row, no
 * sibling gating -- forced here identically. For a removed or replaced profile
 * photo that also removes any restored `applicant_photos` row still pointing
 * at those erased bytes (its foreign key cascades), so a restore can never
 * bring back a photo whose bytes are gone.
 *
 * `RETENTION_PURGE` reason: the document id is never recoverable from the
 * audit event's own columns (`auditEvents` has no such column), so this
 * looks it up on `erasureJobs` on the OLD branch -- uniquely among the
 * tables this reads, that one is designed to outlive the very domain rows
 * it started from. Whether the full cascade (document + every sibling
 * storage object) already completed is then answered by checking whether
 * `documents` for that id still exists on OLD db right now: gone means the
 * cascade genuinely finished there at some point, so the identical end
 * state -- including bumping material revision for any mission on NEW db
 * currently selecting this document as evidence, exactly like
 * `finalizeVerifiedJob` itself does before tearing the document down -- is
 * forced onto NEW db; still there means this individual sibling's own
 * bytes are gone but the document was never fully erasure-verified even by
 * the old branch's own final state, so NEW db is correctly left untouched
 * too. Every other sibling event for the same document re-derives the same
 * answer from the same static, read-only old-branch state, so re-running
 * this (whether a second full reconciliation pass, or a later sibling
 * event in the same run) is a clean no-op once the first one that actually
 * forces the cascade has run.
 */
async function forceErasureVerified(
  oldDb: Db,
  newDb: Db,
  resourceId: string,
  metadata: unknown,
): Promise<boolean> {
  const reason = (metadata as { reason?: string } | null)?.reason;
  if (
    reason === 'ACCOUNT_DELETION' ||
    reason === 'PROFILE_PHOTO_REMOVAL' ||
    reason === 'SAFE_COPY_REMOVAL'
  ) {
    const deleted = await newDb
      .delete(schema.storageObjects)
      .where(eq(schema.storageObjects.id, resourceId))
      .returning({ id: schema.storageObjects.id });
    return deleted.length > 0;
  }
  // A lifecycle removal (owner decision D10) is never brought back by a restore, exactly like an
  // expired document: the same document-row path.
  if (reason !== undefined && DOCUMENT_ROW_REASONS.has(reason as ErasureJobReason)) {
    const job = first(
      await oldDb
        .select({ documentId: schema.erasureJobs.documentId })
        .from(schema.erasureJobs)
        .where(eq(schema.erasureJobs.storageObjectId, resourceId))
        .limit(1),
    );
    if (!job?.documentId) {
      throw new Error(
        `no erasure job with a document id found on the old branch for storage object ${resourceId}`,
      );
    }
    const documentId = job.documentId;
    const stillLive = first(
      await oldDb
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .limit(1),
    );
    if (stillLive) return false;

    const siblingStorageObjectIds = (
      await oldDb
        .select({ storageObjectId: schema.erasureJobs.storageObjectId })
        .from(schema.erasureJobs)
        .where(eq(schema.erasureJobs.documentId, documentId))
    ).map((row) => row.storageObjectId);

    return newDb.transaction(async (tx) => {
      for (const missionId of await missionsSelectingDocument(tx, documentId)) {
        await incrementMaterialRevision(tx, missionId);
      }
      // The restored Removal Record reads Removed, as it did on the old branch: read before the
      // delete, which takes the document's lifecycle row with it.
      await markRestoredRemovalComplete(tx, documentId);
      const deletedDocuments = await tx
        .delete(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .returning({ id: schema.documents.id });
      if (siblingStorageObjectIds.length > 0) {
        await tx
          .delete(schema.storageObjects)
          .where(inArray(schema.storageObjects.id, siblingStorageObjectIds));
      }
      return deletedDocuments.length > 0;
    });
  }
  throw new Error(
    `unrecognized ERASURE_VERIFIED reason on storage object ${resourceId}: ${String(reason)}`,
  );
}

/**
 * A restored branch can hold the Removal Record of a document whose removal finished on the old
 * branch, still reading Scheduled or Removing: move it forward to Removed, the only way the
 * receipt guard of migration 0113 allows. Nothing to do before that migration.
 */
async function markRestoredRemovalComplete(tx: Db, documentId: string): Promise<void> {
  if (!(await lifecycleTablesPresent(tx))) return;
  const row = first(
    await tx
      .select({ receiptId: schema.documentLifecycle.receiptId })
      .from(schema.documentLifecycle)
      .where(eq(schema.documentLifecycle.documentId, documentId)),
  );
  if (!row?.receiptId) return;
  const receipt = first(
    await tx
      .select({ status: schema.deletionReceipts.status })
      .from(schema.deletionReceipts)
      .where(eq(schema.deletionReceipts.id, row.receiptId))
      .for('update'),
  );
  if (!receipt || receipt.status === 'REMOVED' || receipt.status === 'RESTORED') return;
  if (receipt.status !== 'REMOVING') {
    await tx
      .update(schema.deletionReceipts)
      .set({ status: 'REMOVING' })
      .where(eq(schema.deletionReceipts.id, row.receiptId));
  }
  await tx
    .update(schema.deletionReceipts)
    .set({ status: 'REMOVED', verifiedGoneAt: new Date() })
    .where(eq(schema.deletionReceipts.id, row.receiptId));
}

/**
 * A document removed with no stored file on the old branch is removed on the restored one too:
 * every case selecting it moves on, its Removal Record reads Removed, then the row goes. Running
 * again finds no row and does nothing.
 */
async function forceDocumentRemovedWithoutFiles(newDb: Db, documentId: string): Promise<boolean> {
  return newDb.transaction(async (tx) => {
    const present = first(
      await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .for('update'),
    );
    if (!present) return false;
    for (const missionId of await missionsSelectingDocument(tx, documentId)) {
      await incrementMaterialRevision(tx, missionId);
    }
    await markRestoredRemovalComplete(tx, documentId);
    const deleted = await tx
      .delete(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .returning({ id: schema.documents.id });
    return deleted.length > 0;
  });
}

/** Which counter and audit resourceType each event type drives, once applied. */
const EVENT_META: Readonly<
  Record<
    ReconciledEventType,
    { readonly counter: keyof ReconciliationCounts; readonly resourceType: string }
  >
> = {
  GRANT_REVOKED: { counter: 'grantsRevoked', resourceType: 'grant' },
  CONSENT_REVOKED: { counter: 'consentsRevoked', resourceType: 'consent' },
  MEMBERSHIP_DEACTIVATED: { counter: 'membershipsDeactivated', resourceType: 'membership' },
  LEGAL_HOLD_PLACED: { counter: 'legalHoldsPlaced', resourceType: 'legal_hold' },
  LEGAL_HOLD_RELEASED: { counter: 'legalHoldsReleased', resourceType: 'legal_hold' },
  PLATFORM_ROLE_REVOKED: { counter: 'platformRolesRevoked', resourceType: 'platform_role' },
  ORGANIZATION_SUSPENDED: { counter: 'organizationsForced', resourceType: 'organization' },
  ORGANIZATION_TERMINATED: { counter: 'organizationsForced', resourceType: 'organization' },
  ACCOUNT_DELETION_EXECUTED: { counter: 'accountsDeleted', resourceType: 'account' },
  MISSION_RETENTION_PURGED: { counter: 'missionsPurged', resourceType: 'mission' },
  ERASURE_VERIFIED: { counter: 'erasuresVerified', resourceType: 'storage_object' },
  GRANT_CASE_EXCLUDED: { counter: 'caseExceptionsAdded', resourceType: 'case_exception' },
  GRANT_CASE_EXCLUSION_REMOVED: {
    counter: 'caseExceptionsRemoved',
    resourceType: 'case_exception',
  },
  AI_CONNECTION_REVOKED: { counter: 'aiConnectionsRevoked', resourceType: 'ai_connection' },
  AI_CONNECTION_CHANGED: { counter: 'aiConnectionsNarrowed', resourceType: 'ai_connection' },
  DOCUMENT_REDACTION_SAVED: { counter: 'redactionMasksReconciled', resourceType: 'document' },
  DOCUMENT_REDACTION_CLEARED: { counter: 'redactionMasksReconciled', resourceType: 'document' },
  GRANT_AI_ASSIST_CHANGED: { counter: 'aiAssistRemoved', resourceType: 'grant' },
  ORGANIZATION_AI_SETTING_UPDATED: { counter: 'agencyAiSettingsOff', resourceType: 'organization' },
  DOCUMENT_REMOVAL_QUEUED: { counter: 'erasuresVerified', resourceType: 'document' },
  ORGANIZATION_APPLICATION_WITHDRAWN: {
    counter: 'organizationsForced',
    resourceType: 'organization',
  },
  SUBSCRIPTION_ENDED: { counter: 'subscriptionsEnded', resourceType: 'subscription' },
  ORGANIZATION_REVIEWED: { counter: 'organizationsForced', resourceType: 'organization' },
};

async function applyEvent(oldDb: Db, newDb: Db, event: AuditEventRow): Promise<boolean> {
  const resourceId = event.resourceId;
  if (!resourceId) return false;
  switch (event.eventType as ReconciledEventType) {
    case 'GRANT_REVOKED':
      return forceGrantRevoked(newDb, resourceId);
    case 'CONSENT_REVOKED':
      return forceConsentRevoked(newDb, resourceId);
    case 'MEMBERSHIP_DEACTIVATED':
      return forceMembershipDeactivated(newDb, resourceId);
    case 'LEGAL_HOLD_PLACED':
      return forceLegalHoldPlaced(oldDb, newDb, resourceId);
    case 'LEGAL_HOLD_RELEASED':
      return forceLegalHoldReleased(newDb, resourceId);
    case 'PLATFORM_ROLE_REVOKED':
      return forcePlatformRoleRevoked(newDb, resourceId);
    case 'ORGANIZATION_SUSPENDED':
      return forceOrganizationStatus(newDb, resourceId, 'SUSPENDED');
    case 'ORGANIZATION_TERMINATED':
      return forceOrganizationStatus(newDb, resourceId, 'CLOSED');
    case 'ACCOUNT_DELETION_EXECUTED':
      return forceAccountDeletionExecuted(newDb, resourceId, event.occurredAt);
    case 'MISSION_RETENTION_PURGED':
      return forceMissionRetentionPurged(newDb, resourceId);
    case 'ERASURE_VERIFIED':
      return forceErasureVerified(oldDb, newDb, resourceId, event.metadata);
    case 'GRANT_CASE_EXCLUDED':
      return forceCaseExcluded(newDb, event);
    case 'GRANT_CASE_EXCLUSION_REMOVED':
      return forceCaseExclusionRemoved(newDb, event);
    case 'AI_CONNECTION_REVOKED':
      return forceAiConnectionRevoked(newDb, resourceId, event.occurredAt);
    case 'AI_CONNECTION_CHANGED':
      return forceAiConnectionNarrowed(oldDb, newDb, resourceId);
    case 'DOCUMENT_REDACTION_SAVED':
    case 'DOCUMENT_REDACTION_CLEARED':
      return forceRedactionMasks(oldDb, newDb, event.metadata);
    case 'GRANT_AI_ASSIST_CHANGED':
      // Only a "turned off" narrows; a later "turned on" is the traveller's to make again.
      return metadataFlag(event.metadata, 'allowed') === false
        ? forceAiAssistRemoved(newDb, resourceId)
        : false;
    case 'ORGANIZATION_AI_SETTING_UPDATED':
      return metadataFlag(event.metadata, 'after') === false
        ? forceAgencyAiSettingOff(newDb, resourceId)
        : false;
    case 'DOCUMENT_REMOVAL_QUEUED':
      // Only a removal already complete is replayed; a queued one ends in ERASURE_VERIFIED.
      return metadataFlag(event.metadata, 'removed') === true
        ? forceDocumentRemovedWithoutFiles(newDb, resourceId)
        : false;
    case 'ORGANIZATION_APPLICATION_WITHDRAWN':
      return forceOrganizationApplicationWithdrawn(newDb, resourceId);
    case 'SUBSCRIPTION_ENDED':
      return forceSubscriptionEnded(oldDb, newDb, resourceId, event);
    case 'ORGANIZATION_REVIEWED':
      // Only a rejection narrows; an approval is the platform's to make again.
      return metadataValue(event.metadata, 'decision') === 'REJECTED'
        ? forceApplicationRejected(newDb, resourceId)
        : false;
    default:
      return false;
  }
}

export async function reconcileRestoredBranch(
  oldDb: Db,
  newDb: Db,
  restorePoint: Date,
): Promise<ReconciliationReport> {
  const events = await oldDb
    .select()
    .from(schema.auditEvents)
    .where(
      and(
        inArray(schema.auditEvents.eventType, RECONCILED_EVENT_TYPES),
        gt(schema.auditEvents.occurredAt, restorePoint),
      ),
    )
    // Chain order breaks a tie between events written at the same moment.
    .orderBy(asc(schema.auditEvents.occurredAt), asc(schema.auditEvents.seq));

  const counts: ReconciliationCounts = {
    grantsRevoked: 0,
    consentsRevoked: 0,
    membershipsDeactivated: 0,
    legalHoldsPlaced: 0,
    legalHoldsReleased: 0,
    platformRolesRevoked: 0,
    organizationsForced: 0,
    accountsDeleted: 0,
    missionsPurged: 0,
    erasuresVerified: 0,
    caseExceptionsAdded: 0,
    caseExceptionsRemoved: 0,
    aiConnectionsRevoked: 0,
    aiConnectionsNarrowed: 0,
    redactionMasksReconciled: 0,
    aiAssistRemoved: 0,
    agencyAiSettingsOff: 0,
    subscriptionsEnded: 0,
  };
  const errors: ReconciliationError[] = [];
  const mutableCounts = counts as {
    -readonly [K in keyof ReconciliationCounts]: number;
  };

  const finalExceptionEvents = lastExceptionEvents(events);
  for (const event of events) {
    const meta = EVENT_META[event.eventType as ReconciledEventType];
    if (!meta) continue;
    // An earlier "no" or "allow" for the same grant and case is superseded by its last one.
    if (
      meta.resourceType === 'case_exception' &&
      exceptionKey(event) !== undefined &&
      !finalExceptionEvents.has(event.seq)
    ) {
      continue;
    }
    try {
      const applied = await applyEvent(oldDb, newDb, event);
      if (!applied) continue;
      mutableCounts[meta.counter] += 1;
      await appendAuditEvent(newDb, {
        eventType: `RECONCILIATION_${event.eventType}`,
        method: 'SYSTEM',
        result: 'ALLOWED',
        resourceType: meta.resourceType,
        resourceId: event.resourceId,
        missionId: event.missionId,
        reason: 'backup_resurrection_reconciliation',
        metadata: {
          sourceEventType: event.eventType,
          sourceOccurredAt: event.occurredAt.toISOString(),
        },
      });
    } catch (error) {
      errors.push({
        eventType: event.eventType,
        resourceId: event.resourceId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const plansToCheck = await listEndedPlans(
    oldDb,
    newDb,
    events.filter((event) => event.eventType === 'SUBSCRIPTION_ENDED'),
    errors,
  );
  return { checked: events.length, counts, errors, plansToCheck };
}

// --- Plans ended on the pre-incident branch (owner decision, 1 Nov 2026)
// A traveller's plan is named by its paying account below this line only (access/enforcement.test.ts).

/**
 * An agency or traveller whose plan a restore ended, one line each, so the owner can put right
 * what a restore cannot. Every way a plan ends records SUBSCRIPTION_ENDED and the replay above ends
 * it again; a recorded agency plan change or downgrade puts its replacement back too. `planToHave`
 * is the plan the last recorded ending put in its place (none after a closing, the owner ending
 * it, a lapse or a refund), taken from the audit chain, never from the pre-incident branch's live
 * rows; `planNow` is what they have on the restored branch. `needsAction` is true when those
 * differ: a replacement that could not be put back, or a traveller's switch to a plan they paid for
 * (their payment is not restored). Ids and plan keys only, never a name or an email.
 */
export interface PlanToCheck {
  readonly subscriptionId: string;
  readonly organizationId: string | null;
  readonly payerAccountId: string | null;
  readonly endedPlanKey: string | null;
  /** Why it ended (`plan_changed`, `plan_lapsed`, `refunded`, `application_rejected`, ...). */
  readonly reason: string | null;
  readonly endedAt: Date;
  readonly planNow: string | null;
  readonly planToHave: string | null;
  readonly needsAction: boolean;
}

interface SubscriptionOwner {
  readonly organization_id: string | null;
  readonly payer_account_id: string | null;
  readonly plan_key: string | null;
}

/** Whose subscription this is, and its plan, on one branch (null when it is not there). */
async function subscriptionOwner(
  db: Db,
  subscriptionId: string,
): Promise<SubscriptionOwner | null> {
  const payer = (await personBillingPresent(db)) ? sql`s.payer_account_id` : sql`null::uuid`;
  return (
    resultRows<SubscriptionOwner>(
      await db.execute(sql`
        select s.organization_id, ${payer} as payer_account_id, p.key as plan_key
        from subscriptions s left join plans p on p.id = s.plan_id
        where s.id::text = ${subscriptionId}`),
    )[0] ?? null
  );
}

/** The plan key an agency or traveller currently has on the restored branch, or null. */
async function currentPlanOf(db: Db, owner: SubscriptionOwner): Promise<string | null> {
  const whose =
    owner.organization_id !== null
      ? sql`s.organization_id = ${owner.organization_id}::uuid`
      : (await personBillingPresent(db)) && owner.payer_account_id !== null
        ? sql`s.payer_account_id = ${owner.payer_account_id}::uuid`
        : null;
  if (whose === null) return null;
  return (
    resultRows<{ plan_key: string | null }>(
      await db.execute(sql`
        select p.key as plan_key from subscriptions s left join plans p on p.id = s.plan_id
        where ${whose} and s.ended_at is null limit 1`),
    )[0]?.plan_key ?? null
  );
}

/** The plan key the recorded replacement started on, or null when nothing replaced it. */
async function planToHaveAfter(oldDb: Db, newDb: Db, event: AuditEventRow): Promise<string | null> {
  const replacedBy = metadataValue(event.metadata, 'replacedBy');
  if (typeof replacedBy !== 'string') return null;
  const replacement = await recordedReplacement(oldDb, replacedBy);
  if (!replacement) return null;
  if (replacement.planKey) return replacement.planKey;
  if (!replacement.planId) return null;
  for (const db of [newDb, oldDb]) {
    const plan = first(
      await db
        .select({ key: schema.plans.key })
        .from(schema.plans)
        .where(eq(schema.plans.id, replacement.planId)),
    );
    if (plan) return plan.key;
  }
  return null;
}

/** One line per agency or traveller (their last recorded ending), for the owner to check. */
async function listEndedPlans(
  oldDb: Db,
  newDb: Db,
  endings: readonly AuditEventRow[],
  errors: ReconciliationError[],
): Promise<PlanToCheck[]> {
  const byOwner = new Map<string, PlanToCheck>();
  for (const event of endings) {
    const subscriptionId = event.resourceId;
    if (!subscriptionId) continue;
    try {
      const owner =
        (await subscriptionOwner(newDb, subscriptionId)) ??
        (await subscriptionOwner(oldDb, subscriptionId));
      if (!owner) continue;
      const key = owner.organization_id ?? owner.payer_account_id;
      if (!key) continue;
      const planToHave = await planToHaveAfter(oldDb, newDb, event);
      const planNow = await currentPlanOf(newDb, owner);
      byOwner.set(key, {
        subscriptionId,
        organizationId: owner.organization_id,
        payerAccountId: owner.payer_account_id,
        endedPlanKey: owner.plan_key,
        reason: event.reason ?? null,
        endedAt: event.occurredAt,
        planNow,
        planToHave,
        needsAction: planToHave !== null && planToHave !== planNow,
      });
    } catch (error) {
      errors.push({
        eventType: 'SUBSCRIPTION_ENDED',
        resourceId: subscriptionId,
        message: `not listed for the owner: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return [...byOwner.values()];
}
