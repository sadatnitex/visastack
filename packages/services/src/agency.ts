import type {
  AccountId,
  AgencyId,
  ApplicantId,
  DocumentId,
  MissionId,
  MissionState,
  PermissionAction,
} from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { authorize } from '@visastack/policy';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { isDocumentVersionUsable } from './documents';
import { activeOrVerifiedErasureStorageObjectIds } from './erasure';
import { type ServiceError, serviceError } from './errors';
import {
  cancelQueuedNotificationsForResource,
  enqueueNotificationBothChannels,
} from './notifications';
import { getOrganization, isOrgAdmin } from './organizations';
import { type PackRequirement, listRequirements } from './packs';
import { recordProductEvent } from './product-events';
import { RATE_LIMITS, checkRateLimit, checkRateLimits } from './rate-limit';
import { loadGrantsForPolicy } from './sharing';

/**
 * Collaboration surface (Build Spec §2; PRD §5): assignments, mission notes,
 * evidence requests, and permissioned bulk export.
 *
 * Assignment and notes are organizational bookkeeping, but — unlike the
 * pre-PR-2 version of this file — bookkeeping is no longer accepted at face
 * value: every mutating function here proves the organization currently
 * holds a real, active, accepted, unexpired grant that would permit the
 * relevant action, before touching the mission/applicant. Membership alone
 * is still never access (Build Spec law 2); it is the entry ticket, not the
 * grant.
 */

export type Assignment = typeof schema.assignments.$inferSelect;
export type MissionNote = typeof schema.missionNotes.$inferSelect;
export type EvidenceRequest = typeof schema.evidenceRequests.$inferSelect;
export type EvidenceRequestDecision = typeof schema.evidenceRequestDecisions.$inferSelect;

/**
 * Whether a document's CURRENT (highest version-numbered) version is
 * currently safe, fully processed, and unerased: the exact gate Commercial
 * V1 Part 4 §10 means by "upload can move to RECEIVED only after safe
 * processing" and "malware/failed/unrelated evidence cannot close a
 * request." Mirrors `missions.ts`'s own `loadDocumentInstancesByType`
 * query/eligibility logic (the same canonical definition of "usable"), just
 * scoped to one document instead of bulk-loading an applicant's whole set.
 */
async function documentIsUsable(db: Db, documentId: string): Promise<boolean> {
  const versions = await db
    .select({
      versionNumber: schema.documentVersions.versionNumber,
      safetyStatus: schema.documentVersions.safetyStatus,
      processingStatus: schema.documentVersions.processingStatus,
      storageObjectId: schema.documentVersions.storageObjectId,
    })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, documentId));
  const latest = versions.reduce<(typeof versions)[number] | undefined>(
    (best, row) => (!best || row.versionNumber > best.versionNumber ? row : best),
    undefined,
  );
  if (!latest) return false;
  const erased = await activeOrVerifiedErasureStorageObjectIds(db, [latest.storageObjectId]);
  return isDocumentVersionUsable({
    safetyStatus: latest.safetyStatus,
    processingStatus: latest.processingStatus,
    erased: erased.has(latest.storageObjectId),
  });
}

/**
 * True if the organization holds at least one grant for `applicantId` that,
 * evaluated on the grant's own declared purpose, permits `action` — scoped
 * to `missionId` if given. Reuses the canonical policy engine
 * (`packages/policy`) per candidate grant instead of re-deriving scope/
 * status/expiry rules here, so mission-scope-vs-applicant-wide semantics
 * (Build Spec law 5) stay in exactly one place.
 *
 * This answers "does the org currently have standing here at all" — a
 * coarser, non-purpose-bound question than `authorize()`'s "can this
 * specific request proceed" (which callers already answer separately for
 * actual data access). Callers of this function are responsible for
 * verifying the acting individual's own membership/role before calling it —
 * this only proves the ORGANIZATION's grant, not the caller's standing
 * within it.
 */
export async function orgGrantPermits(
  db: Db,
  organizationId: string,
  applicantId: string,
  action: PermissionAction,
  missionId?: string,
): Promise<boolean> {
  // SHR-02: a suspended/closed organization has no standing at all, even
  // with an otherwise-valid grant still on the books.
  const org = await getOrganization(db, organizationId);
  if (!org || org.status !== 'ACTIVE') return false;
  const grants = await loadGrantsForPolicy(db, applicantId);
  const orgGrants = grants.filter((g) => g.recipientOrganizationId === organizationId);
  if (orgGrants.length === 0) return false;
  const now = new Date();
  return orgGrants.some(
    (g) =>
      authorize({
        actor: {
          kind: 'organization_member',
          accountId: 'org-grant-scope-check' as AccountId,
          membership: {
            organizationId: organizationId as AgencyId,
            role: 'ADMIN',
            active: true,
            organizationActive: true,
          },
        },
        action,
        resource: {
          applicantId: applicantId as ApplicantId,
          ...(missionId ? { missionId: missionId as MissionId } : {}),
        },
        context: { now, purpose: g.purpose, stepUpSatisfied: false, grants: [g] },
      }).allowed,
  );
}

/**
 * True if the account is an active member (any role) of the organization.
 * Exported for `apps/web`'s org console page (finding #31, post-programme
 * defect register): the page used to gate its ENTIRE mission-collaboration
 * UI behind `isOrgAdmin`, making the reviewer-decision workflow this
 * function itself authorizes (below) unreachable for the non-admin
 * `REVIEWER`/`CASE_MANAGER` members it's actually meant for.
 */
export async function isActiveMember(
  db: Db,
  accountId: string,
  organizationId: string,
): Promise<boolean> {
  const m = first(
    await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, accountId),
          eq(schema.memberships.organizationId, organizationId),
        ),
      )
      .limit(1),
  );
  return m?.active === true;
}

/**
 * Assign an org member to a mission (org OWNER/ADMIN only).
 *
 * Proves, in order: the actor is an active org OWNER/ADMIN; the assignee is
 * an active member of the SAME organization (not just any account id); the
 * mission exists; and the organization currently holds an active, accepted,
 * unexpired grant that would permit `MANAGE` on that mission (mission-scoped
 * or applicant-wide) — closing the confirmed gap where an org could assign
 * members to missions it has no relationship to at all
 * (docs/audits/commercial-readiness-recovery-baseline.md §7).
 *
 * Idempotent at the application layer: an identical (org, mission, member)
 * assignment returns the existing row rather than inserting a duplicate.
 */
export async function assignMember(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly memberAccountId: string;
    readonly missionId: string;
  },
): Promise<Result<Assignment, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can assign members'));
  }
  if (!(await isActiveMember(db, input.memberAccountId, input.organizationId))) {
    return err(
      serviceError('invalid', 'the assignee must be an active member of this organization'),
    );
  }
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, input.missionId)).limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'mission not found'));
  if (
    !(await orgGrantPermits(db, input.organizationId, mission.applicantId, 'MANAGE', mission.id))
  ) {
    return err(
      serviceError('forbidden', 'this organization has no current grant covering that mission'),
    );
  }

  const existing = first(
    await db
      .select()
      .from(schema.assignments)
      .where(
        and(
          eq(schema.assignments.organizationId, input.organizationId),
          eq(schema.assignments.missionId, input.missionId),
          eq(schema.assignments.memberAccountId, input.memberAccountId),
        ),
      )
      .limit(1),
  );
  if (existing) return ok(existing);

  return db.transaction(async (tx) => {
    const assignment = required(
      first(
        await tx
          .insert(schema.assignments)
          .values({
            organizationId: input.organizationId,
            memberAccountId: input.memberAccountId,
            missionId: input.missionId,
          })
          .returning(),
      ),
      'assignment',
    );
    await appendAuditEvent(tx, {
      eventType: 'MEMBER_ASSIGNED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: mission.applicantId,
      missionId: input.missionId,
      resourceType: 'assignment',
      resourceId: assignment.id,
      metadata: { organizationId: input.organizationId, memberAccountId: input.memberAccountId },
    });
    return ok(assignment);
  });
}

/**
 * Remove one member's assignment from a mission (admin-gated, same bar as
 * `assignMember`). Commercial V1 Part 4 §11's counterpart to "Create
 * reassignment queue": deactivating a member (`setMembershipActive` in
 * `organizations.ts`) already calls this automatically for every mission
 * where they were the SOLE assignee, so this function also serves an org
 * admin choosing to unassign someone directly, case still active, without
 * deactivating their membership at all.
 */
export async function unassignMember(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly memberAccountId: string;
    readonly missionId: string;
  },
): Promise<Result<{ readonly removed: boolean }, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can unassign members'));
  }
  return db.transaction(async (tx) => {
    const existing = first(
      await tx
        .select({ id: schema.assignments.id })
        .from(schema.assignments)
        .where(
          and(
            eq(schema.assignments.organizationId, input.organizationId),
            eq(schema.assignments.missionId, input.missionId),
            eq(schema.assignments.memberAccountId, input.memberAccountId),
          ),
        )
        .limit(1),
    );
    if (!existing) return ok({ removed: false });
    await tx.delete(schema.assignments).where(eq(schema.assignments.id, existing.id));
    await appendAuditEvent(tx, {
      eventType: 'MEMBER_UNASSIGNED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'assignment',
      resourceId: existing.id,
      metadata: { organizationId: input.organizationId, memberAccountId: input.memberAccountId },
    });
    return ok({ removed: true });
  });
}

/**
 * Missions this organization currently holds a grant to act on but that
 * have NO assigned member at all -- the "reassignment queue" Commercial V1
 * Part 4 §11 names: a case a departed/deactivated member's sole assignment
 * was automatically removed from (`organizations.ts`'s `setMembershipActive`)
 * lands here until an admin assigns someone new. Excludes terminal-state
 * missions (CLOSED/CANCELLED): a finished case needs no reassignment.
 */
export async function listUnassignedActiveMissions(
  db: Db,
  organizationId: string,
): Promise<OrgMission[]> {
  const missions = await listMissionsForOrganization(db, organizationId);
  const assigned = new Set(
    (
      await db
        .select({ missionId: schema.assignments.missionId })
        .from(schema.assignments)
        .where(eq(schema.assignments.organizationId, organizationId))
    ).map((a) => a.missionId),
  );
  const active = await db
    .select({ id: schema.missions.id, state: schema.missions.state })
    .from(schema.missions)
    .where(
      inArray(
        schema.missions.id,
        missions.map((m) => m.missionId),
      ),
    );
  const activeStateByMissionId = new Map(active.map((m) => [m.id, m.state]));
  return missions.filter((m) => {
    const state = activeStateByMissionId.get(m.missionId);
    return !assigned.has(m.missionId) && state !== 'CLOSED' && state !== 'CANCELLED';
  });
}

