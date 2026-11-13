import { randomUUID } from 'node:crypto';
import { type Result, isErr, isOk } from '@visastack/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { EACH_GRANT, accountPrincipal, requireAccess } from './access';
import { listAccessEndsForOrg } from './access-ends';
import { provisionAccount } from './accounts';
import {
  addNote,
  assignMember,
  createAppointmentForOrg,
  createTaskForOrg,
  decideAppointmentForOrg,
  decideTaskForOrg,
  listApplicantsForOrganization,
  listAppointmentsForOrg,
  listAssignmentsDetailed,
  listEvidenceRequestsForOrg,
  listMissionRequirementsForOrg,
  listMissionsForOrganization,
  listNotes,
  listRespondingDocumentStatesForOrg,
  listTasksForOrg,
  listUnassignedActiveMissions,
  listVisibleMissionsForMember,
  updateAppointmentForOrg,
  updateTaskForOrg,
} from './agency';
import type { Db } from './db';
import { openRequest } from './evidence-submissions.test-support';
import {
  attachPackVersion,
  createMission,
  listSelectedEvidenceForOrg,
  selectEvidence,
} from './missions';
import { addMembership, setMembershipActive } from './organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  listRequirements,
  publishPackVersion,
} from './packs';
import { editFact, registerFieldDefinition } from './profile';
import { type TrustWorld, addAdmin, trustWorld } from './trust-rules/trust-rules.test-support';

/**
 * The agency reads and writes that are told an organization id check the acting person against
 * that organization themselves (defence in depth under the agency layout's own check). Every one
 * is called as each kind of stranger with a real organization and a real case, and the answer
 * must be exactly the answer the genuine caseworker gets for a made-up organization id: nothing
 * that tells a stranger the organization or the case exists. The genuine caseworker, called with
 * the real ids, still gets the real data.
 *
 * Strangers: a removed member (was an admin assigned to the case), the admin of an unrelated
 * agency, the traveller who owns the record, and, for the reads, an active member of the agency
 * who is not assigned to the case and is not an admin (the console shows them nothing of it).
 */

const MADE_UP_ORG = randomUUID();
const MADE_UP_CASE = randomUUID();

interface World extends TrustWorld {
  /** A case with a published list attached and one requirement's evidence chosen. */
  readonly caseA: string;
  /** A case with the same list and nothing chosen. */
  readonly caseB: string;
  /** A case nobody is assigned to (the reassignment queue). */
  readonly caseC: string;
  readonly taskId: string;
  readonly appointmentId: string;
  /** An active admin of north, assigned to case A and case B. */
  readonly caseworker: string;
  /** An active REVIEWER of north: not an admin, assigned to nothing (until the last test). */
  readonly reviewer: string;
  readonly strangers: Readonly<Record<string, string>>;
}

