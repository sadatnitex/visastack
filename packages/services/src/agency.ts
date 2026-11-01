import type {
  AccountId,
  AgencyId,
  ApplicantId,
  MissionId,
  MissionState,
  PermissionAction,
} from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { authorize } from '@visastack/policy';
import { type SQL, and, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import {
  loadCaseExclusions,
  orgCaseRecordVisibleSql,
  withCaseExclusions,
} from './access/grant-scope';
import { AuthorizedApplicant } from './access/require-access';
import { aiSuggestionsAvailable } from './ai-suggestions';
import { latestTimeZoneName, recognisedTimeZone } from './attention';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { isDocumentVersionUsable } from './documents';
import { activeOrVerifiedErasureStorageObjectIds } from './erasure';
import { type ServiceError, serviceError } from './errors';
import {
  lifecycleTablesPresent,
  presentApplicantCondition,
  presentDocumentCondition,
} from './lifecycle/foundation';
import {
  cancelQueuedNotificationsForResource,
  enqueueNotificationBothChannels,
} from './notifications';
import { getOrganization, isOrgAdmin } from './organizations';
import { type PackRequirement, listRequirements } from './packs';
import { recordProductEvent } from './product-events';
import { RATE_LIMITS, checkRateLimit, checkRateLimits } from './rate-limit';
import { assignReferenceCode } from './reference-codes';
import { loadGrantsForPolicy, toPolicyGrant } from './sharing';

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
  // The case must belong to the person named: an all-cases grant on one
  // person must never vouch for another person's case id passed beside it.
  if (missionId !== undefined && !(await missionBelongsTo(db, missionId, applicantId))) {
    return false;
  }
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

/** Whether `missionId` is a case of `applicantId` (false for an unknown or malformed id). */
async function missionBelongsTo(db: Db, missionId: string, applicantId: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(missionId)) {
    return false;
  }
  const mission = first(
    await db
      .select({ applicantId: schema.missions.applicantId })
      .from(schema.missions)
      .where(eq(schema.missions.id, missionId))
      .limit(1),
  );
  return mission !== undefined && mission.applicantId === applicantId;
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
  if (!mission) return err(serviceError('not_found', 'case not found'));
  if (
    !(await orgGrantPermits(db, input.organizationId, mission.applicantId, 'MANAGE', mission.id))
  ) {
    // Answered exactly like an unknown id, so a case hidden from this
    // organization (a per-case sharing exception, ADR 0017) cannot be told
    // apart from one that does not exist.
    return err(serviceError('not_found', 'case not found'));
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

/**
 * The one condition every agency read of `mission_tasks` uses (S21): a task an AI app added is
 * private to the record's owner, so agencies never see or change it, even on a shared case. Before
 * migration 0105 there can be no such task, so there is nothing to leave out. A guard test
 * (`ai-tools/tool-guard.test.ts`) fails if an agency read of tasks does not use it.
 */
async function agencyVisibleTasks(db: Db): Promise<SQL | undefined> {
  if (!(await aiSuggestionsAvailable(db))) return undefined;
  return sql`not exists (select 1 from ${schema.aiTaskOrigins} where ${schema.aiTaskOrigins.taskId} = ${schema.missionTasks.id})`;
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
  // A reminder the traveller's own AI app added is private to them, even on a shared case (S21).
  return db
    .select()
    .from(schema.missionTasks)
    .where(and(eq(schema.missionTasks.missionId, missionId), await agencyVisibleTasks(db)));
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
    return err(serviceError('forbidden', 'not assigned to this case'));
  }
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'case not found'));
  if (!(await orgGrantPermits(db, organizationId, mission.applicantId, 'MANAGE', mission.id))) {
    // Answered exactly like an unknown id, so a case hidden from this
    // organization (a per-case sharing exception, ADR 0017) cannot be told
    // apart from one that does not exist.
    return err(serviceError('not_found', 'case not found'));
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
            dueTimezone: latestTimeZoneName(input.dueTimezone ?? null),
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
            // A reminder the traveller's own AI app added is theirs alone (S21): not found here.
            await agencyVisibleTasks(tx),
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
        dueTimezone: { before: task.dueTimezone, after: latestTimeZoneName(input.dueTimezone) },
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
            ...(input.dueTimezone !== undefined
              ? { dueTimezone: latestTimeZoneName(input.dueTimezone) }
              : {}),
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
            // A reminder the traveller's own AI app added is theirs alone (S21): not found here.
            await agencyVisibleTasks(tx),
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
  if (input.timezone.trim().length === 0) {
    return err(serviceError('invalid', 'a timezone is required'));
  }
  // A known IANA name only, saved as typed (letter case corrected, never renamed): calendar files place the time in
  // UTC from it, so a name the runtime cannot read would leave the time unplaceable.
  const timezone = recognisedTimeZone(input.timezone);
  if (!timezone) return err(serviceError('invalid', 'enter a time zone name, such as Asia/Dhaka'));
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

  // A known IANA name only, saved as typed (letter case corrected), as when the appointment was made.
  const timezone = input.timezone === undefined ? undefined : recognisedTimeZone(input.timezone);
  if (timezone === null)
    return err(serviceError('invalid', 'enter a time zone name, such as Asia/Dhaka'));

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
    if (timezone !== undefined) {
      changes = { ...changes, timezone: { before: appointment.timezone, after: timezone } };
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
            ...(timezone !== undefined ? { timezone } : {}),
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
  /**
   * The traveller's own time zone (an IANA name). Never shown to the agency: used only to decide
   * when a request or task is past due, which the traveller's time zone decides everywhere (owner
   * decision 26 Oct 2026, ADR 0015 amendment).
   */
  readonly applicantTimezone: string;
}

/**
 * Missions reachable by this org via a CURRENT grant: `ACTIVE`, accepted,
 * started, and not expired. Mission-scoped grants match only their mission;
 * applicant-wide grants (`missionId IS NULL`) match every mission of that
 * applicant except the cases excluded from that grant (per-case sharing
 * exceptions, ADR 0017), through the shared `grantCoversCaseSql` rule.
 * Previously returned a mission for ANY grant row regardless of
 * status/acceptance/expiry - see
 * docs/audits/commercial-readiness-recovery-baseline.md §7.
 */
export async function listMissionsForOrganization(
  db: Db,
  organizationId: string,
): Promise<OrgMission[]> {
  const now = new Date();
  const lifecycle = await lifecycleTablesPresent(db);
  const rows = await withCaseExclusions(db, (covers) =>
    db
      .selectDistinct({
        missionId: schema.missions.id,
        title: schema.missions.title,
        applicantId: schema.applicants.id,
        applicantName: schema.applicants.displayName,
        applicantTimezone: schema.applicants.timezone,
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
          covers(schema.missions.id),
          // Agency view of shared cases: presentApplicantCondition (archive never revokes sharing, D6).
          lifecycle ? presentApplicantCondition() : undefined,
        ),
      ),
  );
  // Several grants can reach the same mission (an applicant-wide one and a
  // mission-scoped one, say); dedupe by missionId so the console never
  // renders (and never lets the user act on) the same mission twice
  // (docs/audits/post-programme-defect-register.md finding #7).
  return [...new Map(rows.map((r) => [r.missionId, r])).values()];
}

/** A case as the org console's workspace/search view needs it (CAS-02): enough to filter and summarize, never any wallet content. */
export interface OrgCaseSummary {
  readonly missionId: string;
  readonly applicantId: string;
  readonly applicantName: string;
  /** The traveller's time zone, for due days only (see `OrgMission.applicantTimezone`). */
  readonly applicantTimezone: string;
  readonly title: string;
  readonly state: MissionState;
  readonly destination: string | null;
  readonly jurisdiction: string | null;
  readonly manualMode: boolean;
  readonly packVersionId: string | null;
  readonly targetDeadline: string | null;
  readonly travelStartDate: string | null;
  /** When the case was opened. Used only to keep agency lists in a stable order. */
  readonly createdAt: string;
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
      createdAt: schema.missions.createdAt,
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
      applicantTimezone: m.applicantTimezone,
      title: m.title,
      state: detail?.state ?? 'DRAFT',
      destination: detail?.destination ?? null,
      jurisdiction: detail?.jurisdiction ?? null,
      manualMode: detail?.manualMode ?? false,
      packVersionId: detail?.packVersionId ?? null,
      targetDeadline: detail?.targetDeadline?.toISOString() ?? null,
      travelStartDate: detail?.travelStartDate?.toISOString() ?? null,
      createdAt: detail?.createdAt.toISOString() ?? new Date(0).toISOString(),
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
  if (!mission) return err(serviceError('not_found', 'case not found'));

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
    return err(serviceError('forbidden', 'not authorized to comment on this case'));
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
  options?: { readonly limit: number },
): Promise<MissionNote[]> {
  if (!(await canReadMissionCollaboration(db, organizationId, applicantId, missionId))) return [];
  const query = db
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
  if (!options) return query;
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(50, Math.floor(options.limit)))
    : 50;
  return query
    .orderBy(desc(schema.missionNotes.createdAt), desc(schema.missionNotes.id))
    .limit(limit);
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
      return err(serviceError('invalid', 'a requirement-linked request must name its case'));
    }
    const mission = first(
      await db
        .select()
        .from(schema.missions)
        .where(eq(schema.missions.id, input.missionId))
        .limit(1),
    );
    if (!mission || mission.applicantId !== input.applicantId) {
      return err(serviceError('not_found', 'case not found for this applicant'));
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
      return err(serviceError('not_found', "requirement not found on this case's attached pack"));
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
    // The visible code people quote (ADR 0018), in the same transaction.
    await assignReferenceCode(tx, 'R', request.id);
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

/**
 * Evidence requests raised by an organization (org OWNER/ADMIN only), newest
 * first. A request on a case is listed only when one of this organization's
 * LIVE grants on that person (active, paused or awaiting acceptance, not
 * expired) reaches the case by case scope: a per-case sharing exception (ADR
 * 0017) hides the organization's requests on that one case, exactly as it
 * hides the case itself, and an ended grant that once reached it no longer
 * counts. Only when the organization holds no live grant on the person at all
 * does the earlier behaviour remain: its own past requests stay listed as
 * history after every grant ended. Requests not tied to a case are unchanged.
 */
export async function listEvidenceRequestsForOrg(
  db: Db,
  actorAccountId: string,
  organizationId: string,
): Promise<Result<EvidenceRequest[], ServiceError>> {
  if (!(await isOrgAdmin(db, actorAccountId, organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can view these requests'));
  }
  const requests = schema.evidenceRequests;
  const now = new Date();
  const rows = await withCaseExclusions(db, (covers) =>
    db
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.organizationId, organizationId),
          or(
            isNull(requests.missionId),
            orgCaseRecordVisibleSql(covers, {
              organizationId,
              applicantId: requests.applicantId,
              missionId: requests.missionId,
              now,
            }),
          ),
        ),
      ),
  );
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return ok(sorted);
}

