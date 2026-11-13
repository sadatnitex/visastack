import { randomUUID } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  addNote,
  assignMember,
  cancelEvidenceRequest,
  createAppointmentForOrg,
  createTaskForOrg,
  decideAppointmentForOrg,
  decideEvidenceResponse,
  decideTaskForOrg,
  listEvidenceRequestDecisions,
  listMissionDecisions,
  listNotes,
  recordMissionDecision,
  requestEvidence,
  requestEvidenceBatch,
  startEvidenceReview,
  unassignMember,
  updateAppointmentForOrg,
  updateTaskForOrg,
} from './agency';
import type { Db } from './db';
import { openRequest } from './evidence-submissions.test-support';
import type { Agency } from './evidence-submissions.test-support';
import { createMission } from './missions';
import { acceptGrant, createGrant } from './sharing';
import { type TrustWorld, addAdmin, trustWorld } from './trust-rules/trust-rules.test-support';

/**
 * A signed-in stranger (not a member of the organization, no grant on the traveller) who happens
 * to know a real case, request, task, appointment or organization id must be answered exactly as
 * if the id had been made up: the same code, the same message, no row changed and no audit entry
 * that says "allowed". Each case below calls one exported agency service twice as the stranger,
 * once with the real id and once with a made-up one, with otherwise valid input so the call
 * reaches its record lookup, and compares the two answers whole.
 *
 * Every function is tried as three kinds of stranger: someone who belongs to no organization,
 * someone with an organization of their own naming the foreign organization, and the same person
 * naming their own organization together with the foreign record.
 */

interface World extends TrustWorld {
  readonly missionId: string;
  readonly taskId: string;
  readonly appointmentId: string;
  readonly requestId: string;
  /** An active admin of north, assigned to the case (the genuine caseworker). */
  readonly caseworker: Agency;
  /** A signed-in account that belongs to no organization. */
  readonly loner: string;
  /** A signed-in account whose own, unrelated organization is `unrelated`. */
  readonly outsider: string;
}

async function buildWorld(): Promise<World> {
  const base = await trustWorld();
  const { db, rahim, north } = base;
  const mission = await createMission(db, {
    actorAccountId: rahim.accountId,
    applicantId: rahim.applicantId,
    title: 'Stranger test case',
  });
  if (!isOk(mission)) throw new Error('mission');
  const missionId = mission.value.id;
  const caseworker = await addAdmin(db, north, 'test-caseworker@example.test');
  const assigned = await assignMember(db, {
    actorAccountId: north.accountId,
    organizationId: north.organizationId,
    memberAccountId: caseworker.accountId,
    missionId,
  });
  if (!isOk(assigned)) throw new Error(`assign: ${assigned.error.message}`);
  const task = await createTaskForOrg(db, {
    actorAccountId: caseworker.accountId,
    organizationId: north.organizationId,
    missionId,
    description: 'Collect the bank letter',
  });
  if (!isOk(task)) throw new Error(`task: ${task.error.message}`);
  const appointment = await createAppointmentForOrg(db, {
    actorAccountId: caseworker.accountId,
    organizationId: north.organizationId,
    missionId,
    title: 'Biometrics',
    localDateTime: new Date('2030-01-10T09:00:00Z'),
    timezone: 'Asia/Dhaka',
  });
  if (!isOk(appointment)) throw new Error(`appointment: ${appointment.error.message}`);
  const requestId = await openRequest(db, north, rahim);
  const lone = await provisionAccount(db, { email: 'test-loner-stranger@example.test' });
  if (!isOk(lone)) throw new Error('loner');
  return {
    ...base,
    missionId,
    taskId: task.value.id,
    appointmentId: appointment.value.id,
    requestId,
    caseworker,
    loner: lone.value.id,
    outsider: base.unrelated.accountId,
  };
}

/** Every table a stranger's call could touch, read whole (audit entries are read separately). */
async function snapshot(db: Db): Promise<string> {
  const tables = [
    schema.assignments,
    schema.missionTasks,
    schema.missionAppointments,
    schema.missionNotes,
    schema.evidenceRequests,
    schema.evidenceRequestDecisions,
    schema.missionDecisions,
    schema.notifications,
    schema.grants,
    schema.memberships,
  ];
  const parts: unknown[] = [];
  for (const table of tables) {
    const rows = (await db.select().from(table)) as unknown as Array<Record<string, unknown>>;
    parts.push(rows.map((row) => JSON.stringify(row)).sort());
  }
  return JSON.stringify(parts);
}

