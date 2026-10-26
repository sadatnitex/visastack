import { CONSENT_TYPES, type ConsentType, isOk } from '@visastack/core';
import { and, asc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { caseExclusionsTablePresent } from './access/grant-scope';
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
  'GRANT_CASE_EXCLUDED',
  'GRANT_CASE_EXCLUSION_REMOVED',
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

// --- Per-case sharing exceptions (ADR 0017) ----------------------------------
//
// A "no" for one case (GRANT_CASE_EXCLUDED) narrows an all-cases grant or a
// pending all-cases invitation, so a restore that lost it would silently give
// the recipient that case again: it is replayed like a revocation. The
// owner's later "Allow This Case" (GRANT_CASE_EXCLUSION_REMOVED) is an
// explicit access decision, replayed in order exactly like a legal hold
// release, so the restored branch ends where the owner left it. Only the last
// event for each grant-or-invitation and case is applied (see
// `lastExceptionEvents`), so a second run is a clean no-op. Invitation
// carry-over on acceptance writes no event of its own: the grant it creates
// was made after the restore point and does not exist on the restored branch,
// while the invitation-bound exception is replayed from its own
// GRANT_CASE_EXCLUDED event.

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
 * branch predates migration 0090), so the parent is closed instead: an active
 * grant is paused, a grant still awaiting acceptance and a pending invitation
 * are revoked. The owner can resume or share again; the recipient never
 * silently regains the case. Audited on the restored branch.
 */
async function closeExceptionParent(newDb: Db, parent: ExceptionParent, missionId: string) {
  if (parent.kind === 'grant') {
    const paused = await newDb
      .update(schema.grants)
      .set({ status: 'PAUSED', updatedAt: new Date() })
      .where(and(eq(schema.grants.id, parent.id), eq(schema.grants.status, 'ACTIVE')))
      .returning({ id: schema.grants.id });
    const revoked = await newDb
      .update(schema.grants)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(and(eq(schema.grants.id, parent.id), eq(schema.grants.status, 'PENDING_ACCEPTANCE')))
      .returning({ id: schema.grants.id });
    if (paused.length + revoked.length === 0) return;
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
  GRANT_CASE_EXCLUDED: { counter: 'caseExceptionsAdded', resourceType: 'case_exception' },
  GRANT_CASE_EXCLUSION_REMOVED: {
    counter: 'caseExceptionsRemoved',
    resourceType: 'case_exception',
  },
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

  return { checked: events.length, counts, errors };
}
