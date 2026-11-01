import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { type StaffScope, accountPrincipal, staffPrincipal } from '../../access/principal';
import { type AuthorizedApplicant, requireAccess } from '../../access/require-access';
import { systemScopeForTest } from '../../access/system-scope.test-support';
import { provisionAccount } from '../../accounts';
import { createApplicant } from '../../applicants';
import { setConsent } from '../../consent';
import type { Db } from '../../db';
import { addDocumentVersion, registerDocument } from '../../documents';
import { placeLegalHold } from '../../legal-hold';
import { attachPackVersion, createMission, listTasks, selectEvidence } from '../../missions';
import { createOrganization, reviewOrganization } from '../../organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from '../../packs';
import { acceptGrant, createGrant } from '../../sharing';
import {
  REMOVAL_DECLINE_CODES,
  REMOVAL_QUEUE_PAGE,
  REMOVAL_REQUEST_REASONS,
  REMOVAL_REQUEST_REFUSALS,
  addWorkingDays,
  cancelRemovalRequest,
  decideRemovalRequest,
  listRemovalQueue,
  pendingRemovalRequests,
  requestRemoval,
  sweepRemovalRequests,
  workingDaysBetween,
} from './index';

const HEAVY = 90_000;
const STAFF_EMAIL = 'removal-staff@example.com';

async function freshDb(options: { readonly withoutLifecycle?: boolean } = {}): Promise<Db> {
  const client = await createMigratedPglite();
  if (options.withoutLifecycle) {
    // The database as production had it before migration 0113.
    await client.exec(
      'drop table document_removal_requests, document_lifecycle, applicant_lifecycle, deletion_receipts cascade',
    );
  }
  return drizzle(client, { schema }) as unknown as Db;
}

interface Owner {
  readonly accountId: string;
  readonly applicantId: string;
}

async function seedOwner(db: Db, email: string): Promise<Owner> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: accountId, accountId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: 'Synthetic Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId, applicantId: applicant.value.id };
}

let keyCounter = 0;

async function addDocument(
  db: Db,
  owner: Owner,
  name: string,
  options: { readonly withFile?: boolean } = {},
): Promise<string> {
  const doc = await registerDocument(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    originalName: name,
    docType: 'PASSPORT',
  });
  if (!isOk(doc)) throw new Error('document');
  if (options.withFile ?? true) {
    keyCounter += 1;
    const version = await addDocumentVersion(db, {
      actorAccountId: owner.accountId,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: `removal-test-${keyCounter}`,
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    if (!isOk(version)) throw new Error(`version: ${version.error.code}`);
  }
  return doc.value.id;
}

async function manage(db: Db, owner: Owner): Promise<AuthorizedApplicant<'MANAGE'>> {
  const result = await requireAccess(
    db,
    accountPrincipal(owner.accountId),
    'MANAGE',
    { applicantId: owner.applicantId },
    { purpose: 'self' },
  );
  if (!result.ok) throw new Error(`proof: ${result.error.code}`);
  return result.value;
}

async function staffAccount(db: Db): Promise<string> {
  const account = await provisionAccount(db, { email: STAFF_EMAIL });
  if (!isOk(account)) throw new Error('staff');
  return account.value.id;
}

async function decider(db: Db, accountId: string): Promise<StaffScope<'RETENTION_PURGE'>> {
  const scope = await staffPrincipal(
    db,
    { accountId, email: STAFF_EMAIL, bootstrapEmails: [STAFF_EMAIL] },
    'RETENTION_PURGE',
  );
  if (!scope.ok) throw new Error('staff scope');
  return scope.value;
}

async function reader(db: Db, accountId: string): Promise<StaffScope<'APPLICANT_DIRECTORY_VIEW'>> {
  const scope = await staffPrincipal(
    db,
    { accountId, email: STAFF_EMAIL, bootstrapEmails: [STAFF_EMAIL] },
    'APPLICANT_DIRECTORY_VIEW',
  );
  if (!scope.ok) throw new Error('reader scope');
  return scope.value;
}

/** A published case for `owner` asking for a passport, with `documentId` selected. */
async function caseUsing(db: Db, owner: Owner, documentId: string, title: string) {
  const pack = await createPack(db, {
    actorAccountId: owner.accountId,
    key: `removal.${title.replace(/\W/g, '').toLowerCase()}.${keyCounter++}`,
    name: 'P',
  });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, {
    actorAccountId: owner.accountId,
    packId: pack.value.id,
  });
  if (!isOk(version)) throw new Error('version');
  const requirement = await addRequirement(db, {
    actorAccountId: owner.accountId,
    packVersionId: version.value.id,
    kind: 'DOCUMENT',
    docType: 'PASSPORT',
    citation: 'rule 1',
  });
  if (!isOk(requirement)) throw new Error('requirement');
  await approvePackVersion(db, {
    actorAccountId: owner.accountId,
    packVersionId: version.value.id,
  });
  await publishPackVersion(db, {
    actorAccountId: owner.accountId,
    packVersionId: version.value.id,
  });
  const mission = await createMission(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    title,
  });
  if (!isOk(mission)) throw new Error('mission');
  await attachPackVersion(db, {
    actorAccountId: owner.accountId,
    missionId: mission.value.id,
    packVersionId: version.value.id,
  });
  const selected = await selectEvidence(db, {
    actorAccountId: owner.accountId,
    missionId: mission.value.id,
    packRequirementId: requirement.value.id,
    documentId,
  });
  if (!isOk(selected)) throw new Error(`select: ${selected.error.code}`);
  return mission.value.id;
}

