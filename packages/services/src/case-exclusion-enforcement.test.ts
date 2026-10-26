import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { EACH_GRANT, accountPrincipal, requireAccess } from './access';
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
import { setConsent } from './consent';
import type { Db } from './db';
import { registerDocument } from './documents';
import { createMission, listSelectedEvidenceForOrg } from './missions';
import { enqueueNotification, runNotificationWorker } from './notifications';
import { createOrganization, reviewOrganization } from './organizations';
import type { EmailPort, SendEmailInput, SendEmailResult } from './ports';
import { acceptGrant, createGrant, listAccessForApplicantDetailed, revokeGrant } from './sharing';
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
      const s = await scenario();
      await s.db.execute(sql`drop table grant_case_exclusions`);
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