export interface EvidenceRequestWithApplicant extends EvidenceRequest {
  readonly applicantName: string;
  /** The traveller's time zone, for due days only; null when the traveller cannot be read. */
  readonly applicantTimezone: string | null;
}

/** Same as `listEvidenceRequestsForOrg`, but resolves each request's applicant name. */
export async function listEvidenceRequestsForOrgDetailed(
  db: Db,
  actorAccountId: string,
  organizationId: string,
): Promise<Result<EvidenceRequestWithApplicant[], ServiceError>> {
  const listed = await listEvidenceRequestsForOrg(db, actorAccountId, organizationId);
  if (!listed.ok) return listed;
  // One query for every distinct applicant, not one per request (measured at 639 requests: about
  // 1.1 seconds for the per-row version, docs/operations/capacity.md).
  const applicantIds = [...new Set(listed.value.map((request) => request.applicantId))];
  const names = new Map<string, { readonly name: string; readonly timezone: string }>();
  const lifecycle = await lifecycleTablesPresent(db);
  if (applicantIds.length > 0) {
    const rows = await db
      .select({
        id: schema.applicants.id,
        displayName: schema.applicants.displayName,
        timezone: schema.applicants.timezone,
      })
      .from(schema.applicants)
      .where(
        and(
          inArray(schema.applicants.id, applicantIds),
          // Agency view: presentApplicantCondition (archive never revokes sharing, D6).
          lifecycle ? presentApplicantCondition() : undefined,
        ),
      );
    for (const row of rows) names.set(row.id, { name: row.displayName, timezone: row.timezone });
  }
  // A traveller record in Recently Deleted takes its requests out of the agency's list.
  const visible = lifecycle
    ? listed.value.filter((request) => names.has(request.applicantId))
    : listed.value;
  const result: EvidenceRequestWithApplicant[] = visible.map((request) => ({
    ...request,
    applicantName: names.get(request.applicantId)?.name ?? 'Unknown applicant',
    applicantTimezone: names.get(request.applicantId)?.timezone ?? null,
  }));
  return ok(result);
}

