import { randomUUID } from 'node:crypto';
import type {
  AccountId,
  AgencyId,
  ApplicantId,
  MissionId,
  MissionState,
  PermissionAction,
} from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { knownFieldOptions, resolveDocumentType } from '@visastack/core/catalogue';
import { authorize } from '@visastack/policy';
import {
  type SQL,
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
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
import { type ServiceError, keyedError, serviceError } from './errors';
import {
  type FieldPin,
  evidenceFieldPinsPresent,
  findFieldSubmissionByKey,
  linkFieldDecision,
  recordFieldSubmission,
  waitingFieldSubmission,
} from './evidence-field-answers';
import {
  evidenceSubmissionsPresent,
  newerUnlinkedDecision,
  pinnedVersionIntact,
} from './evidence-submission-tables';
import type { ServiceMessageKey } from './i18n';
import {
  lifecycleTablesPresent,
  presentApplicantCondition,
  presentDocumentCondition,
} from './lifecycle/foundation';
import { isUuid } from './lifecycle/foundation/ids';
import {
  cancelQueuedNotificationsForResource,
  enqueueNotificationBothChannels,
} from './notifications';
import { getOrganization, isOrgAdmin } from './organizations';
import { type PackRequirement, listRequirements } from './packs';
import {
  type Page,
  type PageRequest,
  clampLimit,
  cursorOrder,
  cursorTime,
  decodeTimeCursor,
  encodeTimeCursor,
  olderThan,
  toPage,
} from './paging';
import { recordProductEvent } from './product-events';
import { RATE_LIMITS, checkRateLimit, checkRateLimits, refundRateLimit } from './rate-limit';
import { assignReferenceCodes } from './reference-codes';
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
  return (await orgPermittingGrantId(db, organizationId, applicantId, action, missionId)) !== null;
}

/**
 * The id of the first grant that makes `orgGrantPermits` true, or null when none does. The same
 * test, kept in one place; a send of evidence records the grant it was made under (Lane D).
 */
async function orgPermittingGrantId(
  db: Db,
  organizationId: string,
  applicantId: string,
  action: PermissionAction,
  missionId?: string,
): Promise<string | null> {
  // SHR-02: a suspended/closed organization has no standing at all, even
  // with an otherwise-valid grant still on the books.
  const org = await getOrganization(db, organizationId);
  if (!org || org.status !== 'ACTIVE') return null;
  // The case must belong to the person named: an all-cases grant on one
  // person must never vouch for another person's case id passed beside it.
  if (missionId !== undefined && !(await missionBelongsTo(db, missionId, applicantId))) {
    return null;
  }
  const rows = await db
    .select()
    .from(schema.grants)
    .where(eq(schema.grants.applicantId, applicantId));
  const exclusions = rows.some((row) => row.missionId === null)
    ? await loadCaseExclusions(db, { applicantId })
    : undefined;
  const now = new Date();
  for (const row of rows) {
    const g = toPolicyGrant(row, exclusions?.get(row.id));
    if (g.recipientOrganizationId !== organizationId) continue;
    const allowed = authorize({
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
    }).allowed;
    if (allowed) return row.id;
  }
  return null;
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
 * Whether the account has ANY relationship with this traveller beyond ownership: it is the named
 * recipient of a grant on them (whatever its state), or belongs (in any state) to an organization
 * that holds one. A signed-in stranger has none of these. The services that refuse a caller who
 * lacks one specific right (`forbidden`) use this to answer a stranger exactly as they answer an
 * id that does not exist, so a real case or request cannot be told apart from a made-up one.
 * Never used to grant anything.
 */
async function hasAnyStandingOnApplicant(
  db: Db,
  accountId: string,
  applicantId: string,
): Promise<boolean> {
  const grantRows = await db
    .select({
      recipientAccountId: schema.grants.recipientAccountId,
      recipientOrganizationId: schema.grants.recipientOrganizationId,
    })
    .from(schema.grants)
    .where(eq(schema.grants.applicantId, applicantId));
  if (grantRows.some((row) => row.recipientAccountId === accountId)) return true;
  const organizationIds = [
    ...new Set(
      grantRows.flatMap((row) =>
        row.recipientOrganizationId ? [row.recipientOrganizationId] : [],
      ),
    ),
  ];
  if (organizationIds.length === 0) return false;
  const membership = first(
    await db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, accountId),
          inArray(schema.memberships.organizationId, organizationIds),
        ),
      )
      .limit(1),
  );
  return membership !== undefined;
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
 * The agency read rule for the person, in one place: may this account read what this organization
 * sees of this case? Only an active member of the organization who is its OWNER or ADMIN, or who
 * is assigned to the case in this organization: exactly the cases `listVisibleMissionsForMember`
 * shows that person. Anyone else (a stranger, a removed member, another agency's admin, the
 * traveller) and a made-up organization get `false`.
 *
 * This checks the PERSON only. Whether the organization's grant still reaches the case (and so
 * whether the case exists for it at all) stays each read's own check, run right after this one
 * (`canReadMissionCollaboration` or `orgGrantPermits`): an owner or admin passes here for any case
 * id, real or not. It reads the one membership row `isActiveMember` and `isOrgAdmin` read, once.
 */
export async function mayReadOrgCase(
  db: Db,
  actorAccountId: string,
  organizationId: string,
  missionId: string,
): Promise<boolean> {
  if (!isUuid(actorAccountId) || !isUuid(organizationId) || !isUuid(missionId)) return false;
  const membership = await readActiveMembership(db, actorAccountId, organizationId);
  if (!membership) return false;
  if (membership.admin) return true;
  return assignedToMission(db, organizationId, actorAccountId, missionId);
}

/**
 * The person's membership of the organization, read once: `null` unless they are an active member,
 * and whether they are an administrator (the roles `isOrgAdmin` treats as such). One read for what
 * `isActiveMember` and `isOrgAdmin` would read twice.
 */
async function readActiveMembership(
  db: Db,
  accountId: string,
  organizationId: string,
): Promise<{ readonly admin: boolean } | null> {
  const row = first(
    await db
      .select({ active: schema.memberships.active, role: schema.memberships.role })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, accountId),
          eq(schema.memberships.organizationId, organizationId),
        ),
      )
      .limit(1),
  );
  if (row?.active !== true) return null;
  return { admin: row.role === 'OWNER' || row.role === 'ADMIN' };
}