async function buildWorld(): Promise<World> {
  const base = await trustWorld();
  const { db, rahim, north } = base;
  const pack = await createPack(db, {
    actorAccountId: rahim.accountId,
    key: 'test.matrix',
    name: 'Matrix',
  });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, {
    actorAccountId: rahim.accountId,
    packId: pack.value.id,
  });
  if (!isOk(version)) throw new Error('version');
  await addRequirement(db, {
    actorAccountId: rahim.accountId,
    packVersionId: version.value.id,
    kind: 'FIELD',
    fieldKey: 'passport.number',
    citation: 'rule 1',
  });
  await approvePackVersion(db, {
    actorAccountId: rahim.accountId,
    packVersionId: version.value.id,
  });
  await publishPackVersion(db, {
    actorAccountId: rahim.accountId,
    packVersionId: version.value.id,
  });

  const newCase = async (title: string) => {
    const mission = await createMission(db, {
      actorAccountId: rahim.accountId,
      applicantId: rahim.applicantId,
      title,
    });
    if (!isOk(mission)) throw new Error('mission');
    const attached = await attachPackVersion(db, {
      actorAccountId: rahim.accountId,
      missionId: mission.value.id,
      packVersionId: version.value.id,
    });
    if (!isOk(attached)) throw new Error(`attach: ${attached.error.message}`);
    return mission.value.id;
  };
  const caseA = await newCase('Case A');
  const caseB = await newCase('Case B');
  const caseC = await newCase('Case C');

  await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
  const fact = await editFact(db, {
    actorAccountId: rahim.accountId,
    applicantId: rahim.applicantId,
    fieldKey: 'passport.number',
    value: 'A1234567',
  });
  if (!isOk(fact)) throw new Error('fact');
  const [requirement] = await listRequirements(db, version.value.id);
  if (!requirement) throw new Error('requirement');
  const selected = await selectEvidence(db, {
    actorAccountId: rahim.accountId,
    missionId: caseA,
    packRequirementId: requirement.id,
    factId: fact.value.fact.id,
  });
  if (!isOk(selected)) throw new Error(`select: ${selected.error.message}`);

  const assign = async (accountId: string, missionId: string) => {
    const assigned = await assignMember(db, {
      actorAccountId: north.accountId,
      organizationId: north.organizationId,
      memberAccountId: accountId,
      missionId,
    });
    if (!isOk(assigned)) throw new Error(`assign: ${assigned.error.message}`);
  };
  const caseworker = await addAdmin(db, north, 'test-matrix-caseworker@example.test');
  await assign(caseworker.accountId, caseA);
  await assign(caseworker.accountId, caseB);

  // A former admin who worked on case A, then was turned off.
  const removed = await addAdmin(db, north, 'test-matrix-removed@example.test');
  await assign(removed.accountId, caseA);
  const off = await setMembershipActive(db, {
    actorAccountId: north.accountId,
    organizationId: north.organizationId,
    membershipId: removed.membershipId,
    active: false,
  });
  if (!isOk(off)) throw new Error(`remove: ${off.error.message}`);

  // An active reviewer of north who is not an admin and is not assigned to anything.
  const reviewer = await provisionAccount(db, { email: 'test-matrix-reviewer@example.test' });
  if (!isOk(reviewer)) throw new Error('reviewer account');
  const asReviewer = await addMembership(db, {
    actorAccountId: north.accountId,
    organizationId: north.organizationId,
    accountId: reviewer.value.id,
    role: 'REVIEWER',
  });
  if (!isOk(asReviewer)) throw new Error(`reviewer: ${asReviewer.error.message}`);

  const task = await createTaskForOrg(db, {
    actorAccountId: caseworker.accountId,
    organizationId: north.organizationId,
    missionId: caseA,
    description: 'Collect the bank letter',
  });
  if (!isOk(task)) throw new Error(`task: ${task.error.message}`);
  const appointment = await createAppointmentForOrg(db, {
    actorAccountId: caseworker.accountId,
    organizationId: north.organizationId,
    missionId: caseA,
    title: 'Biometrics',
    localDateTime: new Date('2030-01-10T09:00:00Z'),
    timezone: 'Asia/Dhaka',
  });
  if (!isOk(appointment)) throw new Error(`appointment: ${appointment.error.message}`);
  // The traveller's own note on the case, shared with the agency.
  const note = await addNote(db, {
    actorAccountId: rahim.accountId,
    missionId: caseA,
    body: 'A note for the agency',
    visibility: 'TRAVELLER_SHARED',
  });
  if (!isOk(note)) throw new Error(`note: ${note.error.message}`);
  await openRequest(db, north, rahim);

  return {
    ...base,
    caseA,
    caseB,
    caseC,
    taskId: task.value.id,
    appointmentId: appointment.value.id,
    caseworker: caseworker.accountId,
    reviewer: reviewer.value.id,
    strangers: {
      'removed member': removed.accountId,
      'unrelated agency admin': base.unrelated.accountId,
      'traveller account': rahim.accountId,
    },
  };
}

/** A whole answer, in a form two answers can be compared by (maps and dates included). */
function shape(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v instanceof Map) return { map: [...v.entries()] };
    if (v instanceof Date) return v.toISOString();
    return v;
  });
}

type Call = (
  w: World,
  actor: string,
  organizationId: string,
  missionId: string,
) => Promise<unknown>;

