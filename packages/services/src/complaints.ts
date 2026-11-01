import { type Result, err, ok } from '@visastack/core';
import { desc, eq, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { type CappedRows, getMissionForOwner } from './missions';
import { clampLimit } from './paging';
import { type PlatformAuthInput, canPerformPlatformAction } from './platform-roles';
import { elapsedSeconds, recordProductEvent } from './product-events';

/**
 * TRU-04 (master directive Part 7 §9): case complaint workflow.
 *
 * Two authorization paths, kept as separate functions rather than one
 * polymorphic entry point (mirroring `listSelectedEvidence`/
 * `listSelectedEvidenceForOrg`'s own owner-vs-privileged split):
 * `fileComplaint`/`withdrawOwnComplaint` are owner-only (`getMissionForOwner`
 * -- the filer acting on their own case), while `assignComplaintOwner`/
 * `updateComplaintStatus` require the new QUALITY_ADMIN platform role, since
 * an agency being complained about must never be the one who decides the
 * complaint is resolved.
 *
 * Unlike `legal-hold.ts`'s established platform-admin functions (which check
 * only step-up internally and rely on the calling web action to check the
 * role), these check `canPerformPlatformAction` directly inside the service
 * -- a deliberate, more defensive choice, since no web UI/action exists yet
 * for this chunk to lean on.
 */

export type CaseComplaint = typeof schema.caseComplaints.$inferSelect;
export type CaseComplaintEvent = typeof schema.caseComplaintEvents.$inferSelect;

/**
 * OPS-04 complaint resolution: how a complaint ended and how long it was open,
 * never the complaint's description or the resolution text. `how` is one of
 * RESOLVED, CLOSED (by the quality reviewer) or WITHDRAWN (by the filer).
 */
async function recordComplaintEnded(
  tx: Db,
  complaint: CaseComplaint,
  actorAccountId: string,
  how: 'RESOLVED' | 'CLOSED' | 'WITHDRAWN',
): Promise<void> {
  const mission = first(
    await tx
      .select({ organizationId: schema.missions.ownerOrganizationId })
      .from(schema.missions)
      .where(eq(schema.missions.id, complaint.missionId))
      .limit(1),
  );
  await recordProductEvent(tx, {
    eventType: 'COMPLAINT_RESOLVED',
    accountId: actorAccountId,
    organizationId: mission?.organizationId ?? null,
    dimension: how,
    metricValue: elapsedSeconds(complaint.createdAt),
  });
}

export async function fileComplaint(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly missionId: string;
    readonly description: string;
  },
): Promise<Result<CaseComplaint, ServiceError>> {
  const owned = await getMissionForOwner(db, input.actorAccountId, input.missionId);
  if (!owned.ok) return owned;

  const description = input.description.trim();
  if (description.length === 0) return err(serviceError('invalid', 'a description is required'));

  return db.transaction(async (tx) => {
    const complaint = required(
      first(
        await tx
          .insert(schema.caseComplaints)
          .values({
            missionId: input.missionId,
            filedByAccountId: input.actorAccountId,
            description,
            status: 'OPEN',
          })
          .returning(),
      ),
      'complaint',
    );
    await tx.insert(schema.caseComplaintEvents).values({
      complaintId: complaint.id,
      fromStatus: null,
      toStatus: 'OPEN',
      actorAccountId: input.actorAccountId,
      note: null,
    });
    await appendAuditEvent(tx, {
      eventType: 'CASE_COMPLAINT_FILED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'case_complaint',
      resourceId: complaint.id,
    });
    return ok(complaint);
  });
}

/**
 * Every complaint filed on a mission, newest first (owner-scoped). With `options.limit` (WP-SB2) only the
 * newest `limit` rows come back (clamped to 1 to 100) with the case's total, behind the same owner
 * check.
 */