/** The organization-wide reads (every case, every client): an active OWNER or ADMIN only. */
async function mayReadOrgWide(
  db: Db,
  actorAccountId: string,
  organizationId: string,
): Promise<boolean> {
  if (!isUuid(actorAccountId) || !isUuid(organizationId)) return false;
  return isOrgAdmin(db, actorAccountId, organizationId);
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
    return err(keyedError('forbidden', 'agency.only_an_org_owner_admin_can'));
  }
  if (!(await isActiveMember(db, input.memberAccountId, input.organizationId))) {
    return err(keyedError('invalid', 'agency.the_assignee_must_be_an_active'));
  }
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, input.missionId)).limit(1),
  );
  if (!mission) return err(keyedError('not_found', 'agency.case_not_found'));
  if (
    !(await orgGrantPermits(db, input.organizationId, mission.applicantId, 'MANAGE', mission.id))
  ) {
    // Answered exactly like an unknown id, so a case hidden from this
    // organization (a per-case sharing exception, ADR 0017) cannot be told
    // apart from one that does not exist.
    return err(keyedError('not_found', 'agency.case_not_found'));
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
    return err(keyedError('forbidden', 'agency.only_an_org_owner_admin_can2'));
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
  actorAccountId: string,
  organizationId: string,
): Promise<OrgMission[]> {
  // Administrator data: anyone else gets the empty queue a made-up organization gets.
  if (!(await mayReadOrgWide(db, actorAccountId, organizationId))) return [];
  const missions = await missionsReachableByOrganization(db, organizationId);
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
  actorAccountId: string,
  organizationId: string,
  applicantId: string,
  missionId: string,
): Promise<AssignmentView[]> {
  if (!(await mayReadOrgCase(db, actorAccountId, organizationId, missionId))) return [];
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
  actorAccountId: string,
  organizationId: string,
  applicantId: string,
  missionId: string,
): Promise<OrgVisibleTask[]> {
  if (!(await mayReadOrgCase(db, actorAccountId, organizationId, missionId))) return [];
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
    return err(keyedError('forbidden', 'agency.not_an_active_member_of_this'));
  }
  if (!(await assignedToMission(db, organizationId, actorAccountId, missionId))) {
    return err(keyedError('forbidden', 'agency.not_assigned_to_this_case'));
  }
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return err(keyedError('not_found', 'agency.case_not_found'));
  if (!(await orgGrantPermits(db, organizationId, mission.applicantId, 'MANAGE', mission.id))) {
    // Answered exactly like an unknown id, so a case hidden from this
    // organization (a per-case sharing exception, ADR 0017) cannot be told
    // apart from one that does not exist.
    return err(keyedError('not_found', 'agency.case_not_found'));
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
  if (description.length === 0)
    return err(keyedError('invalid', 'agency.a_description_is_required'));
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
    if (!task) return err(keyedError('not_found', 'agency.task_not_found'));

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
    if (!task) return err(keyedError('not_found', 'agency.task_not_found'));
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
  if (title.length === 0) return err(keyedError('invalid', 'agency.a_title_is_required'));
  if (input.timezone.trim().length === 0) {
    return err(keyedError('invalid', 'agency.a_timezone_is_required'));
  }
  // A known IANA name only, saved as typed (letter case corrected, never renamed): calendar files place the time in
  // UTC from it, so a name the runtime cannot read would leave the time unplaceable.
  const timezone = recognisedTimeZone(input.timezone);
  if (!timezone) return err(keyedError('invalid', 'agency.enter_a_time_zone_name_such'));
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
  if (timezone === null) return err(keyedError('invalid', 'agency.enter_a_time_zone_name_such'));

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
    if (!appointment) return err(keyedError('not_found', 'agency.appointment_not_found'));

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
    if (!appointment) return err(keyedError('not_found', 'agency.appointment_not_found'));
    if (appointment.status !== 'OPEN') {
      return err(keyedError('invalid', 'agency.only_an_open_appointment_can_be'));
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
  actorAccountId: string,
  organizationId: string,
  applicantId: string,
  missionId: string,
): Promise<OrgVisibleAppointment[]> {
  if (!(await mayReadOrgCase(db, actorAccountId, organizationId, missionId))) return [];
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
  actorAccountId: string,
  organizationId: string,
): Promise<OrgMission[]> {
  // Every case of the organization is administrator data; a member sees their own through
  // `listVisibleMissionsForMember`. Anyone else gets what a made-up organization gets.
  if (!(await mayReadOrgWide(db, actorAccountId, organizationId))) return [];
  return missionsReachableByOrganization(db, organizationId);
}

/**
 * The reachable set itself, with no actor: private to this module, for its own reads that have
 * already checked the person (`listMissionsForOrganization`, `listVisibleMissionsForMember`,
 * `listUnassignedActiveMissions`).
 */
async function missionsReachableByOrganization(
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
 * WP-SB5: one page of the cases the full read below returns, newest opened first (opening time,
 * then id), at most `limit` (clamped to 1 to 100), with how many cases this actor may see in all.
 * `before` is the previous page's `nextCursor`; one made for another organization, or malformed,
 * gives the first page. `only` narrows the page to one case, and only when that case is already
 * in the actor's visible set: the way the Cases page opens a single case without reading any
 * other. The visibility rule is exactly the full read's; the cursor only says where the last page
 * stopped.
 */
export async function listVisibleMissionsForMember(
  db: Db,
  organizationId: string,
  actorAccountId: string,
  options: VisibleCasesPageRequest,
): Promise<VisibleCasesPage>;
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
 * Anyone who is not an active member of the organization (never one, removed,
 * or the organization does not exist) gets no case, the answer an organization
 * with nothing shared gets.
 */
export async function listVisibleMissionsForMember(
  db: Db,
  organizationId: string,
  actorAccountId: string,
): Promise<{ readonly admin: boolean; readonly missions: OrgCaseSummary[] }>;
export async function listVisibleMissionsForMember(
  db: Db,
  organizationId: string,
  actorAccountId: string,
  options?: VisibleCasesPageRequest,
): Promise<{ readonly admin: boolean; readonly missions: OrgCaseSummary[] } | VisibleCasesPage> {
  // Not a member (never one, removed, or the organization does not exist): no case, the same
  // answer as an organization with nothing shared.
  const membership =
    isUuid(actorAccountId) && isUuid(organizationId)
      ? await readActiveMembership(db, actorAccountId, organizationId)
      : null;
  if (!membership) {
    return options
      ? { admin: false, missions: [], nextCursor: null, total: 0 }
      : { admin: false, missions: [] };
  }
  const { admin } = membership;
  const base = await missionsReachableByOrganization(db, organizationId);
  let scoped = base;
  if (!admin) {
    const assignedIds = await listAssignedMissionIds(db, organizationId, actorAccountId);
    scoped = base.filter((m) => assignedIds.has(m.missionId));
  }
  if (options?.only !== undefined) scoped = scoped.filter((m) => m.missionId === options.only);
  if (scoped.length === 0) {
    return options ? { admin, missions: [], nextCursor: null, total: 0 } : { admin, missions: [] };
  }

  const limit = options ? clampLimit(options.limit) : 0;
  const cursorScope = `org:${organizationId}:visible-cases`;
  const after = options ? decodeTimeCursor(options.before, cursorScope) : null;
  const ids = inArray(
    schema.missions.id,
    scoped.map((m) => m.missionId),
  );
  const columns = {
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
    cursorAt: cursorTime(schema.missions.createdAt),
  };
  const rows = options
    ? await db
        .select(columns)
        .from(schema.missions)
        .where(
          after ? and(ids, olderThan(schema.missions.createdAt, schema.missions.id, after)) : ids,
        )
        .orderBy(...cursorOrder(schema.missions.createdAt, schema.missions.id))
        .limit(limit + 1)
    : await db.select(columns).from(schema.missions).where(ids);
  const detailById = new Map(rows.map((r) => [r.id, r]));

  if (options) {
    const summaryById = new Map(scoped.map((m) => [m.missionId, m]));
    const page = toPage(rows, limit, (last) =>
      encodeTimeCursor({ at: last.cursorAt, id: last.id }, cursorScope),
    );
    const missions = page.items.flatMap((detail): OrgCaseSummary[] => {
      const m = summaryById.get(detail.id);
      return m ? [toOrgCaseSummary(m, detail)] : [];
    });
    return { admin, missions, nextCursor: page.nextCursor, total: scoped.length };
  }

  const missions = scoped.map(
    (m): OrgCaseSummary => toOrgCaseSummary(m, detailById.get(m.missionId)),
  );
  return { admin, missions };
}

/** WP-SB5: what one page of an actor's visible cases asks for. */
export interface VisibleCasesPageRequest extends PageRequest {
  /** One case id: the page holds that case alone, and only if the actor may already see it. */
  readonly only?: string;
}

/** WP-SB5: one page of an actor's visible cases. */
export interface VisibleCasesPage {
  readonly admin: boolean;
  readonly missions: OrgCaseSummary[];
  /** Pass back as `before` for the next page; null when this is the last. */
  readonly nextCursor: string | null;
  /** How many cases the actor may see in all (after `only`). */
  readonly total: number;
}

function toOrgCaseSummary(
  m: OrgMission,
  detail:
    | {
        readonly state: MissionState;
        readonly destination: string | null;
        readonly jurisdiction: string | null;
        readonly manualMode: boolean;
        readonly packVersionId: string | null;
        readonly targetDeadline: Date | null;
        readonly travelStartDate: Date | null;
        readonly createdAt: Date;
        readonly updatedAt: Date;
      }
    | undefined,
): OrgCaseSummary {
  // The mission list comes from the missions table moments ago, inside the same request, so a
  // missing detail row here would mean the mission was deleted mid-request -- never actually
  // possible (missions are never deleted, only state-transitioned) -- not a real omission.
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
  if (body.length === 0) return err(keyedError('invalid', 'agency.a_note_body_is_required'));
  if (body.length > NOTE_MAX_LENGTH) {
    return err(serviceError('invalid', `a note may be at most ${NOTE_MAX_LENGTH} characters`));
  }

  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, input.missionId)).limit(1),
  );
  if (!mission) return err(keyedError('not_found', 'agency.case_not_found'));

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
    const stranger = !(await hasAnyStandingOnApplicant(
      db,
      input.actorAccountId,
      mission.applicantId,
    ));
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
    // Someone with no relationship to this traveller at all is answered exactly like an unknown
    // case id, so a real case cannot be told apart from a made-up one. The denied attempt is
    // still recorded above.
    if (stranger) return err(keyedError('not_found', 'agency.case_not_found'));
    return err(keyedError('forbidden', 'agency.not_authorized_to_comment_on_this'));
  }

  if (input.visibility === 'AGENCY_INTERNAL' && !authorizingOrganizationId) {
    return err(
      keyedError('invalid', 'agency.agency_internal_notes_require_organization_authorship'),
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
 * WP-SB5: one page of the notes the full read below returns, newest first (time, then id), at
 * most `limit` (clamped to 1 to 100), under the same read check and the same visibility rule.
 * `before` is the previous page's `nextCursor`. The cursor belongs to this organization's notes,
 * not one case, so the Activity page can page several cases' notes as one list (each note carries
 * its own cursor for that); one made for another organization, or malformed, gives the first
 * page. `withTotal` also counts the notes this organization may read on the case. A reader without
 * access gets an empty page.
 */
export async function listNotes(
  db: Db,
  actorAccountId: string,
  organizationId: string,
  applicantId: string,
  missionId: string,
  options: NotesPageRequest,
): Promise<NotesPage>;
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
  actorAccountId: string,
  organizationId: string,
  applicantId: string,
  missionId: string,
): Promise<MissionNote[]>;
export async function listNotes(
  db: Db,
  actorAccountId: string,
  organizationId: string,
  applicantId: string,
  missionId: string,
  options?: NotesPageRequest,
): Promise<MissionNote[] | NotesPage> {
  if (
    !(await mayReadOrgCase(db, actorAccountId, organizationId, missionId)) ||
    !(await canReadMissionCollaboration(db, organizationId, applicantId, missionId))
  ) {
    return options ? { items: [], nextCursor: null, total: 0 } : [];
  }
  const readable = and(
    eq(schema.missionNotes.missionId, missionId),
    or(
      eq(schema.missionNotes.visibility, 'TRAVELLER_SHARED'),
      eq(schema.missionNotes.authorOrganizationId, organizationId),
    ),
  );
  if (!options) return db.select().from(schema.missionNotes).where(readable);
  const limit = clampLimit(options.limit);
  const cursorScope = `org:${organizationId}:notes`;
  const after = decodeTimeCursor(options.before, cursorScope);
  const [rows, counts] = await Promise.all([
    db
      .select({
        note: schema.missionNotes,
        cursorAt: cursorTime(schema.missionNotes.createdAt),
      })
      .from(schema.missionNotes)
      .where(
        after
          ? and(readable, olderThan(schema.missionNotes.createdAt, schema.missionNotes.id, after))
          : readable,
      )
      .orderBy(...cursorOrder(schema.missionNotes.createdAt, schema.missionNotes.id))
      .limit(limit + 1),
    options.withTotal
      ? db.select({ total: sql<number>`count(*)::int` }).from(schema.missionNotes).where(readable)
      : Promise.resolve(null),
  ]);
  const page = toPage(rows, limit, (last) =>
    encodeTimeCursor({ at: last.cursorAt, id: last.note.id }, cursorScope),
  );
  return {
    items: page.items.map((row) => ({
      ...row.note,
      cursorAt: row.cursorAt,
      cursor: encodeTimeCursor({ at: row.cursorAt, id: row.note.id }, cursorScope),
    })),
    nextCursor: page.nextCursor,
    ...(counts ? { total: Number(counts[0]?.total ?? 0) } : {}),
  };
}

