import { CONSENT_TYPES, type ConsentType, isOk } from '@visastack/core';
import { and, asc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { purgeMissionUnconditionally } from './case-retention';
import { getConsents } from './consent';
import { type Db, first, schema } from './db';
import { executeAccountDeletion } from './deletion';
import { incrementMaterialRevision, missionsSelectingDocument } from './material-revision';

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
 * - Erasure (`ERASURE_VERIFIED`, `erasure.ts`) has exactly two enqueue
 *   sources -- account deletion (a single, ungated storage-object delete)
 *   and `retention.ts`'s `purgeExpiredDocuments` (gated behind every
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
  if (!org || org.status === 'CLOSED' || org.status === targetStatus) return false;
  await newDb
    .update(schema.organizations)
    .set({ status: targetStatus, updatedAt: new Date() })
    .where(eq(schema.organizations.id, resourceId));
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
  if (reason === 'ACCOUNT_DELETION' || reason === 'PROFILE_PHOTO_REMOVAL') {
    const deleted = await newDb
      .delete(schema.storageObjects)
      .where(eq(schema.storageObjects.id, resourceId))
      .returning({ id: schema.storageObjects.id });
    return deleted.length > 0;
  }
  if (reason === 'RETENTION_PURGE') {
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
    .orderBy(asc(schema.auditEvents.occurredAt));

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
  };
  const errors: ReconciliationError[] = [];
  const mutableCounts = counts as {
    -readonly [K in keyof ReconciliationCounts]: number;
  };

  for (const event of events) {
    const meta = EVENT_META[event.eventType as ReconciledEventType];
    if (!meta) continue;
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

  return { checked: events.length, counts, errors };
}
