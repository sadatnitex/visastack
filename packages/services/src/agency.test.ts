import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { EACH_GRANT, accountPrincipal, requireAccess } from './access';
import type { AuthorizedApplicant } from './access';
import { provisionAccount } from './accounts';
import {
  type TRIAGE_GROUPS,
  type TriageRequestInput,
  addNote,
  assignMember,
  bulkExport,
  cancelEvidenceRequest,
  createAppointmentForOrg,
  createTaskForOrg,
  decideAppointmentForOrg,
  decideEvidenceResponse,
  decideTaskForOrg,
  evidenceRequestTriageGroup,
  listApplicantsForOrganization,
  listAppointmentsForOrg,
  listAssignedMissionIds,
  listAssignmentsDetailed,
  listEvidenceRequestDecisions,
  listEvidenceRequestsForApplicant,
  listEvidenceRequestsForOrg,
  listEvidenceRequestsForOrgDetailed,
  listMissionDecisions,
  listMissionRequirementsForOrg,
  listMissionsForOrganization,
  listNotes,
  listRespondingDocumentStatesForOrg,
  listTasksForOrg,
  listUnassignedActiveMissions,
  listVisibleMissionsForMember,
  recordMissionDecision,
  requestEvidence,
  requirementTriageGroup,
  startEvidenceReview,
  submitEvidenceResponse,
  summarizeCaseTriage,
  unassignMember,
  updateAppointmentForOrg,
  updateTaskForOrg,
} from './agency';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { attachPackVersion, createMission, createTask, transitionMission } from './missions';
import { enqueueNotificationBothChannels } from './notifications';
import {
  addMembership,
  createOrganization,
  listMembershipsForAccount,
  reviewOrganization,
  setMembershipActive,
  setRequireDifferentReviewer,
  suspendOrganization,
  terminateOrganization,
} from './organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from './packs';
import { editFact, registerFieldDefinition } from './profile';
import { RATE_LIMITS } from './rate-limit';
import { exhaustRateLimit } from './rate-limit.test-support';
import { acceptGrant, createGrant, pauseGrant, revokeGrant } from './sharing';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
  return db as unknown as Db;
}

async function consentedApplicant(db: Db, email: string) {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'SHARING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { account, applicantId: applicant.value.id };
}

/**
 * Independently verify a PENDING_VERIFICATION org (createGrant requires an
 * ACTIVE, verified recipient organization). The reviewer is a disposable,
 * unrelated account, matching the real rule that an org can never verify
 * itself.
 */
async function activateOrg(db: Db, organizationId: string): Promise<void> {
  const reviewer = await provisionAccount(db, {
    email: `reviewer-${organizationId}@platform.example.com`,
  });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
}

