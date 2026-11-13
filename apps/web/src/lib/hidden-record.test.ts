import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  RATE_LIMITS,
  acceptGrant,
  createApplicant,
  createGrant,
  createMission,
  fileComplaint,
  provisionAccount,
  setConsent,
} from '@visastack/services';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CASE_HIDDEN_LINE,
  COMPLAINT_HIDDEN_LINE,
  GRANT_HIDDEN_LINE,
  PROFILE_HIDDEN_LINE,
  ownsApplicant,
  ownsCase,
  ownsComplaint,
  ownsGrant,
} from './hidden-record';

/**
 * The one check every record action makes before any work: does the signed-in account OWN this
 * record? Run against a real database, so the answers come from the real access gate and the real
 * lookups. Whoever is not the owner, whether the record is real, made up or not even an id, gets
 * the same false, so an action built on it can only ever give one answer.
 */

const MADE_UP = '99999999-9999-4999-8999-999999999999';
const NOT_AN_ID = ['not-an-id', '', "1'; drop table applicants; --", '../../etc/passwd'];

interface World {
  db: Db;
  owner: string;
  stranger: string;
  grantee: string;
  applicantId: string;
  missionId: string;
  complaintId: string;
  grantId: string;
  /** A second person the stranger owns, with a case and a grant of their own. */
  strangerApplicantId: string;
  strangerMissionId: string;
  strangerGrantId: string;
}
let world: World;

async function account(db: Db, email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!made.ok) throw new Error(`account ${email}`);
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, {
      actorAccountId: made.value.id,
      accountId: made.value.id,
      type,
      granted: true,
    });
  }
  return made.value.id;
}

async function personWithCase(db: Db, ownerId: string, name: string) {
  const person = await createApplicant(db, {
    actorAccountId: ownerId,
    ownerAccountId: ownerId,
    displayName: name,
  });
  if (!person.ok) throw new Error(`applicant ${name}`);
  const mission = await createMission(db, {
    actorAccountId: ownerId,
    applicantId: person.value.id,
    title: `${name} case`,
  });
  if (!mission.ok) throw new Error(`case ${name}`);
  return { applicantId: person.value.id, missionId: mission.value.id };
}

async function grantTo(db: Db, ownerId: string, applicantId: string, recipient: string) {
  const grant = await createGrant(db, {
    actorAccountId: ownerId,
    applicantId,
    recipientAccountId: recipient,
    actions: ['VIEW_METADATA'],
    // The purpose the checks ask with, so the gate really lets the recipient in: they can look, yet are not the owner.
    purpose: 'self',
  });
  if (!grant.ok) throw new Error(`grant: ${JSON.stringify(grant.error)}`);
  const accepted = await acceptGrant(db, { actorAccountId: recipient, grantId: grant.value.id });
  if (!accepted.ok) throw new Error('accept');
  return grant.value.id;
}

// One test holds the clock inside a clock hour; every test gets the real clock back, pass or fail.
afterEach(() => {
  vi.useRealTimers();
});

beforeAll(async () => {
  const db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  const owner = await account(db, 'owner@example.com');
  const stranger = await account(db, 'stranger@example.com');
  const grantee = await account(db, 'grantee@example.com');
  const mine = await personWithCase(db, owner, 'Rahima Akter');
  const theirs = await personWithCase(db, stranger, 'Nadia Rahman');
  const complaint = await fileComplaint(db, {
    actorAccountId: owner,
    missionId: mine.missionId,
    description: 'It took far too long.',
  });
  if (!complaint.ok) throw new Error('complaint');
  world = {
    db,
    owner,
    stranger,
    grantee,
    ...mine,
    complaintId: complaint.value.id,
    grantId: await grantTo(db, owner, mine.applicantId, grantee),
    strangerApplicantId: theirs.applicantId,
    strangerMissionId: theirs.missionId,
    // The owner is a recipient of this one: real access to someone else's person, still no ownership.
    strangerGrantId: await grantTo(db, stranger, theirs.applicantId, owner),
  };
}, 120_000);

type Who = 'owner' | 'stranger' | 'grantee';
const idOf = (who: Who) => world[who];