/** WP-SB5: what one page of a case's notes asks for. */
export interface NotesPageRequest extends PageRequest {
  /** Also count every note the organization may read on the case. */
  readonly withTotal?: boolean;
}

/**
 * A note on a page, with the cursor that continues after it: a caller that merges several cases'
 * notes into one newest-first list (the Activity page) passes the last kept note's cursor as
 * `before` to every case, so each case's next read starts strictly after that position.
 */
export type PagedMissionNote = MissionNote & {
  /** The note's exact time as UTC text (microseconds kept), the order a merge must use. */
  readonly cursorAt: string;
  readonly cursor: string;
};

/** WP-SB5: one page of a case's notes. */
export interface NotesPage extends Page<PagedMissionNote> {
  /** Present when the request asked `withTotal`. */
  readonly total?: number;
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
): Promise<OwnerVisibleNote[]>;
/**
 * WP-SB2: with `options.limit` only the newest `limit` shared notes come back (clamped to 1 to
 * 100, as every capped list is), with how many shared notes the case holds. The same owner check
 * and the same TRAVELLER_SHARED rule apply; a reader who is not the owner gets an empty list.
 */
export async function listNotesForOwner(
  db: Db,
  actorAccountId: string,
  missionId: string,
  options: { readonly limit?: number },
): Promise<{ readonly items: readonly OwnerVisibleNote[]; readonly total: number }>;
export async function listNotesForOwner(
  db: Db,
  actorAccountId: string,
  missionId: string,
  options?: { readonly limit?: number },
): Promise<
  OwnerVisibleNote[] | { readonly items: readonly OwnerVisibleNote[]; readonly total: number }
> {
  const none = options ? { items: [], total: 0 } : [];
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return none;
  const applicant = first(
    await db
      .select()
      .from(schema.applicants)
      .where(eq(schema.applicants.id, mission.applicantId))
      .limit(1),
  );
  if (!applicant || applicant.ownerAccountId !== actorAccountId) return none;
  const shared = and(
    eq(schema.missionNotes.missionId, missionId),
    eq(schema.missionNotes.visibility, 'TRAVELLER_SHARED'),
  );
  const query = db
    .select({
      id: schema.missionNotes.id,
      body: schema.missionNotes.body,
      authorEmail: schema.accounts.email,
      createdAt: schema.missionNotes.createdAt,
    })
    .from(schema.missionNotes)
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.missionNotes.authorAccountId))
    .where(shared)
    .orderBy(desc(schema.missionNotes.createdAt), desc(schema.missionNotes.id));
  if (!options) {
    const rows = await query;
    return rows.map((r) => ({ ...r, authorEmail: r.authorEmail ?? null }));
  }
  // The same clamp as clampLimit in paging.ts (1 to 100, default 50), written here so this shared
  // file gains no new import line that parallel packages would also touch.
  const requested = Number.isFinite(options.limit) ? Math.floor(options.limit ?? 50) : 50;
  const limit = Math.min(100, Math.max(1, requested));
  const [rows, counts] = await Promise.all([
    query.limit(limit),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.missionNotes).where(shared),
  ]);
  return {
    items: rows.map((r) => ({ ...r, authorEmail: r.authorEmail ?? null })),
    total: Number(counts[0]?.total ?? 0),
  };
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
  const notAdmin = await evidenceAdminProblem(db, input);
  if (notAdmin) return err(notAdmin);
  if (input.kind === 'FIELD' && !input.fieldKey) {
    return err(keyedError('invalid', 'agency.a_field_request_needs_a_fieldkey'));
  }
  if (input.kind === 'DOCUMENT' && !input.docType) {
    return err(keyedError('invalid', 'agency.a_document_request_needs_a_doctype'));
  }
  const refused = await evidenceAccessProblem(db, input);
  if (refused) return err(refused);
  if (input.packRequirementId) {
    if (!input.missionId) {
      return err(keyedError('invalid', 'agency.a_requirement_linked_request_must_name'));
    }
    const mission = first(
      await db
        .select()
        .from(schema.missions)
        .where(eq(schema.missions.id, input.missionId))
        .limit(1),
    );
    if (!mission || mission.applicantId !== input.applicantId) {
      return err(keyedError('not_found', 'agency.case_not_found_for_this_applicant'));
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
      return err(keyedError('not_found', 'agency.requirement_not_found_on_this_case'));
    }
  }

  const rateLimit = await checkRateLimit(
    db,
    { subjectId: input.actorAccountId, action: 'evidence.request' },
    RATE_LIMITS.EVIDENCE_REQUEST,
  );
  if (!rateLimit.allowed) return err(serviceError('rate_limited', rateLimit.reason));

  return db.transaction(async (tx) => {
    const send = {
      actorAccountId: input.actorAccountId,
      organizationId: input.organizationId,
      applicantId: input.applicantId,
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.missionId !== undefined ? { missionId: input.missionId } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    };
    const [request] = await insertEvidenceRequestRows(tx, send, [
      {
        kind: input.kind,
        ...(input.fieldKey !== undefined ? { fieldKey: input.fieldKey } : {}),
        ...(input.docType !== undefined ? { docType: input.docType } : {}),
        ...(input.packRequirementId !== undefined
          ? { packRequirementId: input.packRequirementId }
          : {}),
      },
    ]);
    const only = required(request, 'evidence request');
    await auditEvidenceRequested(tx, send, [only]);
    await enqueueEvidenceRequestNotice(tx, {
      organizationId: input.organizationId,
      applicantId: input.applicantId,
      resourceId: only.id,
      count: 1,
      ...(input.missionId !== undefined ? { missionId: input.missionId } : {}),
    });
    return ok(only);
  });
}

/**
 * The two checks every way of asking evidence shares, in one place so the single request and the
 * batch cannot drift apart: only an organization OWNER/ADMIN may ask, and the organization needs a
 * current grant that permits MANAGE for the traveller (and the case, when one is named).
 */
async function evidenceAdminProblem(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string },
): Promise<ServiceError | null> {
  return (await isOrgAdmin(db, input.actorAccountId, input.organizationId))
    ? null
    : keyedError('forbidden', 'agency.only_an_org_owner_admin_can3');
}

async function evidenceAccessProblem(
  db: Db,
  input: {
    readonly organizationId: string;
    readonly applicantId: string;
    readonly missionId?: string | undefined;
    readonly message?: string | undefined;
  },
): Promise<ServiceError | null> {
  if (input.message !== undefined && input.message.length > 1000) {
    return keyedError('invalid', 'agency.message_may_be_at_most_1000');
  }
  return (await orgGrantPermits(
    db,
    input.organizationId,
    input.applicantId,
    'MANAGE',
    input.missionId,
  ))
    ? null
    : keyedError('forbidden', 'agency.this_organization_has_no_current_grant');
}

/** What one evidence request row is made of (the parts that differ between rows of one send). */
interface EvidenceRequestRowInput {
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly fieldKey?: string;
  readonly docType?: string;
  readonly packRequirementId?: string;
}

/** What is the same for every row of one send. */
interface EvidenceRequestSendInput {
  readonly actorAccountId: string;
  readonly organizationId: string;
  readonly applicantId: string;
  readonly message?: string;
  readonly missionId?: string;
  readonly dueDate?: Date;
}

/**
 * The request rows of one send, their reference codes (ADR 0018) and product-event counts, in the
 * caller's transaction: one multi-row insert and one set-based code assignment, so a send of 25
 * costs the same few statements as a send of one. The audit entries come afterwards from
 * `auditEvidenceRequested`, kept apart so the audit chain's lock is held for as short a time as
 * possible.
 */
async function insertEvidenceRequestRows(
  tx: Db,
  send: EvidenceRequestSendInput,
  rows: readonly EvidenceRequestRowInput[],
): Promise<EvidenceRequest[]> {
  const created = await tx
    .insert(schema.evidenceRequests)
    .values(
      rows.map((row) => ({
        organizationId: send.organizationId,
        applicantId: send.applicantId,
        missionId: send.missionId ?? null,
        packRequirementId: row.packRequirementId ?? null,
        requestedByAccountId: send.actorAccountId,
        kind: row.kind,
        fieldKey: row.fieldKey ?? null,
        docType: row.docType ?? null,
        message: send.message ?? null,
        dueDate: send.dueDate ?? null,
      })),
    )
    .returning();
  await assignReferenceCodes(
    tx,
    'R',
    created.map((request) => request.id),
  );
  for (const _request of created) {
    await recordProductEvent(tx, {
      eventType: 'EVIDENCE_REQUESTED',
      accountId: send.actorAccountId,
      organizationId: send.organizationId,
    });
  }
  return created;
}

/** One audit entry per request, written last in the transaction. */
async function auditEvidenceRequested(
  tx: Db,
  send: Pick<EvidenceRequestSendInput, 'actorAccountId' | 'applicantId'>,
  requests: readonly EvidenceRequest[],
): Promise<void> {
  for (const request of requests) {
    await appendAuditEvent(tx, {
      eventType: 'EVIDENCE_REQUESTED',
      actorAccountId: send.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: send.applicantId,
      resourceType: 'evidence_request',
      resourceId: request.id,
    });
  }
}

/**
 * NTF-02: "evidence requests" is explicitly named in the notification event list. Neutral/minimal
 * on purpose: never a request's own `message`, `fieldKey` or `docType` (could itself hint at
 * sensitive content), just that a request exists and a deep link to go see it.
 *
 * One request keeps its own notice, tied to the request id (so cancelling that request silences
 * it). A send of several items gives ONE notice (in the app and by email), tied to a fresh id that
 * belongs to no request: cancelling one item must never silence the notice about the others.
 */