// ---------------------------------------------------------------------------
// E02 agency triage (Programme X WP-V4, PROGRAMME.md section 8, W0 ledger
// section 2). One primary group per item, mapped from statuses the product
// already stores. Freshness, safety, due dates, case stage and task state are
// separate indicators and never change the group on their own. Pure: no
// database read, so nothing here can widen who sees what. Callers pass only
// rows they were already allowed to load.
// ---------------------------------------------------------------------------

/** The five item-level E02 groups, in the order a summary shows them. */
export const TRIAGE_GROUPS = [
  'MISSING',
  'PROCESSING',
  'RECEIVED',
  'NEEDS_CORRECTION',
  'REVIEWED',
] as const;
export type TriageGroup = (typeof TRIAGE_GROUPS)[number];

/**
 * Indicators shown beside an item's group. They explain the group; they never
 * replace it.
 */
export type TriageIndicator =
  | 'OPTIONAL'
  | 'OUT_OF_DATE'
  | 'ANSWER_NEEDED'
  | 'DOES_NOT_MATCH'
  | 'NOT_ACCEPTED'
  | 'SENT_BACK'
  | 'REVIEW_STARTED'
  | 'COULD_NOT_BE_USED';

/**
 * The case-level outcome: Ready for review only when the existing readiness
 * check says every required item is in and nothing on the case still waits
 * on anyone. A case checked by hand never gets this claim (W0 table H), and a
 * case without a checklist has nothing to measure.
 */