describe('ownsCase and ownsApplicant', () => {
  const subjects = {
    ownsCase: {
      run: (who: Who, id: string) => ownsCase(world.db, idOf(who), id),
      real: () => world.missionId,
    },
    ownsApplicant: {
      run: (who: Who, id: string) => ownsApplicant(world.db, idOf(who), id),
      real: () => world.applicantId,
    },
  } as const;

  describe.each(Object.entries(subjects))('%s', (_name, subject) => {
    it('is true for the owner of the record', async () => {
      expect(await subject.run('owner', subject.real())).toBe(true);
    });

    it.each(['stranger', 'grantee'] as const)(
      'is false for %s on a real record, who may not be told it exists',
      async (who) => {
        expect(await subject.run(who, subject.real())).toBe(false);
      },
    );

    it('is false for a made-up id, even the owner (nothing is there)', async () => {
      expect(await subject.run('stranger', MADE_UP)).toBe(false);
      expect(await subject.run('owner', MADE_UP)).toBe(false);
    });

    it.each(NOT_AN_ID)('is false, and does not fail, for %j which is not an id', async (bad) => {
      expect(await subject.run('stranger', bad)).toBe(false);
      expect(await subject.run('owner', bad)).toBe(false);
    });

    it('is the very same answer for a stranger whether the record is real, made up or not an id', async () => {
      const answers = [
        await subject.run('stranger', subject.real()),
        await subject.run('stranger', MADE_UP),
        ...(await Promise.all(NOT_AN_ID.map((bad) => subject.run('stranger', bad)))),
      ];
      expect(new Set(answers)).toEqual(new Set([false]));
    });
  });

  it('is false for a real record that belongs to a different owner', async () => {
    expect(await ownsCase(world.db, world.owner, world.strangerMissionId)).toBe(false);
    expect(await ownsApplicant(world.db, world.owner, world.strangerApplicantId)).toBe(false);
    expect(await ownsCase(world.db, world.stranger, world.strangerMissionId)).toBe(true);
  });
});

describe("the audit trail keeps a probe of any record id that is not the caller's", () => {
  const refused = async () =>
    (await world.db.select().from(schema.auditEvents)).filter(
      (row) => row.eventType === 'HIDDEN_RECORD_REFUSED',
    );

  it('writes one event naming ids only for a stranger on a real or made-up case or person, and nothing for anyone else', async () => {
    const before = (await refused()).length;
    expect(await ownsApplicant(world.db, world.owner, world.applicantId)).toBe(true);
    expect(await ownsCase(world.db, world.stranger, 'not-an-id')).toBe(false);
    expect((await refused()).length).toBe(before);
    // A made-up id is kept exactly like a real one (13 Nov 2026): the prober reads their own audit
    // rows in their data export, so a row only for real ids would tell them which ids are real.
    expect(await ownsApplicant(world.db, world.stranger, MADE_UP)).toBe(false);
    const madeUpRows = (await refused()).slice(before);
    expect(madeUpRows.map((r) => [r.resourceType, r.actorAccountId, r.result, r.reason])).toEqual([
      ['applicant', world.stranger, 'DENIED', null],
    ]);
    const afterMadeUp = (await refused()).length;

    expect(await ownsApplicant(world.db, world.stranger, world.applicantId)).toBe(false);
    expect(await ownsCase(world.db, world.stranger, world.missionId)).toBe(false);
    const rows = (await refused()).slice(afterMadeUp);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.resourceType, r.actorAccountId, r.result, r.reason])).toEqual([
      ['applicant', world.stranger, 'DENIED', null],
      ['case', world.stranger, 'DENIED', null],
    ]);
    // The real and the made-up row carry the same fields, apart from the id named.
    const shape = (r: (typeof rows)[number]) => [r.eventType, r.action, r.method, r.metadata];
    expect(shape(rows[0] as (typeof rows)[number])).toEqual(
      shape(madeUpRows[0] as (typeof rows)[number]),
    );
    // The same answer comes back either way: the probe record never changes it.
    expect(await ownsApplicant(world.db, world.stranger, world.applicantId)).toBe(
      await ownsApplicant(world.db, world.stranger, MADE_UP),
    );
  });

  it('keeps at most a bounded number of probes per account, then one id-free capped row, alike for real and made-up ids', async () => {
    // A fresh prober, so the bound is counted from zero.
    const prober = await account(world.db, `prober-${Date.now()}@example.com`);
    const rowsOf = async (who: string) =>
      (await world.db.select().from(schema.auditEvents)).filter(
        (row) => row.actorAccountId === who,
      );
    const idRows = async (who: string) =>
      (await rowsOf(who)).filter((row) => row.eventType === 'HIDDEN_RECORD_REFUSED');
    const cappedRows = async (who: string) =>
      (await rowsOf(who)).filter((row) => row.eventType === 'HIDDEN_RECORD_PROBES_CAPPED');
    const limit = RATE_LIMITS.HIDDEN_RECORD_PROBE_AUDIT.limit;
    // The bound is counted per clock hour, so the clock is held inside one hour here: on the real
    // clock a run that crossed the top of an hour started a new count and wrote extra id rows.
    // Only Date is held; timers keep running for the database.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T10:20:00Z'));
    for (let index = 0; index < limit; index += 1) {
      const id = `99999999-9999-4999-8999-${String(index).padStart(12, '0')}`;
      expect(await ownsCase(world.db, prober, id)).toBe(false);
    }
    expect(await idRows(prober)).toHaveLength(limit);
    expect(await cappedRows(prober)).toHaveLength(0);

    // Past the bound: one real and one made-up id write exactly one capped row and no id row.
    expect(await ownsCase(world.db, prober, world.missionId)).toBe(false);
    expect(await ownsCase(world.db, prober, MADE_UP)).toBe(false);
    expect(await ownsApplicant(world.db, prober, world.applicantId)).toBe(false);
    expect(await idRows(prober)).toHaveLength(limit);
    const capped = await cappedRows(prober);
    expect(capped).toHaveLength(1);
    // The capped row names the account only: no id, no person, no case, no grant, no reason.
    expect(
      capped.map((row) => [
        row.resourceType,
        row.resourceId,
        row.applicantId,
        row.missionId,
        row.grantId,
        row.reason,
        row.result,
        row.metadata,
      ]),
    ).toEqual([[null, null, null, null, null, null, 'DENIED', { capped: true, limit }]]);

    // Another account keeps its own budget: its probe still gets its own id row.
    const other = await account(world.db, `other-prober-${Date.now()}@example.com`);
    expect(await ownsCase(world.db, other, world.missionId)).toBe(false);
    expect((await idRows(other)).map((row) => row.resourceId)).toEqual([world.missionId]);
    expect(await cappedRows(other)).toHaveLength(0);

    // The next clock hour is a new window: the first account's probe is recorded with its id again.
    vi.setSystemTime(new Date('2026-11-13T11:20:00Z'));
    expect(await ownsCase(world.db, prober, MADE_UP)).toBe(false);
    expect(await idRows(prober)).toHaveLength(limit + 1);
    expect(await cappedRows(prober)).toHaveLength(1);
  }, 120_000);
});