async function enqueueEvidenceRequestNotice(
  tx: Db,
  input: {
    readonly organizationId: string;
    readonly applicantId: string;
    readonly resourceId: string;
    readonly count: number;
    readonly missionId?: string;
  },
): Promise<void> {
  const applicant = first(
    await tx
      .select({ ownerAccountId: schema.applicants.ownerAccountId })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, input.applicantId))
      .limit(1),
  );
  if (!applicant) return;
  await enqueueNotificationBothChannels(tx, {
    eventType: 'EVIDENCE_REQUEST_CREATED',
    resourceId: input.resourceId,
    recipientAccountId: applicant.ownerAccountId,
    applicantId: input.applicantId,
    organizationId: input.organizationId,
    ...(input.missionId !== undefined ? { missionId: input.missionId } : {}),
    payload:
      input.count > 1
        ? {
            subject: 'New requests for your case',
            summary: `An agency working on your case has asked you for ${input.count} documents or details.`,
            deepLinkPath: `/app/applicant/${input.applicantId}/evidence`,
          }
        : {
            subject: 'New evidence request',
            summary: 'An agency working your case has asked for evidence.',
            deepLinkPath: `/app/applicant/${input.applicantId}/evidence`,
          },
  });
}

/** The most items one send may carry (the plain message says so; the picker reads it). */
export const MAX_EVIDENCE_REQUESTS_PER_SEND = 25;

/** One thing asked for in a send. A document is named by its standard type, a detail by its field key. */
export interface EvidenceRequestItem {
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly key: string;
}

let askableFieldKeys: ReadonlySet<string> | undefined;
/** The details an agency can ask for: live details and the catalogue's, never an "Other" text box. */
function isAskableFieldKey(key: string): boolean {
  askableFieldKeys ??= new Set(knownFieldOptions().map((option) => option.key));
  return askableFieldKeys.has(key);
}

/**
 * An organization asks one traveller for several documents or details in one send. It makes
 * exactly the requests `requestEvidence` would make, one per item, with the same checks:
 *
 * - only an organization OWNER/ADMIN may ask;
 * - the organization needs a current grant that permits MANAGE for this traveller and case: the
 *   caller passes the central access proof for it (checked once: the traveller and the case are
 *   the same for every item), and the same grant test as the single request runs again here;
 * - every item is checked against the catalogue before anything is written, so a name that is not
 *   a real detail or document type refuses the whole send;
 * - the rate limit is charged once per item;
 * - every row, code, audit entry and the notice commit together or not at all.
 *
 * The same item named twice is asked once. Nothing about request semantics, statuses or what the
 * traveller sees changes: each item is its own request.
 */