export type CaseTriageState = 'READY_FOR_REVIEW' | 'NOT_READY' | 'CHECKED_BY_HAND' | 'NO_CHECKLIST';

type DocumentProcessingState = (typeof schema.documentState.enumValues)[number];
type DocumentSafetyState = (typeof schema.documentSafetyStatus.enumValues)[number];

/** The responding document's latest version, when the caller already holds it. */
export interface TriageDocumentState {
  readonly processingStatus: DocumentProcessingState;
  readonly safetyStatus: DocumentSafetyState;
}

const STILL_PROCESSING: ReadonlySet<DocumentProcessingState> = new Set([
  'UPLOADING',
  'QUARANTINED',
  'SCANNING',
  'NORMALIZING',
  'EXTRACTING',
]);
const UNUSABLE_PROCESSING: ReadonlySet<DocumentProcessingState> = new Set([
  'NEEDS_ATTENTION',
  'FAILED',
  'REJECTED',
]);

/**
 * One request's primary group (W0 ledger 2.1, first match wins). `null` means
 * closed: cancelled, or a legacy Fulfilled or Declined row with no current
 * writer, which must never read as Reviewed (W0 L4).
 *
 * `document` is the responding document's latest version. Leave it out when it
 * was not loaded: the request status alone then decides, which is exact for
 * the statuses that matter (a request only becomes Received after its document
 * passed safety and processing, W0 L3). Pass `null` when the responding
 * document was looked up and no longer exists (for example, erased): the item
 * then needs a new upload.
 */