/** An active agency whose member holds a MANAGE grant on `owner`'s record. */
async function agencyWithGrant(db: Db, owner: Owner, missionId?: string) {
  const agent = await provisionAccount(db, { email: `agent-${keyCounter++}@example.com` });
  if (!isOk(agent)) throw new Error('agent');
  const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
  if (!isOk(org)) throw new Error('org');
  const reviewer = await provisionAccount(db, { email: `reviewer-${keyCounter++}@example.com` });
  if (!isOk(reviewer)) throw new Error('reviewer');
  await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  const grant = await createGrant(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    recipientOrganizationId: org.value.id,
    actions: ['MANAGE'],
    purpose: 'review',
    ...(missionId ? { missionId } : {}),
  });
  if (!isOk(grant)) throw new Error(`grant: ${grant.error.code}`);
  await acceptGrant(db, { actorAccountId: agent.value.id, grantId: grant.value.id });
  return { agentAccountId: agent.value.id, organizationId: org.value.id };
}

async function requestRow(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(schema.documentRemovalRequests)
    .where(eq(schema.documentRemovalRequests.id, id));
  return row;
}

async function notificationsFor(db: Db, accountId: string) {
  return db
    .select({
      eventType: schema.notifications.eventType,
      channel: schema.notifications.channel,
      payload: sql<{
        subject: string;
        summary: string;
        deepLinkPath: string;
      }>`${schema.notifications.payload}`,
    })
    .from(schema.notifications)
    .where(eq(schema.notifications.recipientAccountId, accountId));
}

describe('the fixed lists', () => {
  it('match the database CHECK lists of migration 0113', () => {
    expect([...REMOVAL_REQUEST_REASONS]).toEqual([...schema.REMOVAL_REQUEST_REASONS]);
    expect([...REMOVAL_DECLINE_CODES, 'APPROVED'].sort()).toEqual(
      [...schema.REMOVAL_DECISION_CODES].sort(),
    );
  });
});

describe('working days', () => {
  it('skips Saturdays and Sundays', () => {
    // Friday 6 Nov 2026, 10:00 UTC.
    const friday = new Date('2026-11-06T10:00:00Z');
    expect(addWorkingDays(friday, 1).toISOString()).toBe('2026-11-09T10:00:00.000Z');
    expect(addWorkingDays(friday, 3).toISOString()).toBe('2026-11-11T10:00:00.000Z');
    expect(workingDaysBetween(friday, new Date('2026-11-11T10:00:00Z'))).toBe(3);
    expect(workingDaysBetween(friday, new Date('2026-11-11T09:59:00Z'))).toBe(2);
    expect(workingDaysBetween(friday, friday)).toBe(0);
  });
});