async function auditRows(db: Db): Promise<Array<{ eventType: string; result: string | null }>> {
  const rows = await db.select().from(schema.auditEvents);
  return rows.map((row) => ({ eventType: row.eventType, result: row.result }));
}

interface Caller {
  readonly label: string;
  readonly accountId: string;
  readonly organizationId: string;
}

function callersOf(w: World): Caller[] {
  return [
    {
      label: 'no organization, names the foreign one',
      accountId: w.loner,
      organizationId: w.north.organizationId,
    },
    {
      label: 'own organization, names the foreign one',
      accountId: w.outsider,
      organizationId: w.north.organizationId,
    },
    {
      label: 'own organization, names it with the foreign record',
      accountId: w.outsider,
      organizationId: w.unrelated.organizationId,
    },
  ];
}

/** A case: what the stranger calls with the real id and with a made-up one. */
interface Probe {
  readonly name: string;
  readonly run: (
    w: World,
    who: Caller,
    ids: {
      missionId: string;
      taskId: string;
      appointmentId: string;
      requestId: string;
      applicantId: string;
    },
  ) => Promise<unknown>;
  /** The one audit entry this function may add on a refusal: the denied-attempt record. */
  readonly allowedAudit?: { eventType: string; result: 'DENIED' };
}

const probes: readonly Probe[] = [
  {
    name: 'assignMember',
    run: (w, who, ids) =>
      assignMember(w.db, {
        actorAccountId: who.accountId,
        organizationId: who.organizationId,
        memberAccountId: who.accountId,
        missionId: ids.missionId,
      }),
  },
  {
    name: 'unassignMember',
    run: (w, who, ids) =>
      unassignMember(w.db, {
        actorAccountId: who.accountId,
        organizationId: who.organizationId,
        memberAccountId: w.caseworker.accountId,
        missionId: ids.missionId,
      }),
  },
  {
    name: 'createTaskForOrg',
    run: (w, who, ids) =>
      createTaskForOrg(w.db, {
        actorAccountId: who.accountId,
        organizationId: who.organizationId,
        missionId: ids.missionId,
        description: 'Probe task',
      }),
  },
  {
    name: 'updateTaskForOrg',
    run: (w, who, ids) =>
      updateTaskForOrg(w.db, {
        actorAccountId: who.accountId,
        organizationId: who.organizationId,
        missionId: ids.missionId,
        taskId: ids.taskId,
        priority: 'URGENT',
      }),
  },
  {
    name: 'decideTaskForOrg',
    run: (w, who, ids) =>
      decideTaskForOrg(w.db, {
        actorAccountId: who.accountId,
        organizationId: who.organizationId,
        missionId: ids.missionId,
        taskId: ids.taskId,
        status: 'DONE',
      }),
  },
  {
    name: 'createAppointmentForOrg',
    run: (w, who, ids) =>
      createAppointmentForOrg(w.db, {
        actorAccountId: who.accountId,
        organizationId: who.organizationId,
        missionId: ids.missionId,
        title: 'Probe appointment',
        localDateTime: new Date('2030-02-01T09:00:00Z'),
        timezone: 'Asia/Dhaka',
      }),
  },
  {
    name: 'updateAppointmentForOrg',
    run: (w, who, ids) =>
      updateAppointmentForOrg(w.db, {
        actorAccountId: who.accountId,
        organizationId: who.organizationId,
        missionId: ids.missionId,
        appointmentId: ids.appointmentId,
        place: 'Probe place',
      }),
  },
  {
    name: 'decideAppointmentForOrg',
    run: (w, who, ids) =>
      decideAppointmentForOrg(w.db, {
        actorAccountId: who.accountId,
        organizationId: who.organizationId,
        missionId: ids.missionId,
        appointmentId: ids.appointmentId,
        status: 'DONE',
      }),
  },
  {
    name: 'addNote',
    allowedAudit: { eventType: 'MISSION_NOTE_DENIED', result: 'DENIED' },
    run: (w, who, ids) =>
      addNote(w.db, {
        actorAccountId: who.accountId,
        missionId: ids.missionId,
        body: 'Probe note',
        visibility: 'TRAVELLER_SHARED',
      }),
  },
  {
    name: 'requestEvidence',
    run: (w, who, ids) =>
      requestEvidence(w.db, {
        actorAccountId: who.accountId,
        organizationId: who.organizationId,
        applicantId: ids.applicantId,
        kind: 'DOCUMENT',
        docType: 'bank_statement',
        missionId: ids.missionId,
      }),
  },
  {
    name: 'requestEvidence (no case named)',
    run: (w, who, ids) =>
      requestEvidence(w.db, {
        actorAccountId: who.accountId,
        organizationId: who.organizationId,
        applicantId: ids.applicantId,
        kind: 'DOCUMENT',
        docType: 'bank_statement',
      }),
  },
  {
    // `requestEvidenceBatch` takes a central access proof, which a stranger cannot hold: they can
    // only hand it a forged one. (What the central gate `requireAccess` itself answers a stranger
    // for a real versus a made-up traveller is a separate, shared decision, not tested here.)
    name: 'requestEvidenceBatch (forged proof)',
    run: (_w, who, ids) =>
      requestEvidenceBatch({ applicant: { id: ids.applicantId } } as never, {
        organizationId: who.organizationId,
        items: [{ kind: 'DOCUMENT', key: 'bank_statement' }],
      }),
  },
  {
    name: 'startEvidenceReview',
    run: (w, who, ids) =>
      startEvidenceReview(w.db, { actorAccountId: who.accountId, requestId: ids.requestId }),
  },
  {
    name: 'decideEvidenceResponse',
    run: (w, who, ids) =>
      decideEvidenceResponse(w.db, {
        actorAccountId: who.accountId,
        requestId: ids.requestId,
        outcome: 'ACCEPTED',
      }),
  },
  {
    name: 'cancelEvidenceRequest',
    run: (w, who, ids) =>
      cancelEvidenceRequest(w.db, { actorAccountId: who.accountId, requestId: ids.requestId }),
  },
  {
    name: 'listEvidenceRequestDecisions',
    run: (w, who, ids) => listEvidenceRequestDecisions(w.db, who.accountId, ids.requestId),
  },
  {
    name: 'recordMissionDecision',
    run: (w, who, ids) =>
      recordMissionDecision(w.db, {
        actorAccountId: who.accountId,
        organizationId: who.organizationId,
        missionId: ids.missionId,
        packRequirementId: randomUUID(),
        outcome: 'ACCEPTED',
      }),
  },
  {
    name: 'listMissionDecisions',
    run: (w, who, ids) => listMissionDecisions(w.db, who.accountId, ids.missionId),
  },
  {
    // `listNotes` checks the person against the organization itself (`mayReadOrgCase`), and the
    // organization's standing on the case after that.
    name: 'listNotes',
    run: (w, who, ids) =>
      listNotes(w.db, who.accountId, who.organizationId, ids.applicantId, ids.missionId),
  },
];