export function evidenceRequestTriageGroup(
  request: Pick<EvidenceRequest, 'status' | 'kind'>,
  document?: TriageDocumentState | null,
): TriageGroup | null {
  switch (request.status) {
    case 'CANCELLED':
    case 'FULFILLED':
    case 'DECLINED':
      return null;
    case 'ACCEPTED':
      return 'REVIEWED';
    case 'NEEDS_REPLACEMENT':
      return 'NEEDS_CORRECTION';
    case 'RECEIVED':
    case 'UNDER_REVIEW': {
      if (request.kind !== 'DOCUMENT' || document === undefined) return 'RECEIVED';
      if (document === null) return 'NEEDS_CORRECTION';
      if (document.safetyStatus === 'QUARANTINED' || document.safetyStatus === 'FAILED') {
        return 'NEEDS_CORRECTION';
      }
      if (UNUSABLE_PROCESSING.has(document.processingStatus)) return 'NEEDS_CORRECTION';
      if (
        STILL_PROCESSING.has(document.processingStatus) ||
        document.safetyStatus === 'PENDING' ||
        document.safetyStatus === 'SCANNING'
      ) {
        return 'PROCESSING';
      }
      return 'RECEIVED';
    }
    case 'OPEN':
      return 'MISSING';
  }
}

/** Requirement result states (readiness), as `computeReadiness` reports them. */
type TriageRequirementState =
  | 'SATISFIED'
  | 'ATTENTION'
  | 'CRITICAL_GAP'
  | 'UNVERIFIED'
  | 'CONFLICTING'
  | 'EXPIRING_STALE'
  | 'NOT_APPLICABLE';

/**
 * One checklist requirement's group from its readiness state and the latest
 * reviewer decision on it (W0 tables F and G). Received is never Reviewed: a
 * requirement is Reviewed only when its evidence is present AND a reviewer
 * accepted it. A rejected decision always reads as needing a correction.
 * `null`: the requirement does not apply to this case.
 */
export function requirementTriageGroup(
  state: TriageRequirementState,
  latestDecision: 'ACCEPTED' | 'REJECTED' | null,
): TriageGroup | null {
  if (state === 'NOT_APPLICABLE') return null;
  if (latestDecision === 'REJECTED') return 'NEEDS_CORRECTION';
  switch (state) {
    case 'SATISFIED':
      return latestDecision === 'ACCEPTED' ? 'REVIEWED' : 'RECEIVED';
    case 'CRITICAL_GAP':
    case 'ATTENTION':
      return 'MISSING';
    case 'CONFLICTING':
    case 'EXPIRING_STALE':
    case 'UNVERIFIED':
      return 'NEEDS_CORRECTION';
  }
}

function requirementIndicators(
  state: TriageRequirementState,
  optional: boolean,
  latestDecision: 'ACCEPTED' | 'REJECTED' | null,
): TriageIndicator[] {
  const indicators: TriageIndicator[] = [];
  if (optional) indicators.push('OPTIONAL');
  if (latestDecision === 'REJECTED') indicators.push('NOT_ACCEPTED');
  if (state === 'EXPIRING_STALE') indicators.push('OUT_OF_DATE');
  if (state === 'UNVERIFIED') indicators.push('ANSWER_NEEDED');
  if (state === 'CONFLICTING') indicators.push('DOES_NOT_MATCH');
  return indicators;
}

function requestIndicators(
  request: Pick<EvidenceRequest, 'status'>,
  group: TriageGroup,
): TriageIndicator[] {
  if (request.status === 'NEEDS_REPLACEMENT') return ['SENT_BACK'];
  if (request.status === 'UNDER_REVIEW' && group === 'RECEIVED') return ['REVIEW_STARTED'];
  if (group === 'NEEDS_CORRECTION') return ['COULD_NOT_BE_USED'];
  return [];
}

/** A request as the triage summary needs it. Dates may be Date objects or ISO strings. */
export interface TriageRequestInput {
  readonly id: string;
  readonly missionId: string | null;
  readonly packRequirementId: string | null;
  readonly kind: EvidenceRequest['kind'];
  readonly fieldKey: string | null;
  readonly docType: string | null;
  readonly status: EvidenceRequest['status'];
  readonly dueDate: Date | string | null;
  readonly createdAt: Date | string;
}