describe('removal requests with the lifecycle tables missing', () => {
  it(
    'refuses a request, lists nothing and decides nothing',
    async () => {
      const db = await freshDb({ withoutLifecycle: true });
      const owner = await seedOwner(db, 'missing-owner@example.com');
      const doc = await addDocument(db, owner, 'passport.pdf');
      const proof = await manage(db, owner);
      const asked = await requestRemoval(proof, { documentId: doc, reason: 'NO_LONGER_NEEDED' });
      expect(asked.ok).toBe(false);
      if (!asked.ok) expect(asked.error.message).toBe(REMOVAL_REQUEST_REFUSALS.unavailable);
      expect((await pendingRemovalRequests(proof, [doc])).size).toBe(0);
      const staffId = await staffAccount(db);
      const queue = await listRemovalQueue(await reader(db, staffId), { db });
      expect(queue.ok && queue.value.rows.length).toBe(0);
      const decided = await decideRemovalRequest(
        await decider(db, staffId),
        { id: '00000000-0000-4000-8000-000000000000', decision: 'APPROVE', stepUpSatisfied: true },
        { db },
      );
      expect(decided.ok).toBe(false);
      const swept = await sweepRemovalRequests(
        systemScopeForTest('process-notification-sweeps'),
        db,
        {
          alerts: true,
          alertAfterWorkingDays: 3,
        },
      );
      expect(swept.ok && swept.value).toEqual({ completed: 0, kept: 0, alerted: 0 });
      expect(
        await db
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(eq(schema.documents.id, doc)),
      ).toHaveLength(1);
    },
    HEAVY,
  );
});