describe('ownsGrant', () => {
  const run = (who: Who, applicantId: string, grantId: string) =>
    ownsGrant(world.db, idOf(who), applicantId, grantId);

  it('is true for the owner, with their own person and a grant on that person', async () => {
    expect(await run('owner', world.applicantId, world.grantId)).toBe(true);
  });

  it('is false for the person who was given the access, who is not the owner', async () => {
    expect(await run('grantee', world.applicantId, world.grantId)).toBe(false);
  });

  it('is false for a stranger, whichever person they name', async () => {
    expect(await run('stranger', world.applicantId, world.grantId)).toBe(false);
    expect(await run('stranger', world.strangerApplicantId, world.grantId)).toBe(false);
    expect(await run('owner', world.strangerApplicantId, world.strangerGrantId)).toBe(false);
  });

  it('is false for the owner who names their own person with someone else’s grant', async () => {
    expect(await run('stranger', world.strangerApplicantId, world.strangerGrantId)).toBe(true);
    expect(await run('owner', world.applicantId, world.strangerGrantId)).toBe(false);
  });

  it('is the very same answer for a stranger on a real grant, a made-up grant, a made-up person and a malformed person', async () => {
    const answers = [
      await run('stranger', world.applicantId, world.grantId),
      await run('stranger', world.applicantId, MADE_UP),
      await run('stranger', MADE_UP, world.grantId),
      ...(await Promise.all(NOT_AN_ID.map((bad) => run('stranger', bad, world.grantId)))),
      ...(await Promise.all(NOT_AN_ID.map((bad) => run('stranger', world.applicantId, bad)))),
    ];
    expect(new Set(answers)).toEqual(new Set([false]));
  });

  it('is false for the owner when the grant is made up or the person is not an id', async () => {
    expect(await run('owner', world.applicantId, MADE_UP)).toBe(false);
    for (const bad of NOT_AN_ID) expect(await run('owner', bad, world.grantId)).toBe(false);
  });
});

describe('ownsComplaint', () => {
  const run = (who: Who, missionId: string, complaintId: string) =>
    ownsComplaint(world.db, idOf(who), missionId, complaintId);

  it('is true for the owner who filed it, on their own case', async () => {
    expect(await run('owner', world.missionId, world.complaintId)).toBe(true);
  });

  it('is false for everyone else, however the case and the complaint are named', async () => {
    expect(await run('stranger', world.missionId, world.complaintId)).toBe(false);
    expect(await run('grantee', world.missionId, world.complaintId)).toBe(false);
    expect(await run('stranger', world.strangerMissionId, world.complaintId)).toBe(false);
    expect(await run('owner', world.missionId, MADE_UP)).toBe(false);
    expect(await run('owner', world.strangerMissionId, world.complaintId)).toBe(false);
  });

  it('is the very same answer for a stranger on a real complaint, a made-up one, and ids that are not ids', async () => {
    const answers = [
      await run('stranger', world.missionId, world.complaintId),
      await run('stranger', world.missionId, MADE_UP),
      await run('stranger', MADE_UP, world.complaintId),
      ...(await Promise.all(NOT_AN_ID.map((bad) => run('stranger', bad, world.complaintId)))),
      ...(await Promise.all(NOT_AN_ID.map((bad) => run('stranger', world.missionId, bad)))),
    ];
    expect(new Set(answers)).toEqual(new Set([false]));
  });
});

describe('the fixed lines', () => {
  it('are plain words, one per kind of record, and never say whether a record exists', () => {
    const lines = [CASE_HIDDEN_LINE, PROFILE_HIDDEN_LINE, GRANT_HIDDEN_LINE, COMPLAINT_HIDDEN_LINE];
    expect(new Set(lines).size).toBe(lines.length);
    for (const line of lines) {
      expect(line).toMatch(/^This [a-z]+ is not available to you\.$/);
      expect(line).not.toMatch(/not found|forbidden|denied|default_deny|exist/i);
    }
  });
});