export async function listAssignments(db: Db, missionId: string): Promise<Assignment[]> {
  return db.select().from(schema.assignments).where(eq(schema.assignments.missionId, missionId));
}

/**
 * Every mission (within one organization) an account is currently
 * assigned to. The non-admin visibility boundary the org console page
 * enforces (Codex review, PR-D2, finding #31): "Agency staff / reviewer
 * ... Sees only assigned applicants and missions covered by an effective
 * grant" (Build Spec §2, `docs/product/build-spec-v1.1.md:61-63`) — an org
 * OWNER/ADMIN is exempt from this filter entirely (they see every mission
 * the organization holds a grant for); this exists specifically for the
 * narrower non-admin path.
 */
export async function listAssignedMissionIds(
  db: Db,
  organizationId: string,
  memberAccountId: string,
): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ missionId: schema.assignments.missionId })
    .from(schema.assignments)
    .where(
      and(
        eq(schema.assignments.organizationId, organizationId),
        eq(schema.assignments.memberAccountId, memberAccountId),
      ),
    );
  return new Set(rows.map((r) => r.missionId));
}

/** An assignment resolved with the member's email, for the org console. */
export interface AssignmentView {
  readonly id: string;
  readonly memberAccountId: string;
  readonly memberEmail: string;
  readonly createdAt: string;
}

/**
 * True if the organization currently holds a grant permitting `COMMENT` or
 * `MANAGE` on this specific mission — the bar `addNote`/`assignMember`
 * already require to write. Read access to notes/assignee identities must
 * never be broader than write access to the same mission
 * (docs/audits/post-programme-defect-register.md finding #5): an
 * applicant-wide grant scoped to, say, `PREVIEW` alone must not expose note
 * bodies or assignee emails.
 */
async function canReadMissionCollaboration(
  db: Db,
  organizationId: string,
  applicantId: string,
  missionId: string,
): Promise<boolean> {
  return (
    (await orgGrantPermits(db, organizationId, applicantId, 'COMMENT', missionId)) ||
    (await orgGrantPermits(db, organizationId, applicantId, 'MANAGE', missionId))
  );
}

/**
 * Same as `listAssignments`, but resolves each assignee's email — gated on
 * `canReadMissionCollaboration` (finding #5 above); returns empty rather
 * than throwing so a caller iterating every reachable mission doesn't need
 * a separate authorization branch per mission.
 *
 * Scoped to THIS organization's own assignment rows (Codex review, PR-D2,
 * round 2): a mission can be granted to more than one organization at once
 * (each org assigns its own members independently via `assignMember`,
 * which stamps every row with its own `organizationId`), so a query
 * filtered only by `missionId` returned every organization's assignee
 * emails to whichever org happened to read this mission first — a
 * cross-tenant identity leak, and pre-existing (`5a62bc0`) though PR-D2's
 * new non-admin path makes it reachable by more callers than before.
 */
export async function listAssignmentsDetailed(
  db: Db,
  organizationId: string,
  applicantId: string,
  missionId: string,
): Promise<AssignmentView[]> {
  if (!(await canReadMissionCollaboration(db, organizationId, applicantId, missionId))) return [];
  const rows = await db
    .select({
      id: schema.assignments.id,
      memberAccountId: schema.assignments.memberAccountId,
      memberEmail: schema.accounts.email,
      createdAt: schema.assignments.createdAt,
    })
    .from(schema.assignments)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.assignments.memberAccountId))
    .where(
      and(
        eq(schema.assignments.organizationId, organizationId),
        eq(schema.assignments.missionId, missionId),
      ),
    );
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export type OrgVisibleTask = typeof schema.missionTasks.$inferSelect;

/**
 * Tasks on a mission, org-read-scoped exactly like `listNotes`/
 * `listAssignmentsDetailed` above (`canReadMissionCollaboration`: COMMENT or
 * MANAGE). CAS-02's workspace rollup needs a real "overdue tasks" signal,
 * which needs this to exist at all -- this is currently the ONLY org-facing
 * task read path; creating, assigning, or completing a task remains
 * applicant-owner-only (`missions.ts`'s `ownedMission`), a CAS-04 write-side
 * gap this chunk does not close (tracked in `known-issues.md`).
 */
export async function listTasksForOrg(
  db: Db,
  organizationId: string,
  applicantId: string,
  missionId: string,
): Promise<OrgVisibleTask[]> {
  if (!(await canReadMissionCollaboration(db, organizationId, applicantId, missionId))) return [];
  return db.select().from(schema.missionTasks).where(eq(schema.missionTasks.missionId, missionId));
}

/**
 * The gate every org-side task/appointment write shares (mirrors
 * `recordMissionDecision`'s own three-part check exactly): an active member,
 * assigned to this specific mission -- not merely any active member of the
 * org -- whose organization currently holds a MANAGE grant covering it.
 * Routine caseworker write access, deliberately looser than `assignMember`/
 * `requestEvidence`'s admin-only bar: creating or completing a task is
 * day-to-day case work, not an organizational management action.
 */
async function loadMissionForOrgWrite(
  db: Db,
  organizationId: string,
  actorAccountId: string,
  missionId: string,
) {
  if (!(await isActiveMember(db, actorAccountId, organizationId))) {
    return err(serviceError('forbidden', 'not an active member of this organization'));
  }
  if (!(await assignedToMission(db, organizationId, actorAccountId, missionId))) {
    return err(serviceError('forbidden', 'not assigned to this mission'));
  }
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'mission not found'));
  if (!(await orgGrantPermits(db, organizationId, mission.applicantId, 'MANAGE', mission.id))) {
    return err(
      serviceError('forbidden', 'this organization has no current grant covering that mission'),
    );
  }
  return ok(mission);
}

export interface CreateTaskForOrgInput {
  readonly actorAccountId: string;
  readonly organizationId: string;
  readonly missionId: string;
  readonly description: string;
  readonly assigneeAccountId?: string;
  readonly dueDate?: Date;
  readonly dueTimezone?: string;
  readonly priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

/** Org-side task creation (Commercial V1 Part 4 §11) -- the write path `listTasksForOrg`'s own doc comment named as still open. */
export async function createTaskForOrg(
  db: Db,
  input: CreateTaskForOrgInput,
): Promise<Result<OrgVisibleTask, ServiceError>> {
  const description = input.description.trim();
  if (description.length === 0) return err(serviceError('invalid', 'a description is required'));
  const mission = await loadMissionForOrgWrite(
    db,
    input.organizationId,
    input.actorAccountId,
    input.missionId,
  );
  if (!mission.ok) return mission;

  return db.transaction(async (tx) => {
    const task = required(
      first(
        await tx
          .insert(schema.missionTasks)
          .values({
            missionId: input.missionId,
            description,
            assigneeAccountId: input.assigneeAccountId ?? null,
            dueDate: input.dueDate ?? null,
            dueTimezone: input.dueTimezone ?? null,
            ...(input.priority ? { priority: input.priority } : {}),
          })
          .returning(),
      ),
      'mission task',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_TASK_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'mission_task',
      resourceId: task.id,
    });
    return ok(task);
  });
}

export interface UpdateTaskForOrgInput {
  readonly actorAccountId: string;
  readonly organizationId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly assigneeAccountId?: string | null;
  readonly dueDate?: Date | null;
  readonly dueTimezone?: string | null;
  readonly priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

/** Org-side reassignment/reschedule/re-prioritization, audited exactly like the owner-side `updateTask`. */
export async function updateTaskForOrg(
  db: Db,
  input: UpdateTaskForOrgInput,
): Promise<Result<OrgVisibleTask, ServiceError>> {
  const mission = await loadMissionForOrgWrite(
    db,
    input.organizationId,
    input.actorAccountId,
    input.missionId,
  );
  if (!mission.ok) return mission;

  return db.transaction(async (tx) => {
    const task = first(
      await tx
        .select()
        .from(schema.missionTasks)
        .where(
          and(
            eq(schema.missionTasks.id, input.taskId),
            eq(schema.missionTasks.missionId, input.missionId),
          ),
        )
        .limit(1),
    );
    if (!task) return err(serviceError('not_found', 'task not found'));

    let changes: Record<string, { readonly before: unknown; readonly after: unknown }> = {};
    if (input.assigneeAccountId !== undefined) {
      changes = {
        ...changes,
        assigneeAccountId: { before: task.assigneeAccountId, after: input.assigneeAccountId },
      };
    }
    if (input.dueDate !== undefined) {
      changes = {
        ...changes,
        dueDate: {
          before: task.dueDate?.toISOString() ?? null,
          after: input.dueDate?.toISOString() ?? null,
        },
      };
    }
    if (input.dueTimezone !== undefined) {
      changes = {
        ...changes,
        dueTimezone: { before: task.dueTimezone, after: input.dueTimezone },
      };
    }
    if (input.priority !== undefined) {
      changes = { ...changes, priority: { before: task.priority, after: input.priority } };
    }
    if (Object.keys(changes).length === 0) return ok(task);

    const updated = required(
      first(
        await tx
          .update(schema.missionTasks)
          .set({
            ...(input.assigneeAccountId !== undefined
              ? { assigneeAccountId: input.assigneeAccountId }
              : {}),
            ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
            ...(input.dueTimezone !== undefined ? { dueTimezone: input.dueTimezone } : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.missionTasks.id, input.taskId))
          .returning(),
      ),
      'mission task',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_TASK_UPDATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'mission_task',
      resourceId: task.id,
      metadata: { changes },
    });
    return ok(updated);
  });
}

/** Org-side task state transition, sharing `missions.ts`'s `decideTask` state machine (OPEN -> IN_PROGRESS -> DONE/CANCELLED). */
export async function decideTaskForOrg(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly missionId: string;
    readonly taskId: string;
    readonly status: 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  },
): Promise<Result<OrgVisibleTask, ServiceError>> {
  const mission = await loadMissionForOrgWrite(
    db,
    input.organizationId,
    input.actorAccountId,
    input.missionId,
  );
  if (!mission.ok) return mission;

  return db.transaction(async (tx) => {
    const task = first(
      await tx
        .select()
        .from(schema.missionTasks)
        .where(
          and(
            eq(schema.missionTasks.id, input.taskId),
            eq(schema.missionTasks.missionId, input.missionId),
          ),
        )
        .limit(1),
    );
    if (!task) return err(serviceError('not_found', 'task not found'));
    if (!TASK_TRANSITIONS_FOR_ORG[task.status]?.includes(input.status)) {
      return err(
        serviceError('invalid', `cannot move a task from ${task.status} to ${input.status}`),
      );
    }
    const updated = required(
      first(
        await tx
          .update(schema.missionTasks)
          .set({
            status: input.status,
            completedAt:
              input.status === 'DONE' || input.status === 'CANCELLED' ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(schema.missionTasks.id, input.taskId))
          .returning(),
      ),
      'mission task',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_TASK_DECIDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'mission_task',
      resourceId: task.id,
      metadata: { from: task.status, status: input.status },
    });
    if (input.status === 'CANCELLED') {
      // Part 5 §4: a cancelled task invalidates its own still-QUEUED
      // TASK_DEADLINE reminders (NTF-04's sweep), if any are still pending.
      await cancelQueuedNotificationsForResource(tx, task.id);
    }
    return ok(updated);
  });
}