export async function requestEvidenceBatch(
  access: AuthorizedApplicant<'MANAGE'>,
  request: {
    readonly organizationId: string;
    readonly items: readonly EvidenceRequestItem[];
    readonly message?: string;
    readonly dueDate?: Date;
  },
): Promise<Result<EvidenceRequest[], ServiceError>> {
  // The traveller (and the case, when the proof names one) come from the proof itself, issued by
  // `requireAccess` for this organization's grant: they are never taken from the caller's input.
  const noGrant = () => keyedError('forbidden', 'agency.this_organization_has_no_current_grant');
  if (!AuthorizedApplicant.isGenuine(access, 'MANAGE')) return err(noGrant());
  if (access.resource.kind === 'document') return err(noGrant());
  // Only an organization member acting for their organization asks (a traveller never does).
  if (access.actor.kind !== 'organization_member') return err(noGrant());
  const db = access.tx;
  const input = {
    actorAccountId: access.actor.accountId,
    organizationId: request.organizationId,
    applicantId: access.applicant.id,
    items: request.items,
    ...(access.resource.kind === 'mission' ? { missionId: access.resource.mission.id } : {}),
    ...(request.message !== undefined ? { message: request.message } : {}),
    ...(request.dueDate !== undefined ? { dueDate: request.dueDate } : {}),
  };
  const notAdmin = await evidenceAdminProblem(db, input);
  if (notAdmin) return err(notAdmin);
  const seen = new Set<string>();
  const items: EvidenceRequestItem[] = [];
  for (const item of input.items) {
    const id = `${item.kind}:${item.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push(item);
  }
  if (items.length === 0) return err(keyedError('invalid', 'agency.choose_at_least_one_item'));
  if (items.length > MAX_EVIDENCE_REQUESTS_PER_SEND) {
    return err(
      serviceError(
        'invalid',
        `You can ask for up to ${MAX_EVIDENCE_REQUESTS_PER_SEND} items in one send.`,
      ),
    );
  }
  const refused = await evidenceAccessProblem(db, input);
  if (refused) return err(refused);
  for (const item of items) {
    const known =
      item.kind === 'FIELD'
        ? isAskableFieldKey(item.key)
        : resolveDocumentType(item.key)?.key === item.key;
    if (!known) {
      return err(keyedError('invalid', 'agency.one_of_the_items_is_not'));
    }
  }

  const batchLimitInput = {
    subjectId: input.actorAccountId,
    action: 'evidence.request',
    cost: items.length,
  };
  const rateLimit = await checkRateLimit(db, batchLimitInput, RATE_LIMITS.EVIDENCE_REQUEST);
  if (!rateLimit.allowed) {
    // A send too big for what is left must not lock out the smaller ones that still fit: the
    // charge goes back, so only what was actually sent counts against the hour.
    await refundRateLimit(
      db,
      batchLimitInput,
      RATE_LIMITS.EVIDENCE_REQUEST,
      new Date(),
      items.length,
    );
    return err(serviceError('rate_limited', rateLimit.reason));
  }

  return db.transaction(async (tx) => {
    const send = {
      actorAccountId: input.actorAccountId,
      organizationId: input.organizationId,
      applicantId: input.applicantId,
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.missionId !== undefined ? { missionId: input.missionId } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    };
    const created = await insertEvidenceRequestRows(
      tx,
      send,
      items.map((item) => ({
        kind: item.kind,
        ...(item.kind === 'FIELD' ? { fieldKey: item.key } : { docType: item.key }),
      })),
    );
    await auditEvidenceRequested(tx, send, created);
    const head = created[0];
    if (head) {
      await enqueueEvidenceRequestNotice(tx, {
        organizationId: input.organizationId,
        applicantId: input.applicantId,
        resourceId: created.length === 1 ? head.id : randomUUID(),
        count: created.length,
        ...(input.missionId !== undefined ? { missionId: input.missionId } : {}),
      });
    }
    return ok(created);
  });
}

/** WP-SB3: one page of an applicant's evidence requests, with counts over all of them. */
export interface EvidenceRequestListPage {
  readonly items: EvidenceRequest[];
  /** True when more requests exist after these. */
  readonly more: boolean;
  readonly counts: {
    readonly total: number;
    /** Requests waiting on the person's reply (open, or sent back for a replacement). */
    readonly awaiting: number;
  };
}

/**
 * Evidence requests directed at an applicant (owner-scoped), newest first.
 *
 * With `options` (WP-SB3) it reads at most `limit` requests (clamped 1 to 500) in the order the
 * evidence page shows them: waiting on the person first, then the soonest due date (none last),
 * then newest, then by id, plus counts over every request. The owner check is the same.
 */
export async function listEvidenceRequestsForApplicant(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<Result<EvidenceRequest[], ServiceError>>;
export async function listEvidenceRequestsForApplicant(
  db: Db,
  actorAccountId: string,
  applicantId: string,
  options: { readonly limit?: number },
): Promise<Result<EvidenceRequestListPage, ServiceError>>;
export async function listEvidenceRequestsForApplicant(
  db: Db,
  actorAccountId: string,
  applicantId: string,
  options?: { readonly limit?: number },
): Promise<Result<EvidenceRequest[] | EvidenceRequestListPage, ServiceError>> {
  const applicant = first(
    await db.select().from(schema.applicants).where(eq(schema.applicants.id, applicantId)).limit(1),
  );
  if (!applicant) return err(keyedError('not_found', 'agency.applicant_not_found'));
  if (applicant.ownerAccountId !== actorAccountId) {
    return err(keyedError('forbidden', 'agency.not_authorized_to_view_these_requests'));
  }
  const requests = schema.evidenceRequests;
  if (options === undefined) {
    const rows = await db.select().from(requests).where(eq(requests.applicantId, applicantId));
    const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return ok(sorted);
  }
  // Every request must stay reachable from the page (each may need a reply), so the list grows
  // past the usual 100-row page, up to 500.
  const wanted = options.limit;
  const limit =
    wanted === undefined || !Number.isFinite(wanted)
      ? 500
      : Math.min(500, Math.max(1, Math.floor(wanted)));
  const awaitingSql = inArray(requests.status, ['OPEN', 'NEEDS_REPLACEMENT']);
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(requests)
      .where(eq(requests.applicantId, applicantId))
      .orderBy(
        sql`case when ${awaitingSql} then 0 else 1 end`,
        sql`${requests.dueDate} asc nulls last`,
        desc(requests.createdAt),
        desc(requests.id),
      )
      .limit(limit + 1),
    db
      .select({
        total: sql<number>`count(*)::int`,
        awaiting: sql<number>`(count(*) filter (where ${awaitingSql}))::int`,
      })
      .from(requests)
      .where(eq(requests.applicantId, applicantId)),
  ]);
  const counted = first(totals);
  return ok({
    items: rows.slice(0, limit),
    more: rows.length > limit,
    counts: { total: Number(counted?.total ?? 0), awaiting: Number(counted?.awaiting ?? 0) },
  });
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
    return err(keyedError('forbidden', 'agency.only_an_org_owner_admin_can4'));
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

/**
 * WP-SB5: one page of the requests the full read below returns, newest first (time, then id), at
 * most `limit` (clamped to 1 to 100), optionally only the given statuses (or the one request
 * `only` names), with how many match and how many of each status the organization holds. The same
 * administrator check and the same case rules decide which requests exist at all; names are read
 * only for the requests on the page. `before` is the previous page's `nextCursor`; one made for
 * another organization, or malformed, gives the first page.
 */
export async function listEvidenceRequestsForOrgDetailed(
  db: Db,
  actorAccountId: string,
  organizationId: string,
  options: EvidenceRequestsPageRequest,
): Promise<Result<EvidenceRequestsPage, ServiceError>>;
/** Same as `listEvidenceRequestsForOrg`, but resolves each request's applicant name. */
export async function listEvidenceRequestsForOrgDetailed(
  db: Db,
  actorAccountId: string,
  organizationId: string,
): Promise<Result<EvidenceRequestWithApplicant[], ServiceError>>;
export async function listEvidenceRequestsForOrgDetailed(
  db: Db,
  actorAccountId: string,
  organizationId: string,
  options?: EvidenceRequestsPageRequest,
): Promise<Result<EvidenceRequestWithApplicant[] | EvidenceRequestsPage, ServiceError>> {
  const listed = await listEvidenceRequestsForOrg(db, actorAccountId, organizationId);
  if (!listed.ok) return listed;
  const requests = await withoutDeletedTravellers(db, listed.value);
  if (!options) return ok(await withApplicantNames(db, requests));
  const statusCounts: Record<string, number> = {};
  for (const request of requests) {
    statusCounts[request.status] = (statusCounts[request.status] ?? 0) + 1;
  }
  const wanted = options.statuses?.length ? new Set<string>(options.statuses) : null;
  const matching = requests
    .filter((request) => wanted === null || wanted.has(request.status))
    .filter((request) => options.only === undefined || request.id === options.only)
    .map((request) => ({ request, at: request.createdAt.toISOString() }))
    // The same order the cursor compares in: time, then id, both newest first.
    .sort((a, b) =>
      a.at === b.at ? b.request.id.localeCompare(a.request.id) : b.at.localeCompare(a.at),
    );
  const cursorScope = `org:${organizationId}:evidence-requests`;
  const after = decodeTimeCursor(options.before, cursorScope);
  const remaining = after
    ? matching.filter(
        (row) => row.at < after.at || (row.at === after.at && row.request.id < after.id),
      )
    : matching;
  const limit = clampLimit(options.limit);
  const page = toPage(remaining.slice(0, limit + 1), limit, (last) =>
    encodeTimeCursor({ at: last.at, id: last.request.id }, cursorScope),
  );
  return ok({
    items: await withApplicantNames(
      db,
      page.items.map((row) => row.request),
    ),
    nextCursor: page.nextCursor,
    total: matching.length,
    statusCounts,
  });
}

/** WP-SB5: what one page of an organization's evidence requests asks for. */
export interface EvidenceRequestsPageRequest extends PageRequest {
  /** Only requests in these statuses; empty or left out means every status. */
  readonly statuses?: readonly EvidenceRequest['status'][];
  /** One request id: the page holds that request alone, when it is among the organization's. */
  readonly only?: string;
}

/** WP-SB5: one page of an organization's evidence requests. */
export interface EvidenceRequestsPage extends Page<EvidenceRequestWithApplicant> {
  /** How many requests match the status filter in all. */
  readonly total: number;
  /** How many requests the organization holds in each status, before the filter. */
  readonly statusCounts: Readonly<Record<string, number>>;
}

/**
 * Leaves out the requests of a traveller record in Recently Deleted, before anything is counted
 * or paged, so the list, its total and its status counts agree (agency view:
 * presentApplicantCondition; an archived traveller's requests stay, D6).
 */
async function withoutDeletedTravellers(
  db: Db,
  requests: readonly EvidenceRequest[],
): Promise<readonly EvidenceRequest[]> {
  if (requests.length === 0 || !(await lifecycleTablesPresent(db))) return requests;
  const applicantIds = [...new Set(requests.map((request) => request.applicantId))];
  const present = await db
    .select({ id: schema.applicants.id })
    .from(schema.applicants)
    .where(and(inArray(schema.applicants.id, applicantIds), presentApplicantCondition()));
  const kept = new Set(present.map((row) => row.id));
  return requests.filter((request) => kept.has(request.applicantId));
}

async function withApplicantNames(
  db: Db,
  requests: readonly EvidenceRequest[],
): Promise<EvidenceRequestWithApplicant[]> {
  // One query for every distinct applicant, not one per request (measured at 639 requests: about
  // 1.1 seconds for the per-row version, docs/operations/capacity.md).
  const applicantIds = [...new Set(requests.map((request) => request.applicantId))];
  const names = new Map<string, { readonly name: string; readonly timezone: string }>();
  if (applicantIds.length > 0) {
    const rows = await db
      .select({
        id: schema.applicants.id,
        displayName: schema.applicants.displayName,
        timezone: schema.applicants.timezone,
      })
      .from(schema.applicants)
      .where(inArray(schema.applicants.id, applicantIds));
    for (const row of rows) names.set(row.id, { name: row.displayName, timezone: row.timezone });
  }
  return requests.map((request) => ({
    ...request,
    applicantName: names.get(request.applicantId)?.name ?? 'Unknown applicant',
    applicantTimezone: names.get(request.applicantId)?.timezone ?? null,
  }));
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
  actorAccountId: string,
  organizationId: string,
): Promise<OrgApplicant[]> {
  // Administrator data (the evidence-request picker); anyone else gets an empty list.
  if (!(await mayReadOrgWide(db, actorAccountId, organizationId))) return [];
  return applicantsSharedWithOrganization(db, organizationId);
}

/**
 * The same set with no actor, for this package's own counting (storage and plan limits), which
 * returns numbers, never a name. Not exported from the package entry (the organization actor
 * ratchet holds it there).
 */
export async function applicantsSharedWithOrganization(
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
 * of `applicantsSharedWithOrganization` above, sharing its identical
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

/** One evidence request, read with its row locked when inside a transaction (`lock`), so a second send or decision waits its turn. */
async function readEvidenceRequest(
  db: Db,
  requestId: string,
  lock: boolean,
): Promise<EvidenceRequest | undefined> {
  // A malformed id is answered like a missing one, never as a server error.
  if (!isUuid(requestId)) return undefined;
  const query = db
    .select()
    .from(schema.evidenceRequests)
    .where(eq(schema.evidenceRequests.id, requestId))
    .limit(1);
  return first(lock ? await query.for('update') : await query);
}

/**
 * The applicant owner's request. Anyone else, and a request that does not exist, get the same
 * answer: whether a request id exists is not told to a stranger.
 */
async function loadEvidenceRequestForOwner(
  db: Db,
  actorAccountId: string,
  requestId: string,
  lock = false,
): Promise<Result<EvidenceRequest, ServiceError>> {
  const request = await readEvidenceRequest(db, requestId, lock);
  if (!request) return err(keyedError('not_found', 'agency.evidence_request_not_found'));
  const applicant = first(
    await db
      .select()
      .from(schema.applicants)
      .where(eq(schema.applicants.id, request.applicantId))
      .limit(1),
  );
  if (!applicant || applicant.ownerAccountId !== actorAccountId) {
    return err(keyedError('not_found', 'agency.evidence_request_not_found'));
  }
  return ok(request);
}

/** The requesting org's current standing to act on a request (org OWNER/ADMIN, MANAGE grant covering the request's mission/applicant). */
async function loadEvidenceRequestForOrg(
  db: Db,
  actorAccountId: string,
  requestId: string,
  lock = false,
): Promise<Result<EvidenceRequest, ServiceError>> {
  const request = await readEvidenceRequest(db, requestId, lock);
  if (!request) return err(keyedError('not_found', 'agency.evidence_request_not_found'));
  // Someone who is not an admin of the asking organisation is told the request does not exist.
  if (!(await isOrgAdmin(db, actorAccountId, request.organizationId))) {
    return err(keyedError('not_found', 'agency.evidence_request_not_found'));
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
    return err(keyedError('forbidden', 'agency.this_organization_has_no_current_grant'));
  }
  return ok(request);
}

const AWAITING_SUBMISSION_STATUSES: ReadonlySet<string> = new Set(['OPEN', 'NEEDS_REPLACEMENT']);

/**
 * What a send returns beyond the request itself (Lane D).
 * - `submissionId`: the exact-copy record of this send; null for a FIELD request, and null before
 *   migration 0132 ran (the send then keeps no exact copy and says so through
 *   `listEvidenceSubmissions`).
 * - `replayed`: true when this call repeated a send already recorded under the same idempotency
 *   key; nothing new was written.
 */
export type EvidenceSubmitResult = EvidenceRequest & {
  readonly submissionId: string | null;
  readonly replayed: boolean;
};

/** What a decision returns beyond the request itself: the send it judged (null for a FIELD request or an older, unpinned send). */
export type EvidenceDecisionResult = EvidenceRequest & {
  readonly decidedSubmissionId: string | null;
};

/** A retry key the page makes up (random, 16 to 200 plain characters); nothing else is accepted. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,200}$/;

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
 *
 * Lane D (exact copies): the whole send is one transaction that first locks the request row, so
 * two sends or a send and a decision cannot interleave. Inside it the owner is checked again, the
 * request must still be waiting for an answer, and the organization must still hold its standing
 * (an active organization with a current MANAGE grant covering the request): a traveller's send
 * is consent for exactly this copy to reach exactly this organization while that standing lives
 * (ADR 0026, addendum 8). For a document the exact version is chosen (the one named by
 * `documentVersionId`, else the newest at this moment), must be usable right now, and is written
 * to `evidence_request_submissions` with its stored object and checksum: that, never "the
 * document's latest version", is what the agency decides on and downloads. A retry with the same
 * `idempotencyKey` is answered with the first result and writes nothing. While migration 0132 has
 * not run, the older pointers alone are written (the same hardening applies) and no exact copy is
 * kept; nothing is faked.
 *
 * A detail (FIELD) send pins the same way (migration 0135): inside the same locked transaction the
 * detail's row is locked and its current saved version is read and written to
 * `evidence_request_fact_submissions`, so the send names the exact version, never "whatever the
 * detail says later". When the screen names the version the person saw (`factVersionId`) and the
 * detail has changed since, nothing is sent and the person is told the page is out of date. A
 * retry with the same key is answered like a document retry. Until 0135 has run the older pointer
 * alone is written and no exact value is kept.
 */
export async function submitEvidenceResponse(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly requestId: string;
    readonly factId?: string;
    readonly documentId?: string;
    readonly documentVersionId?: string;
    /** The saved version of the detail the person saw; must still be the current one. */
    readonly factVersionId?: string;
    readonly idempotencyKey?: string;
    /**
     * Set by one confirmation that answers several requests of this agency together: the agency's
     * administrators get one combined notice for the whole confirmation instead of one per answer.
     * Each answer is still its own send, audit entry and review. `anchorRequestId` is the same for
     * every answer of the confirmation, so the notice's retry key is the same too and the first
     * answer to commit writes it; the rest find it already there. Left out, the notice is the
     * single-answer one, exactly as before.
     */
    readonly agencyNotice?: { readonly batchKey: string; readonly anchorRequestId: string };
  },
): Promise<Result<EvidenceSubmitResult, ServiceError>> {
  if (input.idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    return err(keyedError('invalid', 'agency.the_retry_key_is_not_valid'));
  }
  // Malformed ids are answered like missing ones, never as a server error.
  if (
    (input.documentId !== undefined && !isUuid(input.documentId)) ||
    (input.documentVersionId !== undefined && !isUuid(input.documentVersionId))
  ) {
    return err(keyedError('not_found', 'agency.document_not_found_for_this_applicant'));
  }
  if (
    (input.factId !== undefined && !isUuid(input.factId)) ||
    (input.factVersionId !== undefined && !isUuid(input.factVersionId))
  ) {
    return err(keyedError('not_found', 'agency.fact_not_found_for_this_applicant'));
  }
  const exact = await evidenceSubmissionsPresent(db);
  const fieldPins = await evidenceFieldPinsPresent(db);
  const lifecycle = await lifecycleTablesPresent(db);
  // Until the exact-copy tables exist a chosen version could not be kept, so it is not accepted.
  if (!exact && input.documentVersionId !== undefined) {
    return err(keyedError('invalid', 'agency.choosing_an_exact_version_is_not'));
  }
  if (!fieldPins && input.factVersionId !== undefined) {
    return err(
      serviceError(
        'invalid',
        'Choosing an exact saved value is not available yet. Send the detail and its current value is used.',
      ),
    );
  }

  return db.transaction(async (tx) => {
    const loaded = await loadEvidenceRequestForOwner(
      tx,
      input.actorAccountId,
      input.requestId,
      true,
    );
    if (!loaded.ok) return loaded;
    const request = loaded.value;

    // A retry of a send already recorded is answered with that send and nothing is written, but
    // only while that send is still the newest, still undecided, and names the same file. Anything
    // else is not a retry: the person is told the page is out of date, never given a silent "sent".
    if (exact && input.idempotencyKey !== undefined) {
      const earlier = first(
        await tx
          .select()
          .from(schema.evidenceRequestSubmissions)
          .where(
            and(
              eq(schema.evidenceRequestSubmissions.evidenceRequestId, request.id),
              eq(schema.evidenceRequestSubmissions.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1),
      );
      if (earlier) {
        if (
          input.documentId !== earlier.documentId ||
          (input.documentVersionId !== undefined &&
            input.documentVersionId !== earlier.documentVersionId)
        ) {
          return err(keyedError('invalid', 'agency.this_retry_key_was_already_used'));
        }
        const waiting = await waitingSubmission(tx, request);
        if (waiting?.id !== earlier.id) {
          return err(keyedError('stale', 'agency.this_was_already_sent_and_has'));
        }
        return ok({ ...request, submissionId: earlier.id, replayed: true });
      }
    }

    // The same for a detail: a retry of a send already recorded, while it is still the newest and
    // undecided and names the same detail, is answered with it and writes nothing.
    if (fieldPins && request.kind === 'FIELD' && input.idempotencyKey !== undefined) {
      const earlier = await findFieldSubmissionByKey(tx, request.id, input.idempotencyKey);
      if (earlier) {
        if (
          input.factId !== earlier.factId ||
          (input.factVersionId !== undefined && input.factVersionId !== earlier.factVersionId)
        ) {
          return err(
            serviceError('invalid', 'this retry key was already used for a different detail'),
          );
        }
        const waiting = await waitingFieldSubmission(tx, request);
        if (waiting?.id !== earlier.id) {
          return err(
            serviceError(
              'stale',
              'This was already sent and has moved on. Refresh to see where it stands.',
            ),
          );
        }
        return ok({ ...request, submissionId: earlier.id, replayed: true });
      }
    }

    if (!AWAITING_SUBMISSION_STATUSES.has(request.status)) {
      return err(keyedError('invalid', 'agency.this_request_is_not_awaiting_a'));
    }
    // The organization must still hold its standing now: a send is consent for this organization
    // only while its MANAGE grant lives.
    const grantId = await orgPermittingGrantId(
      tx,
      request.organizationId,
      request.applicantId,
      'MANAGE',
      request.missionId ?? undefined,
    );
    if (grantId === null) {
      return err(keyedError('forbidden', 'agency.this_organization_no_longer_has_access'));
    }

    let pin: SendPin | undefined;
    let fieldPin: FieldPin | undefined;
    if (request.kind === 'FIELD') {
      if (!input.factId || input.documentId || input.documentVersionId) {
        return err(keyedError('invalid', 'agency.a_field_request_is_satisfied_by'));
      }
      const fact = first(
        await tx
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
        return err(keyedError('not_found', 'agency.fact_not_found_for_this_applicant'));
      }
      if (fact.fieldKey !== request.fieldKey) {
        return err(keyedError('invalid', 'agency.this_fact_does_not_match_the'));
      }
      if (fieldPins) {
        const pinned = await pinFieldVersion(tx, {
          factId: input.factId,
          fieldKey: fact.fieldKey,
          ...(input.factVersionId !== undefined ? { expectedVersionId: input.factVersionId } : {}),
        });
        if (!pinned.ok) return pinned;
        fieldPin = pinned.value;
      }
    } else {
      if (!input.documentId || input.factId || input.factVersionId) {
        return err(keyedError('invalid', 'agency.a_document_request_is_satisfied_by'));
      }
      const document = first(
        await tx
          .select({
            applicantId: schema.documents.applicantId,
            docType: schema.documents.docType,
            approvedName: schema.documents.approvedName,
            originalName: schema.documents.originalName,
          })
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
        return err(keyedError('not_found', 'agency.document_not_found_for_this_applicant'));
      }
      if (document.docType !== request.docType) {
        return err(keyedError('invalid', 'agency.this_document_does_not_match_the'));
      }
      const version = await chooseSendVersion(tx, input.documentId, input.documentVersionId);
      if (input.documentVersionId !== undefined && !version) {
        return err(keyedError('not_found', 'agency.document_not_found_for_this_applicant'));
      }
      if (!version || !(await versionIsUsable(tx, version))) {
        return err(keyedError('invalid', 'agency.this_document_has_not_finished_safety'));
      }
      pin = {
        documentId: input.documentId,
        version,
        docType: document.docType,
        title: document.approvedName ?? document.originalName,
      };
    }

    // The request moves only if it still waits for an answer; with the row locked this cannot
    // fail, and the check stays so a missed lock could never let two sends through.
    const updated = first(
      await tx
        .update(schema.evidenceRequests)
        .set({
          status: 'RECEIVED',
          respondingFactId: input.factId ?? null,
          respondingDocumentId: input.documentId ?? null,
          respondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.evidenceRequests.id, input.requestId),
            inArray(schema.evidenceRequests.status, [...AWAITING_SUBMISSION_STATUSES] as Array<
              EvidenceRequest['status']
            >),
          ),
        )
        .returning(),
    );
    if (!updated) return err(keyedError('invalid', 'agency.this_request_is_not_awaiting_a'));

    let submissionId: string | null = null;
    let roundNo: number | null = null;
    if (exact && pin) {
      const last = first(
        await tx
          .select({ roundNo: schema.evidenceRequestSubmissions.roundNo })
          .from(schema.evidenceRequestSubmissions)
          .where(eq(schema.evidenceRequestSubmissions.evidenceRequestId, request.id))
          .orderBy(desc(schema.evidenceRequestSubmissions.roundNo))
          .limit(1),
      );
      roundNo = (last?.roundNo ?? 0) + 1;
      const row = required(
        first(
          await tx
            .insert(schema.evidenceRequestSubmissions)
            .values({
              evidenceRequestId: request.id,
              roundNo,
              documentId: pin.documentId,
              documentVersionId: pin.version.id,
              storageObjectId: pin.version.storageObjectId,
              contentSha256: pin.version.sha256 ?? null,
              sizeBytes: pin.version.sizeBytes ?? null,
              versionNumber: pin.version.versionNumber,
              docTypeAtSend: pin.docType,
              titleAtSend: pin.title,
              sentByAccountId: input.actorAccountId,
              grantIdAtSend: grantId,
              idempotencyKey: input.idempotencyKey ?? `auto:round-${roundNo}`,
            })
            .returning({ id: schema.evidenceRequestSubmissions.id }),
        ),
        'evidence submission',
      );
      submissionId = row.id;
    }
    if (fieldPin) {
      const row = await recordFieldSubmission(tx, {
        requestId: request.id,
        pin: fieldPin,
        sentByAccountId: input.actorAccountId,
        grantIdAtSend: grantId,
        ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
      });
      submissionId = row.id;
      roundNo = row.roundNo;
    }
    await noticeAgencyOfEvidence(tx, {
      request,
      ...(input.agencyNotice ? { group: input.agencyNotice } : {}),
      // Keyed on the send's own row (never on its round number, which can be reused once an
      // earlier send is removed with its document); the time covers a send with no exact copy.
      threshold:
        submissionId !== null
          ? `submission-${submissionId}`
          : `sent-${(updated.respondedAt ?? new Date()).getTime()}`,
    });
    await appendAuditEvent(tx, {
      eventType: 'EVIDENCE_RESPONDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: request.applicantId,
      resourceType: 'evidence_request',
      resourceId: updated.id,
      // Ids and counters only: never a file name, a value or a checksum.
      metadata: {
        factId: input.factId,
        documentId: input.documentId,
        ...(submissionId
          ? {
              submissionId,
              roundNo,
              ...(pin ? { documentVersionId: pin.version.id } : {}),
              ...(fieldPin ? { factVersionId: fieldPin.factVersionId } : {}),
            }
          : {}),
      },
    });
    await recordProductEvent(tx, {
      eventType: 'EVIDENCE_RECEIVED',
      accountId: input.actorAccountId,
      organizationId: request.organizationId,
    });
    return ok({ ...updated, submissionId, replayed: false });
  });
}

/**
 * "New Evidence Received" for the active owners and admins of the asking agency, in the app and by
 * email, queued with the send. Neutral on purpose (NTF-02): it names no person, no kind of file, no
 * file name and no reason, only that something arrived and where to open it. The worker sends it
 * only while the recipient is still an owner or admin of the active agency and the agency still
 * holds a grant reaching the case; cancelling the request cancels it while still queued.
 */
async function noticeAgencyOfEvidence(
  tx: Db,
  input: {
    readonly request: EvidenceRequest;
    readonly threshold: string;
    /** One combined notice for a whole confirmation (see `submitEvidenceResponse`). */
    readonly group?: { readonly batchKey: string; readonly anchorRequestId: string };
  },
): Promise<void> {
  const { request } = input;
  // A combined notice is about the confirmation, not about this answer: its retry key, its driving
  // request and its words are the same for every answer in it, and the deep link opens the first
  // request of the group, where the agency's list of waiting answers is.
  const anchor = input.group?.anchorRequestId ?? request.id;
  const admins = await tx
    .select({ accountId: schema.memberships.accountId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, request.organizationId),
        eq(schema.memberships.active, true),
        inArray(schema.memberships.role, ['OWNER', 'ADMIN']),
      ),
    );
  for (const admin of admins) {
    await enqueueNotificationBothChannels(tx, {
      eventType: 'EVIDENCE_RESPONSE_RECEIVED',
      resourceId: anchor,
      threshold: input.group ? `group-${input.group.batchKey}` : input.threshold,
      recipientAccountId: admin.accountId,
      applicantId: request.applicantId,
      organizationId: request.organizationId,
      ...(request.missionId ? { missionId: request.missionId } : {}),
      payload: {
        subject: 'New Evidence Received',
        summary: input.group
          ? 'A traveller sent evidence for several of your requests.'
          : 'A traveller sent evidence for one of your requests.',
        deepLinkPath: `/app/agency/${request.organizationId}/clients?request=${anchor}#request-${anchor}`,
      },
    });
  }
}

