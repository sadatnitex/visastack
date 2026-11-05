import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { CASE_KEPT_REASONS, deleteCancelledMission } from './case-deletion';
import { fileComplaint } from './complaints';
import { setConsent } from './consent';
import type { Db } from './db';
import { placeLegalHold, releaseLegalHold } from './legal-hold';
import { createMission, transitionMission } from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import { acceptGrant, createGrant } from './sharing';

/** What the web layer does: prove the caller may manage this case, then ask for the deletion. */
async function remove(db: Db, accountId: string, missionId: string) {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { missionId },
    { purpose: 'owner_delete_cancelled_case' },
  );
  if (!access.ok) return access;
  return deleteCancelledMission(access.value);
}

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function account(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  await setConsent(db, {
    actorAccountId: provisioned.value.id,
    accountId: provisioned.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  return provisioned.value;
}

describe('deleteCancelledMission (the owner deletes a cancelled case)', () => {
  let db: Db;
  let ownerId: string;
  let applicantId: string;

  beforeEach(async () => {
    db = await freshDb();
    ownerId = (await account(db, 'owner@example.com')).id;
    const applicant = await createApplicant(db, {
      actorAccountId: ownerId,
      ownerAccountId: ownerId,
      displayName: 'Owner',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    applicantId = applicant.value.id;
  });

  async function cancelledCase(title = 'Cancelled trip'): Promise<string> {
    const created = await createMission(db, { actorAccountId: ownerId, applicantId, title });
    if (!isOk(created)) throw new Error('setup');
    const cancelled = await transitionMission(db, {
      actorAccountId: ownerId,
      missionId: created.value.id,
      to: 'CANCELLED',
    });
    if (!isOk(cancelled)) throw new Error('setup');
    return created.value.id;
  }

  const rowCount = async (missionId: string) =>
    (await db.select().from(schema.missions).where(eq(schema.missions.id, missionId))).length;

  it('removes the case and what hangs off it, and leaves the person and their other cases alone', async () => {
    const missionId = await cancelledCase();
    const other = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'Still going',
    });
    if (!isOk(other)) throw new Error('setup');
    await db
      .insert(schema.missionNotes)
      .values({ missionId, authorAccountId: ownerId, body: 'a note' });
    await db.insert(schema.missionTasks).values({ missionId, description: 'a task' });
    await db
      .insert(schema.missionSnapshots)
      .values({ missionId, version: 1, content: {}, checksum: 'abc' });

    const deleted = await remove(db, ownerId, missionId);
    expect(isOk(deleted)).toBe(true);

    expect(await rowCount(missionId)).toBe(0);
    for (const table of [
      schema.missionNotes,
      schema.missionTasks,
      schema.missionSnapshots,
    ] as const) {
      expect(await db.select().from(table).where(eq(table.missionId, missionId))).toEqual([]);
    }
    // The person and the other case are untouched.
    expect(await rowCount(other.value.id)).toBe(1);
    expect(
      (await db.select().from(schema.applicants).where(eq(schema.applicants.id, applicantId)))
        .length,
    ).toBe(1);
  });

  it('records who deleted it, and what it was, in the audit trail', async () => {
    const missionId = await cancelledCase('Trip to keep a record of');
    expect(isOk(await remove(db, ownerId, missionId))).toBe(true);
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'MISSION_DELETED_BY_OWNER'));
    expect(events).toHaveLength(1);
    expect(events[0]?.actorAccountId).toBe(ownerId);
    expect(events[0]?.missionId).toBe(missionId);
    expect(events[0]?.metadata).toMatchObject({
      title: 'Trip to keep a record of',
      state: 'CANCELLED',
    });
  });

  it('keeps the agency invitation that created the case and only clears its pointer', async () => {
    const missionId = await cancelledCase();
    const org = await createOrganization(db, { actorAccountId: ownerId, name: 'Agency' });
    if (!isOk(org)) throw new Error('setup');
    const [invitation] = await db
      .insert(schema.clientInvitations)
      .values({
        organizationId: org.value.id,
        caseOwnerAccountId: ownerId,
        displayName: 'Owner',
        contactDestination: 'owner@example.com',
        tokenHash: 'hash-1',
        status: 'ACCEPTED',
        invitedByAccountId: ownerId,
        acceptedByAccountId: ownerId,
        acceptedApplicantId: applicantId,
        acceptedMissionId: missionId,
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: schema.clientInvitations.id });
    if (!invitation) throw new Error('setup');

    expect(isOk(await remove(db, ownerId, missionId))).toBe(true);
    const [kept] = await db
      .select()
      .from(schema.clientInvitations)
      .where(eq(schema.clientInvitations.id, invitation.id));
    expect(kept?.acceptedMissionId).toBeNull();
    expect(kept?.status).toBe('ACCEPTED');
  });

  it('is for the owner only, and changes nothing for anyone else', async () => {
    const missionId = await cancelledCase();
    const stranger = await account(db, 'stranger@example.com');
    const result = await remove(db, stranger.id, missionId);
    expect(isOk(result)).toBe(false);
    if (!isOk(result)) expect(result.error.code).toBe('forbidden');
    expect(await rowCount(missionId)).toBe(1);
  });

  it('is not something an agency can do for the owner, even with a MANAGE grant on the case', async () => {
    const missionId = await cancelledCase();
    await setConsent(db, {
      actorAccountId: ownerId,
      accountId: ownerId,
      type: 'SHARING',
      granted: true,
    });
    const agent = await account(db, 'agent@example.com');
    const org = await createOrganization(db, { actorAccountId: agent.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('setup');
    const reviewer = await account(db, 'reviewer@example.com');
    await reviewOrganization(db, {
      reviewerAccountId: reviewer.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: ownerId,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'case_management',
    });
    if (!isOk(grant)) throw new Error('setup');
    await acceptGrant(db, { actorAccountId: agent.id, grantId: grant.value.id });

    const result = await remove(db, agent.id, missionId);
    expect(isOk(result)).toBe(false);
    if (!isOk(result)) expect(result.error.code).toBe('forbidden');
    expect(await rowCount(missionId)).toBe(1);
  });

  it('refuses a case that is not cancelled, including one that finished normally', async () => {
    const draft = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'Alive',
    });
    if (!isOk(draft)) throw new Error('setup');
    const refused = await remove(db, ownerId, draft.value.id);
    expect(isOk(refused)).toBe(false);
    if (!isOk(refused)) expect(refused.error.message).toBe(CASE_KEPT_REASONS.state);
    expect(await rowCount(draft.value.id)).toBe(1);
  });

  it('refuses a case that is already gone', async () => {
    const missionId = await cancelledCase();
    expect(isOk(await remove(db, ownerId, missionId))).toBe(true);
    const again = await remove(db, ownerId, missionId);
    expect(isOk(again)).toBe(false);
    if (!isOk(again)) expect(again.error.code).toBe('not_found');
  });

  it('refuses while a legal hold covers the person or the case, and changes nothing', async () => {
    const missionId = await cancelledCase();
    const placed = await placeLegalHold(db, {
      actorAccountId: ownerId,
      applicantId,
      reason: 'a hold',
      reviewAt: new Date(Date.now() + 86_400_000),
      stepUpSatisfied: true,
      missionId,
    });
    if (!isOk(placed)) throw new Error('setup');
    const refused = await remove(db, ownerId, missionId);
    expect(isOk(refused)).toBe(false);
    if (!isOk(refused)) expect(refused.error.message).toBe(CASE_KEPT_REASONS.hold);
    expect(await rowCount(missionId)).toBe(1);
    // The hold record is still there.
    expect(
      (await db.select().from(schema.legalHolds).where(eq(schema.legalHolds.missionId, missionId)))
        .length,
    ).toBe(1);
  });

  it('still refuses once the hold is released: the hold record names the case and would go with it', async () => {
    const missionId = await cancelledCase();
    const placed = await placeLegalHold(db, {
      actorAccountId: ownerId,
      applicantId,
      reason: 'a hold',
      reviewAt: new Date(Date.now() + 86_400_000),
      stepUpSatisfied: true,
      missionId,
    });
    if (!isOk(placed)) throw new Error('setup');
    const released = await releaseLegalHold(db, {
      actorAccountId: ownerId,
      holdId: placed.value.id,
      stepUpSatisfied: true,
    });
    if (!isOk(released)) throw new Error('setup');
    const refused = await remove(db, ownerId, missionId);
    expect(isOk(refused)).toBe(false);
    if (!isOk(refused)) expect(refused.error.message).toBe(CASE_KEPT_REASONS.hold);
    expect(await rowCount(missionId)).toBe(1);
  });

  it('refuses while the case is still shared or has a request that is open, and says what to do first', async () => {
    // A pending invitation to share this case.
    const invited = await cancelledCase('Invited');
    await db.insert(schema.sharingInvitations).values({
      missionId: invited,
      applicantId,
      invitedByAccountId: ownerId,
      email: 'someone@example.com',
      tokenHash: 'invite-1',
      purpose: 'case_management',
      actions: ['VIEW_METADATA'],
      grantExpiryAt: new Date(Date.now() + 86_400_000),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    // A request for a document that is still waiting.
    const asked = await cancelledCase('Asked');
    await db.insert(schema.contributorRequests).values({
      missionId: asked,
      applicantId,
      requestedByAccountId: ownerId,
      contributorEmail: 'helper@example.com',
      docType: 'PASSPORT',
      purpose: 'a document for the case',
      tokenHash: 'ask-1',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    for (const missionId of [invited, asked]) {
      const refused = await remove(db, ownerId, missionId);
      expect(isOk(refused), missionId).toBe(false);
      if (!isOk(refused)) expect(refused.error.message).toBe(CASE_KEPT_REASONS.shared);
      expect(await rowCount(missionId), missionId).toBe(1);
    }
  });

  it('refuses a case that was already purged by retention, in plain words', async () => {
    const missionId = await cancelledCase();
    await db
      .update(schema.missions)
      .set({ purgedAt: new Date(), title: '[case data purged]' })
      .where(eq(schema.missions.id, missionId));
    const refused = await remove(db, ownerId, missionId);
    expect(isOk(refused)).toBe(false);
    if (!isOk(refused)) expect(refused.error.message).toBe(CASE_KEPT_REASONS.gone);
    expect(await rowCount(missionId)).toBe(1);
  });

  it('refuses while a legal hold covers the whole person, not just this case', async () => {
    const missionId = await cancelledCase();
    const placed = await placeLegalHold(db, {
      actorAccountId: ownerId,
      applicantId,
      reason: 'a hold on the whole person',
      reviewAt: new Date(Date.now() + 86_400_000),
      stepUpSatisfied: true,
    });
    if (!isOk(placed)) throw new Error('setup');
    const refused = await remove(db, ownerId, missionId);
    expect(isOk(refused)).toBe(false);
    if (!isOk(refused)) expect(refused.error.message).toBe(CASE_KEPT_REASONS.hold);
    expect(await rowCount(missionId)).toBe(1);
  });

  it('keeps the case and writes no audit event when the delete itself fails (all or nothing)', async () => {
    const missionId = await cancelledCase();
    // A failing delete: a trigger that refuses the case row's deletion.
    await db.execute(
      sql`create function refuse_case_delete() returns trigger as $$ begin raise exception 'blocked for the test'; end; $$ language plpgsql`,
    );
    await db.execute(
      sql`create trigger refuse_case_delete before delete on missions for each row execute function refuse_case_delete()`,
    );
    await expect(remove(db, ownerId, missionId)).rejects.toThrow();
    expect(await rowCount(missionId)).toBe(1);
    expect(
      await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'MISSION_DELETED_BY_OWNER')),
    ).toEqual([]);
  });

  it('refuses a case that has a complaint, an outcome, a submission report or feedback', async () => {
    const withComplaint = await cancelledCase('Complaint');
    expect(
      isOk(
        await fileComplaint(db, {
          actorAccountId: ownerId,
          missionId: withComplaint,
          description: 'a complaint',
        }),
      ),
    ).toBe(true);

    const withOutcome = await cancelledCase('Outcome');
    await db.insert(schema.missionOutcomes).values({
      missionId: withOutcome,
      decision: 'REFUSED',
      decisionDate: new Date(),
      actorAccountId: ownerId,
      authAssuranceContext: {},
    });

    const withFeedback = await cancelledCase('Feedback');
    await db.insert(schema.caseFeedback).values({
      missionId: withFeedback,
      submittedByAccountId: ownerId,
      comments: 'slow',
    });

    const withSubmission = await cancelledCase('Submission');
    const [snapshot] = await db
      .insert(schema.missionSnapshots)
      .values({ missionId: withSubmission, version: 1, content: {}, checksum: 'abc' })
      .returning({ id: schema.missionSnapshots.id });
    if (!snapshot) throw new Error('setup');
    await db.insert(schema.missionSubmissions).values({
      missionId: withSubmission,
      snapshotId: snapshot.id,
      actorAccountId: ownerId,
      channel: 'EMAIL',
      externalReportDescription: 'sent',
      submittedAt: new Date(),
      authAssuranceContext: {},
    });

    for (const missionId of [withComplaint, withOutcome, withFeedback, withSubmission]) {
      const refused = await remove(db, ownerId, missionId);
      expect(isOk(refused), missionId).toBe(false);
      if (!isOk(refused)) expect(refused.error.message).toBe(CASE_KEPT_REASONS.record);
      expect(await rowCount(missionId), missionId).toBe(1);
    }
  });
});