describe('agency collaboration — assignments, notes, evidence', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('assigns a member (admin only) and records notes', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'coll@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'agent-coll@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // The org needs a current grant covering this mission before it can
    // assign members or comment (Build Spec law 2: membership alone is
    // never access).
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['MANAGE', 'COMMENT'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const assigned = await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: agentAcc.value.id,
      missionId: mission.value.id,
    });
    expect(isOk(assigned)).toBe(true);

    const note = await addNote(db, {
      actorAccountId: agentAcc.value.id,
      missionId: mission.value.id,
      body: 'Please add a bank statement.',
      visibility: 'AGENCY_INTERNAL',
    });
    expect(isOk(note)).toBe(true);
    expect(await listNotes(db, org.value.id, applicantId, mission.value.id)).toHaveLength(1);

    const later = await addNote(db, {
      actorAccountId: agentAcc.value.id,
      missionId: mission.value.id,
      body: 'Newest case activity.',
      visibility: 'AGENCY_INTERNAL',
    });
    if (!isOk(later)) throw new Error('later note');
    const recent = await listNotes(db, org.value.id, applicantId, mission.value.id, { limit: 1 });
    expect(recent.map((item) => item.id)).toEqual([later.value.id]);
    expect(await listNotes(db, org.value.id, applicantId, mission.value.id)).toHaveLength(2);
    expect(
      await listNotes(db, '00000000-0000-4000-8000-000000000001', applicantId, mission.value.id, {
        limit: 50,
      }),
    ).toEqual([]);

    // A non-admin cannot assign.
    const stranger = await provisionAccount(db, { email: 'stranger-coll@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await assignMember(db, {
      actorAccountId: stranger.value.id,
      organizationId: org.value.id,
      memberAccountId: stranger.value.id,
      missionId: mission.value.id,
    });
    expect(isErr(denied)).toBe(true);
  });

  it('listAssignedMissionIds returns only the missions a member is personally assigned to, not every mission the org can reach (Codex review, PR-D2, round 1, finding #31)', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'scope@example.com');
    const missionA = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'A',
    });
    const missionB = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'B',
    });
    if (!isOk(missionA) || !isOk(missionB)) throw new Error('mission');

    const agentAcc = await provisionAccount(db, { email: 'agent-scope@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // One org-wide grant covering BOTH missions — the org itself can reach
    // both; the point is that a non-admin member's own assignment is a
    // narrower boundary than the org's.
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE', 'COMMENT'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const reviewer = await provisionAccount(db, { email: 'reviewer-scope@acme.com' });
    if (!isOk(reviewer)) throw new Error('provision');
    await addMembership(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      accountId: reviewer.value.id,
      role: 'REVIEWER',
    });
    // Assigned to mission A only — never assigned to mission B, even
    // though the org's own grant covers both.
    const assigned = await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: reviewer.value.id,
      missionId: missionA.value.id,
    });
    expect(isOk(assigned)).toBe(true);

    // A DIFFERENT member assigned to mission B — this is what makes the
    // test genuinely discriminating: an unscoped (organization-wide-only)
    // query would return BOTH missions, since assignment rows for both
    // exist somewhere in this org; only a caller-scoped query correctly
    // excludes mission B from the reviewer's own result.
    const otherReviewer = await provisionAccount(db, { email: 'other-reviewer-scope@acme.com' });
    if (!isOk(otherReviewer)) throw new Error('provision');
    await addMembership(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      accountId: otherReviewer.value.id,
      role: 'CASE_MANAGER',
    });
    const otherAssigned = await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: otherReviewer.value.id,
      missionId: missionB.value.id,
    });
    expect(isOk(otherAssigned)).toBe(true);

    const assignedIds = await listAssignedMissionIds(db, org.value.id, reviewer.value.id);
    expect(assignedIds.has(missionA.value.id)).toBe(true);
    expect(assignedIds.has(missionB.value.id)).toBe(false);
    expect(assignedIds.size).toBe(1);
  });

  it('scopes listAssignmentsDetailed to the querying organization, not every organization sharing the mission (Codex review, PR-D2, round 2)', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'crossorg@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Shared mission',
    });
    if (!isOk(mission)) throw new Error('mission');

    // Two SEPARATE organizations, both independently granted MANAGE on the
    // SAME mission -- e.g. the applicant is working with two agencies at
    // once. Each org assigns its own member; an unscoped (missionId-only)
    // query would let orgA's read surface orgB's assignee email too.
    const agentAccA = await provisionAccount(db, { email: 'agent-crossorg-a@acme.com' });
    if (!isOk(agentAccA)) throw new Error('provision');
    const orgA = await createOrganization(db, {
      actorAccountId: agentAccA.value.id,
      name: 'Acme A',
    });
    if (!isOk(orgA)) throw new Error('org');
    await activateOrg(db, orgA.value.id);

    const agentAccB = await provisionAccount(db, { email: 'agent-crossorg-b@rival.com' });
    if (!isOk(agentAccB)) throw new Error('provision');
    const orgB = await createOrganization(db, {
      actorAccountId: agentAccB.value.id,
      name: 'Rival B',
    });
    if (!isOk(orgB)) throw new Error('org');
    await activateOrg(db, orgB.value.id);

    const grantA = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: orgA.value.id,
      missionId: mission.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grantA)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAccA.value.id, grantId: grantA.value.id });

    const grantB = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: orgB.value.id,
      missionId: mission.value.id,
      actions: ['MANAGE'],
      purpose: 'second opinion',
    });
    if (!isOk(grantB)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAccB.value.id, grantId: grantB.value.id });

    const assignedA = await assignMember(db, {
      actorAccountId: agentAccA.value.id,
      organizationId: orgA.value.id,
      memberAccountId: agentAccA.value.id,
      missionId: mission.value.id,
    });
    expect(isOk(assignedA)).toBe(true);
    const assignedB = await assignMember(db, {
      actorAccountId: agentAccB.value.id,
      organizationId: orgB.value.id,
      memberAccountId: agentAccB.value.id,
      missionId: mission.value.id,
    });
    expect(isOk(assignedB)).toBe(true);

    const fromOrgA = await listAssignmentsDetailed(
      db,
      orgA.value.id,
      applicantId,
      mission.value.id,
    );
    expect(fromOrgA).toHaveLength(1);
    expect(fromOrgA[0]?.memberEmail).toBe('agent-crossorg-a@acme.com');

    const fromOrgB = await listAssignmentsDetailed(
      db,
      orgB.value.id,
      applicantId,
      mission.value.id,
    );
    expect(fromOrgB).toHaveLength(1);
    expect(fromOrgB[0]?.memberEmail).toBe('agent-crossorg-b@rival.com');
  });

  it('runs the evidence-request lifecycle (Commercial V1 Part 4 §10: OPEN -> RECEIVED -> UNDER_REVIEW -> NEEDS_REPLACEMENT -> RECEIVED -> ACCEPTED)', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ev@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const req = await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      message: 'last 3 months',
    });
    expect(isOk(req)).toBe(true);
    if (!isOk(req)) return;
    expect(req.value.status).toBe('OPEN');
    expect(req.value.requestedByAccountId).toBe(agentAcc.value.id);

    // A stranger cannot submit a response; only the applicant owner can.
    const other = await provisionAccount(db, { email: 'other-ev@example.com' });
    if (!isOk(other)) throw new Error('provision');

    // An unsafe (quarantined) document can never close the request, even
    // though it is the right docType: "malware/failed/unrelated evidence
    // cannot close request" (§10).
    const unsafeDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'unsafe.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(unsafeDoc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: unsafeDoc.value.id,
      bucket: 'QUARANTINE',
      objectKey: 'unsafe-k',
      safetyStatus: 'QUARANTINED',
      processingStatus: 'NEEDS_ATTENTION',
    });
    const badSubmit = await submitEvidenceResponse(db, {
      actorAccountId: account.id,
      requestId: req.value.id,
      documentId: unsafeDoc.value.id,
    });
    expect(isErr(badSubmit)).toBe(true);
    const stillOpen = await listEvidenceRequestsForApplicant(db, account.id, applicantId);
    expect(stillOpen.ok && stillOpen.value[0]?.status).toBe('OPEN');

    const strangerSubmit = await submitEvidenceResponse(db, {
      actorAccountId: other.value.id,
      requestId: req.value.id,
      documentId: unsafeDoc.value.id,
    });
    expect(isErr(strangerSubmit)).toBe(true);

    // A genuinely clean, processed document of the right type is accepted
    // and moves the request to RECEIVED, never straight to ACCEPTED
    // ("upload never equals acceptance").
    const cleanDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'clean.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(cleanDoc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: cleanDoc.value.id,
      bucket: 'CLEAN',
      objectKey: 'clean-k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    const submitted = await submitEvidenceResponse(db, {
      actorAccountId: account.id,
      requestId: req.value.id,
      documentId: cleanDoc.value.id,
    });
    expect(isOk(submitted)).toBe(true);
    if (!isOk(submitted)) return;
    expect(submitted.value.status).toBe('RECEIVED');
    expect(submitted.value.respondingDocumentId).toBe(cleanDoc.value.id);

    const reviewing = await startEvidenceReview(db, {
      actorAccountId: agentAcc.value.id,
      requestId: req.value.id,
    });
    expect(isOk(reviewing)).toBe(true);
    if (isOk(reviewing)) expect(reviewing.value.status).toBe('UNDER_REVIEW');

    // The org asks for a replacement instead of accepting.
    const needsReplacement = await decideEvidenceResponse(db, {
      actorAccountId: agentAcc.value.id,
      requestId: req.value.id,
      outcome: 'NEEDS_REPLACEMENT',
      reason: 'statement is more than 3 months old',
    });
    expect(isOk(needsReplacement)).toBe(true);
    if (!isOk(needsReplacement)) return;
    expect(needsReplacement.value.status).toBe('NEEDS_REPLACEMENT');
    // The current pointer clears; the decision itself does not.
    expect(needsReplacement.value.respondingDocumentId).toBeNull();

    // A second, fresher document resubmitted after replacement is asked for.
    const secondDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'clean-2.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(secondDoc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: secondDoc.value.id,
      bucket: 'CLEAN',
      objectKey: 'clean-k-2',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    const resubmitted = await submitEvidenceResponse(db, {
      actorAccountId: account.id,
      requestId: req.value.id,
      documentId: secondDoc.value.id,
    });
    expect(isOk(resubmitted)).toBe(true);
    if (isOk(resubmitted)) expect(resubmitted.value.status).toBe('RECEIVED');

    const accepted = await decideEvidenceResponse(db, {
      actorAccountId: agentAcc.value.id,
      requestId: req.value.id,
      outcome: 'ACCEPTED',
    });
    expect(isOk(accepted)).toBe(true);
    if (isOk(accepted)) {
      expect(accepted.value.status).toBe('ACCEPTED');
      // ACCEPTED keeps its pointer: it is exactly what was accepted.
      expect(accepted.value.respondingDocumentId).toBe(secondDoc.value.id);
    }

    // Replacement retained the prior decision/reason (§13): both rounds are
    // still in the history, newest first, neither overwriting the other.
    const history = await listEvidenceRequestDecisions(db, account.id, req.value.id);
    expect(isOk(history)).toBe(true);
    if (!isOk(history)) return;
    expect(history.value).toHaveLength(2);
    expect(history.value[0]?.outcome).toBe('ACCEPTED');
    expect(history.value[1]?.outcome).toBe('NEEDS_REPLACEMENT');
    expect(history.value[1]?.reason).toBe('statement is more than 3 months old');
    // The superseded round's own decision snapshot still points at the
    // FIRST document, even though the request's current pointer moved on.
    expect(history.value[1]?.respondingDocumentId).toBe(cleanDoc.value.id);

    // A closed request cannot be decided on again or cancelled.
    const redecide = await decideEvidenceResponse(db, {
      actorAccountId: agentAcc.value.id,
      requestId: req.value.id,
      outcome: 'NEEDS_REPLACEMENT',
    });
    expect(isErr(redecide)).toBe(true);
    const cancelClosed = await cancelEvidenceRequest(db, {
      actorAccountId: agentAcc.value.id,
      requestId: req.value.id,
    });
    expect(isErr(cancelClosed)).toBe(true);
  });

  it('NTF-02: requestEvidence enqueues an in-app + email notification to the applicant owner', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev-notify@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ev-notify@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const req = await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      message: 'a message that must never leak into the notification payload',
    });
    expect(isOk(req)).toBe(true);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'EVIDENCE_REQUEST_CREATED'));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
    for (const row of rows) {
      expect(row.recipientAccountId).toBe(account.id);
      expect(row.applicantId).toBe(applicantId);
      expect(row.organizationId).toBe(org.value.id);
      const payload = row.payload as { summary: string; deepLinkPath: string };
      expect(payload.summary).not.toContain('must never leak');
      expect(payload.deepLinkPath).toBe(`/app/applicant/${applicantId}/evidence`);
    }
  });

  it("NTF-02: decideEvidenceResponse enqueues distinct notifications for ACCEPTED (EVIDENCE_REVIEW_ACCEPTED) versus NEEDS_REPLACEMENT (EVIDENCE_REPLACEMENT_REQUESTED), both to the applicant owner, neither leaking the reviewer's reason text", async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev-decide-notify@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ev-decide-notify@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });
    const agentAccountId = agentAcc.value.id;
    const organizationId = org.value.id;

    async function submitOneResponse() {
      const req = await requestEvidence(db, {
        actorAccountId: agentAccountId,
        organizationId,
        applicantId,
        kind: 'DOCUMENT',
        docType: 'bank_statement',
      });
      if (!isOk(req)) throw new Error('request');
      const doc = await registerDocument(db, {
        actorAccountId: account.id,
        applicantId,
        originalName: 'statement.pdf',
        docType: 'bank_statement',
      });
      if (!isOk(doc)) throw new Error('doc');
      await addDocumentVersion(db, {
        actorAccountId: account.id,
        documentId: doc.value.id,
        bucket: 'CLEAN',
        objectKey: `k-${req.value.id}`,
        safetyStatus: 'CLEAN',
        processingStatus: 'AWAITING_REVIEW',
      });
      const submitted = await submitEvidenceResponse(db, {
        actorAccountId: account.id,
        requestId: req.value.id,
        documentId: doc.value.id,
      });
      if (!isOk(submitted)) throw new Error('submit');
      return req.value.id;
    }

    const acceptedRequestId = await submitOneResponse();
    const accepted = await decideEvidenceResponse(db, {
      actorAccountId: agentAccountId,
      requestId: acceptedRequestId,
      outcome: 'ACCEPTED',
      reason: 'a reason that must never leak into the notification payload',
    });
    expect(isOk(accepted)).toBe(true);

    const acceptedRows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'EVIDENCE_REVIEW_ACCEPTED'));
    expect(acceptedRows).toHaveLength(2);
    expect(acceptedRows.map((r) => r.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
    for (const row of acceptedRows) {
      expect(row.recipientAccountId).toBe(account.id);
      expect(row.resourceId).toBe(acceptedRequestId);
      const payload = row.payload as { summary: string; deepLinkPath: string };
      expect(payload.summary).not.toContain('must never leak');
      expect(payload.deepLinkPath).toBe(`/app/applicant/${applicantId}/evidence`);
    }

    const replacementRequestId = await submitOneResponse();
    const replacement = await decideEvidenceResponse(db, {
      actorAccountId: agentAccountId,
      requestId: replacementRequestId,
      outcome: 'NEEDS_REPLACEMENT',
      reason: 'a different reason that must also never leak',
    });
    expect(isOk(replacement)).toBe(true);

    const replacementRows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'EVIDENCE_REPLACEMENT_REQUESTED'));
    expect(replacementRows).toHaveLength(2);
    for (const row of replacementRows) {
      expect(row.recipientAccountId).toBe(account.id);
      expect(row.resourceId).toBe(replacementRequestId);
      const payload = row.payload as { summary: string };
      expect(payload.summary).not.toContain('must also never leak');
    }
  });

  it("Part 5 §4: cancelEvidenceRequest cancels a still-QUEUED notice for that request, without touching an unrelated request's notice", async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev-cancel-notify@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ev-cancel-notify@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const toCancel = await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
    });
    if (!isOk(toCancel)) throw new Error('request');
    const untouched = await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'DOCUMENT',
      docType: 'passport_bio_page',
    });
    if (!isOk(untouched)) throw new Error('request');

    const cancelled = await cancelEvidenceRequest(db, {
      actorAccountId: agentAcc.value.id,
      requestId: toCancel.value.id,
    });
    expect(isOk(cancelled)).toBe(true);

    const cancelledRows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.resourceId, toCancel.value.id));
    expect(cancelledRows).toHaveLength(2);
    for (const row of cancelledRows) expect(row.status).toBe('CANCELLED');

    const untouchedRows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.resourceId, untouched.value.id));
    expect(untouchedRows).toHaveLength(2);
    for (const row of untouchedRows) expect(row.status).toBe('QUEUED');
  });

  it("decideEvidenceResponse: CONTRADICTION and CORRECTION_PROPOSED are real, distinct outcomes (Commercial V1 Part 4 §13's full four-item review list), both routing the request back to NEEDS_REPLACEMENT while the decision record keeps the more specific classification", async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev-review@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ev-review@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });
    // Narrowing through isOk() doesn't survive into the nested closure below.
    const agentAccountId = agentAcc.value.id;
    const organizationId = org.value.id;

    async function submitOneResponse() {
      const req = await requestEvidence(db, {
        actorAccountId: agentAccountId,
        organizationId,
        applicantId,
        kind: 'DOCUMENT',
        docType: 'bank_statement',
      });
      if (!isOk(req)) throw new Error('request');
      const doc = await registerDocument(db, {
        actorAccountId: account.id,
        applicantId,
        originalName: 'statement.pdf',
        docType: 'bank_statement',
      });
      if (!isOk(doc)) throw new Error('doc');
      await addDocumentVersion(db, {
        actorAccountId: account.id,
        documentId: doc.value.id,
        bucket: 'CLEAN',
        objectKey: `k-${req.value.id}`,
        safetyStatus: 'CLEAN',
        processingStatus: 'AWAITING_REVIEW',
      });
      const submitted = await submitEvidenceResponse(db, {
        actorAccountId: account.id,
        requestId: req.value.id,
        documentId: doc.value.id,
      });
      if (!isOk(submitted)) throw new Error('submit');
      return req.value.id;
    }

    const contradictionRequestId = await submitOneResponse();
    const contradiction = await decideEvidenceResponse(db, {
      actorAccountId: agentAccountId,
      requestId: contradictionRequestId,
      outcome: 'CONTRADICTION',
      reason: 'Statement shows a different home address than your profile.',
    });
    expect(isOk(contradiction)).toBe(true);
    if (isOk(contradiction)) {
      // Same underlying transition as NEEDS_REPLACEMENT: a fresh submission
      // is needed, and the current pointer clears, exactly like §13's
      // "replacement retains prior decision/reason" already tested above.
      expect(contradiction.value.status).toBe('NEEDS_REPLACEMENT');
      expect(contradiction.value.respondingDocumentId).toBeNull();
    }
    const contradictionHistory = await listEvidenceRequestDecisions(
      db,
      account.id,
      contradictionRequestId,
    );
    expect(isOk(contradictionHistory)).toBe(true);
    if (isOk(contradictionHistory)) {
      // The DECISION record keeps the specific classification, distinct
      // from a generic NEEDS_REPLACEMENT, even though the request's own
      // status collapsed onto it.
      expect(contradictionHistory.value[0]?.outcome).toBe('CONTRADICTION');
      expect(contradictionHistory.value[0]?.reason).toContain('different home address');
    }

    const correctionRequestId = await submitOneResponse();
    const correction = await decideEvidenceResponse(db, {
      actorAccountId: agentAccountId,
      requestId: correctionRequestId,
      outcome: 'CORRECTION_PROPOSED',
      reason: 'Consider updating your address to match this statement.',
    });
    expect(isOk(correction)).toBe(true);
    if (isOk(correction)) expect(correction.value.status).toBe('NEEDS_REPLACEMENT');
    const correctionHistory = await listEvidenceRequestDecisions(
      db,
      account.id,
      correctionRequestId,
    );
    expect(isOk(correctionHistory)).toBe(true);
    if (isOk(correctionHistory)) {
      expect(correctionHistory.value[0]?.outcome).toBe('CORRECTION_PROPOSED');
    }
  });

  it('cancelEvidenceRequest lets the requesting org withdraw a request that no longer needs an answer', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev-cancel@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ev-cancel@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const req = await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'FIELD',
      fieldKey: 'passport.number',
    });
    if (!isOk(req)) throw new Error('request');

    const applicantOwnerCannotCancel = await cancelEvidenceRequest(db, {
      actorAccountId: account.id,
      requestId: req.value.id,
    });
    expect(isErr(applicantOwnerCannotCancel)).toBe(true);

    const cancelled = await cancelEvidenceRequest(db, {
      actorAccountId: agentAcc.value.id,
      requestId: req.value.id,
      reason: 'no longer needed',
    });
    expect(isOk(cancelled)).toBe(true);
    if (isOk(cancelled)) expect(cancelled.value.status).toBe('CANCELLED');

    const history = await listEvidenceRequestDecisions(db, agentAcc.value.id, req.value.id);
    expect(isOk(history)).toBe(true);
    if (isOk(history)) {
      expect(history.value).toHaveLength(1);
      expect(history.value[0]?.outcome).toBe('CANCELLED');
      expect(history.value[0]?.reason).toBe('no longer needed');
    }
  });

  it('requireDifferentReviewer (Commercial V1 Part 4 / PRD CAS-06): off by default lets the same account both raise and decide a request; once enabled, refuses the same account but still lets a genuinely different reviewer decide', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev-reviewer@example.com');
    const preparer = await provisionAccount(db, { email: 'preparer-rd@acme.com' });
    if (!isOk(preparer)) throw new Error('provision');
    const reviewer = await provisionAccount(db, { email: 'reviewer-rd@acme.com' });
    if (!isOk(reviewer)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: preparer.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const orgId = org.value.id;
    await activateOrg(db, orgId);
    await addMembership(db, {
      actorAccountId: preparer.value.id,
      organizationId: orgId,
      accountId: reviewer.value.id,
      role: 'ADMIN',
    });
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: orgId,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: preparer.value.id, grantId: grant.value.id });

    async function requestAndSubmit(requesterAccountId: string) {
      const req = await requestEvidence(db, {
        actorAccountId: requesterAccountId,
        organizationId: orgId,
        applicantId,
        kind: 'DOCUMENT',
        docType: 'bank_statement',
      });
      if (!isOk(req)) throw new Error('request');
      const doc = await registerDocument(db, {
        actorAccountId: account.id,
        applicantId,
        originalName: 'bank.pdf',
        docType: 'bank_statement',
      });
      if (!isOk(doc)) throw new Error('doc');
      await addDocumentVersion(db, {
        actorAccountId: account.id,
        documentId: doc.value.id,
        bucket: 'CLEAN',
        objectKey: `k-${req.value.id}`,
        safetyStatus: 'CLEAN',
        processingStatus: 'AWAITING_REVIEW',
      });
      const submitted = await submitEvidenceResponse(db, {
        actorAccountId: account.id,
        requestId: req.value.id,
        documentId: doc.value.id,
      });
      if (!isOk(submitted)) throw new Error('submit');
      return req.value.id;
    }

    // Off by default: the preparer may also decide.
    const requestId1 = await requestAndSubmit(preparer.value.id);
    const decidedByPreparerWhileOff = await decideEvidenceResponse(db, {
      actorAccountId: preparer.value.id,
      requestId: requestId1,
      outcome: 'ACCEPTED',
    });
    expect(isOk(decidedByPreparerWhileOff)).toBe(true);

    // A non-admin (here, the applicant owner has no org role at all) cannot
    // change the setting.
    const deniedToggle = await setRequireDifferentReviewer(db, {
      actorAccountId: account.id,
      organizationId: orgId,
      required: true,
    });
    expect(isErr(deniedToggle)).toBe(true);

    const enabled = await setRequireDifferentReviewer(db, {
      actorAccountId: preparer.value.id,
      organizationId: orgId,
      required: true,
    });
    expect(isOk(enabled)).toBe(true);

    // Now enabled: the SAME preparer may not also decide on their own request.
    const requestId2 = await requestAndSubmit(preparer.value.id);
    const deniedSamePreparer = await decideEvidenceResponse(db, {
      actorAccountId: preparer.value.id,
      requestId: requestId2,
      outcome: 'ACCEPTED',
    });
    expect(isErr(deniedSamePreparer)).toBe(true);

    // A genuinely different reviewer still may.
    const decidedByReviewer = await decideEvidenceResponse(db, {
      actorAccountId: reviewer.value.id,
      requestId: requestId2,
      outcome: 'ACCEPTED',
    });
    expect(isOk(decidedByReviewer)).toBe(true);
  });

  it('refuses further evidence requests once the anti-automation limit is hit (Build Spec §14)', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev-rate@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ev-rate@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const attempt = () =>
      requestEvidence(db, {
        actorAccountId: agentAcc.value.id,
        organizationId: org.value.id,
        applicantId,
        kind: 'DOCUMENT',
        docType: 'bank_statement',
      });

    for (let i = 0; i < RATE_LIMITS.EVIDENCE_REQUEST.limit; i++) {
      const result = await attempt();
      expect(isOk(result)).toBe(true);
    }
    const overLimit = await attempt();
    expect(isErr(overLimit)).toBe(true);
    if (isErr(overLimit)) {
      expect(overLimit.error.code).toBe('rate_limited');
    }
  });

  it('lists evidence requests for the applicant and the org, and org memberships', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev2@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ev2@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'FIELD',
      fieldKey: 'passport_number',
    });

    // Applicant owner sees the request; a stranger is forbidden.
    const forApplicant = await listEvidenceRequestsForApplicant(db, account.id, applicantId);
    expect(isOk(forApplicant)).toBe(true);
    if (isOk(forApplicant)) expect(forApplicant.value).toHaveLength(1);
    const stranger = await listEvidenceRequestsForApplicant(db, agentAcc.value.id, applicantId);
    expect(isErr(stranger)).toBe(true);

    // Org admin sees the org's requests; a non-admin is forbidden.
    const forOrg = await listEvidenceRequestsForOrg(db, agentAcc.value.id, org.value.id);
    expect(isOk(forOrg)).toBe(true);
    if (isOk(forOrg)) expect(forOrg.value).toHaveLength(1);
    const notAdmin = await listEvidenceRequestsForOrg(db, account.id, org.value.id);
    expect(isErr(notAdmin)).toBe(true);

    // The creator is an OWNER member of the org.
    const memberships = await listMembershipsForAccount(db, agentAcc.value.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe('OWNER');
    expect(memberships[0]?.organization.id).toBe(org.value.id);
  });

  it('resolves the applicant name on each org evidence request', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ev3@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ev3@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'FIELD',
      fieldKey: 'passport_number',
    });

    const detailed = await listEvidenceRequestsForOrgDetailed(db, agentAcc.value.id, org.value.id);
    expect(isOk(detailed)).toBe(true);
    if (isOk(detailed)) {
      expect(detailed.value).toHaveLength(1);
      expect(detailed.value[0]?.applicantName).toBe('Owner');
      // Used only for due days (ADR 0015 amendment); the applicant's default zone here.
      expect(detailed.value[0]?.applicantTimezone).toBe('Asia/Dhaka');
    }
  });

  it('resolves the right applicant name across several applicants and requests, and handles none', async () => {
    const first = await consentedApplicant(db, 'ev4a@example.com');
    const second = await consentedApplicant(db, 'ev4b@example.com');
    await db
      .update(schema.applicants)
      .set({ displayName: 'Second Person' })
      .where(eq(schema.applicants.id, second.applicantId));
    const agentAcc = await provisionAccount(db, { email: 'agent-ev4@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const empty = await listEvidenceRequestsForOrgDetailed(db, agentAcc.value.id, org.value.id);
    expect(isOk(empty) && empty.value.length === 0).toBe(true);

    for (const who of [first, second]) {
      const grant = await createGrant(db, {
        actorAccountId: who.account.id,
        applicantId: who.applicantId,
        recipientOrganizationId: org.value.id,
        actions: ['MANAGE'],
        purpose: 'collaboration',
      });
      if (!isOk(grant)) throw new Error('grant');
      await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });
    }
    for (const who of [first, second, second]) {
      await requestEvidence(db, {
        actorAccountId: agentAcc.value.id,
        organizationId: org.value.id,
        applicantId: who.applicantId,
        kind: 'FIELD',
        fieldKey: 'passport_number',
      });
    }

    const detailed = await listEvidenceRequestsForOrgDetailed(db, agentAcc.value.id, org.value.id);
    expect(isOk(detailed)).toBe(true);
    if (isOk(detailed)) {
      expect(detailed.value).toHaveLength(3);
      for (const row of detailed.value) {
        expect(row.applicantName).toBe(
          row.applicantId === second.applicantId ? 'Second Person' : 'Owner',
        );
      }
    }
  });

  it('resolves an assignment to the assigned member email', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'assign@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'agent-assign@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: agentAcc.value.id,
      missionId: mission.value.id,
    });

    const assignments = await listAssignmentsDetailed(
      db,
      org.value.id,
      applicantId,
      mission.value.id,
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.memberEmail).toBe('agent-assign@acme.com');
  });

  it('lists missions reachable by an org via a mission-scoped grant', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'orgmission@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Business trip',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'agent-orgmission@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // No grant yet — the mission isn't visible.
    expect(await listMissionsForOrganization(db, org.value.id)).toHaveLength(0);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['PREVIEW'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');

    // Still pending acceptance — still not visible (regression guard: a
    // grant must be actually accepted, not merely created, before it grants
    // any standing at all).
    expect(await listMissionsForOrganization(db, org.value.id)).toHaveLength(0);

    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const missions = await listMissionsForOrganization(db, org.value.id);
    expect(missions).toHaveLength(1);
    expect(missions[0]?.missionId).toBe(mission.value.id);
    expect(missions[0]?.title).toBe('Business trip');
    expect(missions[0]?.applicantName).toBe('Owner');
  });

  it('lists only applicants with a current (accepted, active) grant to this org (finding #3)', async () => {
    const a = await consentedApplicant(db, 'orgapp-a@example.com');
    const b = await consentedApplicant(db, 'orgapp-b@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-orgapp@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // A has an ACCEPTED grant to this org; B has not (created but never
    // accepted) — a pending, unaccepted grant must not surface the
    // applicant's name at all (docs/audits/post-programme-defect-register.md
    // finding #3), matching listMissionsForOrganization's own
    // accepted-grant requirement.
    const grantA = await createGrant(db, {
      actorAccountId: a.account.id,
      applicantId: a.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    if (!isOk(grantA)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grantA.value.id });

    await createGrant(db, {
      actorAccountId: b.account.id,
      applicantId: b.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });

    const applicants = await listApplicantsForOrganization(db, org.value.id);
    expect(applicants).toHaveLength(1);
    expect(applicants[0]?.applicantId).toBe(a.applicantId);
    expect(applicants[0]?.displayName).toBe('Owner');
  });
});