// Duplicated (not imported) from `missions.ts`'s own `TASK_TRANSITIONS`: two
// independently-authorized write paths (owner, org) sharing one state
// machine's SHAPE, matching this file's established convention of never
// importing a write path across the owner/org boundary.
const TASK_TRANSITIONS_FOR_ORG: Readonly<Record<string, readonly string[]>> = {
  OPEN: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

export type OrgVisibleAppointment = typeof schema.missionAppointments.$inferSelect;

export interface CreateAppointmentForOrgInput {
  readonly actorAccountId: string;
  readonly organizationId: string;
  readonly missionId: string;
  readonly title: string;
  readonly localDateTime: Date;
  readonly timezone: string;
  readonly assigneeAccountId?: string;
  readonly place?: string;
  readonly channel?: string;
}

/** Org-side appointment scheduling, the same shape as the owner-side `createAppointment` in `missions.ts`. */
export async function createAppointmentForOrg(
  db: Db,
  input: CreateAppointmentForOrgInput,
): Promise<Result<OrgVisibleAppointment, ServiceError>> {
  const title = input.title.trim();
  if (title.length === 0) return err(serviceError('invalid', 'a title is required'));
  const timezone = input.timezone.trim();
  if (timezone.length === 0) return err(serviceError('invalid', 'a timezone is required'));
  const mission = await loadMissionForOrgWrite(
    db,
    input.organizationId,
    input.actorAccountId,
    input.missionId,
  );
  if (!mission.ok) return mission;

  return db.transaction(async (tx) => {
    const appointment = required(
      first(
        await tx
          .insert(schema.missionAppointments)
          .values({
            missionId: input.missionId,
            title,
            assigneeAccountId: input.assigneeAccountId ?? null,
            localDateTime: input.localDateTime,
            timezone,
            place: input.place?.trim() || null,
            channel: input.channel?.trim() || null,
          })
          .returning(),
      ),
      'mission appointment',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_APPOINTMENT_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'mission_appointment',
      resourceId: appointment.id,
    });

    // NTF-02: "appointments" -- notify the applicant owner an org member
    // scheduled one on their case. Neutral: never the place/channel/title
    // details, just that an appointment exists and a deep link to see it.
    const owner = first(
      await tx
        .select({ ownerAccountId: schema.applicants.ownerAccountId })
        .from(schema.applicants)
        .where(eq(schema.applicants.id, mission.value.applicantId))
        .limit(1),
    );
    if (owner) {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'APPOINTMENT_SCHEDULED',
        resourceId: appointment.id,
        recipientAccountId: owner.ownerAccountId,
        applicantId: mission.value.applicantId,
        organizationId: input.organizationId,
        missionId: input.missionId,
        payload: {
          subject: 'Appointment scheduled',
          summary: 'An appointment was scheduled on your case.',
          deepLinkPath: `/app/mission/${input.missionId}`,
        },
      });
    }
    return ok(appointment);
  });
}

/** Org-side appointment reschedule/reassign, audited like `missions.ts`'s owner-side `updateAppointment`. */
export async function updateAppointmentForOrg(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly missionId: string;
    readonly appointmentId: string;
    readonly assigneeAccountId?: string | null;
    readonly localDateTime?: Date;
    readonly timezone?: string;
    readonly place?: string | null;
    readonly channel?: string | null;
  },
): Promise<Result<OrgVisibleAppointment, ServiceError>> {
  const mission = await loadMissionForOrgWrite(
    db,
    input.organizationId,
    input.actorAccountId,
    input.missionId,
  );
  if (!mission.ok) return mission;

  return db.transaction(async (tx) => {
    const appointment = first(
      await tx
        .select()
        .from(schema.missionAppointments)
        .where(
          and(
            eq(schema.missionAppointments.id, input.appointmentId),
            eq(schema.missionAppointments.missionId, input.missionId),
          ),
        )
        .limit(1),
    );
    if (!appointment) return err(serviceError('not_found', 'appointment not found'));

    let changes: Record<string, { readonly before: unknown; readonly after: unknown }> = {};
    if (input.assigneeAccountId !== undefined) {
      changes = {
        ...changes,
        assigneeAccountId: {
          before: appointment.assigneeAccountId,
          after: input.assigneeAccountId,
        },
      };
    }
    if (input.localDateTime !== undefined) {
      changes = {
        ...changes,
        localDateTime: {
          before: appointment.localDateTime.toISOString(),
          after: input.localDateTime.toISOString(),
        },
      };
    }
    if (input.timezone !== undefined) {
      changes = { ...changes, timezone: { before: appointment.timezone, after: input.timezone } };
    }
    if (input.place !== undefined) {
      changes = { ...changes, place: { before: appointment.place, after: input.place } };
    }
    if (input.channel !== undefined) {
      changes = { ...changes, channel: { before: appointment.channel, after: input.channel } };
    }
    if (Object.keys(changes).length === 0) return ok(appointment);

    const updated = required(
      first(
        await tx
          .update(schema.missionAppointments)
          .set({
            ...(input.assigneeAccountId !== undefined
              ? { assigneeAccountId: input.assigneeAccountId }
              : {}),
            ...(input.localDateTime !== undefined ? { localDateTime: input.localDateTime } : {}),
            ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
            ...(input.place !== undefined ? { place: input.place } : {}),
            ...(input.channel !== undefined ? { channel: input.channel } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.missionAppointments.id, input.appointmentId))
          .returning(),
      ),
      'mission appointment',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_APPOINTMENT_UPDATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'mission_appointment',
      resourceId: appointment.id,
      metadata: { changes },
    });
    return ok(updated);
  });
}

/** Org-side appointment completion/cancellation. */
export async function decideAppointmentForOrg(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly missionId: string;
    readonly appointmentId: string;
    readonly status: 'DONE' | 'CANCELLED';
  },
): Promise<Result<OrgVisibleAppointment, ServiceError>> {
  const mission = await loadMissionForOrgWrite(
    db,
    input.organizationId,
    input.actorAccountId,
    input.missionId,
  );
  if (!mission.ok) return mission;

  return db.transaction(async (tx) => {
    const appointment = first(
      await tx
        .select()
        .from(schema.missionAppointments)
        .where(
          and(
            eq(schema.missionAppointments.id, input.appointmentId),
            eq(schema.missionAppointments.missionId, input.missionId),
          ),
        )
        .limit(1),
    );
    if (!appointment) return err(serviceError('not_found', 'appointment not found'));
    if (appointment.status !== 'OPEN') {
      return err(serviceError('invalid', 'only an OPEN appointment can be decided'));
    }
    const updated = required(
      first(
        await tx
          .update(schema.missionAppointments)
          .set({ status: input.status, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.missionAppointments.id, input.appointmentId))
          .returning(),
      ),
      'mission appointment',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_APPOINTMENT_DECIDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'mission_appointment',
      resourceId: appointment.id,
      metadata: { status: input.status },
    });
    if (input.status === 'CANCELLED') {
      // Part 5 §4: a cancelled appointment invalidates its own still-QUEUED
      // APPOINTMENT_SCHEDULED notice, if the worker hasn't sent it yet.
      await cancelQueuedNotificationsForResource(tx, appointment.id);
    }
    return ok(updated);
  });
}

/** Appointments on a mission, org-read-scoped exactly like `listTasksForOrg` (COMMENT or MANAGE), soonest first. */
export async function listAppointmentsForOrg(
  db: Db,
  organizationId: string,
  applicantId: string,
  missionId: string,
): Promise<OrgVisibleAppointment[]> {
  if (!(await canReadMissionCollaboration(db, organizationId, applicantId, missionId))) return [];
  const rows = await db
    .select()
    .from(schema.missionAppointments)
    .where(eq(schema.missionAppointments.missionId, missionId));
  return [...rows].sort((a, b) => a.localDateTime.getTime() - b.localDateTime.getTime());
}

/** A mission this org can act on (a grant naming it), for the collaboration console. */
export interface OrgMission {
  readonly missionId: string;
  readonly title: string;
  readonly applicantId: string;
  readonly applicantName: string;
}

/**
 * Missions reachable by this org via a CURRENT grant: `ACTIVE`, accepted,
 * started, and not expired. Mission-scoped grants match only their mission;
 * applicant-wide grants (`missionId IS NULL`) match every mission of that
 * applicant. Previously returned a mission for ANY grant row regardless of
 * status/acceptance/expiry — see
 * docs/audits/commercial-readiness-recovery-baseline.md §7.
 */
export async function listMissionsForOrganization(
  db: Db,
  organizationId: string,
): Promise<OrgMission[]> {
  const now = new Date();
  const rows = await db
    .selectDistinct({
      missionId: schema.missions.id,
      title: schema.missions.title,
      applicantId: schema.applicants.id,
      applicantName: schema.applicants.displayName,
      grantMissionId: schema.grants.missionId,
    })
    .from(schema.grants)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.grants.applicantId))
    .innerJoin(schema.missions, eq(schema.missions.applicantId, schema.applicants.id))
    .where(
      and(
        eq(schema.grants.recipientOrganizationId, organizationId),
        eq(schema.grants.status, 'ACTIVE'),
        isNotNull(schema.grants.acceptedAt),
        lte(schema.grants.startAt, now),
        or(isNull(schema.grants.expiryAt), gt(schema.grants.expiryAt, now)),
      ),
    );
  // A mission-scoped grant only reaches its own mission; the SQL join above
  // is applicant-wide (it must be, to also surface applicant-wide grants),
  // so the mission-scope narrowing happens here.
  const scoped = rows.filter((r) => r.grantMissionId === null || r.grantMissionId === r.missionId);
  // An applicant-wide grant and a mission-scoped grant for the same
  // applicant both survive the filter above as distinct rows for the
  // mission the scoped grant names — dedupe by missionId so the console
  // never renders (and never lets the user act on) the same mission twice
  // (docs/audits/post-programme-defect-register.md finding #7).
  const deduped = [...new Map(scoped.map((r) => [r.missionId, r])).values()];
  return deduped.map(({ missionId, title, applicantId, applicantName }) => ({
    missionId,
    title,
    applicantId,
    applicantName,
  }));
}