export interface CaseTriageInput {
  readonly missionId: string;
  readonly manualMode: boolean;
  /** `computeReadiness` for this case, or null when there is none (manual case, no checklist, or not loaded). */
  readonly readiness: {
    readonly overallState: string;
    readonly requirementResults: readonly {
      readonly packRequirementId: string;
      readonly kind: 'FIELD' | 'DOCUMENT';
      readonly key: string;
      readonly optional: boolean;
      readonly state: TriageRequirementState;
    }[];
  } | null;
  /** Reviewer decisions the viewer may already read for this case. */
  readonly decisions: readonly {
    readonly packRequirementId: string;
    readonly outcome: 'ACCEPTED' | 'REJECTED';
    readonly createdAt: Date | string;
  }[];
  /**
   * Requests the viewer may already read. Only those that name this case are
   * used: an applicant-wide request belongs to the traveller, not to any one
   * case, so it is never counted here (W0 structural flag 2).
   */
  readonly requests: readonly TriageRequestInput[];
  /**
   * The responding document's latest state per request id, where the caller loaded it
   * (`listRespondingDocumentStatesForOrg`). A request not in the map is judged by its status.
   */
  readonly documentStates?: ReadonlyMap<string, TriageDocumentState | null>;
}

export interface CaseTriageItem {
  /** Stable within one summary; never shown. */
  readonly key: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  /** The field key or document type, for the caller to turn into words. */
  readonly subject: string | null;
  readonly packRequirementId: string | null;
  readonly requestId: string | null;
  readonly group: TriageGroup;
  readonly indicators: readonly TriageIndicator[];
  /** Set only when the agency actually set one. Never guessed. */
  readonly dueDate: string | null;
}

export interface CaseTriageSummary {
  readonly state: CaseTriageState;
  readonly items: readonly CaseTriageItem[];
  readonly counts: Readonly<Record<TriageGroup, number>>;
}

const ms = (value: Date | string) => new Date(value).getTime();
const iso = (value: Date | string | null) =>
  value === null ? null : new Date(value).toISOString();

/**
 * The case-level E02 summary: one primary group per item, built from the case's
 * checklist (readiness and reviewer decisions) and the requests that name the
 * case. A live request for a checklist item is the most specific current step,
 * so it decides that item's group; an accepted request reads as Reviewed only
 * when the checklist also finds the evidence present, so a later gap is never
 * hidden behind an old acceptance. Requests for something outside the
 * checklist are their own items. The order is the checklist order, then
 * requests oldest first, so the summary never jumps around.
 */