/**
 * Pin the version a send will carry: the detail's current saved version at this moment. The fact
 * row is locked first, so an edit that lands at the same moment either finishes before (and is what
 * is pinned) or waits until this send has committed; the pin is never a version that was already
 * replaced. When the screen names the version the person saw (`expectedVersionId`) and the detail
 * has moved on since, nothing is sent and the person is told the page is out of date.
 */
async function pinFieldVersion(
  tx: Db,
  input: {
    readonly factId: string;
    readonly fieldKey: string;
    readonly expectedVersionId?: string;
  },
): Promise<Result<FieldPin, ServiceError>> {
  const fact = first(
    await tx
      .select({ currentVersionId: schema.facts.currentVersionId })
      .from(schema.facts)
      .where(eq(schema.facts.id, input.factId))
      .for('update'),
  );
  const current = fact?.currentVersionId ?? null;
  if (current === null) {
    return err(serviceError('invalid', 'this detail has no saved value to send yet'));
  }
  if (input.expectedVersionId !== undefined && input.expectedVersionId !== current) {
    return err(
      serviceError(
        'stale',
        'This detail changed after you opened the page. Refresh to see the value now saved, then send it.',
      ),
    );
  }
  return ok({ factId: input.factId, factVersionId: current, fieldKey: input.fieldKey });
}