/** A case as the org console's workspace/search view needs it (CAS-02): enough to filter and summarize, never any wallet content. */
export interface OrgCaseSummary {
  readonly missionId: string;
  readonly applicantId: string;
  readonly applicantName: string;
  readonly title: string;
  readonly state: MissionState;
  readonly destination: string | null;
  readonly jurisdiction: string | null;
  readonly manualMode: boolean;
  readonly packVersionId: string | null;
  readonly targetDeadline: string | null;
  readonly travelStartDate: string | null;
  readonly updatedAt: string;
}

/**
 * Every case this actor may see in this organization's console, and whether
 * they're seeing it as an admin (the whole org's reachable cases) or as a
 * non-admin member (only cases they're personally assigned to, Build Spec
 * §2: "Agency staff / reviewer ... Sees only assigned applicants and
 * missions"). This is the single source of truth for that scoping rule --
 * previously duplicated ad hoc at the page layer (admin ? all : filter by
 * assignment), now centralized here so CAS-02's search can reuse the exact
 * same authorized set the default workspace view shows, never a separately
 * queried, potentially wider one (PRD CAS-02: "list queries and counts obey
 * the same object rules as detail pages").
 *
 * Callers must already know the actor is at least an active member (this
 * function, like `listMissionsForOrganization`, does not itself re-check
 * membership).
 */
export async function listVisibleMissionsForMember(
  db: Db,
  organizationId: string,
  actorAccountId: string,
): Promise<{ readonly admin: boolean; readonly missions: OrgCaseSummary[] }> {
  const admin = await isOrgAdmin(db, actorAccountId, organizationId);
  const base = await listMissionsForOrganization(db, organizationId);
  let scoped = base;
  if (!admin) {
    const assignedIds = await listAssignedMissionIds(db, organizationId, actorAccountId);
    scoped = base.filter((m) => assignedIds.has(m.missionId));
  }
  if (scoped.length === 0) return { admin, missions: [] };

  const rows = await db
    .select({
      id: schema.missions.id,
      state: schema.missions.state,
      destination: schema.missions.destination,
      jurisdiction: schema.missions.jurisdiction,
      manualMode: schema.missions.manualMode,
      packVersionId: schema.missions.packVersionId,
      targetDeadline: schema.missions.targetDeadline,
      travelStartDate: schema.missions.travelStartDate,
      updatedAt: schema.missions.updatedAt,
    })
    .from(schema.missions)
    .where(
      inArray(
        schema.missions.id,
        scoped.map((m) => m.missionId),
      ),
    );
  const detailById = new Map(rows.map((r) => [r.id, r]));

  const missions = scoped.map((m): OrgCaseSummary => {
    // scoped is derived from missions.ts's own missions table moments ago,
    // inside the same request, so a missing detail row here would mean the
    // mission was deleted mid-request -- never actually possible (missions
    // are never deleted, only state-transitioned) -- not a real omission.
    const detail = detailById.get(m.missionId);
    return {
      missionId: m.missionId,
      applicantId: m.applicantId,
      applicantName: m.applicantName,
      title: m.title,
      state: detail?.state ?? 'DRAFT',
      destination: detail?.destination ?? null,
      jurisdiction: detail?.jurisdiction ?? null,
      manualMode: detail?.manualMode ?? false,
      packVersionId: detail?.packVersionId ?? null,
      targetDeadline: detail?.targetDeadline?.toISOString() ?? null,
      travelStartDate: detail?.travelStartDate?.toISOString() ?? null,
      updatedAt: detail?.updatedAt.toISOString() ?? new Date(0).toISOString(),
    };
  });
  return { admin, missions };
}

const NOTE_MAX_LENGTH = 2000;

export type MissionNoteVisibility = 'AGENCY_INTERNAL' | 'TRAVELLER_SHARED';

export interface AddNoteInput {
  readonly actorAccountId: string;
  readonly missionId: string;
  readonly body: string;
  readonly visibility: MissionNoteVisibility;
}

/**
 * Add a note to a mission (append-only). Authorized if the actor is: the
 * applicant owner; an individual (non-organization) grant recipient whose
 * grant permits `COMMENT` on this mission; or an active member of an
 * organization that holds a current grant permitting `COMMENT` on this
 * mission. Previously had no authorization check at all: see
 * docs/audits/commercial-readiness-recovery-baseline.md §7.
 *
 * Commercial V1 Part 4 §12: every note now requires an explicit
 * `visibility`, no default. `AGENCY_INTERNAL` requires the actor to be
 * authorized via an organization's own grant (never the applicant owner or
 * a direct individual recipient, neither is "an agency" an internal note
 * could belong to), and records exactly which organization it belongs to
 * (`authorOrganizationId`), so a second collaborating organization's own
 * `listNotes` call can tell its own internal notes apart from another
 * org's (AD-09). Rejected explicitly rather than silently downgraded to
 * TRAVELLER_SHARED: this codebase never silently mutates a caller's
 * request into something they did not ask for.
 */
export async function addNote(
  db: Db,
  input: AddNoteInput,
): Promise<Result<MissionNote, ServiceError>> {
  const body = input.body.trim();
  if (body.length === 0) return err(serviceError('invalid', 'a note body is required'));
  if (body.length > NOTE_MAX_LENGTH) {
    return err(serviceError('invalid', `a note may be at most ${NOTE_MAX_LENGTH} characters`));
  }

  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, input.missionId)).limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'mission not found'));

  const applicant = first(
    await db
      .select()
      .from(schema.applicants)
      .where(eq(schema.applicants.id, mission.applicantId))
      .limit(1),
  );
  const isOwner = applicant?.ownerAccountId === input.actorAccountId;

  let authorized = isOwner;
  // Set only when an organization's own grant is what authorized this
  // write, never for the owner or an individual_recipient path, even if
  // one of those also happens to succeed first.
  let authorizingOrganizationId: string | undefined;

  if (!authorized) {
    const grants = await loadGrantsForPolicy(db, mission.applicantId);
    const now = new Date();
    authorized = grants.some(
      (g) =>
        g.recipientAccountId === input.actorAccountId &&
        authorize({
          actor: { kind: 'individual_recipient', accountId: input.actorAccountId as AccountId },
          action: 'COMMENT',
          resource: {
            applicantId: mission.applicantId as ApplicantId,
            missionId: mission.id as MissionId,
          },
          context: { now, purpose: g.purpose, stepUpSatisfied: false, grants: [g] },
        }).allowed,
    );
  }

  if (!authorized) {
    const memberships = await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, input.actorAccountId),
          eq(schema.memberships.active, true),
        ),
      );
    for (const membership of memberships) {
      if (
        await orgGrantPermits(
          db,
          membership.organizationId,
          mission.applicantId,
          'COMMENT',
          mission.id,
        )
      ) {
        authorized = true;
        authorizingOrganizationId = membership.organizationId;
        break;
      }
    }
  }

  if (!authorized) {
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'MISSION_NOTE_DENIED',
        actorAccountId: input.actorAccountId,
        method: 'MANUAL',
        result: 'DENIED',
        applicantId: mission.applicantId,
        missionId: input.missionId,
        resourceType: 'mission_note',
        resourceId: null,
      });
    });
    return err(serviceError('forbidden', 'not authorized to comment on this mission'));
  }

  if (input.visibility === 'AGENCY_INTERNAL' && !authorizingOrganizationId) {
    return err(
      serviceError(
        'invalid',
        'AGENCY_INTERNAL notes require organization authorship: the applicant owner and a direct individual recipient are never "an agency"',
      ),
    );
  }

  return db.transaction(async (tx) => {
    const note = required(
      first(
        await tx
          .insert(schema.missionNotes)
          .values({
            missionId: input.missionId,
            authorAccountId: input.actorAccountId,
            authorOrganizationId: authorizingOrganizationId ?? null,
            visibility: input.visibility,
            body,
          })
          .returning(),
      ),
      'note',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_NOTE_ADDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: mission.applicantId,
      missionId: input.missionId,
      resourceType: 'mission_note',
      resourceId: note.id,
      metadata: { visibility: input.visibility },
    });
    return ok(note);
  });
}

/**
 * Notes on a mission, visible to ONE organization, gated on
 * `canReadMissionCollaboration` (finding #5): an org's grant must permit
 * `COMMENT` or `MANAGE` on this specific mission before ANY note becomes
 * readable, mirroring `addNote`'s own bar. Beyond that gate, RESULTS are
 * filtered per row (Commercial V1 Part 4 §12, AD-09): every
 * `TRAVELLER_SHARED` note (from any author) plus this organization's OWN
 * `AGENCY_INTERNAL` notes, never another organization's internal notes,
 * even when both organizations hold a valid, active, covering grant on the
 * same shared mission. Previously returned every note on the mission
 * unfiltered, a live cross-tenant leak this closes.
 */
export async function listNotes(
  db: Db,
  organizationId: string,
  applicantId: string,
  missionId: string,
): Promise<MissionNote[]> {
  if (!(await canReadMissionCollaboration(db, organizationId, applicantId, missionId))) return [];
  return db
    .select()
    .from(schema.missionNotes)
    .where(
      and(
        eq(schema.missionNotes.missionId, missionId),
        or(
          eq(schema.missionNotes.visibility, 'TRAVELLER_SHARED'),
          eq(schema.missionNotes.authorOrganizationId, organizationId),
        ),
      ),
    );
}

/** A note as the applicant owner sees it - author already resolved to an email, never a raw account id. */
export interface OwnerVisibleNote {
  readonly id: string;
  readonly body: string;
  readonly authorEmail: string | null;
  readonly createdAt: Date;
}

/**
 * Notes on a mission, visible to the applicant OWNER. Only `TRAVELLER_SHARED`
 * notes, from any author: an AGENCY_INTERNAL note is never visible to the
 * traveller regardless of which organization wrote it (Commercial V1 Part 4
 * §12: "traveller cannot read internal"). No owner-facing read path existed
 * for mission notes at all before this (`listNotes` above is inherently
 * organization-scoped); this is the new one.
 */