describe('permissioned bulk export', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('includes only applicants who granted the org EXPORT_PROFILE', async () => {
    // Org + admin.
    const agentAcc = await provisionAccount(db, { email: 'agent-bulk@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const orgId = org.value.id;
    await registerFieldDefinition(db, { key: 'name.full', dataType: 'string' });

    // Applicant A grants EXPORT_PROFILE and accepts; applicant B grants nothing.
    const a = await consentedApplicant(db, 'a-bulk@example.com');
    await editFact(db, {
      actorAccountId: a.account.id,
      applicantId: a.applicantId,
      fieldKey: 'name.full',
      value: 'Alice',
    });
    const grant = await createGrant(db, {
      actorAccountId: a.account.id,
      applicantId: a.applicantId,
      recipientOrganizationId: orgId,
      actions: ['EXPORT_PROFILE'],
      purpose: 'bulk',
      stepUpSatisfied: true,
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const b = await consentedApplicant(db, 'b-bulk@example.com');
    await editFact(db, {
      actorAccountId: b.account.id,
      applicantId: b.applicantId,
      fieldKey: 'name.full',
      value: 'Bob',
    });

    const exported = await bulkExport(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: orgId,
      purpose: 'bulk',
      stepUpSatisfied: true,
    });
    expect(isOk(exported)).toBe(true);
    if (!isOk(exported)) return;
    // Only A (accepted EXPORT_PROFILE grant) is included.
    expect(exported.value).toHaveLength(1);
    expect(exported.value[0]?.facts['name.full']).toBe('Alice');
  });

  it('denies bulk export once the organization itself is suspended, even for a still-active OWNER (SHR-02: "termination of an organisation... denies the next request")', async () => {
    const agentAcc = await provisionAccount(db, { email: 'agent-bulk-suspended@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // Works while the org is ACTIVE.
    const before = await bulkExport(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      purpose: 'bulk',
      stepUpSatisfied: true,
    });
    expect(isOk(before)).toBe(true);

    const reviewer = await provisionAccount(db, {
      email: 'platform-reviewer-bulk-suspend@example.com',
    });
    if (!isOk(reviewer)) throw new Error('provision');
    const suspended = await suspendOrganization(db, {
      reviewerAccountId: reviewer.value.id,
      organizationId: org.value.id,
      stepUpSatisfied: true,
    });
    expect(isOk(suspended)).toBe(true);

    // The caller's own OWNER membership is untouched - only the
    // organization's own status changed.
    const after = await bulkExport(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      purpose: 'bulk',
      stepUpSatisfied: true,
    });
    expect(isErr(after)).toBe(true);
    if (isErr(after)) expect(after.error.code).toBe('forbidden');
  });

  it('is denied for a non-admin caller', async () => {
    const agentAcc = await provisionAccount(db, { email: 'agent-bulk2@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const stranger = await provisionAccount(db, { email: 'stranger-bulk@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const result = await bulkExport(db, {
      actorAccountId: stranger.value.id,
      organizationId: org.value.id,
      purpose: 'bulk',
      stepUpSatisfied: false,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  describe('rate limiting (Part 9 SEC-02)', () => {
    async function activeOrgWithAdmin(email: string): Promise<{ adminId: string; orgId: string }> {
      const admin = await provisionAccount(db, { email });
      if (!isOk(admin)) throw new Error('provision');
      const org = await createOrganization(db, { actorAccountId: admin.value.id, name: 'Acme' });
      if (!isOk(org)) throw new Error('org');
      await activateOrg(db, org.value.id);
      return { adminId: admin.value.id, orgId: org.value.id };
    }
    const exportAs = (actorAccountId: string, organizationId: string) =>
      bulkExport(db, { actorAccountId, organizationId, purpose: 'bulk', stepUpSatisfied: true });

    it('refuses with rate_limited once the actor has hit their bulk-export limit', async () => {
      const { adminId, orgId } = await activeOrgWithAdmin('rl-bulk-actor@acme.com');
      await exhaustRateLimit(db, adminId, 'bulk.export', RATE_LIMITS.BULK_EXPORT);

      const result = await exportAs(adminId, orgId);

      expect(isErr(result)).toBe(true);
      if (isOk(result)) return;
      expect(result.error.code).toBe('rate_limited');
      expect(result.error.message).toContain('export');
    });

    it("refuses once the ORGANIZATION's shared bucket is full, even though this actor is under their own limit", async () => {
      const { adminId, orgId } = await activeOrgWithAdmin('rl-bulk-org@acme.com');
      await exhaustRateLimit(db, orgId, 'bulk.export.org', RATE_LIMITS.BULK_EXPORT_ORG);

      const result = await exportAs(adminId, orgId);

      expect(isErr(result) && result.error.code).toBe('rate_limited');
    });

    it("a refused actor does not spend the organization's shared bucket", async () => {
      const { adminId, orgId } = await activeOrgWithAdmin('rl-bulk-short@acme.com');
      await exhaustRateLimit(db, adminId, 'bulk.export', RATE_LIMITS.BULK_EXPORT);

      const refused = await exportAs(adminId, orgId);
      expect(isErr(refused) && refused.error.code).toBe('rate_limited');

      const orgBuckets = await db
        .select()
        .from(schema.rateLimitBuckets)
        .where(eq(schema.rateLimitBuckets.subjectId, orgId));
      expect(orgBuckets).toHaveLength(0);
    });

    it('authorization comes first: a non-member with an exhausted bucket still gets forbidden', async () => {
      const { orgId } = await activeOrgWithAdmin('rl-bulk-auth@acme.com');
      const stranger = await provisionAccount(db, { email: 'rl-bulk-stranger@example.com' });
      if (!isOk(stranger)) throw new Error('provision');
      await exhaustRateLimit(db, stranger.value.id, 'bulk.export', RATE_LIMITS.BULK_EXPORT);

      const result = await exportAs(stranger.value.id, orgId);

      expect(isErr(result) && result.error.code).toBe('forbidden');
    });
  });
});

describe('reviewer decisions (master directive §7 "PR 10")', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function setUp(db: Db) {
    const { account, applicantId } = await consentedApplicant(db, 'dec@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');

    const pack = await createPack(db, { actorAccountId: account.id, key: 'dec.pack', name: 'Dec' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: account.id, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const requirement = await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport.number',
      citation: 'rule',
    });
    if (!isOk(requirement)) throw new Error('requirement');
    await approvePackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    await publishPackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId: version.value.id,
    });

    const agentAcc = await provisionAccount(db, { email: 'agent-dec@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['MANAGE', 'COMMENT'],
      purpose: 'review',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });
    await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: agentAcc.value.id,
      missionId: mission.value.id,
    });

    return {
      account,
      applicantId,
      missionId: mission.value.id,
      packRequirementId: requirement.value.id,
      org,
      agentAcc,
    };
  }

  it('lets an assigned, granted reviewer record and read a decision', async () => {
    const { missionId, packRequirementId, org, agentAcc } = await setUp(db);
    const decided = await recordMissionDecision(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      missionId,
      packRequirementId,
      outcome: 'ACCEPTED',
      reason: 'Matches the applicant record.',
    });
    expect(isOk(decided)).toBe(true);
    if (!isOk(decided)) return;
    expect(decided.value.outcome).toBe('ACCEPTED');

    const list = await listMissionDecisions(db, agentAcc.value.id, missionId);
    expect(isOk(list)).toBe(true);
    if (isOk(list)) {
      expect(list.value).toHaveLength(1);
      expect(list.value[0]?.outcome).toBe('ACCEPTED');
    }
  });

  it('lets a non-admin, active, assigned member (not OWNER/ADMIN) record and read a decision — the exact authorization the org console page now correctly exposes (finding #31, post-programme defect register)', async () => {
    const { missionId, packRequirementId, org, agentAcc } = await setUp(db);
    // agentAcc (the org creator) is OWNER — every other test above/below
    // that exercises `recordMissionDecision`'s success path uses it, so
    // none of them actually prove a genuinely non-admin role can reach
    // this workflow. A REVIEWER, added and assigned separately, is what
    // finding #31's page-level fix needs proven: recordMissionDecision/
    // listMissionDecisions were never gated on org role, only active
    // membership + assignment + a covering grant — the org console page
    // just never let a non-admin member reach them at all.
    const reviewer = await provisionAccount(db, { email: 'reviewer-dec@acme.com' });
    if (!isOk(reviewer)) throw new Error('provision');
    const membership = await addMembership(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      accountId: reviewer.value.id,
      role: 'REVIEWER',
    });
    expect(isOk(membership)).toBe(true);
    const assigned = await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: reviewer.value.id,
      missionId,
    });
    expect(isOk(assigned)).toBe(true);

    const decided = await recordMissionDecision(db, {
      actorAccountId: reviewer.value.id,
      organizationId: org.value.id,
      missionId,
      packRequirementId,
      outcome: 'ACCEPTED',
      reason: 'Confirmed against the source document.',
    });
    expect(isOk(decided)).toBe(true);
    if (isOk(decided)) expect(decided.value.outcome).toBe('ACCEPTED');

    const list = await listMissionDecisions(db, reviewer.value.id, missionId);
    expect(isOk(list)).toBe(true);
    if (isOk(list)) {
      expect(list.value).toHaveLength(1);
      expect(list.value[0]?.outcome).toBe('ACCEPTED');
    }
  });

  it('refuses to let the mission owner record a decision on their own mission (not self-attestation)', async () => {
    const { account, missionId, packRequirementId, org } = await setUp(db);
    const decided = await recordMissionDecision(db, {
      actorAccountId: account.id,
      organizationId: org.value.id,
      missionId,
      packRequirementId,
      outcome: 'ACCEPTED',
    });
    expect(isErr(decided)).toBe(true);
    if (isErr(decided)) expect(decided.error.code).toBe('forbidden');
  });

  it('refuses a granted-but-unassigned org member', async () => {
    const { missionId, packRequirementId, org, agentAcc } = await setUp(db);
    const unassigned = await provisionAccount(db, { email: 'unassigned-dec@acme.com' });
    if (!isOk(unassigned)) throw new Error('provision');
    // A genuine, active member of the org — just never assigned to THIS mission.
    const membership = await addMembership(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      accountId: unassigned.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isOk(membership)).toBe(true);
    const decided = await recordMissionDecision(db, {
      actorAccountId: unassigned.value.id,
      organizationId: org.value.id,
      missionId,
      packRequirementId,
      outcome: 'ACCEPTED',
    });
    expect(isErr(decided)).toBe(true);
    if (isErr(decided)) expect(decided.error.code).toBe('forbidden');
  });

  it("refuses a stranger org's member entirely (no grant on this applicant)", async () => {
    const { missionId, packRequirementId } = await setUp(db);
    const strangerAgent = await provisionAccount(db, { email: 'stranger-agent-dec@other.com' });
    if (!isOk(strangerAgent)) throw new Error('provision');
    const strangerOrg = await createOrganization(db, {
      actorAccountId: strangerAgent.value.id,
      name: 'Other Agency',
    });
    if (!isOk(strangerOrg)) throw new Error('org');
    await activateOrg(db, strangerOrg.value.id);

    const decided = await recordMissionDecision(db, {
      actorAccountId: strangerAgent.value.id,
      organizationId: strangerOrg.value.id,
      missionId,
      packRequirementId,
      outcome: 'REJECTED',
    });
    expect(isErr(decided)).toBe(true);
    if (isErr(decided)) expect(decided.error.code).toBe('forbidden');
  });

  it('refuses to read decisions for an account with no standing on the mission', async () => {
    const { missionId } = await setUp(db);
    const stranger = await provisionAccount(db, { email: 'stranger-read-dec@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const list = await listMissionDecisions(db, stranger.value.id, missionId);
    expect(isErr(list)).toBe(true);
    if (isErr(list)) expect(list.error.code).toBe('forbidden');
  });

  it("revokes a former reviewer's access to decision history the instant their membership is deactivated (finding #32)", async () => {
    const { missionId, packRequirementId, org, agentAcc } = await setUp(db);
    await recordMissionDecision(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      missionId,
      packRequirementId,
      outcome: 'ACCEPTED',
    });
    // Still readable while active.
    expect(isOk(await listMissionDecisions(db, agentAcc.value.id, missionId))).toBe(true);

    // Deactivate the reviewer's membership (org OWNER acting on themselves via
    // a second, disposable OWNER — setMembershipActive refuses to deactivate
    // the sole remaining owner).
    const secondOwner = await provisionAccount(db, { email: 'second-owner-dec@acme.com' });
    if (!isOk(secondOwner)) throw new Error('provision');
    await addMembership(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      accountId: secondOwner.value.id,
      role: 'OWNER',
    });
    const membership = (await listMembershipsForAccount(db, agentAcc.value.id))[0];
    if (!membership) throw new Error('membership');
    const deactivated = await setMembershipActive(db, {
      actorAccountId: secondOwner.value.id,
      organizationId: org.value.id,
      membershipId: membership.membershipId,
      active: false,
    });
    expect(isOk(deactivated)).toBe(true);

    // The assignment row still exists, but the former reviewer is no longer
    // an active member — decision history must now be denied, not exposed
    // indefinitely (docs/audits/post-programme-defect-register.md finding #32).
    const list = await listMissionDecisions(db, agentAcc.value.id, missionId);
    expect(isErr(list)).toBe(true);
    if (isErr(list)) expect(list.error.code).toBe('forbidden');
  });

  it('authorizes via ANY matching assignment across multiple organizations, not an arbitrary single row (Codex review, PR #65)', async () => {
    const { missionId, applicantId, account, org, agentAcc } = await setUp(db);

    // A second organization, ALSO with the same reviewer assigned to the
    // same mission, via a fully valid active membership and covering grant.
    // The assignments table's uniqueness key includes organizationId, so an
    // account being assigned to one mission through two different
    // organizations is a valid, expected state.
    const secondOrg = await createOrganization(db, {
      actorAccountId: agentAcc.value.id,
      name: 'Second Agency',
    });
    if (!isOk(secondOrg)) throw new Error('org');
    await activateOrg(db, secondOrg.value.id);
    const secondGrant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: secondOrg.value.id,
      missionId,
      actions: ['MANAGE', 'COMMENT'],
      purpose: 'review',
    });
    if (!isOk(secondGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: secondGrant.value.id });
    await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: secondOrg.value.id,
      memberAccountId: agentAcc.value.id,
      missionId,
    });

    // Now deactivate the reviewer's membership in the FIRST org only — that
    // assignment row is no longer backed by an active membership, but the
    // SECOND org's assignment still is. The account has an assignment row
    // for BOTH organizations; an arbitrary single-row check could pick
    // either one.
    const secondOwnerFirstOrg = await provisionAccount(db, {
      email: 'second-owner-first-org@example.com',
    });
    if (!isOk(secondOwnerFirstOrg)) throw new Error('provision');
    await addMembership(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      accountId: secondOwnerFirstOrg.value.id,
      role: 'OWNER',
    });
    const membershipFirstOrg = (await listMembershipsForAccount(db, agentAcc.value.id)).find(
      (m) => m.organization.id === org.value.id,
    );
    if (!membershipFirstOrg) throw new Error('membership');
    const deactivated = await setMembershipActive(db, {
      actorAccountId: secondOwnerFirstOrg.value.id,
      organizationId: org.value.id,
      membershipId: membershipFirstOrg.membershipId,
      active: false,
    });
    expect(isOk(deactivated)).toBe(true);

    // Must succeed via the second organization's still-valid assignment,
    // regardless of which row an unordered query happens to return first.
    const list = await listMissionDecisions(db, agentAcc.value.id, missionId);
    expect(isOk(list)).toBe(true);
  });

  it('NTF-02: enqueues an in-app + email notification to the applicant owner when a decision is recorded', async () => {
    const { account, missionId, packRequirementId, org, agentAcc } = await setUp(db);
    const decided = await recordMissionDecision(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      missionId,
      packRequirementId,
      outcome: 'REJECTED',
      reason: 'Not legible.',
    });
    expect(isOk(decided)).toBe(true);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'MISSION_STATUS_CHANGED'));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
    for (const row of rows) {
      expect(row.recipientAccountId).toBe(account.id);
      expect(row.status).toBe('QUEUED');
      // Neutral/minimal: never the reviewer's own reason text or the outcome.
      const payload = row.payload as { summary: string };
      expect(payload.summary).not.toContain('Not legible');
      expect(payload.summary).not.toContain('REJECTED');
    }
  });
});