/** Every agency read told an organization id. */
const READS: ReadonlyArray<readonly [string, Call]> = [
  ['listAccessEndsForOrg', (w, a, o, m) => listAccessEndsForOrg(w.db, a, o, [m])],
  ['listTasksForOrg', (w, a, o, m) => listTasksForOrg(w.db, a, o, w.rahim.applicantId, m)],
  [
    'listAppointmentsForOrg',
    (w, a, o, m) => listAppointmentsForOrg(w.db, a, o, w.rahim.applicantId, m),
  ],
  ['listMissionRequirementsForOrg', (w, a, o, m) => listMissionRequirementsForOrg(w.db, a, o, m)],
  ['listSelectedEvidenceForOrg', (w, a, o, m) => listSelectedEvidenceForOrg(w.db, a, o, m)],
  ['listNotes', (w, a, o, m) => listNotes(w.db, a, o, w.rahim.applicantId, m)],
  [
    'listNotes (one page)',
    (w, a, o, m) => listNotes(w.db, a, o, w.rahim.applicantId, m, { limit: 10, withTotal: true }),
  ],
  [
    'listAssignmentsDetailed',
    (w, a, o, m) => listAssignmentsDetailed(w.db, a, o, w.rahim.applicantId, m),
  ],
  ['listMissionsForOrganization', (w, a, o) => listMissionsForOrganization(w.db, a, o)],
  ['listApplicantsForOrganization', (w, a, o) => listApplicantsForOrganization(w.db, a, o)],
  ['listUnassignedActiveMissions', (w, a, o) => listUnassignedActiveMissions(w.db, a, o)],
  ['listVisibleMissionsForMember', (w, a, o) => listVisibleMissionsForMember(w.db, o, a)],
  [
    'listVisibleMissionsForMember (one page)',
    (w, a, o) => listVisibleMissionsForMember(w.db, o, a, { limit: 10 }),
  ],
  ['listEvidenceRequestsForOrg', (w, a, o) => listEvidenceRequestsForOrg(w.db, a, o)],
  [
    'listRespondingDocumentStatesForOrg',
    async (w, a, o) => {
      // The actor is inside the proof here: a stranger usually cannot mint one at all. Either way
      // the answer must be the empty one.
      const proof = await requireAccess(
        w.db,
        accountPrincipal(a),
        'MANAGE',
        { applicantId: w.rahim.applicantId },
        { purpose: EACH_GRANT, actingFor: { organizationId: o } },
      );
      return isOk(proof) ? listRespondingDocumentStatesForOrg(proof.value, o) : new Map();
    },
  ],
];

/** Every agency write told an organization id. Refused before anything is read or written. */
const WRITES: ReadonlyArray<readonly [string, Call]> = [
  [
    'createTaskForOrg',
    (w, a, o, m) =>
      createTaskForOrg(w.db, {
        actorAccountId: a,
        organizationId: o,
        missionId: m,
        description: 'A stranger task',
      }),
  ],
  [
    'updateTaskForOrg',
    (w, a, o, m) =>
      updateTaskForOrg(w.db, {
        actorAccountId: a,
        organizationId: o,
        missionId: m,
        taskId: w.taskId,
        assigneeAccountId: null,
      }),
  ],
  [
    'decideTaskForOrg',
    (w, a, o, m) =>
      decideTaskForOrg(w.db, {
        actorAccountId: a,
        organizationId: o,
        missionId: m,
        taskId: w.taskId,
        status: 'CANCELLED',
      }),
  ],
  [
    'createAppointmentForOrg',
    (w, a, o, m) =>
      createAppointmentForOrg(w.db, {
        actorAccountId: a,
        organizationId: o,
        missionId: m,
        title: 'A stranger appointment',
        localDateTime: new Date('2030-02-01T09:00:00Z'),
        timezone: 'Asia/Dhaka',
      }),
  ],
  [
    'updateAppointmentForOrg',
    (w, a, o, m) =>
      updateAppointmentForOrg(w.db, {
        actorAccountId: a,
        organizationId: o,
        missionId: m,
        appointmentId: w.appointmentId,
        place: 'Somewhere else',
      }),
  ],
  [
    'decideAppointmentForOrg',
    (w, a, o, m) =>
      decideAppointmentForOrg(w.db, {
        actorAccountId: a,
        organizationId: o,
        missionId: m,
        appointmentId: w.appointmentId,
        status: 'CANCELLED',
      }),
  ],
];