export async function listNotesForOwner(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<OwnerVisibleNote[]> {
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return [];
  const applicant = first(
    await db
      .select()
      .from(schema.applicants)
      .where(eq(schema.applicants.id, mission.applicantId))
      .limit(1),
  );
  if (!applicant || applicant.ownerAccountId !== actorAccountId) return [];
  const rows = await db
    .select({
      id: schema.missionNotes.id,
      body: schema.missionNotes.body,
      authorEmail: schema.accounts.email,
      createdAt: schema.missionNotes.createdAt,
    })
    .from(schema.missionNotes)
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.missionNotes.authorAccountId))
    .where(
      and(
        eq(schema.missionNotes.missionId, missionId),
        eq(schema.missionNotes.visibility, 'TRAVELLER_SHARED'),
      ),
    )
    .orderBy(desc(schema.missionNotes.createdAt));
  return rows.map((r) => ({ ...r, authorEmail: r.authorEmail ?? null }));
}

/**
 * An organization requests a specific field or document from an applicant.
 * Requires, beyond org-admin: the organization currently holds an active,
 * accepted, unexpired, applicant-wide-or-any-mission grant permitting
 * `MANAGE` for this applicant — closing the confirmed gap where any org
 * admin could request evidence from any applicant with no prior
 * relationship at all (docs/audits/commercial-readiness-recovery-baseline.md
 * §7).
 */
export async function requestEvidence(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly applicantId: string;
    readonly kind: 'FIELD' | 'DOCUMENT';
    readonly fieldKey?: string;
    readonly docType?: string;
    readonly message?: string;
    /**
     * When the requesting organization's only standing for this applicant is
     * a mission-scoped grant, the scope must be supplied so `orgGrantPermits`
     * can match it — an unscoped check against a mission-scoped grant always
     * fails `scope_mismatch` (docs/audits/post-programme-defect-register.md
     * finding #6), silently rejecting evidence requests the org's real grant
     * should permit. Also, when given, now genuinely persisted as the
     * request's own "case" (Commercial V1 Part 4 §10), not just used for
     * this one check and discarded.
     */
    readonly missionId?: string;
    /** The specific pack requirement this request is for, if any (§10: "requirement if applicable"). Requires `missionId`, and must belong to that mission's own attached pack version. */
    readonly packRequirementId?: string;
    readonly dueDate?: Date;
  },
): Promise<Result<EvidenceRequest, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can request evidence'));
  }
  if (input.kind === 'FIELD' && !input.fieldKey) {
    return err(serviceError('invalid', 'a FIELD request needs a fieldKey'));
  }
  if (input.kind === 'DOCUMENT' && !input.docType) {
    return err(serviceError('invalid', 'a DOCUMENT request needs a docType'));
  }
  if (input.message !== undefined && input.message.length > 1000) {
    return err(serviceError('invalid', 'message may be at most 1000 characters'));
  }
  if (
    !(await orgGrantPermits(db, input.organizationId, input.applicantId, 'MANAGE', input.missionId))
  ) {
    return err(
      serviceError('forbidden', 'this organization has no current grant for that applicant'),
    );
  }
  if (input.packRequirementId) {
    if (!input.missionId) {
      return err(serviceError('invalid', 'a requirement-linked request must name its mission'));
    }
    const mission = first(
      await db
        .select()
        .from(schema.missions)
        .where(eq(schema.missions.id, input.missionId))
        .limit(1),
    );
    if (!mission || mission.applicantId !== input.applicantId) {
      return err(serviceError('not_found', 'mission not found for this applicant'));
    }
    const requirement = first(
      await db
        .select({ id: schema.packRequirements.id })
        .from(schema.packRequirements)
        .where(
          and(
            eq(schema.packRequirements.id, input.packRequirementId),
            mission.packVersionId
              ? eq(schema.packRequirements.packVersionId, mission.packVersionId)
              : undefined,
          ),
        )
        .limit(1),
    );
    if (!requirement) {
      return err(
        serviceError('not_found', "requirement not found on this mission's attached pack"),
      );
    }
  }

  const rateLimit = await checkRateLimit(
    db,
    { subjectId: input.actorAccountId, action: 'evidence.request' },
    RATE_LIMITS.EVIDENCE_REQUEST,
  );
  if (!rateLimit.allowed) return err(serviceError('rate_limited', rateLimit.reason));

  return db.transaction(async (tx) => {
    const request = required(
      first(
        await tx
          .insert(schema.evidenceRequests)
          .values({
            organizationId: input.organizationId,
            applicantId: input.applicantId,
            missionId: input.missionId ?? null,
            packRequirementId: input.packRequirementId ?? null,
            requestedByAccountId: input.actorAccountId,
            kind: input.kind,
            fieldKey: input.fieldKey ?? null,
            docType: input.docType ?? null,
            message: input.message ?? null,
            dueDate: input.dueDate ?? null,
          })
          .returning(),
      ),
      'evidence request',
    );
    await appendAuditEvent(tx, {
      eventType: 'EVIDENCE_REQUESTED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      resourceType: 'evidence_request',
      resourceId: request.id,
    });
    await recordProductEvent(tx, {
      eventType: 'EVIDENCE_REQUESTED',
      accountId: input.actorAccountId,
      organizationId: input.organizationId,
    });

    // NTF-02: "evidence requests" is explicitly named in the notification
    // event list. Neutral/minimal on purpose -- never the request's own
    // `message`, `fieldKey`, or `docType` (could itself hint at sensitive
    // content), just that a request exists and a deep link to go see it.
    const applicant = first(
      await tx
        .select({ ownerAccountId: schema.applicants.ownerAccountId })
        .from(schema.applicants)
        .where(eq(schema.applicants.id, input.applicantId))
        .limit(1),
    );
    if (applicant) {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'EVIDENCE_REQUEST_CREATED',
        resourceId: request.id,
        recipientAccountId: applicant.ownerAccountId,
        applicantId: input.applicantId,
        organizationId: input.organizationId,
        ...(input.missionId !== undefined ? { missionId: input.missionId } : {}),
        payload: {
          subject: 'New evidence request',
          summary: 'An agency working your case has asked for evidence.',
          deepLinkPath: `/app/applicant/${input.applicantId}/evidence`,
        },
      });
    }
    return ok(request);
  });
}

/** Evidence requests directed at an applicant (owner-scoped), newest first. */
export async function listEvidenceRequestsForApplicant(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<Result<EvidenceRequest[], ServiceError>> {
  const applicant = first(
    await db.select().from(schema.applicants).where(eq(schema.applicants.id, applicantId)).limit(1),
  );
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to view these requests'));
  }
  const rows = await db
    .select()
    .from(schema.evidenceRequests)
    .where(eq(schema.evidenceRequests.applicantId, applicantId));
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return ok(sorted);
}

/** Evidence requests raised by an organization (org OWNER/ADMIN only), newest first. */
export async function listEvidenceRequestsForOrg(
  db: Db,
  actorAccountId: string,
  organizationId: string,
): Promise<Result<EvidenceRequest[], ServiceError>> {
  if (!(await isOrgAdmin(db, actorAccountId, organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can view these requests'));
  }
  const rows = await db
    .select()
    .from(schema.evidenceRequests)
    .where(eq(schema.evidenceRequests.organizationId, organizationId));
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return ok(sorted);
}

export interface EvidenceRequestWithApplicant extends EvidenceRequest {
  readonly applicantName: string;
}

/** Same as `listEvidenceRequestsForOrg`, but resolves each request's applicant name. */
export async function listEvidenceRequestsForOrgDetailed(
  db: Db,
  actorAccountId: string,
  organizationId: string,
): Promise<Result<EvidenceRequestWithApplicant[], ServiceError>> {
  const listed = await listEvidenceRequestsForOrg(db, actorAccountId, organizationId);
  if (!listed.ok) return listed;
  const result: EvidenceRequestWithApplicant[] = [];
  for (const request of listed.value) {
    const applicant = first(
      await db
        .select({ displayName: schema.applicants.displayName })
        .from(schema.applicants)
        .where(eq(schema.applicants.id, request.applicantId))
        .limit(1),
    );
    result.push({ ...request, applicantName: applicant?.displayName ?? 'Unknown applicant' });
  }
  return ok(result);
}

/** An applicant who has granted this organization something — the legitimate targets for an evidence request. */
export interface OrgApplicant {
  readonly applicantId: string;
  readonly displayName: string;
}

/**
 * Applicants with a CURRENT grant naming this org — candidate targets for
 * evidence requests. Matches `listMissionsForOrganization`'s ACTIVE/
 * accepted/started/unexpired predicate: previously matched any grant row
 * regardless of status, so a revoked, paused, expired, or never-accepted
 * grant still surfaced the applicant's name in the evidence-request picker
 * (docs/audits/post-programme-defect-register.md finding #3).
 */
export async function listApplicantsForOrganization(
  db: Db,
  organizationId: string,
): Promise<OrgApplicant[]> {
  const now = new Date();
  const rows = await db
    .selectDistinct({
      applicantId: schema.grants.applicantId,
      displayName: schema.applicants.displayName,
    })
    .from(schema.grants)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.grants.applicantId))
    .where(
      and(
        eq(schema.grants.recipientOrganizationId, organizationId),
        eq(schema.grants.status, 'ACTIVE'),
        isNotNull(schema.grants.acceptedAt),
        lte(schema.grants.startAt, now),
        or(isNull(schema.grants.expiryAt), gt(schema.grants.expiryAt, now)),
      ),
    );
  return rows;
}

/**
 * Organizations with a CURRENT grant on this applicant -- the exact reverse
 * of `listApplicantsForOrganization` above, sharing its identical
 * ACTIVE/accepted/started/unexpired predicate so both directions of "which
 * org sees which applicant" can never disagree. COM-02 (quota enforcement)
 * uses this to find every organization whose storage entitlement an upload
 * to this applicant counts against -- an applicant can be visible to more
 * than one organization at once, and each one's own cap matters.
 */
export async function listOrganizationsWithAccessToApplicant(
  db: Db,
  applicantId: string,
): Promise<string[]> {
  const now = new Date();
  const rows = await db
    .selectDistinct({ organizationId: schema.grants.recipientOrganizationId })
    .from(schema.grants)
    .where(
      and(
        eq(schema.grants.applicantId, applicantId),
        isNotNull(schema.grants.recipientOrganizationId),
        eq(schema.grants.status, 'ACTIVE'),
        isNotNull(schema.grants.acceptedAt),
        lte(schema.grants.startAt, now),
        or(isNull(schema.grants.expiryAt), gt(schema.grants.expiryAt, now)),
      ),
    );
  return rows.map((r) => r.organizationId).filter((id): id is string => id !== null);
}