describe('scope and read-authorization hardening (post-programme defect register findings #3–#7)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('excludes revoked, paused, and unaccepted grants from listApplicantsForOrganization (finding #3)', async () => {
    const agentAcc = await provisionAccount(db, { email: 'agent-scope@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const revoked = await consentedApplicant(db, 'revoked-scope@example.com');
    const revokedGrant = await createGrant(db, {
      actorAccountId: revoked.account.id,
      applicantId: revoked.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    if (!isOk(revokedGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: revokedGrant.value.id });
    await revokeGrant(db, { actorAccountId: revoked.account.id, grantId: revokedGrant.value.id });

    const paused = await consentedApplicant(db, 'paused-scope@example.com');
    const pausedGrant = await createGrant(db, {
      actorAccountId: paused.account.id,
      applicantId: paused.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    if (!isOk(pausedGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: pausedGrant.value.id });
    await pauseGrant(db, { actorAccountId: paused.account.id, grantId: pausedGrant.value.id });

    const unaccepted = await consentedApplicant(db, 'unaccepted-scope@example.com');
    await createGrant(db, {
      actorAccountId: unaccepted.account.id,
      applicantId: unaccepted.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });

    const active = await consentedApplicant(db, 'active-scope@example.com');
    const activeGrant = await createGrant(db, {
      actorAccountId: active.account.id,
      applicantId: active.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    if (!isOk(activeGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: activeGrant.value.id });

    const applicants = await listApplicantsForOrganization(db, org.value.id);
    expect(applicants).toHaveLength(1);
    expect(applicants[0]?.applicantId).toBe(active.applicantId);
  });

  it('never lets a mission-scoped bulk export reach beyond its scope (finding #4)', async () => {
    const agentAcc = await provisionAccount(db, { email: 'agent-bulkscope@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const orgId = org.value.id;

    const { account, applicantId } = await consentedApplicant(db, 'bulkscope@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');

    // A mission-scoped grant is the ONLY standing this org has for this
    // applicant — it must never be evaluated as applicant-wide.
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: orgId,
      missionId: mission.value.id,
      actions: ['EXPORT_PROFILE'],
      purpose: 'bulk',
      stepUpSatisfied: true,
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const exported = await bulkExport(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: orgId,
      purpose: 'bulk',
      stepUpSatisfied: true,
    });
    expect(isOk(exported)).toBe(true);
    if (!isOk(exported)) return;
    // EXPORT_PROFILE is a profile-wide action with no mission-scoped
    // equivalent in the policy engine — a genuinely mission-scoped grant
    // must never authorize it at all once scope is correctly preserved.
    expect(exported.value).toHaveLength(0);
  });

  it('denies notes/assignments once the org grant does not permit COMMENT or MANAGE on that mission (finding #5)', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'readscope@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'agent-readscope@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // Seed REAL note/assignment rows for this exact org/mission while a
    // MANAGE grant is active — a prior version of this test asserted
    // emptiness with no data ever seeded, which would also pass on a
    // reverted (unguarded) implementation simply because nothing existed to
    // leak (Codex-equivalent gap caught during PR-F1's own re-verification
    // pass). Seeding, then narrowing the SAME org's grant to PREVIEW-only,
    // proves the action check itself — not absence of data — is what
    // suppresses access.
    const manageGrant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      // COMMENT (addNote's own bar) and MANAGE (assignMember's own bar) —
      // both are needed to seed one row of each kind below.
      actions: ['COMMENT', 'MANAGE'],
      purpose: 'onboarding',
    });
    if (!isOk(manageGrant)) throw new Error('manage grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: manageGrant.value.id });
    const noteResult = await addNote(db, {
      actorAccountId: agentAcc.value.id,
      missionId: mission.value.id,
      body: 'A note only a sufficiently-permitted reader should see.',
      visibility: 'AGENCY_INTERNAL',
    });
    expect(isOk(noteResult)).toBe(true);
    const assignResult = await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: agentAcc.value.id,
      missionId: mission.value.id,
    });
    expect(isOk(assignResult)).toBe(true);
    // Confirm the seeded rows are genuinely readable while MANAGE is active
    // (rules out a fixture mistake before we assert the negative below).
    expect(await listNotes(db, org.value.id, applicantId, mission.value.id)).toHaveLength(1);
    expect(
      await listAssignmentsDetailed(db, org.value.id, applicantId, mission.value.id),
    ).toHaveLength(1);

    // Revoke MANAGE and replace it with a PREVIEW-only grant for the SAME
    // org — the note/assignment rows above still exist, still belong to
    // this exact org, but this org's current standing no longer covers
    // COMMENT or MANAGE.
    const revoked = await revokeGrant(db, {
      actorAccountId: account.id,
      grantId: manageGrant.value.id,
    });
    expect(isOk(revoked)).toBe(true);
    const previewGrant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    if (!isOk(previewGrant)) throw new Error('preview grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: previewGrant.value.id });

    // The mission is still visible via listMissionsForOrganization (a real,
    // active, accepted grant exists)...
    const missions = await listMissionsForOrganization(db, org.value.id);
    expect(missions).toHaveLength(1);

    // ...but the previously-seeded, still-existing notes/assignments must
    // no longer be readable without COMMENT/MANAGE.
    expect(await listNotes(db, org.value.id, applicantId, mission.value.id)).toHaveLength(0);
    expect(
      await listAssignmentsDetailed(db, org.value.id, applicantId, mission.value.id),
    ).toHaveLength(0);
  });

  it('honors a mission-scoped MANAGE grant when requesting evidence (finding #6)', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'evscope@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'agent-evscope@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // The ONLY grant is mission-scoped — no applicant-wide grant exists.
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['MANAGE'],
      purpose: 'review',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    // Without the mission id, this must fail (scope_mismatch) — proving the
    // regression this test guards against.
    const withoutScope = await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
    });
    expect(isErr(withoutScope)).toBe(true);

    // Supplying the mission id lets the mission-scoped grant match.
    const withScope = await requestEvidence(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      applicantId,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      missionId: mission.value.id,
    });
    expect(isOk(withScope)).toBe(true);
  });

  it('deduplicates a mission reachable via both an applicant-wide and a mission-scoped grant (finding #7)', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'dedupe@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'agent-dedupe@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const wideGrant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review-wide',
    });
    if (!isOk(wideGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: wideGrant.value.id });

    const scopedGrant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['COMMENT'],
      purpose: 'review-scoped',
    });
    if (!isOk(scopedGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: scopedGrant.value.id });

    const missions = await listMissionsForOrganization(db, org.value.id);
    expect(missions).toHaveLength(1);
    expect(missions[0]?.missionId).toBe(mission.value.id);
  });
});