describe('agency functions told an organization check the person acting', () => {
  let w: World;
  beforeAll(async () => {
    w = await buildWorld();
  }, 120_000);

  const org = () => w.north.organizationId;

  it.each(READS)('%s: every stranger gets the made-up organization answer', async (_name, call) => {
    const madeUp = shape(await call(w, w.caseworker, MADE_UP_ORG, w.caseA));
    const strangers = {
      ...w.strangers,
      'unassigned reviewer': w.reviewer,
    };
    for (const [who, accountId] of Object.entries(strangers)) {
      expect(shape(await call(w, accountId, org(), w.caseA)), who).toBe(madeUp);
    }
  });

  it.each(WRITES)('%s: every stranger gets the made-up organization answer', async (_n, call) => {
    const madeUp = await call(w, w.caseworker, MADE_UP_ORG, w.caseA);
    expect(isErr(madeUp as Result<unknown, unknown>)).toBe(true);
    for (const [who, accountId] of Object.entries(w.strangers)) {
      expect(shape(await call(w, accountId, org(), w.caseA)), who).toBe(shape(madeUp));
    }
  });

  it('issuer confirmation lookup: a stranger gets one answer for a made-up agency, a made-up case, and a real case with or without evidence chosen', async () => {
    const lookups = (actor: string) =>
      Promise.all([
        listSelectedEvidenceForOrg(w.db, actor, MADE_UP_ORG, w.caseA),
        listSelectedEvidenceForOrg(w.db, actor, org(), MADE_UP_CASE),
        listSelectedEvidenceForOrg(w.db, actor, org(), w.caseB),
        listSelectedEvidenceForOrg(w.db, actor, org(), w.caseA),
      ]);
    const madeUp = shape(
      await listSelectedEvidenceForOrg(w.db, w.caseworker, MADE_UP_ORG, w.caseA),
    );
    for (const [who, accountId] of Object.entries(w.strangers)) {
      const answers = (await lookups(accountId)).map(shape);
      expect(answers, who).toEqual([madeUp, madeUp, madeUp, madeUp]);
    }
    // The genuine caseworker tells the cases apart, as the issuer form needs.
    const own = await lookups(w.caseworker);
    expect(own.map((r) => isOk(r))).toEqual([false, false, true, true]);
    expect(own[2] && isOk(own[2]) ? own[2].value : null).toEqual([]);
    expect(own[3] && isOk(own[3]) ? own[3].value.length : 0).toBe(1);
  });

  it('the genuine caseworker still reads everything with the real ids', async () => {
    const db: Db = w.db;
    const me = w.caseworker;
    const applicant = w.rahim.applicantId;
    expect((await listAccessEndsForOrg(db, me, org(), [w.caseA, w.caseB])).size).toBe(2);
    expect(await listTasksForOrg(db, me, org(), applicant, w.caseA)).toHaveLength(1);
    expect(await listAppointmentsForOrg(db, me, org(), applicant, w.caseA)).toHaveLength(1);
    const requirements = await listMissionRequirementsForOrg(db, me, org(), w.caseA);
    expect(isOk(requirements) && requirements.value.length).toBe(1);
    expect(await listNotes(db, me, org(), applicant, w.caseA)).toHaveLength(1);
    const assignees = await listAssignmentsDetailed(db, me, org(), applicant, w.caseA);
    expect(assignees.map((a) => a.memberAccountId)).toContain(me);
    expect((await listMissionsForOrganization(db, me, org())).length).toBe(3);
    expect(await listApplicantsForOrganization(db, me, org())).toHaveLength(1);
    expect((await listUnassignedActiveMissions(db, me, org())).map((m) => m.missionId)).toEqual([
      w.caseC,
    ]);
    expect((await listVisibleMissionsForMember(db, org(), me)).missions).toHaveLength(3);
    const requests = await listEvidenceRequestsForOrg(db, me, org());
    expect(isOk(requests) && requests.value.length).toBe(1);
    // And can still do case work.
    const done = await decideTaskForOrg(db, {
      actorAccountId: me,
      organizationId: org(),
      missionId: w.caseA,
      taskId: w.taskId,
      status: 'DONE',
    });
    expect(isOk(done)).toBe(true);
  });

  it('an active member who is not an admin reads only the cases assigned to them', async () => {
    const reviewer = w.reviewer;
    const assigned = await assignMember(w.db, {
      actorAccountId: w.north.accountId,
      organizationId: org(),
      memberAccountId: reviewer,
      missionId: w.caseB,
    });
    expect(isOk(assigned)).toBe(true);
    const applicant = w.rahim.applicantId;
    expect(isOk(await listMissionRequirementsForOrg(w.db, reviewer, org(), w.caseB))).toBe(true);
    expect(isOk(await listMissionRequirementsForOrg(w.db, reviewer, org(), w.caseA))).toBe(false);
    expect(await listTasksForOrg(w.db, reviewer, org(), applicant, w.caseA)).toEqual([]);
    const ends = await listAccessEndsForOrg(w.db, reviewer, org(), [w.caseA, w.caseB]);
    expect([...ends.keys()]).toEqual([w.caseB]);
    // Organization-wide lists stay administrator data.
    expect(await listMissionsForOrganization(w.db, reviewer, org())).toEqual([]);
    expect(await listApplicantsForOrganization(w.db, reviewer, org())).toEqual([]);
  });
});