export function summarizeCaseTriage(input: CaseTriageInput): CaseTriageSummary {
  const latestDecision = new Map<string, { outcome: 'ACCEPTED' | 'REJECTED'; at: number }>();
  for (const decision of input.decisions) {
    const at = ms(decision.createdAt);
    const seen = latestDecision.get(decision.packRequirementId);
    if (!seen || at > seen.at) {
      latestDecision.set(decision.packRequirementId, { outcome: decision.outcome, at });
    }
  }

  const groupOf = (request: TriageRequestInput) =>
    evidenceRequestTriageGroup(request, input.documentStates?.get(request.id));
  const live = input.requests
    .filter((r) => r.missionId === input.missionId)
    .filter((r) => groupOf(r) !== null)
    .sort((a, b) => ms(a.createdAt) - ms(b.createdAt) || a.id.localeCompare(b.id));
  // The newest live request per checklist item decides that item.
  const requestForRequirement = new Map<string, TriageRequestInput>();
  for (const request of live) {
    if (request.packRequirementId) requestForRequirement.set(request.packRequirementId, request);
  }

  const items: CaseTriageItem[] = [];
  const requirementIds = new Set<string>();
  for (const result of input.readiness?.requirementResults ?? []) {
    requirementIds.add(result.packRequirementId);
    const decision = latestDecision.get(result.packRequirementId)?.outcome ?? null;
    const fromChecklist = requirementTriageGroup(result.state, decision);
    if (fromChecklist === null) continue;
    const request = requestForRequirement.get(result.packRequirementId);
    const fromRequest = request ? groupOf(request) : null;
    let group = fromChecklist;
    let indicators = requirementIndicators(result.state, result.optional, decision);
    let dueDate: string | null = null;
    if (request && fromRequest === 'REVIEWED') {
      // An accepted response is a person's review, but only while the evidence is still there.
      if (result.state === 'SATISFIED' && decision !== 'REJECTED') group = 'REVIEWED';
    } else if (request && fromRequest !== null) {
      group = fromRequest;
      indicators = requestIndicators(request, fromRequest);
      if (result.optional) indicators.unshift('OPTIONAL');
      dueDate = iso(request.dueDate);
    }
    items.push({
      key: `requirement:${result.packRequirementId}`,
      kind: result.kind,
      subject: result.key,
      packRequirementId: result.packRequirementId,
      requestId: request?.id ?? null,
      group,
      indicators,
      dueDate,
    });
  }
  for (const request of live) {
    if (request.packRequirementId && requirementIds.has(request.packRequirementId)) continue;
    const group = groupOf(request);
    if (group === null) continue;
    items.push({
      key: `request:${request.id}`,
      kind: request.kind,
      subject: request.kind === 'FIELD' ? request.fieldKey : request.docType,
      packRequirementId: request.packRequirementId,
      requestId: request.id,
      group,
      indicators: requestIndicators(request, group),
      dueDate: iso(request.dueDate),
    });
  }

  const counts: Record<TriageGroup, number> = {
    MISSING: 0,
    PROCESSING: 0,
    RECEIVED: 0,
    NEEDS_CORRECTION: 0,
    REVIEWED: 0,
  };
  for (const item of items) counts[item.group] += 1;

  let state: CaseTriageState;
  if (input.manualMode) state = 'CHECKED_BY_HAND';
  else if (!input.readiness) state = 'NO_CHECKLIST';
  else if (
    input.readiness.overallState === 'READY_FOR_APPLICANT_REVIEW' &&
    counts.MISSING + counts.PROCESSING + counts.NEEDS_CORRECTION === 0
  ) {
    state = 'READY_FOR_REVIEW';
  } else state = 'NOT_READY';

  return { state, items, counts };
}

/**
 * The latest version state of each document a traveller sent in answer to this organization's
 * requests, for the triage groups (W0 ledger 2.1 step 4): a newer version still being checked
 * reads as Processing, and one that is unsafe, failed or erased reads as Needs Correction, never
 * as Received.
 *
 * Gated: `access` must be a genuine `requireAccess` proof of MANAGE on one case (covering that
 * case's requests) or on the traveller as a whole (covering requests made for the traveller in
 * general), issued to a member of `organizationId`. Requests are administrator data, so anyone
 * else gets an empty map, never an error. Keys are request ids; a `null` value means the
 * document can no longer be used (no version left, or erased).
 */