describe('removal requests with the lifecycle tables', () => {
  let db: Db;
  let owner: Owner;
  let staffId: string;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedOwner(db, 'removal-owner@example.com');
    staffId = await staffAccount(db);
  }, HEAVY);

  it(
    'the owner asks once; a second request, an agency member and a read-level proof are refused',
    async () => {
      const doc = await addDocument(db, owner, 'My Secret Passport.pdf');
      const proof = await manage(db, owner);
      const asked = await requestRemoval(proof, { documentId: doc, reason: 'PRIVACY_CONCERN' });
      expect(asked.ok).toBe(true);
      if (!asked.ok) return;
      expect(asked.value.documentCode).toMatch(/^D-/);
      const again = await requestRemoval(proof, { documentId: doc, reason: 'OTHER' });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.message).toBe(REMOVAL_REQUEST_REFUSALS.alreadyPending);
      expect((await pendingRemovalRequests(proof, [doc])).get(doc)).toBe(asked.value.id);

      // No free text anywhere: the row holds codes, a reason key and dates only.
      const row = await requestRow(db, asked.value.id);
      expect(JSON.stringify(row)).not.toContain('Secret');
      expect(row?.reason).toBe('PRIVACY_CONCERN');

      const other = await addDocument(db, owner, 'other.pdf');
      const agency = await agencyWithGrant(db, owner);
      const agencyProof = await requireAccess(
        db,
        accountPrincipal(agency.agentAccountId),
        'MANAGE',
        { applicantId: owner.applicantId },
        { purpose: 'review' },
      );
      expect(isOk(agencyProof)).toBe(true);
      if (!isOk(agencyProof)) return;
      const byAgency = await requestRemoval(agencyProof.value, {
        documentId: other,
        reason: 'NO_LONGER_NEEDED',
      });
      expect(byAgency.ok).toBe(false);
      if (!byAgency.ok) expect(byAgency.error.code).toBe('forbidden');
      expect((await pendingRemovalRequests(agencyProof.value, [doc])).size).toBe(0);

      const reading = await requireAccess(
        db,
        accountPrincipal(owner.accountId),
        'VIEW_METADATA',
        { applicantId: owner.applicantId },
        { purpose: 'self' },
      );
      if (!isOk(reading)) throw new Error('reading');
      const byReader = await requestRemoval(
        reading.value as unknown as AuthorizedApplicant<'MANAGE'>,
        { documentId: other, reason: 'NO_LONGER_NEEDED' },
      );
      expect(byReader.ok).toBe(false);

      // A stranger's own proof does not reach our documents.
      const stranger = await seedOwner(db, 'removal-stranger@example.com');
      const byStranger = await requestRemoval(await manage(db, stranger), {
        documentId: other,
        reason: 'WRONG_PERSON',
      });
      expect(byStranger.ok).toBe(false);
      if (!byStranger.ok) expect(byStranger.error.code).toBe('not_found');
      // A made-up reason is refused.
      const madeUp = await requestRemoval(proof, {
        documentId: other,
        reason: 'because' as unknown as 'OTHER',
      });
      expect(madeUp.ok).toBe(false);
    },
    HEAVY,
  );

  it(
    'cancels while pending, and not after support decided',
    async () => {
      const doc = await addDocument(db, owner, 'passport.pdf');
      const proof = await manage(db, owner);
      const asked = await requestRemoval(proof, { documentId: doc, reason: 'NO_LONGER_NEEDED' });
      if (!asked.ok) throw new Error('ask');
      expect((await cancelRemovalRequest(proof, asked.value.id)).ok).toBe(true);
      expect((await requestRow(db, asked.value.id))?.status).toBe('CANCELLED');
      expect((await pendingRemovalRequests(proof, [doc])).size).toBe(0);

      const second = await requestRemoval(proof, { documentId: doc, reason: 'NO_LONGER_NEEDED' });
      if (!second.ok) throw new Error('ask again');
      const declined = await decideRemovalRequest(
        await decider(db, staffId),
        {
          id: second.value.id,
          decision: 'DECLINE',
          decisionCode: 'RETENTION_REQUIRED',
          stepUpSatisfied: true,
        },
        { db },
      );
      expect(declined.ok).toBe(true);
      const late = await cancelRemovalRequest(proof, second.value.id);
      expect(late.ok).toBe(false);
      if (!late.ok) expect(late.error.message).toBe(REMOVAL_REQUEST_REFUSALS.notPending);
      // The owner hears the decision, with the plain reason.
      const notices = await notificationsFor(db, owner.accountId);
      const decision = notices.find((n) => n.eventType === 'DOCUMENT_REMOVAL_DECIDED');
      expect(decision?.payload.summary).toContain('required to keep it');
    },
    HEAVY,
  );

  // Red first (lanes/D.md).
  it(
    'refuses approval without a fresh sign-in check, and changes nothing',
    async () => {
      const doc = await addDocument(db, owner, 'passport.pdf');
      const asked = await requestRemoval(await manage(db, owner), {
        documentId: doc,
        reason: 'NO_LONGER_NEEDED',
      });
      if (!asked.ok) throw new Error('ask');
      const refused = await decideRemovalRequest(
        await decider(db, staffId),
        { id: asked.value.id, decision: 'APPROVE', stepUpSatisfied: false },
        { db },
      );
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe('step_up_required');
      expect((await requestRow(db, asked.value.id))?.status).toBe('PENDING');
      expect(await db.select().from(schema.deletionReceipts)).toHaveLength(0);
      expect(await db.select().from(schema.documentLifecycle)).toHaveLength(0);
    },
    HEAVY,
  );

  it(
    'refuses approval under a legal hold; the request stays waiting and can be declined',
    async () => {
      const doc = await addDocument(db, owner, 'passport.pdf');
      const asked = await requestRemoval(await manage(db, owner), {
        documentId: doc,
        reason: 'NO_LONGER_NEEDED',
      });
      if (!asked.ok) throw new Error('ask');
      const hold = await placeLegalHold(db, {
        actorAccountId: staffId,
        applicantId: owner.applicantId,
        documentId: doc,
        reason: 'synthetic hold',
        reviewAt: new Date(Date.now() + 30 * 86_400_000),
        stepUpSatisfied: true,
      });
      expect(hold.ok).toBe(true);
      const scope = await decider(db, staffId);
      const refused = await decideRemovalRequest(
        scope,
        { id: asked.value.id, decision: 'APPROVE', stepUpSatisfied: true },
        { db },
      );
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.message).toBe(REMOVAL_REQUEST_REFUSALS.legalHold);
      expect((await requestRow(db, asked.value.id))?.status).toBe('PENDING');
      expect(await db.select().from(schema.erasureJobs)).toHaveLength(0);
      // The queue shows the hold.
      const queue = await listRemovalQueue(await reader(db, staffId), { db });
      expect(queue.ok && queue.value.rows[0]?.legalHold).toBe(true);
      const declined = await decideRemovalRequest(
        scope,
        {
          id: asked.value.id,
          decision: 'DECLINE',
          decisionCode: 'LEGAL_HOLD',
          stepUpSatisfied: true,
        },
        { db },
      );
      expect(declined.ok).toBe(true);
      expect((await requestRow(db, asked.value.id))?.decisionCode).toBe('LEGAL_HOLD');
    },
    HEAVY,
  );

  it(
    'an agency member cannot decide, and a decline needs a code',
    async () => {
      const doc = await addDocument(db, owner, 'passport.pdf');
      const asked = await requestRemoval(await manage(db, owner), {
        documentId: doc,
        reason: 'NO_LONGER_NEEDED',
      });
      if (!asked.ok) throw new Error('ask');
      const agency = await agencyWithGrant(db, owner);
      // No staff scope for an agency member: the live role check refuses.
      const scope = await staffPrincipal(
        db,
        { accountId: agency.agentAccountId, email: 'agent@example.com', bootstrapEmails: [] },
        'RETENTION_PURGE',
      );
      expect(scope.ok).toBe(false);
      // Their record proof dressed as a staff scope is refused at run time.
      const agencyProof = await requireAccess(
        db,
        accountPrincipal(agency.agentAccountId),
        'MANAGE',
        { applicantId: owner.applicantId },
        { purpose: 'review' },
      );
      if (!isOk(agencyProof)) throw new Error('agency proof');
      const byAgency = await decideRemovalRequest(
        agencyProof.value as unknown as StaffScope<'RETENTION_PURGE'>,
        { id: asked.value.id, decision: 'APPROVE', stepUpSatisfied: true },
        { db },
      );
      expect(byAgency.ok).toBe(false);
      if (!byAgency.ok) expect(byAgency.error.code).toBe('forbidden');
      // Privacy read access alone does not decide.
      const readOnly = await decideRemovalRequest(
        (await reader(db, staffId)) as unknown as StaffScope<'RETENTION_PURGE'>,
        { id: asked.value.id, decision: 'APPROVE', stepUpSatisfied: true },
        { db },
      );
      expect(readOnly.ok).toBe(false);
      const noCode = await decideRemovalRequest(
        await decider(db, staffId),
        {
          id: asked.value.id,
          decision: 'DECLINE',
          decisionCode: 'APPROVED' as unknown as 'OTHER',
          stepUpSatisfied: true,
        },
        { db },
      );
      expect(noCode.ok).toBe(false);
      if (!noCode.ok) expect(noCode.error.message).toBe(REMOVAL_REQUEST_REFUSALS.declineCode);
      expect((await requestRow(db, asked.value.id))?.status).toBe('PENDING');
    },
    HEAVY,
  );

  it(
    'approves: open case loses the selection and gets a task, finished case kept, agency told without the name, file queued',
    async () => {
      const doc = await addDocument(db, owner, 'Private Name Passport.pdf');
      const open = await caseUsing(db, owner, doc, 'Open Trip');
      const finished = await caseUsing(db, owner, doc, 'Old Trip');
      await db
        .update(schema.missions)
        .set({ state: 'CLOSED', closedAt: new Date() })
        .where(eq(schema.missions.id, finished));
      const agency = await agencyWithGrant(db, owner, open);
      // A reviewer of the same agency who is not assigned to the case does not see it.
      const reviewer = await provisionAccount(db, { email: 'reviewer-unassigned@example.com' });
      if (!isOk(reviewer)) throw new Error('reviewer');
      await db.insert(schema.memberships).values({
        accountId: reviewer.value.id,
        organizationId: agency.organizationId,
        role: 'REVIEWER',
      });
      // An agency shared on all cases except this one is not told about it.
      const excluded = await agencyWithGrant(db, owner);
      const [excludedGrant] = await db
        .select({ id: schema.grants.id })
        .from(schema.grants)
        .where(eq(schema.grants.recipientOrganizationId, excluded.organizationId));
      await db.insert(schema.grantCaseExclusions).values({
        grantId: excludedGrant?.id ?? '',
        missionId: open,
        applicantId: owner.applicantId,
      });
      // An agency named on the case whose grant was revoked is not told either.
      const former = await agencyWithGrant(db, owner, open);
      await db
        .update(schema.grants)
        .set({ status: 'REVOKED' })
        .where(eq(schema.grants.recipientOrganizationId, former.organizationId));
      await db
        .update(schema.missions)
        .set({ ownerOrganizationId: former.organizationId })
        .where(eq(schema.missions.id, open));
      const [before] = await db
        .select({ revision: schema.missions.materialRevision })
        .from(schema.missions)
        .where(eq(schema.missions.id, open));

      const proof = await manage(db, owner);
      const asked = await requestRemoval(proof, { documentId: doc, reason: 'NO_LONGER_NEEDED' });
      if (!asked.ok) throw new Error('ask');

      const queue = await listRemovalQueue(await reader(db, staffId), { db });
      if (!queue.ok) throw new Error('queue');
      const preview = queue.value.rows[0];
      expect(preview).toMatchObject({
        documentCode: asked.value.documentCode,
        openCases: 1,
        finishedCases: 1,
        agencies: 1,
        legalHold: false,
      });
      expect(JSON.stringify(queue.value)).not.toContain('Private Name');

      const decided = await decideRemovalRequest(
        await decider(db, staffId),
        { id: asked.value.id, decision: 'APPROVE', stepUpSatisfied: true },
        { db },
      );
      expect(decided.ok).toBe(true);
      if (!decided.ok) return;
      expect(decided.value).toMatchObject({
        decision: 'APPROVED',
        removal: 'QUEUED',
        openCasesUpdated: 1,
        agenciesTold: 1,
      });

      const selections = await db
        .select({ missionId: schema.selectedEvidence.missionId })
        .from(schema.selectedEvidence)
        .where(eq(schema.selectedEvidence.documentId, doc));
      expect(selections.map((s) => s.missionId)).toEqual([finished]);
      const [after] = await db
        .select({ revision: schema.missions.materialRevision })
        .from(schema.missions)
        .where(eq(schema.missions.id, open));
      expect(after?.revision).toBe((before?.revision ?? 0) + 1);
      const tasks = await listTasks(db, owner.accountId, open);
      expect(
        isOk(tasks) && tasks.value.some((t) => t.description.includes('removed by request')),
      ).toBe(true);

      const request = await requestRow(db, asked.value.id);
      expect(request?.status).toBe('APPROVED');
      expect(request?.decidedByAccountId).toBe(staffId);
      const [receipt] = await db.select().from(schema.deletionReceipts);
      expect(receipt).toMatchObject({
        path: 'REQUEST',
        status: 'REMOVING',
        subjectCode: asked.value.documentCode,
        documentKind: 'passport',
        approvedByAccountId: staffId,
      });
      expect(JSON.stringify(receipt)).not.toContain('Private Name');
      const [lifecycle] = await db
        .select()
        .from(schema.documentLifecycle)
        .where(eq(schema.documentLifecycle.documentId, doc));
      expect(lifecycle?.deletePath).toBe('REQUEST');
      expect(lifecycle?.receiptId).toBe(receipt?.id);
      const jobs = await db
        .select({ reason: schema.erasureJobs.reason })
        .from(schema.erasureJobs)
        .where(eq(schema.erasureJobs.documentId, doc));
      expect(jobs.map((j) => j.reason)).toEqual(['DOCUMENT_REMOVAL']);

      const agentNotices = await notificationsFor(db, agency.agentAccountId);
      const told = agentNotices.filter((n) => n.eventType === 'DOCUMENT_REMOVED_BY_TRAVELLER');
      expect(told).toHaveLength(1);
      expect(told[0]?.channel).toBe('IN_APP');
      expect(told[0]?.payload.summary).toMatch(/case C-/);
      expect(JSON.stringify(told)).not.toContain('Private Name');
      expect(JSON.stringify(told)).not.toContain('Passport');
      for (const outsider of [reviewer.value.id, excluded.agentAccountId, former.agentAccountId]) {
        expect(
          (await notificationsFor(db, outsider)).filter(
            (n) => n.eventType === 'DOCUMENT_REMOVED_BY_TRAVELLER',
          ),
        ).toHaveLength(0);
      }
      // The case task is recorded as the staff member's action, not the traveller's.
      const [taskAudit] = await db
        .select({ actor: schema.auditEvents.actorAccountId })
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.eventType, 'MISSION_TASK_CREATED'),
            eq(schema.auditEvents.missionId, open),
            eq(schema.auditEvents.actorAccountId, staffId),
          ),
        );
      expect(taskAudit?.actor).toBe(staffId);
      const ownerNotices = await notificationsFor(db, owner.accountId);
      expect(
        ownerNotices.filter((n) => n.eventType === 'DOCUMENT_REMOVAL_DECIDED').length,
      ).toBeGreaterThan(0);

      // Deciding again is refused: the request is no longer waiting.
      const twice = await decideRemovalRequest(
        await decider(db, staffId),
        { id: asked.value.id, decision: 'APPROVE', stepUpSatisfied: true },
        { db },
      );
      expect(twice.ok).toBe(false);
      // A document being removed cannot be asked for again.
      const again = await requestRemoval(proof, { documentId: doc, reason: 'OTHER' });
      expect(again.ok).toBe(false);

      // Once the erasure worker verifies every file gone, the sweep completes the request.
      await db.execute(sql`delete from erasure_jobs where document_id = ${doc}`);
      await db
        .update(schema.deletionReceipts)
        .set({ status: 'REMOVED', verifiedGoneAt: new Date() })
        .where(eq(schema.deletionReceipts.id, receipt?.id ?? ''));
      const swept = await sweepRemovalRequests(
        systemScopeForTest('process-notification-sweeps'),
        db,
        {
          alerts: false,
          alertAfterWorkingDays: 3,
        },
      );
      expect(swept.ok && swept.value.completed).toBe(1);
      expect((await requestRow(db, asked.value.id))?.status).toBe('COMPLETED');
      const removedNotice = (await notificationsFor(db, owner.accountId)).filter(
        (n) => n.eventType === 'DOCUMENT_REMOVAL_COMPLETED',
      );
      expect(removedNotice.length).toBeGreaterThan(0);
      expect(removedNotice[0]?.payload.summary).toContain('90 days');
      expect(removedNotice[0]?.payload.deepLinkPath).toBe(
        `/app/applicant/${owner.applicantId}/documents`,
      );
    },
    HEAVY,
  );

  it(
    'tells the person when a legal hold keeps an approved file, and closes a request whose document left',
    async () => {
      const proof = await manage(db, owner);
      const kept = await addDocument(db, owner, 'kept.pdf');
      const keptAsk = await requestRemoval(proof, { documentId: kept, reason: 'NO_LONGER_NEEDED' });
      if (!keptAsk.ok) throw new Error('ask');
      const approved = await decideRemovalRequest(
        await decider(db, staffId),
        { id: keptAsk.value.id, decision: 'APPROVE', stepUpSatisfied: true },
        { db },
      );
      expect(approved.ok).toBe(true);
      await db
        .update(schema.deletionReceipts)
        .set({ status: 'BLOCKED' })
        .where(eq(schema.deletionReceipts.subjectCode, keptAsk.value.documentCode));

      const leaving = await addDocument(db, owner, 'leaving.pdf', { withFile: false });
      const leavingAsk = await requestRemoval(proof, {
        documentId: leaving,
        reason: 'NO_LONGER_NEEDED',
      });
      if (!leavingAsk.ok) throw new Error('ask');
      // The retention purge removes the document row while the request waits.
      await db.delete(schema.documents).where(eq(schema.documents.id, leaving));
      const refused = await decideRemovalRequest(
        await decider(db, staffId),
        { id: leavingAsk.value.id, decision: 'APPROVE', stepUpSatisfied: true },
        { db },
      );
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.message).toBe(REMOVAL_REQUEST_REFUSALS.gone);
      const queue = await listRemovalQueue(await reader(db, staffId), { db });
      expect(
        queue.ok && queue.value.rows.find((r) => r.id === leavingAsk.value.id)?.documentGone,
      ).toBe(true);

      const system = systemScopeForTest('process-notification-sweeps');
      const swept = await sweepRemovalRequests(system, db, { alerts: false });
      expect(swept.ok && swept.value).toEqual({ completed: 1, kept: 1, alerted: 0 });
      expect((await requestRow(db, keptAsk.value.id))?.status).toBe('APPROVED');
      expect((await requestRow(db, leavingAsk.value.id))?.status).toBe('COMPLETED');
      const again = await sweepRemovalRequests(system, db, { alerts: false });
      expect(again.ok && again.value).toEqual({ completed: 0, kept: 0, alerted: 0 });
      const notices = await notificationsFor(db, owner.accountId);
      expect(notices.some((n) => n.eventType === 'DOCUMENT_REMOVAL_KEPT')).toBe(true);
      expect(
        notices.some(
          (n) =>
            n.eventType === 'DOCUMENT_REMOVAL_COMPLETED' &&
            n.payload.summary.includes('no longer in VisaStack'),
        ),
      ).toBe(true);
    },
    HEAVY,
  );

  it(
    'a document with no stored file is removed at once and the request completes',
    async () => {
      const doc = await addDocument(db, owner, 'empty.pdf', { withFile: false });
      const asked = await requestRemoval(await manage(db, owner), {
        documentId: doc,
        reason: 'UPLOADED_BY_MISTAKE',
      });
      if (!asked.ok) throw new Error('ask');
      const decided = await decideRemovalRequest(
        await decider(db, staffId),
        { id: asked.value.id, decision: 'APPROVE', stepUpSatisfied: true },
        { db },
      );
      expect(decided.ok && decided.value.decision === 'APPROVED' && decided.value.removal).toBe(
        'REMOVED',
      );
      const request = await requestRow(db, asked.value.id);
      expect(request?.status).toBe('COMPLETED');
      expect(request?.documentId).toBeNull();
      expect(request?.documentCode).toBe(asked.value.documentCode);
      expect(
        await db.select().from(schema.documents).where(eq(schema.documents.id, doc)),
      ).toHaveLength(0);
    },
    HEAVY,
  );

  it(
    'pages the queue 25 at a time, oldest first, and alerts staff once after 3 working days',
    async () => {
      const proof = await manage(db, owner);
      const ids: string[] = [];
      for (let i = 0; i < REMOVAL_QUEUE_PAGE + 1; i += 1) {
        const doc = await addDocument(db, owner, `d${i}.pdf`, { withFile: false });
        const asked = await requestRemoval(proof, { documentId: doc, reason: 'NO_LONGER_NEEDED' });
        if (!asked.ok) throw new Error('ask');
        ids.push(asked.value.id);
      }
      // The first request was made on Monday 2 Nov 2026, the others on Tuesday 3 Nov.
      for (const [index, id] of ids.entries()) {
        await db
          .update(schema.documentRemovalRequests)
          .set({
            requestedAt:
              index === 0
                ? new Date('2026-11-02T09:00:00Z')
                : new Date(Date.parse('2026-11-03T09:00:00Z') + index * 60_000),
          })
          .where(eq(schema.documentRemovalRequests.id, id));
      }
      const now = new Date('2026-11-06T10:00:00Z');
      const queue = await listRemovalQueue(await reader(db, staffId), { db, now });
      if (!queue.ok) throw new Error('queue');
      expect(queue.value.rows).toHaveLength(REMOVAL_QUEUE_PAGE);
      expect(queue.value.hasMore).toBe(true);
      expect(queue.value.rows[0]?.id).toBe(ids[0]);
      expect(queue.value.rows[0]?.waitingWorkingDays).toBe(4);

      // Bootstrap staff hold no stored role, so give the staff account a real compliance role.
      await db.insert(schema.platformRoles).values({
        accountId: staffId,
        role: 'COMPLIANCE_ADMIN',
        reason: 'synthetic',
      });
      const system = systemScopeForTest('process-notification-sweeps');
      const first = await sweepRemovalRequests(system, db, {
        now,
        alerts: true,
        alertAfterWorkingDays: 3,
      });
      expect(first.ok && first.value.alerted).toBe(1);
      const second = await sweepRemovalRequests(system, db, {
        now,
        alerts: true,
        alertAfterWorkingDays: 3,
      });
      expect(second.ok && second.value.alerted).toBe(0);
      const alerts = (await notificationsFor(db, staffId)).filter(
        (n) => n.eventType === 'DOCUMENT_REMOVAL_REQUEST_WAITING',
      );
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.payload.deepLinkPath).toBe('/app/admin/removals');
      // Another job's scope is refused.
      const wrong = await sweepRemovalRequests(
        systemScopeForTest('process-erasure') as unknown as typeof system,
        db,
        { now, alerts: true, alertAfterWorkingDays: 3 },
      );
      expect(wrong.ok).toBe(false);
      // Only requests are listed; nothing belonging to another state shows.
      const pending = await db
        .select({ id: schema.documentRemovalRequests.id })
        .from(schema.documentRemovalRequests)
        .where(and(eq(schema.documentRemovalRequests.status, 'PENDING')));
      expect(pending).toHaveLength(REMOVAL_QUEUE_PAGE + 1);
    },
    HEAVY,
  );
});