describe("SHR-02: a suspended/closed organization loses standing everywhere orgGrantPermits gates, independent of any individual member's own still-active row", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('orgGrantPermits denies once the organization is suspended, then a NEW grant to a re-activated organization works again', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'shr02-orggrant@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'shr02-orggrant-agent@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    // assignMember (orgGrantPermits-gated) works while the org is ACTIVE.
    const assignedBefore = await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: agentAcc.value.id,
      missionId: mission.value.id,
    });
    expect(isOk(assignedBefore)).toBe(true);

    const reviewer = await provisionAccount(db, {
      email: 'shr02-orggrant-reviewer@example.com',
    });
    if (!isOk(reviewer)) throw new Error('provision');
    await suspendOrganization(db, {
      reviewerAccountId: reviewer.value.id,
      organizationId: org.value.id,
      stepUpSatisfied: true,
    });

    // The grant itself is untouched (still ACTIVE, still accepted), the
    // actor is still a genuine OWNER, and the assignee is still a genuine
    // active member -- isOrgAdmin/isActiveMember both still pass. Only the
    // organization's own status changed, so orgGrantPermits is the ONE
    // check left that can refuse this.
    const assignedAfter = await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: agentAcc.value.id,
      missionId: mission.value.id,
    });
    expect(isErr(assignedAfter)).toBe(true);
    if (isErr(assignedAfter)) expect(assignedAfter.error.code).toBe('forbidden');

    // Reading collaboration data through the same gate is denied too.
    const requirements = await listMissionRequirementsForOrg(db, org.value.id, mission.value.id);
    expect(isErr(requirements)).toBe(true);
    if (isErr(requirements)) expect(requirements.error.code).toBe('forbidden');
  });

  it('orgGrantPermits denies once the organization is terminated (CLOSED), proving "removes agency access" is real, not just documented in this describe title', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'shr02-closed@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const agentAcc = await provisionAccount(db, { email: 'shr02-closed-agent@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      missionId: mission.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const assignedBefore = await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: agentAcc.value.id,
      missionId: mission.value.id,
    });
    expect(isOk(assignedBefore)).toBe(true);

    const reviewer = await provisionAccount(db, { email: 'shr02-closed-reviewer@example.com' });
    if (!isOk(reviewer)) throw new Error('provision');
    const terminated = await terminateOrganization(db, {
      reviewerAccountId: reviewer.value.id,
      organizationId: org.value.id,
      stepUpSatisfied: true,
    });
    expect(isOk(terminated)).toBe(true);
    if (isOk(terminated)) expect(terminated.value.status).toBe('CLOSED');

    const assignedAfter = await assignMember(db, {
      actorAccountId: agentAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: agentAcc.value.id,
      missionId: mission.value.id,
    });
    expect(isErr(assignedAfter)).toBe(true);
    if (isErr(assignedAfter)) expect(assignedAfter.error.code).toBe('forbidden');

    // "Traveller retains wallet" (PRD PRV-04): terminating the agency never
    // touches the applicant's own profile at all.
    const stillOwnedApplicant = await db
      .select()
      .from(schema.applicants)
      .where(eq(schema.applicants.id, applicantId));
    expect(stillOwnedApplicant).toHaveLength(1);
    expect(stillOwnedApplicant[0]?.ownerAccountId).toBe(account.id);
  });
});

describe('CAS-02 - case workspace: authorized visibility, search fields, task rollup', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('listVisibleMissionsForMember: an admin sees every case the org can reach; a non-admin member sees only cases they are personally assigned to', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'cas02-visibility@example.com');
    const missionA = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Case A',
    });
    const missionB = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Case B',
    });
    if (!isOk(missionA) || !isOk(missionB)) throw new Error('mission');

    const adminAcc = await provisionAccount(db, { email: 'cas02-admin@acme.com' });
    const memberAcc = await provisionAccount(db, { email: 'cas02-member@acme.com' });
    if (!isOk(adminAcc) || !isOk(memberAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: adminAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    await addMembership(db, {
      actorAccountId: adminAcc.value.id,
      organizationId: org.value.id,
      accountId: memberAcc.value.id,
      role: 'CASE_MANAGER',
    });

    // One applicant-wide grant makes BOTH cases reachable by the org.
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: adminAcc.value.id, grantId: grant.value.id });

    // The non-admin member is personally assigned to Case A only.
    await assignMember(db, {
      actorAccountId: adminAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: memberAcc.value.id,
      missionId: missionA.value.id,
    });

    const asAdmin = await listVisibleMissionsForMember(db, org.value.id, adminAcc.value.id);
    expect(asAdmin.admin).toBe(true);
    expect(asAdmin.missions.map((m) => m.missionId).sort()).toEqual(
      [missionA.value.id, missionB.value.id].sort(),
    );

    const asMember = await listVisibleMissionsForMember(db, org.value.id, memberAcc.value.id);
    expect(asMember.admin).toBe(false);
    expect(asMember.missions).toHaveLength(1);
    expect(asMember.missions[0]?.missionId).toBe(missionA.value.id);
  });

  it('listVisibleMissionsForMember: carries the CAS-01 case fields search/rollup needs (state, destination, jurisdiction, manualMode, dates)', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'cas02-fields@example.com');
    const targetDeadline = new Date('2026-12-15T00:00:00Z');
    const travelStartDate = new Date('2026-11-01T00:00:00Z');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Manual route case',
      destination: 'Narnia',
      jurisdiction: 'Consulate of Narnia, Dhaka',
      manualMode: true,
      targetDeadline,
      travelStartDate,
    });
    if (!isOk(mission)) throw new Error('mission');

    const agentAcc = await provisionAccount(db, { email: 'cas02-fields-agent@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const { missions } = await listVisibleMissionsForMember(db, org.value.id, agentAcc.value.id);
    expect(missions).toHaveLength(1);
    const summary = missions[0];
    expect(summary?.state).toBe('DRAFT');
    expect(summary?.destination).toBe('Narnia');
    expect(summary?.jurisdiction).toBe('Consulate of Narnia, Dhaka');
    expect(summary?.manualMode).toBe(true);
    expect(summary?.targetDeadline).toBe(targetDeadline.toISOString());
    expect(summary?.travelStartDate).toBe(travelStartDate.toISOString());
    // The traveller's time zone, used only to decide when a due day ends (ADR 0015 amendment).
    expect(summary?.applicantTimezone).toBe('Asia/Dhaka');
    // No protected wallet content anywhere on this shape -- just case metadata.
    expect(Object.keys(summary ?? {}).sort()).toEqual(
      [
        'applicantId',
        'applicantName',
        'applicantTimezone',
        'createdAt',
        'destination',
        'jurisdiction',
        'manualMode',
        'missionId',
        'packVersionId',
        'state',
        'targetDeadline',
        'title',
        'travelStartDate',
        'updatedAt',
      ].sort(),
    );
  });

  it('listTasksForOrg: org-read-scoped like listNotes/listAssignmentsDetailed (COMMENT or MANAGE grant only), and carries dueDate for the overdue-tasks rollup', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'cas02-tasks@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Task case',
    });
    if (!isOk(mission)) throw new Error('mission');
    const dueDate = new Date('2020-01-01T00:00:00Z'); // deliberately in the past
    const task = await createTask(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      description: 'Chase a replacement document.',
      dueDate,
    });
    if (!isOk(task)) throw new Error('task');

    const agentAcc = await provisionAccount(db, { email: 'cas02-tasks-agent@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);

    // No grant yet at all -- denied.
    expect(await listTasksForOrg(db, org.value.id, applicantId, mission.value.id)).toHaveLength(0);

    const previewGrant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    if (!isOk(previewGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: previewGrant.value.id });

    // PREVIEW alone is not COMMENT-or-MANAGE -- still denied.
    expect(await listTasksForOrg(db, org.value.id, applicantId, mission.value.id)).toHaveLength(0);

    const commentGrant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['COMMENT'],
      purpose: 'review-2',
    });
    if (!isOk(commentGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: commentGrant.value.id });

    const tasks = await listTasksForOrg(db, org.value.id, applicantId, mission.value.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe(task.value.id);
    expect(tasks[0]?.dueDate?.toISOString()).toBe(dueDate.toISOString());
  });
});