/** The exact version a send pins, with what the record needs to remember about it. */
interface SendPin {
  readonly documentId: string;
  readonly version: typeof schema.documentVersions.$inferSelect;
  readonly docType: string | null;
  readonly title: string;
}

/** The version a traveller's send uses: the one named, which must belong to the document, else the newest right now. */
async function chooseSendVersion(
  db: Db,
  documentId: string,
  documentVersionId: string | undefined,
): Promise<typeof schema.documentVersions.$inferSelect | undefined> {
  const where =
    documentVersionId === undefined
      ? eq(schema.documentVersions.documentId, documentId)
      : and(
          eq(schema.documentVersions.documentId, documentId),
          eq(schema.documentVersions.id, documentVersionId),
        );
  return first(
    await db
      .select()
      .from(schema.documentVersions)
      .where(where)
      .orderBy(desc(schema.documentVersions.versionNumber))
      .limit(1),
  );
}

/** The one canonical "is this version still real evidence" test, for exactly this version. */
async function versionIsUsable(
  db: Db,
  version: Pick<
    typeof schema.documentVersions.$inferSelect,
    'safetyStatus' | 'processingStatus' | 'storageObjectId'
  >,
): Promise<boolean> {
  const erased = await activeOrVerifiedErasureStorageObjectIds(db, [version.storageObjectId]);
  return isDocumentVersionUsable({
    safetyStatus: version.safetyStatus,
    processingStatus: version.processingStatus,
    erased: erased.has(version.storageObjectId),
  });
}

/** Optional, lightweight RECEIVED -> UNDER_REVIEW marker (org, MANAGE-grant-gated): mainly workflow visibility, never a prerequisite for a decision. */
export async function startEvidenceReview(
  db: Db,
  input: { readonly actorAccountId: string; readonly requestId: string },
): Promise<Result<EvidenceRequest, ServiceError>> {
  return db.transaction(async (tx) => {
    const loaded = await loadEvidenceRequestForOrg(tx, input.actorAccountId, input.requestId, true);
    if (!loaded.ok) return loaded;
    if (loaded.value.status !== 'RECEIVED') {
      return err(keyedError('invalid', 'agency.only_a_received_request_can_start'));
    }
    // Only a request still RECEIVED moves: a decision made in the meantime is never undone by this.
    const updated = first(
      await tx
        .update(schema.evidenceRequests)
        .set({ status: 'UNDER_REVIEW', updatedAt: new Date() })
        .where(
          and(
            eq(schema.evidenceRequests.id, input.requestId),
            eq(schema.evidenceRequests.status, 'RECEIVED'),
          ),
        )
        .returning(),
    );
    if (!updated) return err(keyedError('invalid', 'agency.only_a_received_request_can_start'));
    return ok(updated);
  });
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
 *
 * Lane D (exact copies): the decision is one transaction that locks the request row first. The
 * organization's standing (active OWNER or ADMIN, current MANAGE grant) is checked again inside
 * it, the request must still wait for a decision, and the decision is about one exact send: the
 * newest one, recorded in `evidence_request_decision_submissions` (unique per send, so a send can
 * be decided once). A reviewer who looked at a send that has since been replaced (`submissionId`
 * names the one they saw) is told to look again instead of deciding on the newer copy unseen.
 * Accepting also needs the pinned copy to be usable right now, the same stored object and
 * checksum as when it was sent, and still the kind it was sent as; sending back is always allowed.
 * While migration 0132 has not run, or for a send recorded before it, the decision is recorded as
 * before without a link to an exact copy.
 */
export async function decideEvidenceResponse(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly requestId: string;
    readonly outcome: 'ACCEPTED' | 'NEEDS_REPLACEMENT' | 'CONTRADICTION' | 'CORRECTION_PROPOSED';
    readonly reason?: string;
    /** The send the reviewer was looking at; when given it must still be the one waiting. */
    readonly submissionId?: string;
  },
): Promise<Result<EvidenceDecisionResult, ServiceError>> {
  if (input.submissionId !== undefined && !isUuid(input.submissionId)) {
    return err(keyedError('not_found', 'agency.evidence_request_not_found'));
  }
  const exact = await evidenceSubmissionsPresent(db);
  const fieldPins = await evidenceFieldPinsPresent(db);
  const lifecycle = await lifecycleTablesPresent(db);

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
    const loaded = await loadEvidenceRequestForOrg(tx, input.actorAccountId, input.requestId, true);
    if (!loaded.ok) return loaded;
    const request = loaded.value;
    if (!DECIDABLE_STATUSES.has(request.status)) {
      return err(keyedError('invalid', 'agency.this_request_has_nothing_submitted_to'));
    }
    const org = first(
      await tx
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
      return err(keyedError('forbidden', 'agency.this_organization_requires_a_reviewer_different'));
    }

    // The exact send being decided: the newest one, only while nobody has decided it yet and the
    // request still points at it. Anything else is an older, unpinned send.
    const pinned =
      exact && request.kind === 'DOCUMENT' ? await waitingSubmission(tx, request) : undefined;
    // A detail answer is judged the same way: the newest send, only while nobody has decided it.
    const pinnedField =
      fieldPins && request.kind === 'FIELD' ? await waitingFieldSubmission(tx, request) : undefined;
    if (input.submissionId !== undefined && input.submissionId !== (pinned ?? pinnedField)?.id) {
      return err(keyedError('stale', 'agency.a_newer_copy_was_sent_or'));
    }
    if (input.outcome === 'ACCEPTED' && request.kind === 'DOCUMENT') {
      // Nothing was ever pointed at, so there is nothing to accept.
      if (request.respondingDocumentId === null) {
        return err(keyedError('invalid', 'agency.this_request_has_nothing_submitted_to'));
      }
      if (pinned) {
        const problem = await pinnedCopyProblem(tx, pinned, lifecycle);
        if (problem) return err(keyedError('invalid', problem));
      } else {
        // A send recorded before exact copies were kept: the newest version of the document it
        // points at must still be usable evidence (the check the older flow made at send time).
        const present = first(
          await tx
            .select({ id: schema.documents.id })
            .from(schema.documents)
            .where(
              and(
                eq(schema.documents.id, request.respondingDocumentId),
                lifecycle ? presentDocumentCondition() : undefined,
              ),
            )
            .limit(1),
        );
        const newest = present
          ? await chooseSendVersion(tx, request.respondingDocumentId, undefined)
          : undefined;
        if (!newest || !(await versionIsUsable(tx, newest))) {
          return err(keyedError('invalid', 'agency.the_copy_that_was_sent_is'));
        }
      }
    }

    // The request moves only if it still waits for a decision (the row is locked, so it does).
    const updated = first(
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
        .where(
          and(
            eq(schema.evidenceRequests.id, request.id),
            inArray(schema.evidenceRequests.status, [...DECIDABLE_STATUSES] as Array<
              EvidenceRequest['status']
            >),
          ),
        )
        .returning(),
    );
    if (!updated) {
      return err(keyedError('invalid', 'agency.this_request_has_nothing_submitted_to'));
    }
    const decision = required(
      first(
        await tx
          .insert(schema.evidenceRequestDecisions)
          .values({
            evidenceRequestId: request.id,
            outcome: input.outcome,
            reason: input.reason ?? null,
            respondingFactId: request.respondingFactId,
            respondingDocumentId: request.respondingDocumentId,
            decidedByAccountId: input.actorAccountId,
          })
          .returning({ id: schema.evidenceRequestDecisions.id }),
      ),
      'evidence decision',
    );
    if (pinned) {
      await tx
        .insert(schema.evidenceRequestDecisionSubmissions)
        .values({ decisionId: decision.id, submissionId: pinned.id });
    }
    if (pinnedField) await linkFieldDecision(tx, decision.id, pinnedField.id);
    // The agency's "evidence arrived" notice is obsolete once the request has been decided; the
    // notices to the traveller about this decision are not touched.
    await cancelQueuedNotificationsForResource(tx, request.id, 'EVIDENCE_RESPONSE_RECEIVED');
    await appendAuditEvent(tx, {
      eventType: 'EVIDENCE_REQUEST_DECIDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: request.applicantId,
      resourceType: 'evidence_request',
      resourceId: request.id,
      metadata: {
        outcome: input.outcome,
        ...((pinned ?? pinnedField) ? { submissionId: (pinned ?? pinnedField)?.id } : {}),
      },
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
          // One notice for each send that is sent back, keyed on the send's own row (a second send-back
          // on the same request is a new notice, and a reused round number never collides); a send with no exact copy is told apart by its decision.
          threshold: pinned ? `submission-${pinned.id}` : `decision-${decision.id}`,
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
    return ok({ ...updated, decidedSubmissionId: pinned?.id ?? null });
  });
}