async function loadEvidenceRequestForOwner(
  db: Db,
  actorAccountId: string,
  requestId: string,
): Promise<Result<EvidenceRequest, ServiceError>> {
  const request = first(
    await db
      .select()
      .from(schema.evidenceRequests)
      .where(eq(schema.evidenceRequests.id, requestId))
      .limit(1),
  );
  if (!request) return err(serviceError('not_found', 'evidence request not found'));
  const applicant = first(
    await db
      .select()
      .from(schema.applicants)
      .where(eq(schema.applicants.id, request.applicantId))
      .limit(1),
  );
  if (!applicant || applicant.ownerAccountId !== actorAccountId) {
    return err(serviceError('forbidden', 'only the applicant owner can respond'));
  }
  return ok(request);
}

/** The requesting org's current standing to act on a request (org OWNER/ADMIN, MANAGE grant covering the request's mission/applicant). */
async function loadEvidenceRequestForOrg(
  db: Db,
  actorAccountId: string,
  requestId: string,
): Promise<Result<EvidenceRequest, ServiceError>> {
  const request = first(
    await db
      .select()
      .from(schema.evidenceRequests)
      .where(eq(schema.evidenceRequests.id, requestId))
      .limit(1),
  );
  if (!request) return err(serviceError('not_found', 'evidence request not found'));
  if (!(await isOrgAdmin(db, actorAccountId, request.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can act on this request'));
  }
  if (
    !(await orgGrantPermits(
      db,
      request.organizationId,
      request.applicantId,
      'MANAGE',
      request.missionId ?? undefined,
    ))
  ) {
    return err(
      serviceError('forbidden', 'this organization has no current grant for that applicant'),
    );
  }
  return ok(request);
}

const AWAITING_SUBMISSION_STATUSES: ReadonlySet<string> = new Set(['OPEN', 'NEEDS_REPLACEMENT']);

/**
 * The applicant owner submits a fact or document they already hold, a fresh
 * upload or explicit wallet reuse (Commercial V1 Part 4 §10 explicitly
 * allows both), as the response to a request. This is the ONLY way a request
 * moves toward RECEIVED, and only when the linked evidence is genuinely
 * usable right now: a still-processing, quarantined/unsafe, failed, or
 * erased document is refused outright, never silently accepted ("upload can
 * move to RECEIVED only after safe processing"; "malware/failed/unrelated
 * evidence cannot close a request"). A FIELD request has no such processing
 * concept (a fact is just data), so only the DOCUMENT branch checks
 * usability. Reachable from OPEN (first submission) or NEEDS_REPLACEMENT (a
 * resubmission after the org asked for something else); the prior round's
 * decision stays intact in `evidenceRequestDecisions`, untouched by this.
 */
export async function submitEvidenceResponse(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly requestId: string;
    readonly factId?: string;
    readonly documentId?: string;
  },
): Promise<Result<EvidenceRequest, ServiceError>> {
  const loaded = await loadEvidenceRequestForOwner(db, input.actorAccountId, input.requestId);
  if (!loaded.ok) return loaded;
  const request = loaded.value;
  if (!AWAITING_SUBMISSION_STATUSES.has(request.status)) {
    return err(serviceError('invalid', 'this request is not awaiting a submission'));
  }

  if (request.kind === 'FIELD') {
    if (!input.factId || input.documentId) {
      return err(serviceError('invalid', 'a FIELD request is satisfied by exactly one factId'));
    }
    const fact = first(
      await db
        .select({
          applicantId: schema.facts.applicantId,
          fieldKey: schema.fieldDefinitions.key,
        })
        .from(schema.facts)
        .innerJoin(
          schema.fieldDefinitions,
          eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
        )
        .where(eq(schema.facts.id, input.factId))
        .limit(1),
    );
    if (!fact || fact.applicantId !== request.applicantId) {
      return err(serviceError('not_found', 'fact not found for this applicant'));
    }
    if (fact.fieldKey !== request.fieldKey) {
      return err(serviceError('invalid', "this fact does not match the request's field"));
    }
  } else {
    if (!input.documentId || input.factId) {
      return err(
        serviceError('invalid', 'a DOCUMENT request is satisfied by exactly one documentId'),
      );
    }
    const document = first(
      await db
        .select({ applicantId: schema.documents.applicantId, docType: schema.documents.docType })
        .from(schema.documents)
        .where(eq(schema.documents.id, input.documentId))
        .limit(1),
    );
    if (!document || document.applicantId !== request.applicantId) {
      return err(serviceError('not_found', 'document not found for this applicant'));
    }
    if (document.docType !== request.docType) {
      return err(
        serviceError('invalid', "this document does not match the request's document type"),
      );
    }
    if (!(await documentIsUsable(db, input.documentId))) {
      return err(
        serviceError(
          'invalid',
          'this document has not finished safety processing, or failed it, and cannot be submitted yet',
        ),
      );
    }
  }

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.evidenceRequests)
          .set({
            status: 'RECEIVED',
            respondingFactId: input.factId ?? null,
            respondingDocumentId: input.documentId ?? null,
            respondedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.evidenceRequests.id, input.requestId))
          .returning(),
      ),
      'evidence request',
    );
    await appendAuditEvent(tx, {
      eventType: 'EVIDENCE_RESPONDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: request.applicantId,
      resourceType: 'evidence_request',
      resourceId: updated.id,
      metadata: { factId: input.factId, documentId: input.documentId },
    });
    await recordProductEvent(tx, {
      eventType: 'EVIDENCE_RECEIVED',
      accountId: input.actorAccountId,
      organizationId: request.organizationId,
    });
    return ok(updated);
  });
}

/** Optional, lightweight RECEIVED -> UNDER_REVIEW marker (org, MANAGE-grant-gated): mainly workflow visibility, never a prerequisite for a decision. */
export async function startEvidenceReview(
  db: Db,
  input: { readonly actorAccountId: string; readonly requestId: string },
): Promise<Result<EvidenceRequest, ServiceError>> {
  const loaded = await loadEvidenceRequestForOrg(db, input.actorAccountId, input.requestId);
  if (!loaded.ok) return loaded;
  if (loaded.value.status !== 'RECEIVED') {
    return err(serviceError('invalid', 'only a RECEIVED request can start review'));
  }
  const updated = required(
    first(
      await db
        .update(schema.evidenceRequests)
        .set({ status: 'UNDER_REVIEW', updatedAt: new Date() })
        .where(eq(schema.evidenceRequests.id, input.requestId))
        .returning(),
    ),
    'evidence request',
  );
  return ok(updated);
}

const DECIDABLE_STATUSES: ReadonlySet<string> = new Set(['RECEIVED', 'UNDER_REVIEW']);

/**
 * The requesting org decides on what was submitted (org, MANAGE-grant-gated)
 * -- Part 4 §13's full "Review" list, all four outcomes: accepted evidence;
 * replacement requested; contradiction; proposed correction. Every decision
 * is appended to `evidenceRequestDecisions`, an immutable snapshot of
 * exactly what was being decided on, so a later round, which clears the
 * request's own current responding pointers to make room for the next
 * submission, never loses this one's reason (§13: "replacement retains
 * prior decision/reason").
 *
 * CONTRADICTION and CORRECTION_PROPOSED are real, distinct, reviewer-facing
 * outcomes -- previously this codebase had mapped them onto generic,
 * unreachable-by-a-reviewer mechanisms instead (AI-extraction-only
 * FACT_STATUSES CONFLICTED; AI-extraction-only `field_proposals`, whose
 * `aiExtractionRunId` is a required foreign key with no human-reviewer
 * equivalent). Both are handled as the same underlying request-status
 * transition as NEEDS_REPLACEMENT (evidence didn't stand as submitted,
 * a fresh response is needed; CAS-03's own six-state model is not extended
 * with new states for this), while the DECISION record itself keeps the
 * more specific classification, surfaced to the applicant on the evidence
 * page with its own distinct label. A structured, one-click-apply
 * `field_proposals` row from a CORRECTION_PROPOSED decision (rather than a
 * plain-text suggestion the applicant reads and then acts on through their
 * own Master Profile edit, same as any self-directed correction) would need
 * decoupling `field_proposals` from `aiExtractionRunId`, a real but
 * deliberately separate, undone enhancement -- see `known-issues.md`.
 *
 * Also enforces CAS-06's "an organisation may require a reviewer different
 * from the preparer; if enabled, the server enforces it": here, "preparer"
 * is whoever on the org raised this specific request
 * (`evidenceRequests.requestedByAccountId`), the one existing, genuinely
 * agency-internal signal for who initiated/worked this ask, as opposed to
 * `selectEvidence`, which is owner-only and could never name an org account
 * at all. Off by default (a legacy request with no recorded requester never
 * triggers this, nothing to compare against), and this function never
 * claims independent review happened when the org has not opted in.
 */