export async function listComplaintsForMission(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<CaseComplaint[], ServiceError>>;
export async function listComplaintsForMission(
  db: Db,
  actorAccountId: string,
  missionId: string,
  options: { readonly limit?: number },
): Promise<Result<CappedRows<CaseComplaint>, ServiceError>>;
export async function listComplaintsForMission(
  db: Db,
  actorAccountId: string,
  missionId: string,
  options?: { readonly limit?: number },
): Promise<Result<CaseComplaint[] | CappedRows<CaseComplaint>, ServiceError>> {
  const owned = await getMissionForOwner(db, actorAccountId, missionId);
  if (!owned.ok) return owned;
  if (!options) {
    const rows = await db
      .select()
      .from(schema.caseComplaints)
      .where(eq(schema.caseComplaints.missionId, missionId));
    return ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  }
  const onCase = eq(schema.caseComplaints.missionId, missionId);
  const [items, counts] = await Promise.all([
    db
      .select()
      .from(schema.caseComplaints)
      .where(onCase)
      .orderBy(desc(schema.caseComplaints.createdAt), desc(schema.caseComplaints.id))
      .limit(clampLimit(options.limit)),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.caseComplaints).where(onCase),
  ]);
  return ok({ items, total: Number(counts[0]?.total ?? 0) });
}

/** A complaint's full history, oldest first (owner-scoped to its filer's own mission). */
export async function listComplaintEvents(
  db: Db,
  actorAccountId: string,
  complaintId: string,
): Promise<Result<CaseComplaintEvent[], ServiceError>> {
  const complaint = first(
    await db
      .select()
      .from(schema.caseComplaints)
      .where(eq(schema.caseComplaints.id, complaintId))
      .limit(1),
  );
  if (!complaint) return err(serviceError('not_found', 'complaint not found'));
  const owned = await getMissionForOwner(db, actorAccountId, complaint.missionId);
  if (!owned.ok) return owned;
  const rows = await db
    .select()
    .from(schema.caseComplaintEvents)
    .where(eq(schema.caseComplaintEvents.complaintId, complaintId));
  return ok([...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()));
}

/** A filer withdrawing their own still-open complaint. Always moves to CLOSED. */
export async function withdrawOwnComplaint(
  db: Db,
  input: { readonly actorAccountId: string; readonly complaintId: string },
): Promise<Result<CaseComplaint, ServiceError>> {
  return db.transaction(async (tx) => {
    const complaint = first(
      await tx
        .select()
        .from(schema.caseComplaints)
        .where(eq(schema.caseComplaints.id, input.complaintId))
        .limit(1)
        .for('update'),
    );
    if (!complaint) return err(serviceError('not_found', 'complaint not found'));
    if (complaint.filedByAccountId !== input.actorAccountId) {
      return err(serviceError('forbidden', 'only the filer can withdraw their own complaint'));
    }
    if (complaint.status === 'RESOLVED' || complaint.status === 'CLOSED') {
      return err(
        serviceError('invalid', `cannot withdraw a complaint that is already ${complaint.status}`),
      );
    }
    const updated = required(
      first(
        await tx
          .update(schema.caseComplaints)
          .set({ status: 'CLOSED', updatedAt: new Date() })
          .where(eq(schema.caseComplaints.id, complaint.id))
          .returning(),
      ),
      'complaint',
    );
    await tx.insert(schema.caseComplaintEvents).values({
      complaintId: complaint.id,
      fromStatus: complaint.status,
      toStatus: 'CLOSED',
      actorAccountId: input.actorAccountId,
      note: 'Withdrawn by filer.',
    });
    await appendAuditEvent(tx, {
      eventType: 'CASE_COMPLAINT_WITHDRAWN',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: complaint.missionId,
      resourceType: 'case_complaint',
      resourceId: complaint.id,
    });
    await recordComplaintEnded(tx, complaint, input.actorAccountId, 'WITHDRAWN');
    return ok(updated);
  });
}

const COMPLAINT_TRANSITIONS: Readonly<
  Record<CaseComplaint['status'], readonly CaseComplaint['status'][]>
> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
  RESOLVED: [],
  CLOSED: [],
};

export interface UpdateComplaintStatusInput {
  readonly actor: PlatformAuthInput;
  readonly complaintId: string;
  readonly status: 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  /** Required when `status` is RESOLVED; ignored otherwise. */
  readonly resolution?: string;
  readonly note?: string;
}