export async function listRespondingDocumentStatesForOrg(
  access: AuthorizedApplicant<'MANAGE'>,
  organizationId: string,
): Promise<ReadonlyMap<string, TriageDocumentState | null>> {
  const states = new Map<string, TriageDocumentState | null>();
  if (!AuthorizedApplicant.isGenuine(access, 'MANAGE')) return states;
  const { actor, resource, tx } = access;
  if (actor.kind !== 'organization_member') return states;
  if (actor.membership.organizationId !== organizationId) return states;
  if (!(await isOrgAdmin(tx, actor.accountId, organizationId))) return states;
  if (resource.kind === 'document') return states;

  const scope =
    resource.kind === 'mission'
      ? eq(schema.evidenceRequests.missionId, resource.mission.id)
      : isNull(schema.evidenceRequests.missionId);
  const requests = await tx
    .select({
      id: schema.evidenceRequests.id,
      documentId: schema.evidenceRequests.respondingDocumentId,
    })
    .from(schema.evidenceRequests)
    .where(
      and(
        eq(schema.evidenceRequests.organizationId, organizationId),
        eq(schema.evidenceRequests.applicantId, resource.applicantId),
        eq(schema.evidenceRequests.kind, 'DOCUMENT'),
        inArray(schema.evidenceRequests.status, ['RECEIVED', 'UNDER_REVIEW']),
        isNotNull(schema.evidenceRequests.respondingDocumentId),
        scope,
      ),
    );
  const documentIds = [...new Set(requests.flatMap((r) => (r.documentId ? [r.documentId] : [])))];
  if (documentIds.length === 0) return states;

  const versions = await tx
    .select({
      documentId: schema.documentVersions.documentId,
      versionNumber: schema.documentVersions.versionNumber,
      safetyStatus: schema.documentVersions.safetyStatus,
      processingStatus: schema.documentVersions.processingStatus,
      storageObjectId: schema.documentVersions.storageObjectId,
    })
    .from(schema.documentVersions)
    .where(inArray(schema.documentVersions.documentId, documentIds));
  const latest = new Map<string, (typeof versions)[number]>();
  for (const version of versions) {
    const best = latest.get(version.documentId);
    if (!best || version.versionNumber > best.versionNumber)
      latest.set(version.documentId, version);
  }
  const erased = await activeOrVerifiedErasureStorageObjectIds(
    tx,
    [...latest.values()].map((v) => v.storageObjectId),
  );
  for (const request of requests) {
    const version = request.documentId ? latest.get(request.documentId) : undefined;
    states.set(
      request.id,
      !version || erased.has(version.storageObjectId)
        ? null
        : { processingStatus: version.processingStatus, safetyStatus: version.safetyStatus },
    );
  }
  return states;
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
  const lifecycle = await lifecycleTablesPresent(db);
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
        // Agency view: presentApplicantCondition (archive never revokes sharing, D6).
        lifecycle ? presentApplicantCondition() : undefined,
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
    const lifecycle = await lifecycleTablesPresent(db);
    const document = first(
      await db
        .select({ applicantId: schema.documents.applicantId, docType: schema.documents.docType })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, input.documentId),
            // The owner's explicit answer: presentDocumentCondition (archived stays, deleted goes).
            lifecycle ? presentDocumentCondition() : undefined,
          ),
        )
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

  const exclusions = await loadCaseExclusions(db, { grantIds: grantRows.map((g) => g.id) });

  const now = new Date();
  const candidateApplicantIds = [...new Set(grantRows.map((g) => g.applicantId))].slice(
    0,
    BULK_EXPORT_MAX_APPLICANTS,
  );
  const rows: BulkExportRow[] = [];
  for (const applicantId of candidateApplicantIds) {
    // The one row-to-policy mapping (`toPolicyGrant`), so mission, document,
    // category-snapshot and case-exception scope are all kept, never a
    // hand-copied subset (docs/audits/post-programme-defect-register.md
    // finding #4 was exactly such a subset). `grantRows` holds only grants
    // naming this organization.
    const grants = grantRows
      .filter((g) => g.applicantId === applicantId)
      .map((g) => toPolicyGrant(g, exclusions.get(g.id)));

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
    return err(serviceError('forbidden', 'not assigned to this case'));
  }
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, input.missionId)).limit(1),
  );
  if (!mission) return err(serviceError('not_found', 'case not found'));
  if (
    !(await orgGrantPermits(db, input.organizationId, mission.applicantId, 'MANAGE', mission.id))
  ) {
    // Answered exactly like an unknown id, so a case hidden from this
    // organization (a per-case sharing exception, ADR 0017) cannot be told
    // apart from one that does not exist.
    return err(serviceError('not_found', 'case not found'));
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
    return err(serviceError('not_found', "requirement not found on this case's attached pack"));
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
  if (!mission) return err(serviceError('not_found', 'case not found'));
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
      return err(serviceError('forbidden', 'not authorized to view decisions on this case'));
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
  if (!mission) return err(serviceError('not_found', 'case not found'));
  if (!(await orgGrantPermits(db, organizationId, mission.applicantId, 'MANAGE', mission.id))) {
    // Answered exactly like an unknown id, so a case hidden from this
    // organization (a per-case sharing exception, ADR 0017) cannot be told
    // apart from one that does not exist.
    return err(serviceError('not_found', 'case not found'));
  }
  if (!mission.packVersionId) return ok([]);
  return ok(await listRequirements(db, mission.packVersionId));
}
