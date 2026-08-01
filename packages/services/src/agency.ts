import type {
  AccountId,
  AgencyId,
  ApplicantId,
  MissionId,
  PermissionAction,
} from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { authorize } from '@visastack/policy';
import { and, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { isOrgAdmin } from './organizations';
import { type PackRequirement, listRequirements } from './packs';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';
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
async function orgGrantPermits(
  db: Db,
  organizationId: string,
  applicantId: string,
  action: PermissionAction,
  missionId?: string,
): Promise<boolean> {
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
          membership: { organizationId: organizationId as AgencyId, role: 'ADMIN', active: true },
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

/** True if the account is an active member (any role) of the organization. */
async function isActiveMember(db: Db, accountId: string, organizationId: string): Promise<boolean> {
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

export async function listAssignments(db: Db, missionId: string): Promise<Assignment[]> {
  return db.select().from(schema.assignments).where(eq(schema.assignments.missionId, missionId));
}

/** An assignment resolved with the member's email, for the org console. */
export interface AssignmentView {
  readonly id: string;
  readonly memberAccountId: string;
  readonly memberEmail: string;
  readonly createdAt: string;
}

/** Same as `listAssignments`, but resolves each assignee's email. */
export async function listAssignmentsDetailed(
  db: Db,
  missionId: string,
): Promise<AssignmentView[]> {
  const rows = await db
    .select({
      id: schema.assignments.id,
      memberAccountId: schema.assignments.memberAccountId,
      memberEmail: schema.accounts.email,
      createdAt: schema.assignments.createdAt,
    })
    .from(schema.assignments)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.assignments.memberAccountId))
    .where(eq(schema.assignments.missionId, missionId));
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
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
  return rows
    .filter((r) => r.grantMissionId === null || r.grantMissionId === r.missionId)
    .map(({ missionId, title, applicantId, applicantName }) => ({
      missionId,
      title,
      applicantId,
      applicantName,
    }));
}

const NOTE_MAX_LENGTH = 2000;

/**
 * Add a note to a mission (append-only). Authorized if the actor is: the
 * applicant owner; an individual (non-organization) grant recipient whose
 * grant permits `COMMENT` on this mission; or an active member of an
 * organization that holds a current grant permitting `COMMENT` on this
 * mission. Previously had no authorization check at all — see
 * docs/audits/commercial-readiness-recovery-baseline.md §7.
 */
export async function addNote(
  db: Db,
  input: { readonly actorAccountId: string; readonly missionId: string; readonly body: string },
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

  return db.transaction(async (tx) => {
    const note = required(
      first(
        await tx
          .insert(schema.missionNotes)
          .values({
            missionId: input.missionId,
            authorAccountId: input.actorAccountId,
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
    });
    return ok(note);
  });
}

export async function listNotes(db: Db, missionId: string): Promise<MissionNote[]> {
  return db.select().from(schema.missionNotes).where(eq(schema.missionNotes.missionId, missionId));
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
  if (!(await orgGrantPermits(db, input.organizationId, input.applicantId, 'MANAGE'))) {
    return err(
      serviceError('forbidden', 'this organization has no current grant for that applicant'),
    );
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
            kind: input.kind,
            fieldKey: input.fieldKey ?? null,
            docType: input.docType ?? null,
            message: input.message ?? null,
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

/** Applicants with any grant naming this org (candidate targets for evidence requests). */
export async function listApplicantsForOrganization(
  db: Db,
  organizationId: string,
): Promise<OrgApplicant[]> {
  const rows = await db
    .selectDistinct({
      applicantId: schema.grants.applicantId,
      displayName: schema.applicants.displayName,
    })
    .from(schema.grants)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.grants.applicantId))
    .where(eq(schema.grants.recipientOrganizationId, organizationId));
  return rows;
}

/** The applicant owner responds to an evidence request. */
export async function respondEvidence(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly requestId: string;
    readonly decision: 'FULFILLED' | 'DECLINED';
  },
): Promise<Result<EvidenceRequest, ServiceError>> {
  const request = first(
    await db
      .select()
      .from(schema.evidenceRequests)
      .where(eq(schema.evidenceRequests.id, input.requestId))
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
  if (!applicant || applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'only the applicant owner can respond'));
  }
  if (request.status !== 'OPEN') return err(serviceError('invalid', 'request is not open'));

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.evidenceRequests)
          .set({ status: input.decision, respondedAt: new Date(), updatedAt: new Date() })
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
      metadata: { decision: input.decision },
    });
    return ok(updated);
  });
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
    return ok(decision);
  });
}

/**
 * Every decision recorded on a mission, newest first — visible to the
 * mission owner or any org member currently assigned to it (read is
 * intentionally more permissive than the write, matching this codebase's
 * general pattern elsewhere).
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
    const assignedAnywhere = first(
      await db
        .select({ id: schema.assignments.id })
        .from(schema.assignments)
        .where(
          and(
            eq(schema.assignments.memberAccountId, actorAccountId),
            eq(schema.assignments.missionId, missionId),
          ),
        )
        .limit(1),
    );
    if (!assignedAnywhere) {
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