type SubmissionRecord = typeof schema.evidenceRequestSubmissions.$inferSelect;

const UNAVAILABLE_COPY: ServiceMessageKey = 'agency.the_copy_that_was_sent_is';
const FILED_AS_OTHER_KIND: ServiceMessageKey = 'agency.the_file_was_filed_as_a';

/**
 * The newest send of a request, if it is still waiting for a decision: not yet decided, and the
 * request still points at its document. A send recorded before migration 0132, or one an older
 * deployment wrote without a record, has no such row and reads as unpinned.
 */
async function waitingSubmission(
  db: Db,
  request: Pick<EvidenceRequest, 'id' | 'respondingDocumentId' | 'status'>,
): Promise<SubmissionRecord | undefined> {
  // A request that no longer waits for a decision (withdrawn, sent back, closed) has no waiting send.
  if (!DECIDABLE_STATUSES.has(request.status)) return undefined;
  const latest = first(
    await db
      .select()
      .from(schema.evidenceRequestSubmissions)
      .where(eq(schema.evidenceRequestSubmissions.evidenceRequestId, request.id))
      .orderBy(desc(schema.evidenceRequestSubmissions.roundNo))
      .limit(1),
  );
  if (!latest || request.respondingDocumentId !== latest.documentId) return undefined;
  const decided = first(
    await db
      .select({ decisionId: schema.evidenceRequestDecisionSubmissions.decisionId })
      .from(schema.evidenceRequestDecisionSubmissions)
      .where(eq(schema.evidenceRequestDecisionSubmissions.submissionId, latest.id))
      .limit(1),
  );
  if (decided) return undefined;
  // An older deployment running beside this one may have decided it without a link.
  if (await newerUnlinkedDecision(db, request.id, latest.sentAt)) return undefined;
  return latest;
}

/**
 * Why a pinned copy cannot be accepted right now, in words a reviewer reads, or undefined when it
 * can: the copy is gone or unsafe, its stored object or checksum is not what was sent, the
 * document was removed, or the file was filed as a different kind after it was sent.
 */
async function pinnedCopyProblem(
  db: Db,
  submission: SubmissionRecord,
  lifecycle: boolean,
): Promise<ServiceMessageKey | undefined> {
  const unavailable = UNAVAILABLE_COPY;
  const version = first(
    await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, submission.documentVersionId))
      .limit(1),
  );
  if (!version || !pinnedVersionIntact(submission, version)) return unavailable;
  if (!(await versionIsUsable(db, version))) return unavailable;
  const document = first(
    await db
      .select({ docType: schema.documents.docType })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, submission.documentId),
          lifecycle ? presentDocumentCondition() : undefined,
        ),
      )
      .limit(1),
  );
  if (!document) return unavailable;
  if ((document.docType ?? null) !== (submission.docTypeAtSend ?? null)) {
    return FILED_AS_OTHER_KIND;
  }
  return undefined;
}

/** The requesting org withdraws a request that no longer needs an answer (org, MANAGE-grant-gated). Terminal; matches the applicant owner's own respondEvidence-era DECLINED intent, but as the requester's own act, not the applicant's. */
export async function cancelEvidenceRequest(
  db: Db,
  input: { readonly actorAccountId: string; readonly requestId: string; readonly reason?: string },
): Promise<Result<EvidenceRequest, ServiceError>> {
  return db.transaction(async (tx) => {
    const loaded = await loadEvidenceRequestForOrg(tx, input.actorAccountId, input.requestId, true);
    if (!loaded.ok) return loaded;
    const request = loaded.value;
    if (request.status === 'CANCELLED' || request.status === 'ACCEPTED') {
      return err(keyedError('invalid', 'agency.this_request_is_already_closed'));
    }
    // Only a request that is not yet closed moves: an acceptance made in the meantime stays.
    const updated = first(
      await tx
        .update(schema.evidenceRequests)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(
          and(
            eq(schema.evidenceRequests.id, request.id),
            notInArray(schema.evidenceRequests.status, ['CANCELLED', 'ACCEPTED']),
          ),
        )
        .returning(),
    );
    if (!updated) return err(keyedError('invalid', 'agency.this_request_is_already_closed'));
    await tx.insert(schema.evidenceRequestDecisions).values({
      evidenceRequestId: request.id,
      outcome: 'CANCELLED',
      reason: input.reason ?? null,
      respondingFactId: request.respondingFactId,
      respondingDocumentId: request.respondingDocumentId,
      decidedByAccountId: input.actorAccountId,
    });
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
  if (!request) return err(keyedError('not_found', 'agency.evidence_request_not_found'));

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
    // A stranger gets exactly what an unknown request id gets.
    if (!(await hasAnyStandingOnApplicant(db, actorAccountId, request.applicantId))) {
      return err(keyedError('not_found', 'agency.evidence_request_not_found'));
    }
    return err(keyedError('forbidden', 'agency.not_authorized_to_view_this_request'));
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
    return err(keyedError('forbidden', 'agency.only_an_org_owner_admin_can5'));
  }
  // SHR-02: a suspended/closed organization has no standing, regardless of
  // the caller's own still-active membership row.
  const org = await getOrganization(db, input.organizationId);
  if (!org || org.status !== 'ACTIVE') {
    return err(keyedError('forbidden', 'agency.this_organization_is_not_active'));
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
    return err(keyedError('forbidden', 'agency.not_an_active_member_of_this'));
  }
  if (!(await assignedToMission(db, input.organizationId, input.actorAccountId, input.missionId))) {
    return err(keyedError('forbidden', 'agency.not_assigned_to_this_case'));
  }
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, input.missionId)).limit(1),
  );
  if (!mission) return err(keyedError('not_found', 'agency.case_not_found'));
  if (
    !(await orgGrantPermits(db, input.organizationId, mission.applicantId, 'MANAGE', mission.id))
  ) {
    // Answered exactly like an unknown id, so a case hidden from this
    // organization (a per-case sharing exception, ADR 0017) cannot be told
    // apart from one that does not exist.
    return err(keyedError('not_found', 'agency.case_not_found'));
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
    return err(keyedError('not_found', 'agency.requirement_not_found_on_this_case'));
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
  if (!mission) return err(keyedError('not_found', 'agency.case_not_found'));
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
      // A stranger gets exactly what an unknown case id gets.
      if (
        assignments.length === 0 &&
        !(await hasAnyStandingOnApplicant(db, actorAccountId, mission.applicantId))
      ) {
        return err(keyedError('not_found', 'agency.case_not_found'));
      }
      return err(keyedError('forbidden', 'agency.not_authorized_to_view_decisions_on'));
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
  actorAccountId: string,
  organizationId: string,
  missionId: string,
): Promise<Result<PackRequirement[], ServiceError>> {
  // Someone who may not read this organization's view of the case gets what an unknown id gets.
  if (!(await mayReadOrgCase(db, actorAccountId, organizationId, missionId))) {
    return err(keyedError('not_found', 'agency.case_not_found'));
  }
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return err(keyedError('not_found', 'agency.case_not_found'));
  if (!(await orgGrantPermits(db, organizationId, mission.applicantId, 'MANAGE', mission.id))) {
    // Answered exactly like an unknown id, so a case hidden from this
    // organization (a per-case sharing exception, ADR 0017) cannot be told
    // apart from one that does not exist.
    return err(keyedError('not_found', 'agency.case_not_found'));
  }
  if (!mission.packVersionId) return ok([]);
  return ok(await listRequirements(db, mission.packVersionId));
}