describe('CAS-04 - org-side tasks/appointments, unassignment, and the reassignment queue (Commercial V1 Part 4 §11)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  /** An org, an admin, an assigned member holding a real MANAGE grant, and one mission. */
  async function setUpAssignedOrg(db: Db, tag: string) {
    const { account, applicantId } = await consentedApplicant(db, `cas04-${tag}@example.com`);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Task/appointment case',
    });
    if (!isOk(mission)) throw new Error('mission');

    const adminAcc = await provisionAccount(db, { email: `cas04-${tag}-admin@acme.com` });
    const memberAcc = await provisionAccount(db, { email: `cas04-${tag}-member@acme.com` });
    if (!isOk(adminAcc) || !isOk(memberAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: adminAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    await addMembership(db, {
      actorAccountId: adminAcc.value.id,
      organizationId: org.value.id,
      accountId: memberAcc.value.id,
      role: 'CASE_MANAGER',
    });
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: adminAcc.value.id, grantId: grant.value.id });
    await assignMember(db, {
      actorAccountId: adminAcc.value.id,
      organizationId: org.value.id,
      memberAccountId: memberAcc.value.id,
      missionId: mission.value.id,
    });

    return {
      account,
      applicantId,
      missionId: mission.value.id,
      organizationId: org.value.id,
      adminAccountId: adminAcc.value.id,
      memberAccountId: memberAcc.value.id,
    };
  }

  it('createTaskForOrg/updateTaskForOrg/decideTaskForOrg require the actor to be assigned to the mission, not merely an active member with a covering grant', async () => {
    const { missionId, organizationId, adminAccountId, memberAccountId } = await setUpAssignedOrg(
      db,
      'task',
    );

    const created = await createTaskForOrg(db, {
      actorAccountId: memberAccountId,
      organizationId,
      missionId,
      description: 'Chase the applicant for a bank statement.',
      priority: 'HIGH',
    });
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;
    expect(created.value.priority).toBe('HIGH');

    const reassigned = await updateTaskForOrg(db, {
      actorAccountId: memberAccountId,
      organizationId,
      missionId,
      taskId: created.value.id,
      assigneeAccountId: null,
    });
    expect(isOk(reassigned)).toBe(true);
    if (isOk(reassigned)) expect(reassigned.value.assigneeAccountId).toBeNull();

    const started = await decideTaskForOrg(db, {
      actorAccountId: memberAccountId,
      organizationId,
      missionId,
      taskId: created.value.id,
      status: 'IN_PROGRESS',
    });
    expect(isOk(started)).toBe(true);
    if (isOk(started)) expect(started.value.status).toBe('IN_PROGRESS');

    // An active member with the SAME covering grant, but never assigned to
    // this mission, is refused -- routine case work is assignment-gated,
    // exactly like recordMissionDecision's own bar.
    const outsider = await provisionAccount(db, { email: 'cas04-task-outsider@acme.com' });
    if (!isOk(outsider)) throw new Error('provision');
    await addMembership(db, {
      actorAccountId: adminAccountId,
      organizationId,
      accountId: outsider.value.id,
      role: 'CASE_MANAGER',
    });
    const deniedCreate = await createTaskForOrg(db, {
      actorAccountId: outsider.value.id,
      organizationId,
      missionId,
      description: 'Should be refused.',
    });
    expect(isErr(deniedCreate)).toBe(true);
    if (isErr(deniedCreate)) expect(deniedCreate.error.code).toBe('forbidden');
  });

  it('org-side appointments refuse a time zone that is not a known IANA name', async () => {
    const { missionId, organizationId, memberAccountId } = await setUpAssignedOrg(db, 'apptzone');
    const base = {
      actorAccountId: memberAccountId,
      organizationId,
      missionId,
      title: 'Prep call',
      localDateTime: new Date('2026-12-01T10:00:00'),
    };
    const refused = await createAppointmentForOrg(db, {
      ...base,
      timezone: 'Asia/Dhaka\r\nX-INJECT:1',
    });
    expect(isErr(refused) && refused.error.code).toBe('invalid');
    const made = await createAppointmentForOrg(db, { ...base, timezone: 'Asia/Dhaka' });
    if (!isOk(made)) throw new Error('appointment');
    const moved = await updateAppointmentForOrg(db, {
      actorAccountId: memberAccountId,
      organizationId,
      missionId,
      appointmentId: made.value.id,
      timezone: 'Nowhere/Else',
    });
    expect(isErr(moved) && moved.error.code).toBe('invalid');
  });

  it('org-side appointments: create/list/decide share the same assigned-member gate as tasks', async () => {
    const { missionId, applicantId, organizationId, memberAccountId } = await setUpAssignedOrg(
      db,
      'appt',
    );

    const created = await createAppointmentForOrg(db, {
      actorAccountId: memberAccountId,
      organizationId,
      missionId,
      title: 'Prep call',
      localDateTime: new Date('2026-12-01T10:00:00'),
      timezone: 'Asia/Dhaka',
    });
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;

    const listed = await listAppointmentsForOrg(db, organizationId, applicantId, missionId);
    expect(listed.map((a) => a.id)).toEqual([created.value.id]);

    const decided = await decideAppointmentForOrg(db, {
      actorAccountId: memberAccountId,
      organizationId,
      missionId,
      appointmentId: created.value.id,
      status: 'DONE',
    });
    expect(isOk(decided)).toBe(true);
    if (isOk(decided)) expect(decided.value.status).toBe('DONE');
  });

  it('NTF-02: createAppointmentForOrg enqueues an APPOINTMENT_SCHEDULED notification to the applicant owner', async () => {
    const { account, missionId, organizationId, memberAccountId } = await setUpAssignedOrg(
      db,
      'appt-notify',
    );

    const created = await createAppointmentForOrg(db, {
      actorAccountId: memberAccountId,
      organizationId,
      missionId,
      title: 'Prep call',
      localDateTime: new Date('2026-12-01T10:00:00'),
      timezone: 'Asia/Dhaka',
    });
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'APPOINTMENT_SCHEDULED'));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
    for (const row of rows) {
      expect(row.recipientAccountId).toBe(account.id);
      expect(row.resourceId).toBe(created.value.id);
      const payload = row.payload as { deepLinkPath: string };
      expect(payload.deepLinkPath).toBe(`/app/mission/${missionId}`);
    }
  });

  it('Part 5 §4: decideAppointmentForOrg CANCELLED cancels the still-QUEUED APPOINTMENT_SCHEDULED notice', async () => {
    const { missionId, organizationId, memberAccountId } = await setUpAssignedOrg(
      db,
      'appt-cancel-notify',
    );
    const created = await createAppointmentForOrg(db, {
      actorAccountId: memberAccountId,
      organizationId,
      missionId,
      title: 'Prep call',
      localDateTime: new Date('2026-12-01T10:00:00'),
      timezone: 'Asia/Dhaka',
    });
    if (!isOk(created)) throw new Error('appointment');

    const decided = await decideAppointmentForOrg(db, {
      actorAccountId: memberAccountId,
      organizationId,
      missionId,
      appointmentId: created.value.id,
      status: 'CANCELLED',
    });
    expect(isOk(decided)).toBe(true);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.resourceId, created.value.id));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.status).toBe('CANCELLED');
  });

  it('Part 5 §4: decideTaskForOrg CANCELLED cancels a still-QUEUED notice tied to that task (e.g. an NTF-04 deadline reminder not yet dispatched)', async () => {
    const { missionId, applicantId, organizationId, adminAccountId, memberAccountId } =
      await setUpAssignedOrg(db, 'task-cancel-notify');
    const created = await createTaskForOrg(db, {
      actorAccountId: memberAccountId,
      organizationId,
      missionId,
      description: 'Chase the applicant for a bank statement.',
    });
    if (!isOk(created)) throw new Error('task');

    // Simulates what NTF-04's sweepTaskDeadlineReminders would have already
    // enqueued for this task's due date, still sitting QUEUED because the
    // worker hasn't run yet.
    await db.transaction(async (tx) => {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'TASK_DEADLINE',
        resourceId: created.value.id,
        recipientAccountId: adminAccountId,
        applicantId,
        threshold: 'due_7d',
        payload: { subject: 'Task due soon', summary: 'A task is due soon.', deepLinkPath: '/app' },
      });
    });

    const decided = await decideTaskForOrg(db, {
      actorAccountId: memberAccountId,
      organizationId,
      missionId,
      taskId: created.value.id,
      status: 'CANCELLED',
    });
    expect(isOk(decided)).toBe(true);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.resourceId, created.value.id));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.status).toBe('CANCELLED');
  });

  it('unassignMember: admin-only, removes exactly that assignment, and is idempotent when nothing is assigned', async () => {
    const { missionId, organizationId, adminAccountId, memberAccountId } = await setUpAssignedOrg(
      db,
      'unassign',
    );

    const nonAdminAttempt = await unassignMember(db, {
      actorAccountId: memberAccountId,
      organizationId,
      memberAccountId,
      missionId,
    });
    expect(isErr(nonAdminAttempt)).toBe(true);
    if (isErr(nonAdminAttempt)) expect(nonAdminAttempt.error.code).toBe('forbidden');

    const removed = await unassignMember(db, {
      actorAccountId: adminAccountId,
      organizationId,
      memberAccountId,
      missionId,
    });
    expect(isOk(removed)).toBe(true);
    if (isOk(removed)) expect(removed.value.removed).toBe(true);

    const assignments = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.missionId, missionId));
    expect(assignments).toHaveLength(0);

    // Removing again is a true no-op, not an error.
    const again = await unassignMember(db, {
      actorAccountId: adminAccountId,
      organizationId,
      memberAccountId,
      missionId,
    });
    expect(isOk(again)).toBe(true);
    if (isOk(again)) expect(again.value.removed).toBe(false);
  });

  it('listUnassignedActiveMissions: surfaces an active, reachable case with nobody assigned, excludes an assigned one and a CANCELLED one', async () => {
    const { account, applicantId, missionId, organizationId, adminAccountId, memberAccountId } =
      await setUpAssignedOrg(db, 'queue');

    // Assigned -- not in the queue.
    expect(await listUnassignedActiveMissions(db, organizationId)).toEqual([]);

    await unassignMember(db, {
      actorAccountId: adminAccountId,
      organizationId,
      memberAccountId,
      missionId,
    });
    const queue = await listUnassignedActiveMissions(db, organizationId);
    expect(queue.map((m) => m.missionId)).toEqual([missionId]);

    // A second, CANCELLED mission with no assignee at all never appears --
    // a finished case needs no reassignment.
    const cancelled = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Withdrawn case',
    });
    if (!isOk(cancelled)) throw new Error('mission');
    await transitionMission(db, {
      actorAccountId: account.id,
      missionId: cancelled.value.id,
      to: 'CANCELLED',
    });
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: organizationId,
      missionId: cancelled.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: adminAccountId, grantId: grant.value.id });

    const queueAfter = await listUnassignedActiveMissions(db, organizationId);
    expect(queueAfter.map((m) => m.missionId)).toEqual([missionId]);
  });

  it('deactivating a member auto-unassigns them from every active mission where they were the SOLE assignee, landing it in the reassignment queue -- but never touches a mission with a co-assignee still standing', async () => {
    const { account, applicantId, missionId, organizationId, adminAccountId, memberAccountId } =
      await setUpAssignedOrg(db, 'deactivate');

    // A second mission, co-assigned to both the admin and the member -- a
    // deactivation must never strip the admin's own still-valid assignment.
    const coAssignedMission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Co-assigned case',
    });
    if (!isOk(coAssignedMission)) throw new Error('mission');
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: organizationId,
      missionId: coAssignedMission.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: adminAccountId, grantId: grant.value.id });
    await assignMember(db, {
      actorAccountId: adminAccountId,
      organizationId,
      memberAccountId: adminAccountId,
      missionId: coAssignedMission.value.id,
    });
    await assignMember(db, {
      actorAccountId: adminAccountId,
      organizationId,
      memberAccountId,
      missionId: coAssignedMission.value.id,
    });

    const membership = (
      await db
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.organizationId, organizationId),
            eq(schema.memberships.accountId, memberAccountId),
          ),
        )
    )[0];
    if (!membership) throw new Error('membership');

    const deactivated = await setMembershipActive(db, {
      actorAccountId: adminAccountId,
      organizationId,
      membershipId: membership.id,
      active: false,
    });
    expect(isOk(deactivated)).toBe(true);

    // Sole-assignee mission: the member's assignment is gone, and it now
    // shows up in the reassignment queue.
    const soleAssignments = await db
      .select()
      .from(schema.assignments)
      .where(
        and(
          eq(schema.assignments.missionId, missionId),
          eq(schema.assignments.memberAccountId, memberAccountId),
        ),
      );
    expect(soleAssignments).toHaveLength(0);
    const queue = await listUnassignedActiveMissions(db, organizationId);
    expect(queue.map((m) => m.missionId)).toContain(missionId);

    // Co-assigned mission: BOTH assignments survive untouched -- the admin's
    // own standing was never at risk, and the case still has a working
    // assignee (the now-deactivated member's row itself is intentionally
    // left as historical record; only a SOLE assignment is auto-removed).
    const coAssignments = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.missionId, coAssignedMission.value.id));
    expect(coAssignments).toHaveLength(2);
    expect(queue.map((m) => m.missionId)).not.toContain(coAssignedMission.value.id);
  });
});