export async function decideEvidenceResponse(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly requestId: string;
    readonly outcome: 'ACCEPTED' | 'NEEDS_REPLACEMENT' | 'CONTRADICTION' | 'CORRECTION_PROPOSED';
    readonly reason?: string;
  },
): Promise<Result<EvidenceRequest, ServiceError>> {
  const loaded = await loadEvidenceRequestForOrg(db, input.actorAccountId, input.requestId);
  if (!loaded.ok) return loaded;
  const request = loaded.value;
  if (!DECIDABLE_STATUSES.has(request.status)) {
    return err(serviceError('invalid', 'this request has nothing submitted to decide on yet'));
  }
  const org = first(
    await db
      .select({ requireDifferentReviewer: schema.organizations.requireDifferentReviewer })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, request.organizationId))
      .limit(1),
  );
  if (
    org?.requireDifferentReviewer &&
    request.requestedByAccountId &&
    request.requestedByAccountId === input.actorAccountId
  ) {
    return err(
      serviceError(
        'forbidden',
        'this organization requires a reviewer different from whoever raised this request',
      ),
    );
  }

  // CAS-03's own request-status enum has no CONTRADICTION/CORRECTION_PROPOSED
  // value: both mean "this submission doesn't stand, a fresh one is needed,"
  // the same underlying transition as NEEDS_REPLACEMENT. The decision record
  // (just below) keeps the more specific classification; only the REQUEST's
  // status collapses the two onto NEEDS_REPLACEMENT.
  const requestStatus =
    input.outcome === 'CONTRADICTION' || input.outcome === 'CORRECTION_PROPOSED'
      ? 'NEEDS_REPLACEMENT'
      : input.outcome;

  return db.transaction(async (tx) => {
    await tx.insert(schema.evidenceRequestDecisions).values({
      evidenceRequestId: request.id,
      outcome: input.outcome,
      reason: input.reason ?? null,
      respondingFactId: request.respondingFactId,
      respondingDocumentId: request.respondingDocumentId,
      decidedByAccountId: input.actorAccountId,
    });
    const updated = required(
      first(
        await tx
          .update(schema.evidenceRequests)
          .set({
            status: requestStatus,
            // Cleared whenever the request goes back to needing a fresh
            // response: this pointer means "what's currently under
            // consideration," which is nothing again until the applicant
            // submits again. ACCEPTED keeps its pointer: it's exactly what
            // was accepted.
            ...(requestStatus === 'NEEDS_REPLACEMENT'
              ? { respondingFactId: null, respondingDocumentId: null }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.evidenceRequests.id, request.id))
          .returning(),
      ),
      'evidence request',
    );
    await appendAuditEvent(tx, {
      eventType: 'EVIDENCE_REQUEST_DECIDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: request.applicantId,
      resourceType: 'evidence_request',
      resourceId: request.id,
      metadata: { outcome: input.outcome },
    });
    // OPS-04 reworked evidence: the reviewer sent a submission back. The
    // dimension is which of the three kinds of "send back" it was, never the
    // reviewer's own `reason` text.
    if (requestStatus === 'NEEDS_REPLACEMENT') {
      await recordProductEvent(tx, {
        eventType: 'EVIDENCE_REWORK_REQUESTED',
        accountId: input.actorAccountId,
        organizationId: request.organizationId,
        dimension: input.outcome,
      });
    }

    // NTF-02: "replacement requests" / "final review" -- a reviewer's
    // verdict on a submitted response, same neutral shape as
    // MISSION_STATUS_CHANGED (never the reviewer's own `reason` text, just
    // that a decision landed and a deep link to go see it). ACCEPTED reads
    // as this specific evidence item's review closing out; the other three
    // outcomes all mean "this doesn't stand, resubmit" -- one event type,
    // matching how `requestStatus` above already collapses them.
    const owner = first(
      await tx
        .select({ ownerAccountId: schema.applicants.ownerAccountId })
        .from(schema.applicants)
        .where(eq(schema.applicants.id, request.applicantId))
        .limit(1),
    );
    if (owner) {
      const deepLinkPath = `/app/applicant/${request.applicantId}/evidence`;
      if (input.outcome === 'ACCEPTED') {
        await enqueueNotificationBothChannels(tx, {
          eventType: 'EVIDENCE_REVIEW_ACCEPTED',
          resourceId: request.id,
          recipientAccountId: owner.ownerAccountId,
          applicantId: request.applicantId,
          organizationId: request.organizationId,
          payload: {
            subject: 'Evidence accepted',
            summary: 'A reviewer accepted your submitted evidence.',
            deepLinkPath,
          },
        });
      } else {
        await enqueueNotificationBothChannels(tx, {
          eventType: 'EVIDENCE_REPLACEMENT_REQUESTED',
          resourceId: request.id,
          recipientAccountId: owner.ownerAccountId,
          applicantId: request.applicantId,
          organizationId: request.organizationId,
          payload: {
            subject: 'Evidence needs a fresh submission',
            summary: 'A reviewer requested a replacement for your submitted evidence.',
            deepLinkPath,
          },
        });
      }
    }
    return ok(updated);
  });
}

/** The requesting org withdraws a request that no longer needs an answer (org, MANAGE-grant-gated). Terminal; matches the applicant owner's own respondEvidence-era DECLINED intent, but as the requester's own act, not the applicant's. */
export async function cancelEvidenceRequest(
  db: Db,
  input: { readonly actorAccountId: string; readonly requestId: string; readonly reason?: string },
): Promise<Result<EvidenceRequest, ServiceError>> {
  const loaded = await loadEvidenceRequestForOrg(db, input.actorAccountId, input.requestId);
  if (!loaded.ok) return loaded;
  const request = loaded.value;
  if (request.status === 'CANCELLED' || request.status === 'ACCEPTED') {
    return err(serviceError('invalid', 'this request is already closed'));
  }

  return db.transaction(async (tx) => {
    await tx.insert(schema.evidenceRequestDecisions).values({
      evidenceRequestId: request.id,
      outcome: 'CANCELLED',
      reason: input.reason ?? null,
      respondingFactId: request.respondingFactId,
      respondingDocumentId: request.respondingDocumentId,
      decidedByAccountId: input.actorAccountId,
    });
    const updated = required(
      first(
        await tx
          .update(schema.evidenceRequests)
          .set({ status: 'CANCELLED', updatedAt: new Date() })
          .where(eq(schema.evidenceRequests.id, request.id))
          .returning(),
      ),
      'evidence request',
    );
    await appendAuditEvent(tx, {
      eventType: 'EVIDENCE_REQUEST_CANCELLED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: request.applicantId,
      resourceType: 'evidence_request',
      resourceId: request.id,
    });
    // Part 5 §4: this request no longer needs an answer -- any still-QUEUED
    // notice about it (e.g. the original EVIDENCE_REQUEST_CREATED, if the
    // worker hasn't dispatched it yet) is now obsolete.
    await cancelQueuedNotificationsForResource(tx, request.id);
    return ok(updated);
  });
}

/** Full decision history on a request, newest first: the applicant owner or the requesting org's currently-standing member. */
export async function listEvidenceRequestDecisions(
  db: Db,
  actorAccountId: string,
  requestId: string,
): Promise<Result<EvidenceRequestDecision[], ServiceError>> {
  const request = first(
    await db
      .select()
      .from(schema.evidenceRequests)
      .where(eq(schema.evidenceRequests.id, requestId))
      .limit(1),
  );
  if (!request) return err(serviceError('not_found', 'evidence request not found'));

  const applicant = first(
    await db
      .select()
      .from(schema.applicants)
      .where(eq(schema.applicants.id, request.applicantId))
      .limit(1),
  );
  const isOwner = applicant?.ownerAccountId === actorAccountId;
  const isAuthorizedOrgMember =
    !isOwner &&
    (await isOrgAdmin(db, actorAccountId, request.organizationId)) &&
    (await orgGrantPermits(
      db,
      request.organizationId,
      request.applicantId,
      'MANAGE',
      request.missionId ?? undefined,
    ));
  if (!isOwner && !isAuthorizedOrgMember) {
    return err(serviceError('forbidden', 'not authorized to view this request'));
  }

  const rows = await db
    .select()
    .from(schema.evidenceRequestDecisions)
    .where(eq(schema.evidenceRequestDecisions.evidenceRequestId, requestId));
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return ok(sorted);
}

export interface BulkExportRow {
  readonly applicantId: string;
  readonly displayName: string;
  readonly facts: Record<string, string | null>;
}

/** Hard ceiling on applicants included in one bulk export (bounded result size). */
const BULK_EXPORT_MAX_APPLICANTS = 500;

/**
 * Permissioned bulk export for an organization, rebuilt from first
 * principles (master recovery directive §7 "PR 2"). Uses the actor's REAL
 * membership role (never a synthetic one), reauthorizes each applicant
 * immediately before export via the real policy engine, excludes any
 * non-`ACTIVE`/unaccepted/expired grant, and is bounded.
 *
 * Step-up: `stepUpSatisfied` is derived honestly from `input.stepUpSatisfied`
 * — this function never hardcodes `true`. Because `EXPORT_PROFILE` is a
 * `STEP_UP_ACTIONS` action, every export denies unless the caller can
 * honestly supply `true`, which now requires a genuine WorkOS
 * reauthentication plus a server-generated, action-bound assurance record
 * (`apps/web/src/lib/step-up.ts`, master recovery directive §7 "PR 5"). The
 * `bulkExport` platform capability reports `available` accordingly — see
 * apps/web/src/lib/capabilities.ts.
 */
