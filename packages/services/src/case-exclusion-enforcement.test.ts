import { randomBytes } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { EACH_GRANT, accountPrincipal, requireAccess, verifyStepUp } from './access';
import { caseSharingLockKey } from './access/grant-scope';
import { provisionAccount } from './accounts';
import {
  addNote,
  assignMember,
  cancelEvidenceRequest,
  createAppointmentForOrg,
  createTaskForOrg,
  listAppointmentsForOrg,
  listEvidenceRequestDecisions,
  listEvidenceRequestsForOrg,
  listMissionDecisions,
  listMissionRequirementsForOrg,
  listMissionsForOrganization,
  listNotes,
  listTasksForOrg,
  listUnassignedActiveMissions,
  listVisibleMissionsForMember,
  orgGrantPermits,
  requestEvidence,
} from './agency';
import { createApplicant } from './applicants';
import { getApplicationMemory } from './application-memory';
import { reconcileRestoredBranch } from './backup-reconciliation';
import { setConsent } from './consent';
import type { Db } from './db';
import { registerDocument } from './documents';
import { exportAccount } from './export';
import { createMission, listSelectedEvidenceForOrg } from './missions';
import {
  enqueueNotification,
  listNotificationsForAccount,
  runNotificationWorker,
} from './notifications';
import { createOrganization, reviewOrganization } from './organizations';
import type { EmailPort, KeyManagementPort, SendEmailInput, SendEmailResult } from './ports';
import {
  acceptGrant,
  applyCaseSharingAnswers,
  createGrant,
  listAccessForApplicantDetailed,
  listCaseSharingQuestions,
  pauseGrant,
  removeCaseException,
  revokeGrant,
} from './sharing';
import {
  acceptSharingInvitation,
  createSharingInvitation,
  listInvitationCaseExceptions,
} from './sharing-invitations';
import { issueStepUpAssurance } from './step-up';
import { searchWorkspaceRecords } from './workspace-search';

/**
 * Per-case sharing exceptions (ADR 0017), end to end on every read path.
 *
 * One person owns two cases: C1 (the old one) and C2 (made later). Three
 * all-cases grants: organization A, organization B and person P. C2 is
 * excluded from A's and P's grants; B is not excluded. Every path that shows
 * or acts on case data must deny A and P on C2, allow them on C1, allow B on
 * C2, and leave documents to their own grant scope. Removing the exception
 * restores C2; revoking the grant ends everything.
 */

const HEAVY_TIMEOUT_MS = 120_000;

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

class FakeEmailPort implements EmailPort {
  public readonly sent: SendEmailInput[] = [];
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    this.sent.push(input);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}

async function consentedAccount(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, {
      actorAccountId: provisioned.value.id,
      accountId: provisioned.value.id,
      type,
      granted: true,
    });
  }
  return provisioned.value;
}

async function activeOrganization(db: Db, ownerEmail: string, name: string) {
  const admin = await consentedAccount(db, ownerEmail);
  const org = await createOrganization(db, { actorAccountId: admin.id, name });
  if (!isOk(org)) throw new Error('org');
  const reviewer = await provisionAccount(db, { email: `reviewer-${ownerEmail}` });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  return { adminId: admin.id, organizationId: org.value.id };
}