describe('OPS-04 (Commercial V1 Part 9): evidence analytics', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function events(type: string) {
    return (await db.select().from(schema.productEvents)).filter((e) => e.eventType === type);
  }

  async function setUp() {
    const { account, applicantId } = await consentedApplicant(db, 'ops04-ev@example.com');
    const agentAcc = await provisionAccount(db, { email: 'agent-ops04-ev@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });
    return {
      account,
      applicantId,
      agentId: agentAcc.value.id,
      organizationId: org.value.id,
    };
  }

  async function request(
    s: Awaited<ReturnType<typeof setUp>>,
    message = 'last 3 months of statements for the Rahman family',
  ) {
    const req = await requestEvidence(db, {
      actorAccountId: s.agentId,
      organizationId: s.organizationId,
      applicantId: s.applicantId,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      message,
    });
    if (!isOk(req)) throw new Error('request');
    return req.value.id;
  }

  async function respond(s: Awaited<ReturnType<typeof setUp>>, requestId: string, key: string) {
    const doc = await registerDocument(db, {
      actorAccountId: s.account.id,
      applicantId: s.applicantId,
      originalName: `${key}.pdf`,
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: s.account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: `ops04-${key}`,
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    const submitted = await submitEvidenceResponse(db, {
      actorAccountId: s.account.id,
      requestId,
      documentId: doc.value.id,
    });
    if (!isOk(submitted)) throw new Error('submit');
  }

  it('records a request, each response and each send-back by organization, and none of the wording', async () => {
    const s = await setUp();
    const requestId = await request(s);
    await respond(s, requestId, 'first');
    const sentBack = await decideEvidenceResponse(db, {
      actorAccountId: s.agentId,
      requestId,
      outcome: 'NEEDS_REPLACEMENT',
      reason: 'The Rahman statement is older than three months',
    });
    expect(isOk(sentBack)).toBe(true);
    await respond(s, requestId, 'second');
    const accepted = await decideEvidenceResponse(db, {
      actorAccountId: s.agentId,
      requestId,
      outcome: 'ACCEPTED',
    });
    expect(isOk(accepted)).toBe(true);

    expect(await events('EVIDENCE_REQUESTED')).toMatchObject([
      { accountId: s.agentId, organizationId: s.organizationId, dimension: null },
    ]);
    const received = await events('EVIDENCE_RECEIVED');
    expect(received).toHaveLength(2);
    for (const event of received) {
      expect(event).toMatchObject({ accountId: s.account.id, organizationId: s.organizationId });
    }
    // Accepting is not rework: only the send-back counts.
    expect(await events('EVIDENCE_REWORK_REQUESTED')).toMatchObject([
      { accountId: s.agentId, organizationId: s.organizationId, dimension: 'NEEDS_REPLACEMENT' },
    ]);

    const stored = JSON.stringify(await db.select().from(schema.productEvents));
    for (const leaked of ['Rahman', 'statement', 'bank_statement', 'three months']) {
      expect(stored, leaked).not.toContain(leaked);
    }
  });

  it('labels each kind of send-back, for every outcome the database allows other than accepting or cancelling', async () => {
    const s = await setUp();
    const kinds = schema.evidenceRequestDecisionOutcome.enumValues.filter(
      (o) => o !== 'ACCEPTED' && o !== 'CANCELLED',
    );
    expect(kinds.length).toBeGreaterThan(0);
    for (const outcome of kinds) {
      const requestId = await request(s);
      await respond(s, requestId, outcome);
      const decided = await decideEvidenceResponse(db, {
        actorAccountId: s.agentId,
        requestId,
        outcome: outcome as 'NEEDS_REPLACEMENT' | 'CONTRADICTION' | 'CORRECTION_PROPOSED',
        reason: 'does not stand',
      });
      expect(isOk(decided), outcome).toBe(true);
    }
    const labels = (await events('EVIDENCE_REWORK_REQUESTED')).map((e) => e.dimension).sort();
    expect(labels).toEqual([...kinds].sort());
  });

  it('records nothing for a response or a decision that is refused', async () => {
    const s = await setUp();
    const requestId = await request(s);

    // A quarantined document can never answer a request.
    const unsafe = await registerDocument(db, {
      actorAccountId: s.account.id,
      applicantId: s.applicantId,
      originalName: 'unsafe.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(unsafe)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: s.account.id,
      documentId: unsafe.value.id,
      bucket: 'QUARANTINE',
      objectKey: 'ops04-unsafe',
      safetyStatus: 'QUARANTINED',
      processingStatus: 'NEEDS_ATTENTION',
    });
    const refusedResponse = await submitEvidenceResponse(db, {
      actorAccountId: s.account.id,
      requestId,
      documentId: unsafe.value.id,
    });
    // Nothing has been submitted, so there is nothing to decide yet.
    const refusedDecision = await decideEvidenceResponse(db, {
      actorAccountId: s.agentId,
      requestId,
      outcome: 'NEEDS_REPLACEMENT',
    });
    expect([isErr(refusedResponse), isErr(refusedDecision)]).toEqual([true, true]);

    expect(await events('EVIDENCE_REQUESTED')).toHaveLength(1);
    expect(await events('EVIDENCE_RECEIVED')).toEqual([]);
    expect(await events('EVIDENCE_REWORK_REQUESTED')).toEqual([]);
  });

  it('records nothing for a request that is refused', async () => {
    const s = await setUp();
    const stranger = await provisionAccount(db, { email: 'ops04-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const refused = await requestEvidence(db, {
      actorAccountId: stranger.value.id,
      organizationId: s.organizationId,
      applicantId: s.applicantId,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
    });
    expect(isErr(refused)).toBe(true);
    expect(await events('EVIDENCE_REQUESTED')).toEqual([]);
  });
});

describe('E02 agency triage mapping (Programme X WP-V4, R03)', () => {
  const statuses = schema.evidenceRequestStatus.enumValues;

  it('gives every stored request status exactly one group, or none when the request is closed', () => {
    const expected: Record<(typeof statuses)[number], string | null> = {
      OPEN: 'MISSING',
      RECEIVED: 'RECEIVED',
      UNDER_REVIEW: 'RECEIVED',
      ACCEPTED: 'REVIEWED',
      NEEDS_REPLACEMENT: 'NEEDS_CORRECTION',
      CANCELLED: null,
      // Legacy values with no current writer: never shown as Reviewed (W0 L4).
      FULFILLED: null,
      DECLINED: null,
    };
    for (const status of statuses) {
      for (const kind of ['FIELD', 'DOCUMENT'] as const) {
        expect(evidenceRequestTriageGroup({ status, kind }), `${status} ${kind}`).toBe(
          expected[status],
        );
      }
    }
  });

  it('uses the responding document only when it is known, so a received file still processing or unsafe is never Received', () => {
    const received = { status: 'RECEIVED', kind: 'DOCUMENT' } as const;
    const clean = { processingStatus: 'AWAITING_REVIEW', safetyStatus: 'CLEAN' } as const;
    expect(evidenceRequestTriageGroup(received, clean)).toBe('RECEIVED');
    for (const processingStatus of [
      'UPLOADING',
      'QUARANTINED',
      'SCANNING',
      'NORMALIZING',
      'EXTRACTING',
    ] as const) {
      expect(
        evidenceRequestTriageGroup(received, { processingStatus, safetyStatus: 'CLEAN' }),
      ).toBe('PROCESSING');
    }
    for (const safetyStatus of ['PENDING', 'SCANNING'] as const) {
      expect(
        evidenceRequestTriageGroup(received, { processingStatus: 'AWAITING_REVIEW', safetyStatus }),
      ).toBe('PROCESSING');
    }
    for (const safetyStatus of ['QUARANTINED', 'FAILED'] as const) {
      expect(
        evidenceRequestTriageGroup(received, { processingStatus: 'AWAITING_REVIEW', safetyStatus }),
      ).toBe('NEEDS_CORRECTION');
    }
    for (const processingStatus of ['NEEDS_ATTENTION', 'FAILED', 'REJECTED'] as const) {
      expect(
        evidenceRequestTriageGroup(received, { processingStatus, safetyStatus: 'CLEAN' }),
      ).toBe('NEEDS_CORRECTION');
    }
    // A document marked approved by processing is still only received: review comes from a person.
    expect(
      evidenceRequestTriageGroup(received, { processingStatus: 'APPROVED', safetyStatus: 'CLEAN' }),
    ).toBe('RECEIVED');
    // Looked up and gone (for example erased): it needs a new upload.
    expect(evidenceRequestTriageGroup(received, null)).toBe('NEEDS_CORRECTION');
    // A field answer has no document to check.
    expect(evidenceRequestTriageGroup({ status: 'RECEIVED', kind: 'FIELD' }, null)).toBe(
      'RECEIVED',
    );
    // An accepted request stays Reviewed whatever is passed: the decision was made by a person.
    expect(evidenceRequestTriageGroup({ status: 'ACCEPTED', kind: 'DOCUMENT' }, clean)).toBe(
      'REVIEWED',
    );
  });

  it('maps checklist states with reviewer decisions, and never calls received evidence reviewed', () => {
    expect(requirementTriageGroup('SATISFIED', null)).toBe('RECEIVED');
    expect(requirementTriageGroup('SATISFIED', 'ACCEPTED')).toBe('REVIEWED');
    expect(requirementTriageGroup('SATISFIED', 'REJECTED')).toBe('NEEDS_CORRECTION');
    expect(requirementTriageGroup('CRITICAL_GAP', null)).toBe('MISSING');
    expect(requirementTriageGroup('ATTENTION', null)).toBe('MISSING');
    // An old acceptance never lifts a gap that appeared later.
    expect(requirementTriageGroup('CRITICAL_GAP', 'ACCEPTED')).toBe('MISSING');
    expect(requirementTriageGroup('CONFLICTING', null)).toBe('NEEDS_CORRECTION');
    expect(requirementTriageGroup('EXPIRING_STALE', 'ACCEPTED')).toBe('NEEDS_CORRECTION');
    expect(requirementTriageGroup('UNVERIFIED', null)).toBe('NEEDS_CORRECTION');
    expect(requirementTriageGroup('NOT_APPLICABLE', 'ACCEPTED')).toBeNull();
  });

  const request = (overrides: Partial<TriageRequestInput>): TriageRequestInput => ({
    id: 'r1',
    missionId: 'm1',
    packRequirementId: 'req-passport',
    kind: 'DOCUMENT',
    fieldKey: null,
    docType: 'PASSPORT',
    status: 'OPEN',
    dueDate: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  });
  const readiness = (
    state: 'SATISFIED' | 'CRITICAL_GAP',
    overallState = state === 'SATISFIED' ? 'READY_FOR_APPLICANT_REVIEW' : 'NEEDS_ACTION',
  ) => ({
    overallState,
    requirementResults: [
      {
        packRequirementId: 'req-passport',
        kind: 'DOCUMENT' as const,
        key: 'PASSPORT',
        optional: false,
        state,
      },
    ],
  });

  it('follows one item through request, receipt, replacement, a new receipt and review with the summary agreeing at each step', () => {
    const steps: readonly [string, Parameters<typeof summarizeCaseTriage>[0], string, string][] = [
      [
        'asked for',
        {
          missionId: 'm1',
          manualMode: false,
          readiness: readiness('CRITICAL_GAP'),
          decisions: [],
          requests: [request({ status: 'OPEN' })],
        },
        'MISSING',
        'NOT_READY',
      ],
      [
        'received',
        {
          missionId: 'm1',
          manualMode: false,
          readiness: readiness('SATISFIED'),
          decisions: [],
          requests: [request({ status: 'RECEIVED' })],
        },
        'RECEIVED',
        'READY_FOR_REVIEW',
      ],
      [
        'sent back',
        {
          missionId: 'm1',
          manualMode: false,
          readiness: readiness('CRITICAL_GAP'),
          decisions: [],
          requests: [request({ status: 'NEEDS_REPLACEMENT' })],
        },
        'NEEDS_CORRECTION',
        'NOT_READY',
      ],
      [
        'received again, review started',
        {
          missionId: 'm1',
          manualMode: false,
          readiness: readiness('SATISFIED'),
          decisions: [],
          requests: [request({ status: 'UNDER_REVIEW' })],
        },
        'RECEIVED',
        'READY_FOR_REVIEW',
      ],
      [
        'accepted',
        {
          missionId: 'm1',
          manualMode: false,
          readiness: readiness('SATISFIED'),
          decisions: [],
          requests: [request({ status: 'ACCEPTED' })],
        },
        'REVIEWED',
        'READY_FOR_REVIEW',
      ],
    ];
    for (const [label, input, group, state] of steps) {
      const summary = summarizeCaseTriage(input);
      expect(summary.items, label).toHaveLength(1);
      expect(summary.items[0]?.group, label).toBe(group);
      expect(summary.counts[group as (typeof TRIAGE_GROUPS)[number]], label).toBe(1);
      expect(summary.state, label).toBe(state);
    }
  });

  it('never shows Ready for review while something on the case is still missing or waiting, even if the checklist is complete', () => {
    const withExtraOpen = summarizeCaseTriage({
      missionId: 'm1',
      manualMode: false,
      readiness: readiness('SATISFIED'),
      decisions: [],
      requests: [
        request({
          id: 'r-extra',
          packRequirementId: null,
          docType: 'BANK_STATEMENT',
          status: 'OPEN',
        }),
      ],
    });
    expect(withExtraOpen.state).toBe('NOT_READY');
    expect(withExtraOpen.counts.MISSING).toBe(1);
    expect(withExtraOpen.counts.RECEIVED).toBe(1);
    // A case checked by hand never gets the claim, and a case with no checklist has nothing to measure.
    expect(
      summarizeCaseTriage({
        missionId: 'm1',
        manualMode: true,
        readiness: null,
        decisions: [],
        requests: [],
      }).state,
    ).toBe('CHECKED_BY_HAND');
    expect(
      summarizeCaseTriage({
        missionId: 'm1',
        manualMode: false,
        readiness: null,
        decisions: [],
        requests: [],
      }).state,
    ).toBe('NO_CHECKLIST');
  });

  it('counts only requests that name this case, uses the newest live request per item, and is stable', () => {
    const input = {
      missionId: 'm1',
      manualMode: false,
      readiness: readiness('CRITICAL_GAP'),
      decisions: [
        {
          packRequirementId: 'req-passport',
          outcome: 'REJECTED' as const,
          createdAt: '2026-10-02T00:00:00.000Z',
        },
        {
          packRequirementId: 'req-passport',
          outcome: 'ACCEPTED' as const,
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      requests: [
        // Another case of the same traveller, and a request for the traveller in general.
        request({ id: 'r-other', missionId: 'm2', status: 'RECEIVED' }),
        request({ id: 'r-wide', missionId: null, packRequirementId: null, status: 'OPEN' }),
        // Closed requests are history only.
        request({ id: 'r-old', status: 'CANCELLED', createdAt: '2026-09-01T00:00:00.000Z' }),
        request({
          id: 'r-new',
          status: 'RECEIVED',
          createdAt: '2026-10-05T00:00:00.000Z',
          dueDate: '2026-10-20T00:00:00.000Z',
        }),
        request({
          id: 'r-mid',
          status: 'NEEDS_REPLACEMENT',
          createdAt: '2026-10-03T00:00:00.000Z',
        }),
      ],
    };
    const summary = summarizeCaseTriage(input);
    expect(summary.items.map((item) => [item.key, item.group, item.requestId])).toEqual([
      ['requirement:req-passport', 'RECEIVED', 'r-new'],
    ]);
    expect(summary.items[0]?.dueDate).toBe('2026-10-20T00:00:00.000Z');
    expect(summary.items[0]?.indicators).toEqual([]);
    // With no live request, the latest reviewer decision decides.
    const decisionOnly = summarizeCaseTriage({ ...input, requests: [] });
    expect(decisionOnly.items[0]?.group).toBe('NEEDS_CORRECTION');
    expect(decisionOnly.items[0]?.indicators).toEqual(['NOT_ACCEPTED']);
    // Same input in any order gives the same summary.
    expect(summarizeCaseTriage({ ...input, requests: [...input.requests].reverse() })).toEqual(
      summary,
    );
  });

  it('uses the answered file state when the caller has it, so an unsafe or gone file is never Received', () => {
    const base = {
      missionId: 'm1',
      manualMode: false,
      readiness: readiness('SATISFIED'),
      decisions: [],
      requests: [request({ id: 'r1', status: 'RECEIVED' })],
    };
    expect(summarizeCaseTriage(base).items[0]?.group).toBe('RECEIVED');
    const unsafe = summarizeCaseTriage({
      ...base,
      documentStates: new Map([
        ['r1', { processingStatus: 'NEEDS_ATTENTION', safetyStatus: 'QUARANTINED' } as const],
      ]),
    });
    expect(unsafe.items[0]?.group).toBe('NEEDS_CORRECTION');
    expect(unsafe.items[0]?.indicators).toEqual(['COULD_NOT_BE_USED']);
    expect(unsafe.state).toBe('NOT_READY');
    const gone = summarizeCaseTriage({ ...base, documentStates: new Map([['r1', null]]) });
    expect(gone.items[0]?.group).toBe('NEEDS_CORRECTION');
    const checking = summarizeCaseTriage({
      ...base,
      documentStates: new Map([
        ['r1', { processingStatus: 'SCANNING', safetyStatus: 'PENDING' } as const],
      ]),
    });
    expect(checking.items[0]?.group).toBe('PROCESSING');
    expect(checking.state).toBe('NOT_READY');
  });

  describe('case open date', () => {
    let db: Db;
    beforeEach(async () => {
      db = await freshDb();
    });

    it('reports the case open date with the other case fields, for stable ordering', async () => {
      const { account, applicantId } = await consentedApplicant(db, 'triage-created@example.com');
      const mission = await createMission(db, {
        actorAccountId: account.id,
        applicantId,
        title: 'Created at',
      });
      if (!isOk(mission)) throw new Error('mission');
      const agentAcc = await provisionAccount(db, { email: 'triage-created-agent@acme.com' });
      if (!isOk(agentAcc)) throw new Error('provision');
      const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
      if (!isOk(org)) throw new Error('org');
      await activateOrg(db, org.value.id);
      const grant = await createGrant(db, {
        actorAccountId: account.id,
        applicantId,
        recipientOrganizationId: org.value.id,
        actions: ['MANAGE'],
        purpose: 'collaboration',
      });
      if (!isOk(grant)) throw new Error('grant');
      await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });
      const { missions } = await listVisibleMissionsForMember(db, org.value.id, agentAcc.value.id);
      expect(missions[0]?.createdAt).toBe(mission.value.createdAt.toISOString());
    });
  });

  describe('responding document state (gated)', () => {
    let db: Db;
    beforeEach(async () => {
      db = await freshDb();
    });

    it('reads the newest version of each answered file, so an unsafe or erased newer version never reads as Received, for administrators only', async () => {
      const { account, applicantId } = await consentedApplicant(db, 'triage-doc@example.com');
      const mission = await createMission(db, {
        actorAccountId: account.id,
        applicantId,
        title: 'Triage doc case',
      });
      if (!isOk(mission)) throw new Error('mission');
      const agentAcc = await provisionAccount(db, { email: 'triage-doc-agent@acme.com' });
      if (!isOk(agentAcc)) throw new Error('provision');
      const memberAcc = await provisionAccount(db, { email: 'triage-doc-member@acme.com' });
      if (!isOk(memberAcc)) throw new Error('provision');
      const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
      if (!isOk(org)) throw new Error('org');
      await activateOrg(db, org.value.id);
      await addMembership(db, {
        actorAccountId: agentAcc.value.id,
        organizationId: org.value.id,
        accountId: memberAcc.value.id,
        role: 'CASE_MANAGER',
      });
      const grant = await createGrant(db, {
        actorAccountId: account.id,
        applicantId,
        recipientOrganizationId: org.value.id,
        actions: ['MANAGE'],
        purpose: 'collaboration',
      });
      if (!isOk(grant)) throw new Error('grant');
      await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });
      const organizationId = org.value.id;
      const agentId = agentAcc.value.id;

      async function answered(missionId: string | undefined, key: string) {
        const req = await requestEvidence(db, {
          actorAccountId: agentId,
          organizationId,
          applicantId,
          ...(missionId ? { missionId } : {}),
          kind: 'DOCUMENT',
          docType: 'bank_statement',
        });
        if (!isOk(req)) throw new Error('request');
        const doc = await registerDocument(db, {
          actorAccountId: account.id,
          applicantId,
          originalName: `${key}.pdf`,
          docType: 'bank_statement',
        });
        if (!isOk(doc)) throw new Error('doc');
        await addDocumentVersion(db, {
          actorAccountId: account.id,
          documentId: doc.value.id,
          bucket: 'CLEAN',
          objectKey: `k-${key}`,
          safetyStatus: 'CLEAN',
          processingStatus: 'AWAITING_REVIEW',
        });
        const submitted = await submitEvidenceResponse(db, {
          actorAccountId: account.id,
          requestId: req.value.id,
          documentId: doc.value.id,
        });
        if (!isOk(submitted)) throw new Error('submit');
        return { requestId: req.value.id, documentId: doc.value.id };
      }
      const wide = await answered(undefined, 'wide');
      const onCase = await answered(mission.value.id, 'case');
      // A newer version of the general request's file fails the safety check.
      await addDocumentVersion(db, {
        actorAccountId: account.id,
        documentId: wide.documentId,
        bucket: 'QUARANTINE',
        objectKey: 'k-wide-2',
        safetyStatus: 'QUARANTINED',
        processingStatus: 'NEEDS_ATTENTION',
      });

      const proof = async (
        accountId: string,
        ref: { applicantId: string } | { missionId: string },
      ) => {
        const result = await requireAccess(db, accountPrincipal(accountId), 'MANAGE', ref, {
          purpose: EACH_GRANT,
          actingFor: { organizationId },
        });
        if (!isOk(result)) throw new Error(`access refused: ${result.error.message}`);
        return result.value;
      };

      const forTraveller = await listRespondingDocumentStatesForOrg(
        await proof(agentId, { applicantId }),
        organizationId,
      );
      expect([...forTraveller.keys()]).toEqual([wide.requestId]);
      const wideState = forTraveller.get(wide.requestId);
      expect(wideState).toEqual({
        processingStatus: 'NEEDS_ATTENTION',
        safetyStatus: 'QUARANTINED',
      });
      expect(evidenceRequestTriageGroup({ status: 'RECEIVED', kind: 'DOCUMENT' }, wideState)).toBe(
        'NEEDS_CORRECTION',
      );

      const forCase = await listRespondingDocumentStatesForOrg(
        await proof(agentId, { missionId: mission.value.id }),
        organizationId,
      );
      expect([...forCase.entries()]).toEqual([
        [onCase.requestId, { processingStatus: 'AWAITING_REVIEW', safetyStatus: 'CLEAN' }],
      ]);

      // A member who is not an administrator gets nothing, with no error.
      const asMember = await listRespondingDocumentStatesForOrg(
        await proof(memberAcc.value.id, { missionId: mission.value.id }),
        organizationId,
      );
      expect(asMember.size).toBe(0);
      // A proof for another organization, or a forged one, gets nothing.
      expect(
        (
          await listRespondingDocumentStatesForOrg(
            await proof(agentId, { applicantId }),
            'other-org',
          )
        ).size,
      ).toBe(0);
      const forged = {
        tx: db,
        actor: { kind: 'organization_member' },
      } as unknown as AuthorizedApplicant<'MANAGE'>;
      expect((await listRespondingDocumentStatesForOrg(forged, organizationId)).size).toBe(0);
    });
  });
});