export async function bulkExport(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly purpose: string;
    readonly stepUpSatisfied: boolean;
  },
): Promise<Result<BulkExportRow[], ServiceError>> {
  const actorMembership = first(
    await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, input.actorAccountId),
          eq(schema.memberships.organizationId, input.organizationId),
        ),
      )
      .limit(1),
  );
  if (
    !actorMembership?.active ||
    (actorMembership.role !== 'OWNER' && actorMembership.role !== 'ADMIN')
  ) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can bulk export'));
  }
  // SHR-02: a suspended/closed organization has no standing, regardless of
  // the caller's own still-active membership row.
  const org = await getOrganization(db, input.organizationId);
  if (!org || org.status !== 'ACTIVE') {
    return err(serviceError('forbidden', 'this organization is not active'));
  }

  // Actor first, then the organization's shared bucket: several admins of one
  // organization must not be able to multiply the export rate between them.
  const rateLimit = await checkRateLimits(db, [
    {
      input: { subjectId: input.actorAccountId, action: 'bulk.export', label: 'export' },
      config: RATE_LIMITS.BULK_EXPORT,
    },
    {
      input: { subjectId: input.organizationId, action: 'bulk.export.org', label: 'export' },
      config: RATE_LIMITS.BULK_EXPORT_ORG,
    },
  ]);
  if (!rateLimit.allowed) return err(serviceError('rate_limited', rateLimit.reason));

  // Candidate applicants: those with any grant naming this org, bounded.
  const grantRows = await db
    .select()
    .from(schema.grants)
    .where(eq(schema.grants.recipientOrganizationId, input.organizationId));

  const now = new Date();
  const candidateApplicantIds = [...new Set(grantRows.map((g) => g.applicantId))].slice(
    0,
    BULK_EXPORT_MAX_APPLICANTS,
  );
  const rows: BulkExportRow[] = [];
  for (const applicantId of candidateApplicantIds) {
    const grants = grantRows
      .filter((g) => g.applicantId === applicantId)
      .map((g) => ({
        applicantId: g.applicantId as ApplicantId,
        recipientOrganizationId: input.organizationId as AgencyId,
        actions: g.actions as PermissionAction[],
        purpose: g.purpose,
        status: g.status,
        startAt: g.startAt.toISOString(),
        ...(g.categories ? { categories: g.categories } : {}),
        ...(g.acceptedAt ? { acceptedAt: g.acceptedAt.toISOString() } : {}),
        ...(g.expiryAt ? { expiryAt: g.expiryAt.toISOString() } : {}),
        // Preserve mission/document scope exactly as `loadGrantsForPolicy`
        // does — omitting these let a mission- or document-scoped grant be
        // evaluated as applicant-wide, exporting the full profile instead of
        // the authorized subset (docs/audits/post-programme-defect-register.md
        // finding #4).
        ...(g.missionId ? { missionId: g.missionId as MissionId } : {}),
        ...(g.documentIds ? { documentIds: g.documentIds as DocumentId[] } : {}),
      }));

    // Which of this applicant's grants actually allow EXPORT_PROFILE here,
    // evaluated per-grant WITHOUT that grant's own category restriction: a
    // category-scoped grant must still make the applicant reachable at all
    // (category only narrows WHICH facts are visible below, exactly like a
    // grant with no category restriction covers every pack) — category is
    // fundamentally a fact-level filter, not an applicant-level gate.
    // Mission/document scope are deliberately NOT stripped here: bulk export
    // is inherently profile-wide, and neither a mission- nor a
    // document-scoped grant should ever reach it (Build Spec law 5 — mission
    // access never implies the whole profile; no fact carries a missionId or
    // documentId for such a grant to match against).
    const allowingGrants = grants.filter((g) => {
      const { categories: _categories, ...categoryless } = g;
      return authorize({
        actor: {
          kind: 'organization_member',
          accountId: input.actorAccountId as AccountId,
          membership: {
            organizationId: input.organizationId as AgencyId,
            role: actorMembership.role,
            active: actorMembership.active,
            organizationActive: true,
          },
        },
        action: 'EXPORT_PROFILE',
        resource: { applicantId: applicantId as ApplicantId },
        context: {
          now,
          purpose: input.purpose,
          stepUpSatisfied: input.stepUpSatisfied,
          grants: [categoryless],
        },
      }).allowed;
    });
    if (allowingGrants.length === 0) continue;

    // Category scope: only export facts whose pack is on an allow-list from
    // at least one allowing grant's OWN (unstripped) categories — a grant
    // with no `categories` restriction covers every pack.
    const unrestricted = allowingGrants.some((g) => g.categories === undefined);
    const allowedCategories = unrestricted
      ? undefined
      : new Set(allowingGrants.flatMap((g) => g.categories ?? []));

    const applicant = first(
      await db
        .select()
        .from(schema.applicants)
        .where(eq(schema.applicants.id, applicantId))
        .limit(1),
    );
    if (!applicant) continue;
    const factRows = await db
      .select({
        key: schema.fieldDefinitions.key,
        packId: schema.fieldDefinitions.packId,
        value: schema.factVersions.value,
      })
      .from(schema.facts)
      .innerJoin(
        schema.fieldDefinitions,
        eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
      )
      .innerJoin(schema.factVersions, eq(schema.factVersions.id, schema.facts.currentVersionId))
      .where(eq(schema.facts.applicantId, applicantId));
    const facts: Record<string, string | null> = {};
    for (const row of factRows) {
      if (allowedCategories && (!row.packId || !allowedCategories.has(row.packId))) continue;
      facts[row.key] = row.value;
    }
    rows.push({ applicantId, displayName: applicant.displayName, facts });
  }

  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'BULK_EXPORT',
      actorAccountId: input.actorAccountId,
      action: 'EXPORT_PROFILE',
      method: 'API',
      result: 'ALLOWED',
      resourceType: 'organization',
      resourceId: input.organizationId,
      metadata: {
        included: rows.length,
        candidates: candidateApplicantIds.length,
        purpose: input.purpose,
      },
    });
  });
  return ok(rows);
}

// --- Reviewer decisions (master directive §7 "PR 10") -----------------------
//
// A decision on a specific requirement is a genuine external-review action —
// deliberately not something the applicant can record on their own mission,
// or the concept collapses into self-attestation. Authorization mirrors
// assignMember's exact shape: the acting individual must be an active
// member of the organization AND currently assigned to this specific
// mission, AND the organization must hold a live grant that would permit
// MANAGE on this mission. Append-only, like every other decision-history
// table in this schema — the latest row per requirement is "the" decision.

export type MissionDecision = typeof schema.missionDecisions.$inferSelect;

async function assignedToMission(
  db: Db,
  organizationId: string,
  memberAccountId: string,
  missionId: string,
): Promise<boolean> {
  const assignment = first(
    await db
      .select({ id: schema.assignments.id })
      .from(schema.assignments)
      .where(
        and(
          eq(schema.assignments.organizationId, organizationId),
          eq(schema.assignments.memberAccountId, memberAccountId),
          eq(schema.assignments.missionId, missionId),
        ),
      )
      .limit(1),
  );
  return assignment !== undefined;
}

export async function recordMissionDecision(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly missionId: string;
    readonly packRequirementId: string;
    readonly outcome: 'ACCEPTED' | 'REJECTED';
    readonly reason?: string;
  },
): Promise<Result<MissionDecision, ServiceError>> {
  if (!(await isActiveMember(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'not an active member of this organization'));
  }
  if (!(await assignedToMission(db, input.organizationId, input.actorAccountId, input.missionId))) {
    return err(serviceError('forbidden', 'not assigned to this mission'));
  }
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, input.missionId)).limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'mission not found'));
  if (
    !(await orgGrantPermits(db, input.organizationId, mission.applicantId, 'MANAGE', mission.id))
  ) {
    return err(
      serviceError('forbidden', 'this organization has no current grant covering that mission'),
    );
  }
  const requirement = first(
    await db
      .select({ id: schema.packRequirements.id })
      .from(schema.packRequirements)
      .where(
        and(
          eq(schema.packRequirements.id, input.packRequirementId),
          mission.packVersionId
            ? eq(schema.packRequirements.packVersionId, mission.packVersionId)
            : undefined,
        ),
      )
      .limit(1),
  );
  if (!requirement) {
    return err(serviceError('not_found', "requirement not found on this mission's attached pack"));
  }

  return db.transaction(async (tx) => {
    const decision = required(
      first(
        await tx
          .insert(schema.missionDecisions)
          .values({
            missionId: input.missionId,
            packRequirementId: input.packRequirementId,
            outcome: input.outcome,
            reason: input.reason ?? null,
            decidedByAccountId: input.actorAccountId,
          })
          .returning(),
      ),
      'mission decision',
    );
    await appendAuditEvent(tx, {
      eventType: 'MISSION_DECISION_RECORDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      missionId: input.missionId,
      resourceType: 'mission_decision',
      resourceId: decision.id,
      metadata: { packRequirementId: input.packRequirementId, outcome: input.outcome },
    });

    // NTF-02: "material case status/readiness changes" -- a reviewer's
    // ACCEPTED/REJECTED verdict on a requirement is exactly that. Neutral on
    // purpose: never the requirement's own field/doc identity or the
    // reviewer's `reason` text, just that a decision landed and a deep link
    // to go see it.
    const owner = first(
      await tx
        .select({ ownerAccountId: schema.applicants.ownerAccountId })
        .from(schema.applicants)
        .where(eq(schema.applicants.id, mission.applicantId))
        .limit(1),
    );
    if (owner) {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'MISSION_STATUS_CHANGED',
        resourceId: decision.id,
        recipientAccountId: owner.ownerAccountId,
        applicantId: mission.applicantId,
        organizationId: input.organizationId,
        missionId: input.missionId,
        payload: {
          subject: 'Update on your case',
          summary: 'A reviewer recorded a decision on your case.',
          deepLinkPath: `/app/mission/${input.missionId}`,
        },
      });
    }
    return ok(decision);
  });
}

/**
 * Every decision recorded on a mission, newest first — visible to the
 * mission owner or any org member currently assigned to it. Previously only
 * checked that an assignment ROW existed, so a reviewer deactivated,
 * removed from the organization, or whose org's grant was later revoked
 * kept indefinite read access to decision history/reasons; now re-checks
 * active membership and a current covering grant, exactly like the write
 * path (`recordMissionDecision`) already does
 * (docs/audits/post-programme-defect-register.md finding #32).
 */
export async function listMissionDecisions(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<Result<MissionDecision[], ServiceError>> {
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'mission not found'));
  const applicant = first(
    await db
      .select({ ownerAccountId: schema.applicants.ownerAccountId })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, mission.applicantId))
      .limit(1),
  );
  const isOwner = applicant?.ownerAccountId === actorAccountId;
  if (!isOwner) {
    // An account can be assigned to the same mission through MULTIPLE
    // organizations — the assignments table's uniqueness key includes
    // organizationId, so this is a valid, expected state, not a bug. An
    // arbitrary single row (the previous `.limit(1)`) could select an
    // organization whose membership or grant has since lapsed even though
    // a DIFFERENT one of this account's assignments still has an active
    // membership and a covering grant — incorrectly denying access
    // depending only on which row Postgres happened to return (Codex
    // review, PR #65). Authorize as soon as ANY matching assignment
    // satisfies both checks.
    const assignments = await db
      .select({ organizationId: schema.assignments.organizationId })
      .from(schema.assignments)
      .where(
        and(
          eq(schema.assignments.memberAccountId, actorAccountId),
          eq(schema.assignments.missionId, missionId),
        ),
      );
    let authorized = false;
    for (const assignment of assignments) {
      if (
        (await isActiveMember(db, actorAccountId, assignment.organizationId)) &&
        (await orgGrantPermits(
          db,
          assignment.organizationId,
          mission.applicantId,
          'MANAGE',
          missionId,
        ))
      ) {
        authorized = true;
        break;
      }
    }
    if (!authorized) {
      return err(serviceError('forbidden', 'not authorized to view decisions on this mission'));
    }
  }
  const rows = await db
    .select()
    .from(schema.missionDecisions)
    .where(eq(schema.missionDecisions.missionId, missionId));
  return ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}

/**
 * A mission's attached pack requirements, for an org that currently holds a
 * grant covering it — lets the reviewer decision UI offer a real requirement
 * picker without needing owner-level mission access. Empty (not an error)
 * if no pack is attached yet.
 */
export async function listMissionRequirementsForOrg(
  db: Db,
  organizationId: string,
  missionId: string,
): Promise<Result<PackRequirement[], ServiceError>> {
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'mission not found'));
  if (!(await orgGrantPermits(db, organizationId, mission.applicantId, 'MANAGE', mission.id))) {
    return err(
      serviceError('forbidden', 'this organization has no current grant covering that mission'),
    );
  }
  if (!mission.packVersionId) return ok([]);
  return ok(await listRequirements(db, mission.packVersionId));
}