/** `listNotes` answers for an organization, so it is only compared where the organization has no standing. */
const ORGANIZATION_ONLY = new Set(['listNotes']);

describe('a stranger gets the same answer for a real record and a made-up id', () => {
  let w: World;
  beforeAll(async () => {
    w = await buildWorld();
  }, 120_000);

  for (const probe of probes) {
    for (const callerIndex of [0, 1, 2]) {
      it(`${probe.name}: ${['no organization, names the foreign one', 'own organization, names the foreign one', 'own organization, names it with the foreign record'][callerIndex]}`, async () => {
        const who = callersOf(w)[callerIndex];
        if (!who) throw new Error('caller');
        if (ORGANIZATION_ONLY.has(probe.name) && who.organizationId === w.north.organizationId) {
          // The foreign organization really has standing: nothing to hide from it.
          return;
        }
        const real = {
          missionId: w.missionId,
          taskId: w.taskId,
          appointmentId: w.appointmentId,
          requestId: w.requestId,
          applicantId: w.rahim.applicantId,
        };
        const made = {
          missionId: randomUUID(),
          taskId: randomUUID(),
          appointmentId: randomUUID(),
          requestId: randomUUID(),
          applicantId: randomUUID(),
        };

        const beforeReal = await snapshot(w.db);
        const auditBeforeReal = await auditRows(w.db);
        const realAnswer = await probe.run(w, who, real);
        const afterReal = await snapshot(w.db);
        const auditAfterReal = await auditRows(w.db);

        const beforeMade = await snapshot(w.db);
        const auditBeforeMade = await auditRows(w.db);
        const madeAnswer = await probe.run(w, who, made);
        const afterMade = await snapshot(w.db);
        const auditAfterMade = await auditRows(w.db);

        // Same answer, whole: code and message (and anything else the answer carries).
        expect(realAnswer).toEqual(madeAnswer);
        // It was a refusal or an empty answer, never a success.
        expect(JSON.stringify(realAnswer)).not.toMatch(/"ok":true.*"value":\{"id"/);

        // No row changed, for either call.
        expect(afterReal).toBe(beforeReal);
        expect(afterMade).toBe(beforeMade);

        // No audit entry beyond the one denied-attempt record the function is allowed to keep.
        const extraReal = auditAfterReal.slice(auditBeforeReal.length);
        const extraMade = auditAfterMade.slice(auditBeforeMade.length);
        for (const entry of [...extraReal, ...extraMade]) {
          expect(entry).toEqual(probe.allowedAudit);
        }
      }, 60_000);
    }
  }

  it('the real records exist and work for the people who really have standing (guard against vacuous passes)', async () => {
    const ok = await listEvidenceRequestDecisions(w.db, w.north.accountId, w.requestId);
    expect(isOk(ok)).toBe(true);
    const decisions = await listMissionDecisions(w.db, w.rahim.accountId, w.missionId);
    expect(isOk(decisions)).toBe(true);
    const notes = await addNote(w.db, {
      actorAccountId: w.rahim.accountId,
      missionId: w.missionId,
      body: 'owner note',
      visibility: 'TRAVELLER_SHARED',
    });
    expect(isOk(notes)).toBe(true);
    const seen = await listNotes(
      w.db,
      w.north.accountId,
      w.north.organizationId,
      w.rahim.applicantId,
      w.missionId,
    );
    expect(seen.length).toBeGreaterThan(0);
    // The genuine caseworker can still do case work.
    const done = await decideTaskForOrg(w.db, {
      actorAccountId: w.caseworker.accountId,
      organizationId: w.north.organizationId,
      missionId: w.missionId,
      taskId: w.taskId,
      status: 'IN_PROGRESS',
    });
    expect(isOk(done)).toBe(true);
  });
});

describe('people with a real relationship keep their own, more specific answers', () => {
  it('a grantee who may look but not comment, and an unassigned admin, are still told "forbidden"', async () => {
    const w = await buildWorld();
    // The unrelated agency is given a look-only grant: it knows the traveller, so it keeps the
    // specific refusal.
    const grant = await createGrant(w.db, {
      actorAccountId: w.rahim.accountId,
      applicantId: w.rahim.applicantId,
      recipientOrganizationId: w.unrelated.organizationId,
      actions: ['PREVIEW'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(w.db, { actorAccountId: w.unrelated.accountId, grantId: grant.value.id });
    const note = await addNote(w.db, {
      actorAccountId: w.unrelated.accountId,
      missionId: w.missionId,
      body: 'look-only grantee',
      visibility: 'TRAVELLER_SHARED',
    });
    expect(note).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'forbidden',
        message: 'not authorized to comment on this case',
      }),
    });
    // North's owner holds the grant but is not assigned to the case.
    const decisions = await listMissionDecisions(w.db, w.north.accountId, w.missionId);
    expect(decisions).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'forbidden',
        message: 'not authorized to view decisions on this case',
      }),
    });
    // An admin of another agency that also holds a grant on the traveller is not a stranger to
    // the request either.
    const history = await listEvidenceRequestDecisions(w.db, w.unrelated.accountId, w.requestId);
    expect(history).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'forbidden',
        message: 'not authorized to view this request',
      }),
    });
  }, 120_000);
});