async function scenario() {
  const db = await freshDb();
  const owner = await consentedAccount(db, 'owner@example.test');
  const applicant = await createApplicant(db, {
    actorAccountId: owner.id,
    ownerAccountId: owner.id,
    displayName: 'Rahim Uddin',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const applicantId = applicant.value.id;
  const c1 = await createMission(db, {
    actorAccountId: owner.id,
    applicantId,
    title: 'Japan trip 2025',
  });
  const c2 = await createMission(db, {
    actorAccountId: owner.id,
    applicantId,
    title: 'Japan trip 2026',
  });
  if (!isOk(c1) || !isOk(c2)) throw new Error('missions');

  const a = await activeOrganization(db, 'a-admin@agency-a.test', 'Agency A');
  const b = await activeOrganization(db, 'b-admin@agency-b.test', 'Agency B');
  const person = await consentedAccount(db, 'person@example.test');

  const grantTo = async (recipient: { organizationId: string } | { accountId: string }) => {
    const created = await createGrant(db, {
      actorAccountId: owner.id,
      applicantId,
      ...('organizationId' in recipient
        ? { recipientOrganizationId: recipient.organizationId }
        : { recipientAccountId: recipient.accountId }),
      actions: ['VIEW_METADATA', 'COMMENT', 'MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(created)) throw new Error(`grant: ${created.error.message}`);
    return created.value.id;
  };
  const grantA = await grantTo({ organizationId: a.organizationId });
  const grantB = await grantTo({ organizationId: b.organizationId });
  const grantP = await grantTo({ accountId: person.id });
  for (const [actor, grantId] of [
    [a.adminId, grantA],
    [b.adminId, grantB],
    [person.id, grantP],
  ] as const) {
    const accepted = await acceptGrant(db, { actorAccountId: actor, grantId });
    if (!isOk(accepted)) throw new Error('accept');
  }

  // Work done on both cases while A still had them (before the exception).
  for (const missionId of [c1.value.id, c2.value.id]) {
    for (const org of [a, b]) {
      const assigned = await assignMember(db, {
        actorAccountId: org.adminId,
        organizationId: org.organizationId,
        memberAccountId: org.adminId,
        missionId,
      });
      if (!isOk(assigned)) throw new Error('assign');
    }
    const note = await addNote(db, {
      actorAccountId: a.adminId,
      missionId,
      body: 'Shared note',
      visibility: 'TRAVELLER_SHARED',
    });
    if (!isOk(note)) throw new Error('note');
    const task = await createTaskForOrg(db, {
      actorAccountId: a.adminId,
      organizationId: a.organizationId,
      missionId,
      description: 'Check bank statement',
    });
    if (!isOk(task)) throw new Error(`task: ${task.error.message}`);
    const appointment = await createAppointmentForOrg(db, {
      actorAccountId: a.adminId,
      organizationId: a.organizationId,
      missionId,
      title: 'Biometrics',
      localDateTime: new Date('2026-12-01T10:00:00Z'),
      timezone: 'Asia/Dhaka',
    });
    if (!isOk(appointment)) throw new Error(`appointment: ${appointment.error.message}`);
  }
  const requestOn = async (missionId?: string) => {
    const created = await requestEvidence(db, {
      actorAccountId: a.adminId,
      organizationId: a.organizationId,
      applicantId,
      kind: 'DOCUMENT',
      docType: 'BANK_STATEMENT',
      ...(missionId ? { missionId } : {}),
    });
    if (!isOk(created)) throw new Error(`request: ${created.error.message}`);
    return created.value.id;
  };
  const requestC1 = await requestOn(c1.value.id);
  const requestC2 = await requestOn(c2.value.id);
  const requestGeneral = await requestOn();

  const document = await registerDocument(db, {
    actorAccountId: owner.id,
    applicantId,
    originalName: 'passport.pdf',
  });
  if (!isOk(document)) throw new Error('document');

  return {
    db,
    owner,
    applicantId,
    c1: c1.value.id,
    c2: c2.value.id,
    a,
    b,
    person,
    grantA,
    grantB,
    grantP,
    requestC1,
    requestC2,
    requestGeneral,
    documentId: document.value.id,
  };
}

type Scenario = Awaited<ReturnType<typeof scenario>>;

/**
 * Drops the table, as on a database migration 0090 has not reached, and
 * returns the scenario on a new handle: "table present" is remembered per
 * handle (never "missing"), and the table never disappears in production.
 */
async function withoutExclusionsTable(s: Scenario): Promise<Scenario> {
  await s.db.execute(sql`drop table grant_case_exclusions`);
  const client = (s.db as unknown as { $client: PGlite }).$client;
  return { ...s, db: drizzle(client, { schema }) as unknown as Db };
}

/** Records the owner's "no" for one grant and one case, as the write side does. */
async function exclude(s: Scenario, grantId: string, missionId: string): Promise<void> {
  await s.db.insert(schema.grantCaseExclusions).values({
    grantId,
    missionId,
    applicantId: s.applicantId,
    createdByAccountId: s.owner.id,
  });
}

async function caseGate(s: Scenario, accountId: string, missionId: string) {
  return requireAccess(
    s.db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { missionId },
    { purpose: EACH_GRANT },
  );
}

async function notificationDelivered(
  s: Scenario,
  recipientAccountId: string,
  organizationId: string,
  missionId: string,
): Promise<boolean> {
  await s.db.delete(schema.notifications);
  await enqueueNotification(s.db, {
    eventType: 'MISSION_STATUS_CHANGED',
    channel: 'IN_APP',
    resourceId: `case-${missionId}-${organizationId}`,
    recipientAccountId,
    applicantId: s.applicantId,
    organizationId,
    missionId,
    payload: { subject: 'Case update', summary: 'A case changed', deepLinkPath: '/app' },
  });
  const result = await runNotificationWorker(s.db, new FakeEmailPort(), 'https://app.example');
  return result.sent === 1;
}

async function caseTitlesFound(s: Scenario, adminId: string, organizationId: string) {
  const found = await searchWorkspaceRecords(
    s.db,
    adminId,
    { kind: 'agency', organizationId },
    'Japan',
  );
  if (!isOk(found)) throw new Error('search');
  return found.value
    .filter((r) => r.category === 'Case')
    .map((r) => r.label)
    .sort();
}

/** Everything organization A and person P can reach on one case, as booleans. */
async function reachOnCase(s: Scenario, missionId: string) {
  const db = s.db;
  const aId = s.a.organizationId;
  return {
    aGate: isOk(await caseGate(s, s.a.adminId, missionId)),
    pGate: isOk(await caseGate(s, s.person.id, missionId)),
    aOrgGrant: await orgGrantPermits(db, aId, s.applicantId, 'MANAGE', missionId),
    aListed: (await listMissionsForOrganization(db, aId)).some((m) => m.missionId === missionId),
    aVisible: (await listVisibleMissionsForMember(db, aId, s.a.adminId)).missions.some(
      (m) => m.missionId === missionId,
    ),
    aNotes: (await listNotes(db, aId, s.applicantId, missionId)).length > 0,
    aTasks: (await listTasksForOrg(db, aId, s.applicantId, missionId)).length > 0,
    aAppointments: (await listAppointmentsForOrg(db, aId, s.applicantId, missionId)).length > 0,
    aRequirements: isOk(await listMissionRequirementsForOrg(db, aId, missionId)),
    aSelectedEvidence: isOk(await listSelectedEvidenceForOrg(db, aId, missionId)),
    aDecisions: isOk(await listMissionDecisions(db, s.a.adminId, missionId)),
    aNewNote: isOk(
      await addNote(db, {
        actorAccountId: s.a.adminId,
        missionId,
        body: 'Probe',
        visibility: 'AGENCY_INTERNAL',
      }),
    ),
    pNewNote: isOk(
      await addNote(db, {
        actorAccountId: s.person.id,
        missionId,
        body: 'Probe',
        visibility: 'TRAVELLER_SHARED',
      }),
    ),
    aNewTask: isOk(
      await createTaskForOrg(db, {
        actorAccountId: s.a.adminId,
        organizationId: aId,
        missionId,
        description: 'Probe',
      }),
    ),
    aNewRequest: isOk(
      await requestEvidence(db, {
        actorAccountId: s.a.adminId,
        organizationId: aId,
        applicantId: s.applicantId,
        kind: 'DOCUMENT',
        docType: 'PASSPORT',
        missionId,
      }),
    ),
    aNotified: await notificationDelivered(s, s.a.adminId, aId, missionId),
  };
}

const ALL_TRUE = {
  aGate: true,
  pGate: true,
  aOrgGrant: true,
  aListed: true,
  aVisible: true,
  aNotes: true,
  aTasks: true,
  aAppointments: true,
  aRequirements: true,
  aSelectedEvidence: true,
  aDecisions: true,
  aNewNote: true,
  pNewNote: true,
  aNewTask: true,
  aNewRequest: true,
  aNotified: true,
};
const ALL_FALSE = Object.fromEntries(Object.keys(ALL_TRUE).map((k) => [k, false]));

describe('per-case sharing exceptions on every read path', () => {
  it(
    'denies A and P on the excluded case, keeps the other case, and leaves B alone',
    async () => {
      const s = await scenario();
      await exclude(s, s.grantA, s.c2);
      await exclude(s, s.grantP, s.c2);

      expect(await reachOnCase(s, s.c2)).toEqual(ALL_FALSE);
      expect(await reachOnCase(s, s.c1)).toEqual(ALL_TRUE);

      // Organization B, not excluded, still reaches C2 everywhere.
      const bId = s.b.organizationId;
      expect(isOk(await caseGate(s, s.b.adminId, s.c2))).toBe(true);
      expect((await listMissionsForOrganization(s.db, bId)).map((m) => m.missionId).sort()).toEqual(
        [s.c1, s.c2].sort(),
      );
      expect(await notificationDelivered(s, s.b.adminId, bId, s.c2)).toBe(true);
      expect(await caseTitlesFound(s, s.b.adminId, bId)).toEqual([
        'Japan trip 2025',
        'Japan trip 2026',
      ]);

      // Search, the reassignment queue and the evidence request list hide C2 from A only.
      expect(await caseTitlesFound(s, s.a.adminId, s.a.organizationId)).toEqual([
        'Japan trip 2025',
      ]);
      await s.db.delete(schema.assignments).where(eq(schema.assignments.missionId, s.c2));
      expect(
        (await listUnassignedActiveMissions(s.db, s.a.organizationId)).map((m) => m.missionId),
      ).toEqual([]);
      expect((await listUnassignedActiveMissions(s.db, bId)).map((m) => m.missionId)).toEqual([
        s.c2,
      ]);
      const requests = await listEvidenceRequestsForOrg(s.db, s.a.adminId, s.a.organizationId);
      if (!isOk(requests)) throw new Error('requests');
      const listedIds = requests.value.map((r) => r.id);
      expect(listedIds).toContain(s.requestC1);
      expect(listedIds).toContain(s.requestGeneral);
      expect(listedIds).not.toContain(s.requestC2);
      // A request already made on C2 can no longer be acted on or read by A.
      expect(
        isErr(
          await cancelEvidenceRequest(s.db, {
            actorAccountId: s.a.adminId,
            requestId: s.requestC2,
          }),
        ),
      ).toBe(true);
      expect(isErr(await listEvidenceRequestDecisions(s.db, s.a.adminId, s.requestC2))).toBe(true);
      expect(
        isErr(
          await assignMember(s.db, {
            actorAccountId: s.a.adminId,
            organizationId: s.a.organizationId,
            memberAccountId: s.a.adminId,
            missionId: s.c2,
          }),
        ),
      ).toBe(true);

      // Documents keep their own grant scope: an exception never hides them.
      for (const actor of [s.a.adminId, s.person.id]) {
        const documentGate = await requireAccess(
          s.db,
          accountPrincipal(actor),
          'VIEW_METADATA',
          { documentId: s.documentId },
          { purpose: EACH_GRANT },
        );
        expect(isOk(documentGate)).toBe(true);
      }
      const profileGate = await requireAccess(
        s.db,
        accountPrincipal(s.a.adminId),
        'VIEW_METADATA',
        { applicantId: s.applicantId },
        { purpose: EACH_GRANT },
      );
      expect(isOk(profileGate)).toBe(true);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'shows the owner, and only the owner, which grants do not cover which case',
    async () => {
      const s = await scenario();
      await exclude(s, s.grantA, s.c2);
      await exclude(s, s.grantP, s.c2);

      const gate = await requireAccess(
        s.db,
        accountPrincipal(s.owner.id),
        'VIEW_METADATA',
        { applicantId: s.applicantId },
        { purpose: 'application_memory' },
      );
      if (!isOk(gate)) throw new Error('gate');
      const memory = await getApplicationMemory(gate.value);
      if (!isOk(memory)) throw new Error('memory');
      const byCase = new Map(memory.value.cases.map((c) => [c.missionId, c.notSharedWith]));
      expect(byCase.get(s.c1)).toEqual([]);
      expect(
        byCase
          .get(s.c2)
          ?.map((e) => `${e.recipientKind}:${e.recipientName}`)
          .sort(),
      ).toEqual(['organization:Agency A', 'person:person@example.test']);

      const access = await listAccessForApplicantDetailed(s.db, s.owner.id, s.applicantId);
      if (!isOk(access)) throw new Error('access');
      const exceptions = new Map(
        access.value.map((g) => [g.id, g.caseExceptions.map((e) => e.missionTitle)]),
      );
      expect(exceptions.get(s.grantA)).toEqual(['Japan trip 2026']);
      expect(exceptions.get(s.grantP)).toEqual(['Japan trip 2026']);
      expect(exceptions.get(s.grantB)).toEqual([]);

      // Nobody else can read that list.
      expect(isErr(await listAccessForApplicantDetailed(s.db, s.a.adminId, s.applicantId))).toBe(
        true,
      );
      // Revoked grants reach nothing, so they are no longer named.
      await revokeGrant(s.db, { actorAccountId: s.owner.id, grantId: s.grantA });
      const after = await getApplicationMemory(gate.value);
      if (!isOk(after)) throw new Error('memory');
      expect(
        after.value.cases.find((c) => c.missionId === s.c2)?.notSharedWith.map((e) => e.grantId),
      ).toEqual([s.grantP]);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'removing the exception restores the case; revoking the grant ends everything',
    async () => {
      const s = await scenario();
      await exclude(s, s.grantA, s.c2);
      await exclude(s, s.grantP, s.c2);
      expect((await reachOnCase(s, s.c2)).aListed).toBe(false);

      await s.db
        .delete(schema.grantCaseExclusions)
        .where(
          and(
            eq(schema.grantCaseExclusions.grantId, s.grantA),
            eq(schema.grantCaseExclusions.missionId, s.c2),
          ),
        );
      const restored = await reachOnCase(s, s.c2);
      expect({ ...restored, pGate: true, pNewNote: true }).toEqual(ALL_TRUE);
      // P's exception is separate and still stands.
      expect(restored.pGate).toBe(false);
      expect(restored.pNewNote).toBe(false);

      for (const grantId of [s.grantA, s.grantP]) {
        const revoked = await revokeGrant(s.db, { actorAccountId: s.owner.id, grantId });
        if (!isOk(revoked)) throw new Error('revoke');
      }
      expect(await reachOnCase(s, s.c1)).toEqual(ALL_FALSE);
      expect(await reachOnCase(s, s.c2)).toEqual(ALL_FALSE);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'before migration 0090 runs, every read path behaves exactly as it did without exceptions',
    async () => {
      const s = await withoutExclusionsTable(await scenario());
      expect(await reachOnCase(s, s.c2)).toEqual(ALL_TRUE);
      expect(await caseTitlesFound(s, s.a.adminId, s.a.organizationId)).toEqual([
        'Japan trip 2025',
        'Japan trip 2026',
      ]);
      const requests = await listEvidenceRequestsForOrg(s.db, s.a.adminId, s.a.organizationId);
      if (!isOk(requests)) throw new Error('requests');
      expect(requests.value.map((r) => r.id)).toContain(s.requestC2);
      const access = await listAccessForApplicantDetailed(s.db, s.owner.id, s.applicantId);
      if (!isOk(access)) throw new Error('access');
      expect(access.value.every((g) => g.caseExceptions.length === 0)).toBe(true);
    },
    HEAVY_TIMEOUT_MS,
  );
});

// --- The write side ---------------------------------------------------------

const STEP_UP_SECRET = 'case-exclusion-step-up-secret';

async function newCase(s: Scenario, title = 'Japan trip 2027'): Promise<string> {
  const created = await createMission(s.db, {
    actorAccountId: s.owner.id,
    applicantId: s.applicantId,
    title,
  });
  if (!isOk(created)) throw new Error('mission');
  return created.value.id;
}

async function ownerManage(s: Scenario, missionId: string, db: Db = s.db) {
  const proof = await requireAccess(
    db,
    accountPrincipal(s.owner.id),
    'MANAGE',
    { missionId },
    { purpose: 'owner_case_sharing' },
  );
  if (!isOk(proof)) throw new Error('owner proof');
  return proof.value;
}

async function auditCount(s: Scenario, eventType: string, missionId: string): Promise<number> {
  const rows = await s.db
    .select({ seq: schema.auditEvents.seq })
    .from(schema.auditEvents)
    .where(
      and(eq(schema.auditEvents.eventType, eventType), eq(schema.auditEvents.missionId, missionId)),
    );
  return rows.length;
}

async function grantPending(s: Scenario, email: string, actions: string[] = ['VIEW_METADATA']) {
  const account = await consentedAccount(s.db, email);
  const created = await createGrant(s.db, {
    actorAccountId: s.owner.id,
    applicantId: s.applicantId,
    recipientAccountId: account.id,
    actions: actions as never,
    purpose: 'collaboration',
    stepUpSatisfied: true,
  });
  if (!isOk(created)) throw new Error('grant');
  return { accountId: account.id, grantId: created.value.id };
}

const fixtureKey = randomBytes(32);
const encryption: KeyManagementPort = {
  currentKeyVersion: () => 'fixture-v1',
  generateDataKey: async () => ({
    keyVersion: 'fixture-v1',
    plaintextDataKey: fixtureKey,
    wrappedDataKey: new Uint8Array([1]),
  }),
  unwrapDataKey: async () => fixtureKey,
};

describe('per-case sharing answers (write side)', () => {
  it(
    'asks about every all-cases recipient, records a "no" for everyone not ticked, and tells nobody',
    async () => {
      const s = await scenario();
      const viewProof = await requireAccess(
        s.db,
        accountPrincipal(s.owner.id),
        'VIEW_METADATA',
        { applicantId: s.applicantId },
        { purpose: 'owner_case_sharing' },
      );
      if (!isOk(viewProof)) throw new Error('view proof');
      // A case-scoped grant is never asked about.
      const scoped = await createGrant(s.db, {
        actorAccountId: s.owner.id,
        applicantId: s.applicantId,
        recipientOrganizationId: s.b.organizationId,
        missionId: s.c1,
        actions: ['VIEW_METADATA'],
        purpose: 'case only',
      });
      if (!isOk(scoped)) throw new Error('scoped grant');
      const questions = await listCaseSharingQuestions(viewProof.value);
      if (!isOk(questions)) throw new Error('questions');
      expect(questions.value.map((q) => `${q.kind}:${q.recipient.label}`)).toEqual([
        'grant:Agency A',
        'grant:Agency B',
        'grant:person@example.test',
      ]);

      // Someone given all-cases access after the question was shown is not ticked, so excluded.
      const late = await grantPending(s, 'late@example.test');
      const c3 = await newCase(s);
      const notificationsBefore = (await s.db.select().from(schema.notifications)).length;
      const applied = await applyCaseSharingAnswers(await ownerManage(s, c3), {
        allowedGrantIds: [s.grantB],
        allowedInvitationIds: [],
      });
      if (!isOk(applied)) throw new Error(`apply: ${applied.error.message}`);
      expect([...applied.value.excludedGrantIds].sort()).toEqual(
        [s.grantA, s.grantP, late.grantId].sort(),
      );
      expect(applied.value.allowedGrantIds).toEqual([s.grantB]);
      expect((await s.db.select().from(schema.notifications)).length).toBe(notificationsBefore);

      expect(isOk(await caseGate(s, s.a.adminId, c3))).toBe(false);
      expect(isOk(await caseGate(s, s.person.id, c3))).toBe(false);
      expect(isOk(await caseGate(s, s.b.adminId, c3))).toBe(true);
      await acceptGrant(s.db, { actorAccountId: late.accountId, grantId: late.grantId });
      expect(isOk(await caseGate(s, late.accountId, c3))).toBe(false);
      expect(isOk(await caseGate(s, late.accountId, s.c1))).toBe(true);
      expect(await auditCount(s, 'GRANT_CASE_EXCLUDED', c3)).toBe(3);
      expect(await auditCount(s, 'GRANT_CASE_ALLOWED', c3)).toBe(1);

      // One-shot: the same answers again are refused and change nothing.
      const again = await applyCaseSharingAnswers(await ownerManage(s, c3), {
        allowedGrantIds: [s.grantB],
        allowedInvitationIds: [],
      });
      expect(isErr(again) && again.error.code).toBe('invalid');
      expect(await auditCount(s, 'GRANT_CASE_EXCLUDED', c3)).toBe(3);
      expect(await auditCount(s, 'GRANT_CASE_ALLOWED', c3)).toBe(1);
      expect(
        (
          await s.db
            .select()
            .from(schema.grantCaseExclusions)
            .where(eq(schema.grantCaseExclusions.missionId, c3))
        ).length,
      ).toBe(3);

      // A ticked id that is not a current all-cases grant of this person is refused.
      const c4 = await newCase(s, 'Japan trip 2028');
      for (const allowedGrantIds of [[scoped.value.id], ['00000000-0000-4000-8000-000000000000']]) {
        const refused = await applyCaseSharingAnswers(await ownerManage(s, c4), {
          allowedGrantIds,
          allowedInvitationIds: [],
        });
        expect(isErr(refused) && refused.error.code).toBe('invalid');
      }
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'only the owner can answer, with a genuine proof for the case',
    async () => {
      const s = await scenario();
      const c3 = await newCase(s);
      const owner = await ownerManage(s, c3);
      const answers = { allowedGrantIds: [], allowedInvitationIds: [] };
      expect(isErr(await applyCaseSharingAnswers({ ...owner } as typeof owner, answers))).toBe(
        true,
      );
      // Agency B holds MANAGE on the case, but it is not the owner.
      const agencyProof = await requireAccess(
        s.db,
        accountPrincipal(s.b.adminId),
        'MANAGE',
        { missionId: c3 },
        { purpose: EACH_GRANT },
      );
      if (!isOk(agencyProof)) throw new Error('agency proof');
      const refused = await applyCaseSharingAnswers(agencyProof.value, answers);
      expect(isErr(refused) && refused.error.code).toBe('forbidden');
      const viaView = await requireAccess(
        s.db,
        accountPrincipal(s.owner.id),
        'VIEW_METADATA',
        { missionId: c3 },
        { purpose: 'owner_case_sharing' },
      );
      if (!isOk(viaView)) throw new Error('view proof');
      expect(isErr(await applyCaseSharingAnswers(viaView.value as never, answers))).toBe(true);
      expect(isErr(await listCaseSharingQuestions(agencyProof.value as never))).toBe(true);
      expect(isErr(await removeCaseException(agencyProof.value, { grantId: s.grantA }))).toBe(true);
      expect((await s.db.select().from(schema.grantCaseExclusions)).length).toBe(0);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'before migration 0090 runs, refuses and lets the case creation roll back so no "no" is lost',
    async () => {
      const s = await withoutExclusionsTable(await scenario());
      const titles = async () =>
        (await s.db.select({ title: schema.missions.title }).from(schema.missions)).map(
          (m) => m.title,
        );
      const attempt = s.db.transaction(async (tx) => {
        const created = await createMission(tx, {
          actorAccountId: s.owner.id,
          applicantId: s.applicantId,
          title: 'Prepare Again copy',
        });
        if (!isOk(created)) throw new Error('mission');
        const applied = await applyCaseSharingAnswers(await ownerManage(s, created.value.id, tx), {
          allowedGrantIds: [s.grantB],
          allowedInvitationIds: [],
        });
        expect(isErr(applied) && applied.error.code).toBe('upstream_error');
        // The surrounding transaction is still usable after the refusal.
        expect((await tx.select().from(schema.missions)).length).toBe(3);
        throw new Error('roll back the new case');
      });
      await expect(attempt).rejects.toThrow('roll back the new case');
      expect(await titles()).not.toContain('Prepare Again copy');

      // Every recipient ticked: there is no "no" to lose, so it goes ahead.
      const shared = await newCase(s, 'Shared with everyone');
      const allTicked = await applyCaseSharingAnswers(await ownerManage(s, shared), {
        allowedGrantIds: [s.grantA, s.grantB, s.grantP],
        allowedInvitationIds: [],
      });
      expect(isOk(allTicked)).toBe(true);
      expect(await auditCount(s, 'GRANT_CASE_ALLOWED', shared)).toBe(3);

      // With nobody to ask about there is nothing to lose, so it goes ahead.
      for (const grantId of [s.grantA, s.grantB, s.grantP]) {
        await revokeGrant(s.db, { actorAccountId: s.owner.id, grantId });
      }
      const c3 = await newCase(s);
      expect(
        isOk(
          await applyCaseSharingAnswers(await ownerManage(s, c3), {
            allowedGrantIds: [],
            allowedInvitationIds: [],
          }),
        ),
      ).toBe(true);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'Allow This Case removes one exception, asking for a fresh sign-in only when the sharing needed one',
    async () => {
      const s = await scenario();
      const sensitive = await grantPending(s, 'sensitive@example.test', [
        'VIEW_METADATA',
        'DOWNLOAD_ORIGINAL',
      ]);
      await acceptGrant(s.db, { actorAccountId: sensitive.accountId, grantId: sensitive.grantId });
      const c3 = await newCase(s);
      const applied = await applyCaseSharingAnswers(await ownerManage(s, c3), {
        allowedGrantIds: [],
        allowedInvitationIds: [],
      });
      if (!isOk(applied)) throw new Error('apply');

      // An ordinary grant: no fresh sign-in.
      const removed = await removeCaseException(await ownerManage(s, c3), { grantId: s.grantA });
      expect(isOk(removed)).toBe(true);
      expect(isOk(await caseGate(s, s.a.adminId, c3))).toBe(true);
      expect(await auditCount(s, 'GRANT_CASE_EXCLUSION_REMOVED', c3)).toBe(1);
      const twice = await removeCaseException(await ownerManage(s, c3), { grantId: s.grantA });
      expect(isErr(twice) && twice.error.code).toBe('not_found');

      // A grant that hands out a download of originals needs one, bound to SHARE on this record.
      const proofFor = (action: string, resourceId: string) =>
        verifyStepUp(
          STEP_UP_SECRET,
          issueStepUpAssurance(STEP_UP_SECRET, { accountId: s.owner.id, action, resourceId }),
          { accountId: s.owner.id, action: action as never, resourceId },
        );
      for (const stepUp of [undefined, proofFor('PREVIEW', s.applicantId), proofFor('SHARE', c3)]) {
        const refused = await removeCaseException(await ownerManage(s, c3), {
          grantId: sensitive.grantId,
          ...(stepUp ? { stepUp } : {}),
        });
        expect(isErr(refused) && refused.error.code).toBe('step_up_required');
      }
      const shareProof = proofFor('SHARE', s.applicantId);
      if (!shareProof) throw new Error('step-up proof');
      expect(
        isOk(
          await removeCaseException(await ownerManage(s, c3), {
            grantId: sensitive.grantId,
            stepUp: shareProof,
          }),
        ),
      ).toBe(true);

      // An ended grant has nothing left to allow.
      await revokeGrant(s.db, { actorAccountId: s.owner.id, grantId: s.grantP });
      const ended = await removeCaseException(await ownerManage(s, c3), { grantId: s.grantP });
      expect(isErr(ended) && ended.error.code).toBe('invalid');
      expect(isOk(await caseGate(s, s.person.id, c3))).toBe(false);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'a "no" recorded against a pending invitation binds the grant it becomes',
    async () => {
      const s = await scenario();
      const invite = async (email: string) => {
        const created = await createSharingInvitation(s.db, {
          actorAccountId: s.owner.id,
          applicantId: s.applicantId,
          email,
          actions: ['VIEW_METADATA'],
          purpose: 'Invited review',
          encryption,
        });
        if (!isOk(created)) throw new Error(`invite: ${created.error.message}`);
        return created.value;
      };
      const refusedInvite = await invite('invited-no@example.test');
      const allowedInvite = await invite('invited-yes@example.test');
      const c3 = await newCase(s);
      const applied = await applyCaseSharingAnswers(await ownerManage(s, c3), {
        allowedGrantIds: [s.grantA, s.grantB, s.grantP],
        allowedInvitationIds: [allowedInvite.invitation.id],
      });
      if (!isOk(applied)) throw new Error('apply');
      expect(applied.value.excludedInvitationIds).toEqual([refusedInvite.invitation.id]);
      expect(await auditCount(s, 'GRANT_CASE_EXCLUDED', c3)).toBe(1);

      const acceptAs = async (email: string, rawToken: string) => {
        const account = await consentedAccount(s.db, email);
        const accepted = await acceptSharingInvitation(s.db, {
          actorAccountId: account.id,
          rawToken,
        });
        if (!isOk(accepted)) throw new Error(`accept: ${accepted.error.message}`);
        return { accountId: account.id, grantId: accepted.value };
      };
      const no = await acceptAs('invited-no@example.test', refusedInvite.rawToken);
      const yes = await acceptAs('invited-yes@example.test', allowedInvite.rawToken);
      expect(isOk(await caseGate(s, no.accountId, c3))).toBe(false);
      expect(isOk(await caseGate(s, no.accountId, s.c1))).toBe(true);
      expect(isOk(await caseGate(s, yes.accountId, c3))).toBe(true);

      const rows = await s.db
        .select()
        .from(schema.grantCaseExclusions)
        .where(eq(schema.grantCaseExclusions.missionId, c3));
      expect(rows.map((r) => [r.grantId, r.sharingInvitationId])).toEqual([[no.grantId, null]]);
    },
    HEAVY_TIMEOUT_MS,
  );
});

// --- Review fixes (code review and security review, 26 Oct 2026) -----------

function clientOf(db: Db): PGlite {
  return (db as unknown as { $client: PGlite }).$client;
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function exceptionRows(s: Scenario, missionId: string, db: Db = s.db) {
  return db
    .select()
    .from(schema.grantCaseExclusions)
    .where(eq(schema.grantCaseExclusions.missionId, missionId));
}

async function shareAllCasesWith(
  s: Scenario,
  recipient: { organizationId: string; adminId: string },
) {
  const created = await createGrant(s.db, {
    actorAccountId: s.owner.id,
    applicantId: s.applicantId,
    recipientOrganizationId: recipient.organizationId,
    actions: ['VIEW_METADATA', 'COMMENT', 'MANAGE'],
    purpose: 'collaboration',
  });
  if (!isOk(created)) throw new Error(`grant: ${created.error.message}`);
  const accepted = await acceptGrant(s.db, {
    actorAccountId: recipient.adminId,
    grantId: created.value.id,
  });
  if (!isOk(accepted)) throw new Error('accept');
  return created.value.id;
}

async function memoryNotShared(s: Scenario, missionId: string): Promise<string[]> {
  const gate = await requireAccess(
    s.db,
    accountPrincipal(s.owner.id),
    'VIEW_METADATA',
    { applicantId: s.applicantId },
    { purpose: 'application_memory' },
  );
  if (!isOk(gate)) throw new Error('gate');
  const memory = await getApplicationMemory(gate.value);
  if (!isOk(memory)) throw new Error('memory');
  return (memory.value.cases.find((c) => c.missionId === missionId)?.notSharedWith ?? [])
    .map((e) => `${e.recipientKind}:${e.recipientName}`)
    .sort();
}

describe('review fixes: one-shot answers, the sharing lock, recipient-level exceptions', () => {
  it(
    'answers are one-shot, so the rows and the audit trail always agree, and a restore ends where the owner left it',
    async () => {
      const s = await scenario();
      const yesFirst = await newCase(s, 'Yes first');
      const noFirst = await newCase(s, 'No first');
      // A restored branch from this moment, before any answer.
      const restored = drizzle((await clientOf(s.db).clone()) as PGlite, {
        schema,
      }) as unknown as Db;
      await pause(5);
      const restorePoint = new Date();
      await pause(5);
      const apply = async (missionId: string, allowedGrantIds: string[]) =>
        applyCaseSharingAnswers(await ownerManage(s, missionId), {
          allowedGrantIds,
          allowedInvitationIds: [],
        });

      // Yes, then a later no: the later no is refused, nothing is written.
      expect(isOk(await apply(yesFirst, [s.grantA, s.grantB, s.grantP]))).toBe(true);
      const late = await apply(yesFirst, [s.grantB, s.grantP]);
      expect(isErr(late) && late.error.code).toBe('invalid');
      expect(isErr(late) && late.error.message).toContain('Allow This Case');
      expect(await exceptionRows(s, yesFirst)).toHaveLength(0);
      expect(await auditCount(s, 'GRANT_CASE_EXCLUDED', yesFirst)).toBe(0);
      expect(isOk(await caseGate(s, s.a.adminId, yesFirst))).toBe(true);

      // No, Allow This Case, then no again: the second no is refused.
      expect(isOk(await apply(noFirst, [s.grantB, s.grantP]))).toBe(true);
      expect(await exceptionRows(s, noFirst)).toHaveLength(1);
      expect(await auditCount(s, 'GRANT_CASE_EXCLUDED', noFirst)).toBe(1);
      const allowed = await removeCaseException(await ownerManage(s, noFirst), {
        grantId: s.grantA,
      });
      expect(isOk(allowed)).toBe(true);
      const again = await apply(noFirst, [s.grantB, s.grantP]);
      expect(isErr(again) && again.error.code).toBe('invalid');
      expect(await exceptionRows(s, noFirst)).toHaveLength(0);
      expect(await auditCount(s, 'GRANT_CASE_EXCLUDED', noFirst)).toBe(1);
      expect(await auditCount(s, 'GRANT_CASE_EXCLUSION_REMOVED', noFirst)).toBe(1);
      expect(isOk(await caseGate(s, s.a.adminId, noFirst))).toBe(true);

      // Replaying the trail onto the restored branch gives the same table.
      const report = await reconcileRestoredBranch(s.db, restored, restorePoint);
      expect(report.errors).toEqual([]);
      for (const missionId of [yesFirst, noFirst]) {
        expect(await exceptionRows(s, missionId, restored)).toHaveLength(0);
        const gate = await requireAccess(
          restored,
          accountPrincipal(s.a.adminId),
          'VIEW_METADATA',
          { missionId },
          { purpose: EACH_GRANT },
        );
        expect(isOk(gate)).toBe(true);
      }
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'takes the person sharing lock before reading any grant or invitation it protects',
    async () => {
      const s = await scenario();
      const queries: { sql: string; params: unknown[] }[] = [];
      const logged = drizzle(clientOf(s.db), {
        schema,
        logger: {
          logQuery: (query: string, params: unknown[]) => queries.push({ sql: query, params }),
        },
      }) as unknown as Db;
      const lockKey = caseSharingLockKey(s.applicantId);
      const indexOf = (pattern: RegExp) => queries.findIndex((q) => pattern.test(q.sql));
      const isOurLock = (q: { sql: string; params: unknown[] }) =>
        /pg_advisory_xact_lock/.test(q.sql) && q.params.includes(lockKey);
      const lockIndex = () => {
        const at = queries.findIndex(isOurLock);
        expect(at).toBeGreaterThanOrEqual(0);
        return at;
      };

      // Recording the answers for a new case.
      const c3 = await newCase(s);
      const proof = await ownerManage(s, c3, logged);
      queries.length = 0;
      expect(
        isOk(
          await applyCaseSharingAnswers(proof, {
            allowedGrantIds: [s.grantB],
            allowedInvitationIds: [],
          }),
        ),
      ).toBe(true);
      const answersLock = lockIndex();
      expect(answersLock).toBeLessThan(indexOf(/from "grants"/));
      expect(answersLock).toBeLessThan(indexOf(/from "sharing_invitations"/));
      expect(answersLock).toBeLessThan(indexOf(/from "audit_events"/));

      // Creating an all-cases invitation, then accepting it.
      queries.length = 0;
      const invitation = await createSharingInvitation(logged, {
        actorAccountId: s.owner.id,
        applicantId: s.applicantId,
        email: 'locked@example.test',
        actions: ['VIEW_METADATA'],
        purpose: 'Invited review',
        encryption,
      });
      if (!isOk(invitation)) throw new Error('invite');
      expect(lockIndex()).toBeLessThan(indexOf(/insert into "sharing_invitations"/));
      const invitee = await consentedAccount(s.db, 'locked@example.test');
      queries.length = 0;
      const accepted = await acceptSharingInvitation(logged, {
        actorAccountId: invitee.id,
        rawToken: invitation.value.rawToken,
      });
      expect(isOk(accepted)).toBe(true);
      const acceptLock = lockIndex();
      // Before the lock, only whose record the token names is looked up.
      for (const q of queries.slice(0, acceptLock)) {
        expect(q.sql).toMatch(/^select "applicant_id" from "sharing_invitations"/);
      }
      expect(acceptLock).toBeLessThan(indexOf(/update "sharing_invitations"/));
      expect(acceptLock).toBeLessThan(indexOf(/from "grants"/));

      // Creating an all-cases grant takes it; a grant for one case does not need it.
      queries.length = 0;
      const allCases = await createGrant(logged, {
        actorAccountId: s.owner.id,
        applicantId: s.applicantId,
        recipientAccountId: invitee.id,
        actions: ['VIEW_METADATA'],
        purpose: 'collaboration',
      });
      expect(isOk(allCases)).toBe(true);
      expect(lockIndex()).toBeLessThan(indexOf(/insert into "grants"/));
      queries.length = 0;
      const oneCase = await createGrant(logged, {
        actorAccountId: s.owner.id,
        applicantId: s.applicantId,
        recipientAccountId: invitee.id,
        missionId: s.c1,
        actions: ['VIEW_METADATA'],
        purpose: 'case only',
      });
      expect(isOk(oneCase)).toBe(true);
      expect(queries.some(isOurLock)).toBe(false);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'an ended grant does not keep the excluded case evidence requests or notices visible',
    async () => {
      const s = await scenario();
      const aId = s.a.organizationId;
      // Notices about both cases reach A's bell while A reaches both.
      await s.db.delete(schema.notifications);
      for (const missionId of [s.c1, s.c2]) {
        await enqueueNotification(s.db, {
          eventType: 'MISSION_STATUS_CHANGED',
          channel: 'IN_APP',
          resourceId: `bell-${missionId}`,
          recipientAccountId: s.a.adminId,
          applicantId: s.applicantId,
          organizationId: aId,
          missionId,
          payload: {
            subject: `Update ${missionId}`,
            summary: 'A case changed',
            deepLinkPath: '/app',
          },
        });
      }
      await runNotificationWorker(s.db, new FakeEmailPort(), 'https://app.example');
      const bell = async () =>
        (await listNotificationsForAccount(s.db, s.a.adminId)).map((n) => n.subject).sort();
      expect(await bell()).toEqual([`Update ${s.c1}`, `Update ${s.c2}`].sort());
      const listed = async () => {
        const requests = await listEvidenceRequestsForOrg(s.db, s.a.adminId, aId);
        if (!isOk(requests)) throw new Error('requests');
        return requests.value.map((r) => r.id);
      };

      // The security reviewer's case: the request on C2 was made under the old grant;
      // that grant is revoked, all cases are shared again, and C2 is excluded.
      expect(isOk(await revokeGrant(s.db, { actorAccountId: s.owner.id, grantId: s.grantA }))).toBe(
        true,
      );
      const fresh = await shareAllCasesWith(s, s.a);
      await exclude(s, fresh, s.c2);
      expect((await listMissionsForOrganization(s.db, aId)).map((m) => m.missionId)).toEqual([
        s.c1,
      ]);
      expect(await listed()).not.toContain(s.requestC2);
      expect(await listed()).toEqual(expect.arrayContaining([s.requestC1, s.requestGeneral]));
      expect(await bell()).toEqual([`Update ${s.c1}`]);

      // A paused grant is still live: the exception still hides C2.
      await pauseGrant(s.db, { actorAccountId: s.owner.id, grantId: fresh });
      expect(await listed()).not.toContain(s.requestC2);
      expect(await bell()).toEqual([`Update ${s.c1}`]);

      // With no live grant left, A's own past requests and notices stay as history.
      await revokeGrant(s.db, { actorAccountId: s.owner.id, grantId: fresh });
      expect(await listed()).toEqual(expect.arrayContaining([s.requestC1, s.requestC2]));
      expect(await bell()).toEqual([`Update ${s.c1}`, `Update ${s.c2}`].sort());
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'exceptions follow the recipient: sharing all cases again keeps the case hidden; a grant for that case shows it',
    async () => {
      const s = await scenario();
      const c3 = await newCase(s);
      expect(
        isOk(
          await applyCaseSharingAnswers(await ownerManage(s, c3), {
            allowedGrantIds: [s.grantB],
            allowedInvitationIds: [],
          }),
        ),
      ).toBe(true);

      // Re-sharing all cases with A after a revoke keeps C3 hidden from A.
      await revokeGrant(s.db, { actorAccountId: s.owner.id, grantId: s.grantA });
      const again = await shareAllCasesWith(s, s.a);
      expect(isOk(await caseGate(s, s.a.adminId, c3))).toBe(false);
      expect(isOk(await caseGate(s, s.a.adminId, s.c1))).toBe(true);
      expect(
        (await listMissionsForOrganization(s.db, s.a.organizationId)).map((m) => m.missionId),
      ).not.toContain(c3);
      const carried = await s.db
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.eventType, 'GRANT_CASE_EXCLUDED'),
            eq(schema.auditEvents.grantId, again),
          ),
        );
      expect(carried.map((e) => [e.missionId, e.reason])).toEqual([[c3, 'carried_forward']]);
      expect(await memoryNotShared(s, c3)).toEqual([
        'organization:Agency A',
        'person:person@example.test',
      ]);

      // A grant for that one case is an explicit share: it reaches the case, and
      // A is no longer listed as not sharing it.
      const scoped = await createGrant(s.db, {
        actorAccountId: s.owner.id,
        applicantId: s.applicantId,
        recipientOrganizationId: s.a.organizationId,
        missionId: c3,
        actions: ['VIEW_METADATA'],
        purpose: 'this case',
      });
      if (!isOk(scoped)) throw new Error('scoped');
      await acceptGrant(s.db, { actorAccountId: s.a.adminId, grantId: scoped.value.id });
      expect(isOk(await caseGate(s, s.a.adminId, c3))).toBe(true);
      expect(await memoryNotShared(s, c3)).toEqual(['person:person@example.test']);
      const access = await listAccessForApplicantDetailed(s.db, s.owner.id, s.applicantId);
      if (!isOk(access)) throw new Error('access');
      expect(
        access.value
          .find((g) => g.id === again)
          ?.caseExceptions.map((e) => e.reachedByAnotherGrant),
      ).toEqual([true]);
      expect(
        access.value
          .find((g) => g.id === s.grantP)
          ?.caseExceptions.map((e) => e.reachedByAnotherGrant),
      ).toEqual([false]);
      await revokeGrant(s.db, { actorAccountId: s.owner.id, grantId: scoped.value.id });

      // An invitation to the same person carries their "no" too, shows it to the
      // owner, and the grant it becomes keeps it.
      const invitation = await createSharingInvitation(s.db, {
        actorAccountId: s.owner.id,
        applicantId: s.applicantId,
        email: 'person@example.test',
        actions: ['VIEW_METADATA'],
        purpose: 'Invited review',
        encryption,
      });
      if (!isOk(invitation)) throw new Error(`invite: ${invitation.error.message}`);
      const recordProof = async (accountId: string) => {
        const gate = await requireAccess(
          s.db,
          accountPrincipal(accountId),
          'VIEW_METADATA',
          { applicantId: s.applicantId },
          { purpose: EACH_GRANT },
        );
        if (!isOk(gate)) throw new Error('gate');
        return gate.value;
      };
      const onInvitations = await listInvitationCaseExceptions(await recordProof(s.owner.id));
      if (!isOk(onInvitations)) throw new Error('invitation exceptions');
      expect(onInvitations.value.map((e) => [e.invitationId, e.missionTitle])).toEqual([
        [invitation.value.invitation.id, 'Japan trip 2027'],
      ]);
      // An organization that can view the record still cannot see the owner's exceptions.
      expect(isErr(await listInvitationCaseExceptions(await recordProof(s.b.adminId)))).toBe(true);
      const exported = await exportAccount(s.db, {
        actorAccountId: s.owner.id,
        accountId: s.owner.id,
      });
      if (!isOk(exported)) throw new Error('export');
      expect(
        exported.value.applicants[0]?.invitationCaseExceptions.map((e) => [
          e.invitedEmail,
          e.caseTitle,
          e.invitationStatus,
        ]),
      ).toEqual([['person@example.test', 'Japan trip 2027', 'PENDING']]);
      const accepted = await acceptSharingInvitation(s.db, {
        actorAccountId: s.person.id,
        rawToken: invitation.value.rawToken,
      });
      if (!isOk(accepted)) throw new Error(`accept: ${accepted.error.message}`);
      expect((await exceptionRows(s, c3)).some((r) => r.grantId === accepted.value)).toBe(true);
      await revokeGrant(s.db, { actorAccountId: s.owner.id, grantId: s.grantP });
      expect(isOk(await caseGate(s, s.person.id, c3))).toBe(false);
      expect(isOk(await caseGate(s, s.person.id, s.c1))).toBe(true);

      // Allowing follows the recipient as well: after Allow This Case, sharing all
      // cases with A again does not bring the old "no" back.
      expect(isOk(await removeCaseException(await ownerManage(s, c3), { grantId: again }))).toBe(
        true,
      );
      expect(await auditCount(s, 'GRANT_CASE_EXCLUSION_REMOVED', c3)).toBe(2);
      await revokeGrant(s.db, { actorAccountId: s.owner.id, grantId: again });
      await shareAllCasesWith(s, s.a);
      expect(isOk(await caseGate(s, s.a.adminId, c3))).toBe(true);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'the organization that runs a case cannot be excluded from it, and is never carried an exception for it',
    async () => {
      const s = await scenario();
      const c3 = await newCase(s);
      await s.db
        .update(schema.missions)
        .set({ ownerOrganizationId: s.a.organizationId })
        .where(eq(schema.missions.id, c3));
      const refused = await applyCaseSharingAnswers(await ownerManage(s, c3), {
        allowedGrantIds: [s.grantB],
        allowedInvitationIds: [],
      });
      expect(isErr(refused) && refused.error.code).toBe('invalid');
      expect(isErr(refused) && refused.error.message).toContain('Agency A runs this case');
      expect(await exceptionRows(s, c3)).toHaveLength(0);
      expect(
        isOk(
          await applyCaseSharingAnswers(await ownerManage(s, c3), {
            allowedGrantIds: [s.grantA, s.grantB],
            allowedInvitationIds: [],
          }),
        ),
      ).toBe(true);

      // An exception recorded before A ran the case is not carried to A's next grant.
      const c4 = await newCase(s, 'Japan trip 2028');
      await applyCaseSharingAnswers(await ownerManage(s, c4), {
        allowedGrantIds: [s.grantB, s.grantP],
        allowedInvitationIds: [],
      });
      await s.db
        .update(schema.missions)
        .set({ ownerOrganizationId: s.a.organizationId })
        .where(eq(schema.missions.id, c4));
      await revokeGrant(s.db, { actorAccountId: s.owner.id, grantId: s.grantA });
      const next = await shareAllCasesWith(s, s.a);
      expect((await exceptionRows(s, c4)).map((r) => r.grantId)).toEqual([s.grantA]);
      expect(isOk(await caseGate(s, s.a.adminId, c4))).toBe(true);
      expect(next).toBeDefined();
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'a hidden case looks exactly like one that does not exist',
    async () => {
      const s = await scenario();
      await exclude(s, s.grantA, s.c2);
      const unknown = await caseGate(s, s.a.adminId, '00000000-0000-4000-8000-000000000000');
      const hidden = await caseGate(s, s.a.adminId, s.c2);
      expect(isErr(hidden) && hidden.error).toEqual(isErr(unknown) && unknown.error);
      expect(isErr(hidden) && hidden.error.code).toBe('not_found');
      // The owner and an organization that reaches the case are unaffected.
      expect(isOk(await caseGate(s, s.owner.id, s.c2))).toBe(true);
      expect(isOk(await caseGate(s, s.b.adminId, s.c2))).toBe(true);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'a case id is trusted only for the person it belongs to',
    async () => {
      const s = await scenario();
      const otherOwner = await consentedAccount(s.db, 'other-owner@example.test');
      const other = await createApplicant(s.db, {
        actorAccountId: otherOwner.id,
        ownerAccountId: otherOwner.id,
        displayName: 'Someone Else',
      });
      if (!isOk(other)) throw new Error('other');
      const foreign = await createMission(s.db, {
        actorAccountId: otherOwner.id,
        applicantId: other.value.id,
        title: 'Someone else trip',
      });
      if (!isOk(foreign)) throw new Error('foreign');
      await s.db.insert(schema.missionNotes).values({
        missionId: foreign.value.id,
        body: 'Private to someone else',
        visibility: 'TRAVELLER_SHARED',
      });
      await s.db
        .insert(schema.missionTasks)
        .values({ missionId: foreign.value.id, description: 'Someone else task' });
      const aId = s.a.organizationId;
      // A's all-cases grant is on this person, not on the other one.
      expect(await orgGrantPermits(s.db, aId, s.applicantId, 'COMMENT', foreign.value.id)).toBe(
        false,
      );
      expect(await listNotes(s.db, aId, s.applicantId, foreign.value.id)).toEqual([]);
      expect(await listTasksForOrg(s.db, aId, s.applicantId, foreign.value.id)).toEqual([]);
      expect(await listAppointmentsForOrg(s.db, aId, s.applicantId, foreign.value.id)).toEqual([]);
      // The matching pair still works.
      expect((await listNotes(s.db, aId, s.applicantId, s.c1)).length).toBeGreaterThan(0);
    },
    HEAVY_TIMEOUT_MS,
  );
});
