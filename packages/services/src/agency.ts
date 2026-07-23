import type { ApplicantId } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { authorize } from '@visastack/policy';
import { eq } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { isOrgAdmin } from './organizations';

/**
 * Collaboration surface (Build Spec §2; PRD §5): assignments, mission notes,
 * evidence requests, and permissioned bulk export. Assignment and notes are
 * organizational bookkeeping and never by themselves grant record access — that
 * is always a grant evaluated by the policy engine (see bulkExport).
 */

export type Assignment = typeof schema.assignments.$inferSelect;
export type MissionNote = typeof schema.missionNotes.$inferSelect;
export type EvidenceRequest = typeof schema.evidenceRequests.$inferSelect;

/** Assign an org member to a mission (org OWNER/ADMIN only). */
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

/** Missions reachable by this org via a mission-scoped grant. */
export async function listMissionsForOrganization(
  db: Db,
  organizationId: string,
): Promise<OrgMission[]> {
  const rows = await db
    .selectDistinct({
      missionId: schema.missions.id,
      title: schema.missions.title,
      applicantId: schema.applicants.id,
      applicantName: schema.applicants.displayName,
    })
    .from(schema.grants)
    .innerJoin(schema.missions, eq(schema.missions.id, schema.grants.missionId))
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.missions.applicantId))
    .where(eq(schema.grants.recipientOrganizationId, organizationId));
  return rows;
}

/** Add a note to a mission (author recorded; append-only in practice). */
export async function addNote(
  db: Db,
  input: { readonly actorAccountId: string; readonly missionId: string; readonly body: string },
): Promise<Result<MissionNote, ServiceError>> {
  if (input.body.trim().length === 0)
    return err(serviceError('invalid', 'a note body is required'));
  return db.transaction(async (tx) => {
    const note = required(
      first(
        await tx
          .insert(schema.missionNotes)
          .values({
            missionId: input.missionId,
            authorAccountId: input.actorAccountId,
            body: input.body.trim(),
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

/** An organization requests a specific field or document from an applicant. */
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

/**
 * Permissioned bulk export for an organization: includes ONLY applicants who
 * granted the org an accepted EXPORT_PROFILE grant for `purpose`. Each
 * applicant is checked through the policy engine (default-deny) and audited.
 */
export async function bulkExport(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly purpose: string;
  },
): Promise<Result<BulkExportRow[], ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'only an org OWNER/ADMIN can bulk export'));
  }

  // Candidate applicants: those with any grant naming this org.
  const grantRows = await db
    .select()
    .from(schema.grants)
    .where(eq(schema.grants.recipientOrganizationId, input.organizationId));

  const now = new Date();
  const rows: BulkExportRow[] = [];
  for (const applicantId of new Set(grantRows.map((g) => g.applicantId))) {
    const grants = grantRows
      .filter((g) => g.applicantId === applicantId)
      .map((g) => ({
        applicantId: g.applicantId as ApplicantId,
        recipientOrganizationId: input.organizationId as never,
        actions: g.actions as never,
        purpose: g.purpose,
        status: g.status,
        startAt: g.startAt.toISOString(),
        ...(g.acceptedAt ? { acceptedAt: g.acceptedAt.toISOString() } : {}),
        ...(g.expiryAt ? { expiryAt: g.expiryAt.toISOString() } : {}),
      }));

    const decision = authorize({
      actor: {
        kind: 'organization_member',
        accountId: input.actorAccountId as never,
        membership: { organizationId: input.organizationId as never, role: 'ADMIN', active: true },
      },
      action: 'EXPORT_PROFILE',
      resource: { applicantId: applicantId as ApplicantId },
      context: { now, purpose: input.purpose, stepUpSatisfied: true, grants },
    });
    if (!decision.allowed) continue;

    const applicant = first(
      await db
        .select()
        .from(schema.applicants)
        .where(eq(schema.applicants.id, applicantId))
        .limit(1),
    );
    if (!applicant) continue;
    const factRows = await db
      .select({ key: schema.fieldDefinitions.key, value: schema.factVersions.value })
      .from(schema.facts)
      .innerJoin(
        schema.fieldDefinitions,
        eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
      )
      .innerJoin(schema.factVersions, eq(schema.factVersions.id, schema.facts.currentVersionId))
      .where(eq(schema.facts.applicantId, applicantId));
    const facts: Record<string, string | null> = {};
    for (const row of factRows) facts[row.key] = row.value;
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
      metadata: { included: rows.length, purpose: input.purpose },
    });
  });
  return ok(rows);
}