/** QUALITY_ADMIN-only: move a complaint through its workflow. */
export async function updateComplaintStatus(
  db: Db,
  input: UpdateComplaintStatusInput,
): Promise<Result<CaseComplaint, ServiceError>> {
  if (!(await canPerformPlatformAction(db, input.actor, 'COMPLAINT_MANAGE'))) {
    return err(serviceError('forbidden', 'quality-admin permission is required'));
  }
  const resolution = input.resolution?.trim();
  if (input.status === 'RESOLVED' && (!resolution || resolution.length === 0)) {
    return err(serviceError('invalid', 'a resolution is required to resolve a complaint'));
  }

  return db.transaction(async (tx) => {
    const complaint = first(
      await tx
        .select()
        .from(schema.caseComplaints)
        .where(eq(schema.caseComplaints.id, input.complaintId))
        .limit(1)
        .for('update'),
    );
    if (!complaint) return err(serviceError('not_found', 'complaint not found'));
    if (!COMPLAINT_TRANSITIONS[complaint.status].includes(input.status)) {
      return err(
        serviceError(
          'invalid',
          `cannot move a complaint from ${complaint.status} to ${input.status}`,
        ),
      );
    }

    const updated = required(
      first(
        await tx
          .update(schema.caseComplaints)
          .set({
            status: input.status,
            resolution: input.status === 'RESOLVED' ? (resolution ?? null) : complaint.resolution,
            updatedAt: new Date(),
          })
          .where(eq(schema.caseComplaints.id, complaint.id))
          .returning(),
      ),
      'complaint',
    );
    await tx.insert(schema.caseComplaintEvents).values({
      complaintId: complaint.id,
      fromStatus: complaint.status,
      toStatus: input.status,
      actorAccountId: input.actor.accountId,
      note: input.status === 'RESOLVED' ? (resolution ?? null) : (input.note?.trim() ?? null),
    });
    await appendAuditEvent(tx, {
      eventType: 'CASE_COMPLAINT_STATUS_CHANGED',
      actorAccountId: input.actor.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: complaint.missionId,
      resourceType: 'case_complaint',
      resourceId: complaint.id,
      metadata: { from: complaint.status, to: input.status },
    });
    if (input.status === 'RESOLVED' || input.status === 'CLOSED') {
      await recordComplaintEnded(tx, complaint, input.actor.accountId, input.status);
    }
    return ok(updated);
  });
}

/** QUALITY_ADMIN-only: assign (or reassign) who is responsible for handling a complaint. */
export async function assignComplaintOwner(
  db: Db,
  input: {
    readonly actor: PlatformAuthInput;
    readonly complaintId: string;
    readonly ownerAccountId: string;
  },
): Promise<Result<CaseComplaint, ServiceError>> {
  if (!(await canPerformPlatformAction(db, input.actor, 'COMPLAINT_MANAGE'))) {
    return err(serviceError('forbidden', 'quality-admin permission is required'));
  }
  return db.transaction(async (tx) => {
    const complaint = first(
      await tx
        .select()
        .from(schema.caseComplaints)
        .where(eq(schema.caseComplaints.id, input.complaintId))
        .limit(1),
    );
    if (!complaint) return err(serviceError('not_found', 'complaint not found'));
    const updated = required(
      first(
        await tx
          .update(schema.caseComplaints)
          .set({ ownerAccountId: input.ownerAccountId, updatedAt: new Date() })
          .where(eq(schema.caseComplaints.id, complaint.id))
          .returning(),
      ),
      'complaint',
    );
    await tx.insert(schema.caseComplaintEvents).values({
      complaintId: complaint.id,
      fromStatus: complaint.status,
      toStatus: complaint.status,
      actorAccountId: input.actor.accountId,
      note: `Assigned to account ${input.ownerAccountId}.`,
    });
    await appendAuditEvent(tx, {
      eventType: 'CASE_COMPLAINT_ASSIGNED',
      actorAccountId: input.actor.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: complaint.missionId,
      resourceType: 'case_complaint',
      resourceId: complaint.id,
      metadata: { ownerAccountId: input.ownerAccountId },
    });
    return ok(updated);
  });
}

/** QUALITY_ADMIN-only: every complaint platform-wide, newest first (for triage). */
export async function listComplaintsForQualityReview(
  db: Db,
  actor: PlatformAuthInput,
): Promise<Result<CaseComplaint[], ServiceError>> {
  if (!(await canPerformPlatformAction(db, actor, 'COMPLAINT_MANAGE'))) {
    return err(serviceError('forbidden', 'quality-admin permission is required'));
  }
  const rows = await db.select().from(schema.caseComplaints);
  return ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}
