import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  DEADLINE_CLOCK_DEFAULT_LIMIT,
  DEADLINE_CLOCK_MAX_LIMIT,
  DEADLINE_CLOCK_PAST_DAYS,
  type DeadlineEntry,
  deadlineUrgency,
  documentExpiryDoubt,
  listDeadlineClock,
  rankDeadlines,
} from './deadline-clock';
import { registerDocument } from './documents';
import { createAppointment, createMission, createTask } from './missions';
import { acceptGrant, createGrant } from './sharing';

// Made-up values, seeded so the tests can prove none of them reaches an entry.
const PASSPORT_NUMBER = 'BX7319046';
const FILE_NAME = 'Nusrat_Jahan_passport_scan.pdf';
const AGENCY_NOTE = `Please send your bank statement, account 0123456789, passport ${PASSPORT_NUMBER}`;
// 26 Oct 2026, 12:00 UTC: 18:00 the same day in Dhaka (the applicant's default time zone).
const NOW = new Date('2026-10-26T12:00:00Z');
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const HEAVY = 60_000;

let db: Db;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
});

async function account(email: string): Promise<string> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error(`provision ${email}`);
  return provisioned.value.id;
}

async function person(email: string, timezone?: string, displayName = 'Synthetic Traveller') {
  const ownerId = await account(email);
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: ownerId,
    ownerAccountId: ownerId,
    displayName,
  });
  if (!isOk(applicant)) throw new Error('applicant');
  if (timezone) {
    await db
      .update(schema.applicants)
      .set({ timezone })
      .where(eq(schema.applicants.id, applicant.value.id));
  }
  return { ownerId, applicantId: applicant.value.id };
}

async function proofFor(accountId: string, applicantId: string, purpose = 'self') {
  return requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId },
    { purpose },
  );
}

async function clock(
  who: { ownerId: string; applicantId: string },
  now: Date = NOW,
  limit?: number,
) {
  const proof = await proofFor(who.ownerId, who.applicantId);
  if (!isOk(proof)) throw new Error('owner proof');
  const listed = await listDeadlineClock(proof.value, {
    now,
    ...(limit === undefined ? {} : { limit }),
  });
  if (!isOk(listed)) throw new Error(`clock: ${listed.error.message}`);
  return listed.value;
}

async function caseFor(ownerId: string, applicantId: string, title: string) {
  const mission = await createMission(db, { actorAccountId: ownerId, applicantId, title });
  if (!isOk(mission)) throw new Error('mission');
  return mission.value.id;
}

async function task(
  ownerId: string,
  missionId: string,
  description: string,
  dueDate?: Date,
  dueTimezone?: string,
) {
  const created = await createTask(db, {
    actorAccountId: ownerId,
    missionId,
    description,
    ...(dueDate ? { dueDate } : {}),
    ...(dueTimezone ? { dueTimezone } : {}),
  });
  if (!isOk(created)) throw new Error('task');
  return created.value.id;
}

async function document(
  ownerId: string,
  applicantId: string,
  docType: string | null,
  expiresAt: Date | null,
  documentDate?: string,
) {
  const registered = await registerDocument(db, {
    actorAccountId: ownerId,
    applicantId,
    originalName: FILE_NAME,
    ...(docType ? { docType } : {}),
  });
  if (!isOk(registered)) throw new Error('document');
  await db
    .update(schema.documents)
    .set({ expiresAt, ...(documentDate ? { documentDate } : {}) })
    .where(eq(schema.documents.id, registered.value.id));
  return registered.value.id;
}

async function organization(): Promise<string> {
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Harbor Visas' })
    .returning({ id: schema.organizations.id });
  if (!org) throw new Error('org');
  return org.id;
}

async function request(
  organizationId: string,
  applicantId: string,
  values: { status: 'OPEN' | 'NEEDS_REPLACEMENT' | 'RECEIVED'; dueDate: Date; missionId?: string },
) {
  const [row] = await db
    .insert(schema.evidenceRequests)
    .values({
      organizationId,
      applicantId,
      missionId: values.missionId ?? null,
      kind: 'DOCUMENT',
      docType: 'BANK_STATEMENT',
      fieldKey: null,
      message: AGENCY_NOTE,
      dueDate: values.dueDate,
      status: values.status,
    })
    .returning({ id: schema.evidenceRequests.id });
  if (!row) throw new Error('request');
  return row.id;
}

function entry(overrides: Partial<DeadlineEntry> & Pick<DeadlineEntry, 'key'>): DeadlineEntry {
  return {
    kind: 'document_expires',
    applicantId: 'a',
    applicantName: 'Someone',
    date: '2026-11-01',
    daysUntil: 6,
    urgency: 'soon',
    docType: 'PASSPORT',
    subject: null,
    label: null,
    doubt: null,
    caseId: null,
    href: '/app',
    ...overrides,
  };
}

describe('deadlineUrgency: the four tones at their edges', () => {
  it('splits overdue, within 7 days, within 30 days and later', () => {
    expect(deadlineUrgency(-1)).toBe('overdue');
    expect(deadlineUrgency(-400)).toBe('overdue');
    expect(deadlineUrgency(0)).toBe('soon');
    expect(deadlineUrgency(7)).toBe('soon');
    expect(deadlineUrgency(8)).toBe('month');
    expect(deadlineUrgency(30)).toBe('month');
    expect(deadlineUrgency(31)).toBe('later');
  });
});

describe('documentExpiryDoubt: the dates the system is unsure of', () => {
  const base = {
    docType: 'PASSPORT',
    documentDate: null,
    expiryDay: '2027-04-30',
    daysUntil: 185,
  };
  it('trusts a date on a document whose kind the person accepted', () => {
    expect(documentExpiryDoubt(base)).toBeNull();
    expect(documentExpiryDoubt({ ...base, documentDate: '2017-05-01' })).toBeNull();
  });
  it('doubts a date read from a document whose kind was never accepted', () => {
    expect(documentExpiryDoubt({ ...base, docType: null })).toBe('kind_not_accepted');
  });
  it('doubts an expiry that falls before the document was issued', () => {
    expect(documentExpiryDoubt({ ...base, documentDate: '2028-01-01' })).toBe('date_before_issue');
    // The same day is not before.
    expect(documentExpiryDoubt({ ...base, documentDate: '2027-04-30' })).toBeNull();
  });
  it('doubts a date more than thirty years away, and not one just inside', () => {
    expect(documentExpiryDoubt({ ...base, daysUntil: 30 * 366 + 1 })).toBe('far_future');
    expect(documentExpiryDoubt({ ...base, daysUntil: 30 * 366 })).toBeNull();
  });
});

describe('rankDeadlines', () => {
  it('orders by days, then date, kind and key, the same for any input order, and keeps a key once', () => {
    const list = [
      entry({ key: 'document_expires:c', daysUntil: 40, date: '2026-12-05' }),
      entry({ key: 'task_due:a', kind: 'task_due', daysUntil: -2, date: '2026-10-24' }),
      entry({ key: 'request_due:b', kind: 'request_due', daysUntil: 6 }),
      entry({ key: 'document_expires:d', daysUntil: 6 }),
      entry({ key: 'document_expires:d', daysUntil: 6 }),
    ];
    const expected = ['task_due:a', 'request_due:b', 'document_expires:d', 'document_expires:c'];
    expect(rankDeadlines(list, 10).map((e) => e.key)).toEqual(expected);
    expect(rankDeadlines([...list].reverse(), 10).map((e) => e.key)).toEqual(expected);
    expect(rankDeadlines(list, 2).map((e) => e.key)).toEqual(expected.slice(0, 2));
    expect(rankDeadlines(list, 0)).toEqual([]);
  });

  it('always keeps the next date ahead, even when old overdue dates could fill every place', () => {
    const overdue = [-25, -20, -10, -2].map((days) =>
      entry({
        key: `task_due:${days}`,
        kind: 'task_due',
        daysUntil: days,
        urgency: 'overdue',
        date: '2026-10-01',
      }),
    );
    const ahead = [
      entry({ key: 'document_expires:p', daysUntil: 9 }),
      entry({ key: 'document_expires:q', daysUntil: 40 }),
    ];
    // Three places: the two most recently passed, then the next date ahead (the passport).
    expect(rankDeadlines([...overdue, ...ahead], 3).map((e) => e.key)).toEqual([
      'task_due:-10',
      'task_due:-2',
      'document_expires:p',
    ]);
    // One place: what is ahead wins.
    expect(rankDeadlines([...overdue, ...ahead], 1).map((e) => e.key)).toEqual([
      'document_expires:p',
    ]);
    // Nothing ahead: the passed dates fill every place, the most recent ones.
    expect(rankDeadlines(overdue, 3).map((e) => e.key)).toEqual([
      'task_due:-20',
      'task_due:-10',
      'task_due:-2',
    ]);
    // Little passed: what is ahead fills the rest, soonest first.
    expect(rankDeadlines([overdue[3] as DeadlineEntry, ...ahead], 3).map((e) => e.key)).toEqual([
      'task_due:-2',
      'document_expires:p',
      'document_expires:q',
    ]);
  });

  it('merges several people soonest first, whoever they belong to', () => {
    const ranked = rankDeadlines(
      [
        entry({ key: 'document_expires:1', applicantName: 'Ana', daysUntil: 50 }),
        entry({ key: 'document_expires:2', applicantName: 'Bo', daysUntil: 3 }),
        entry({ key: 'task_due:3', kind: 'task_due', applicantName: 'Cy', daysUntil: 12 }),
        entry({ key: 'document_expires:4', applicantName: 'Ana', daysUntil: 1 }),
      ],
      3,
    );
    expect(ranked.map((e) => e.key)).toEqual([
      'document_expires:4',
      'document_expires:2',
      'task_due:3',
    ]);
  });
});

describe('listDeadlineClock', () => {
  it(
    'lists the next dates across every source, soonest first, with day counts and tones',
    async () => {
      const who = await person('clock@example.com');
      const orgId = await organization();
      const visa = await caseFor(who.ownerId, who.applicantId, 'Japan Visit');
      const passport = await document(who.ownerId, who.applicantId, 'PASSPORT', day('2027-04-30'));
      const due = await task(who.ownerId, visa, 'Pay the visa fee', day('2026-10-29'));
      const asked = await request(orgId, who.applicantId, {
        status: 'NEEDS_REPLACEMENT',
        missionId: visa,
        dueDate: day('2026-10-27'),
      });
      const appointment = await createAppointment(db, {
        actorAccountId: who.ownerId,
        missionId: visa,
        title: `Biometrics for passport ${PASSPORT_NUMBER}`,
        localDateTime: new Date('2026-11-20T09:30:00.000Z'),
        timezone: 'Asia/Dhaka',
        place: 'Gulshan Avenue, House 12',
        channel: 'In Person',
      });
      if (!isOk(appointment)) throw new Error('appointment');

      const result = await clock(who, NOW, 10);
      expect(result.entries.map((e) => [e.key, e.daysUntil, e.urgency])).toEqual([
        [`request_due:${asked}`, 1, 'soon'],
        [`task_due:${due}`, 3, 'soon'],
        [`appointment:${appointment.value.id}`, 25, 'month'],
        [`document_expires:${passport}`, 186, 'later'],
      ]);
      expect(result.entries.every((e) => e.applicantId === who.applicantId)).toBe(true);
      expect(result.entries.find((e) => e.kind === 'document_expires')).toMatchObject({
        docType: 'PASSPORT',
        doubt: null,
        href: `/app/applicant/${who.applicantId}/expiry`,
      });
      expect(result.entries.find((e) => e.kind === 'task_due')).toMatchObject({
        label: 'Pay the visa fee',
        caseId: visa,
        href: `/app/mission/${visa}`,
      });
    },
    HEAVY,
  );

  it(
    'does not let old overdue items hide what is coming next',
    async () => {
      const who = await person('stale@example.com');
      const visa = await caseFor(who.ownerId, who.applicantId, 'Japan Visit');
      for (const [name, due] of [
        ['Old one', '2026-10-01'],
        ['Old two', '2026-10-05'],
        ['Old three', '2026-10-10'],
        ['Old four', '2026-10-12'],
      ] as const) {
        await task(who.ownerId, visa, name, day(due));
      }
      const passport = await document(who.ownerId, who.applicantId, 'PASSPORT', day('2026-11-04'));
      const entries = (await clock(who, NOW, 3)).entries;
      expect(entries.map((e) => e.date)).toEqual(['2026-10-10', '2026-10-12', '2026-11-04']);
      expect(entries.at(-1)?.key).toBe(`document_expires:${passport}`);
    },
    HEAVY,
  );

  it(
    'finds the soonest date even when many dated items share one stored day in different zones',
    async () => {
      const who = await person('many@example.com', 'Asia/Dhaka');
      const visa = await caseFor(who.ownerId, who.applicantId, 'Japan Visit');
      // Twelve tasks on the same stored day; the one in the earliest-ending zone is the soonest.
      for (let i = 0; i < 12; i++) {
        await task(who.ownerId, visa, `Later ${i}`, day('2026-10-28'), 'Pacific/Pago_Pago');
      }
      const soonest = await task(
        who.ownerId,
        visa,
        'Soonest',
        day('2026-10-28'),
        'Pacific/Kiritimati',
      );
      // 12:00 UTC on 26 Oct: 02:00 on the 27th in Kiritimati (so the 28th is tomorrow there),
      // 01:00 on the 26th in Pago Pago (so the 28th is two days away there).
      const result = await clock(who, NOW, 1);
      expect(result.entries.map((e) => e.key)).toEqual([`task_due:${soonest}`]);
      expect(result.entries[0]?.daysUntil).toBe(1);
    },
    HEAVY,
  );

  it(
    'returns only the limit asked for, three by default, never more than twenty',
    async () => {
      const who = await person('limit@example.com');
      const visa = await caseFor(who.ownerId, who.applicantId, 'Japan Visit');
      for (let i = 1; i <= 25; i++) {
        await task(who.ownerId, visa, `Step ${i}`, day(`2026-11-${String(i).padStart(2, '0')}`));
      }
      expect((await clock(who)).entries).toHaveLength(DEADLINE_CLOCK_DEFAULT_LIMIT);
      expect((await clock(who, NOW, 5)).entries).toHaveLength(5);
      expect((await clock(who, NOW, 500)).entries).toHaveLength(DEADLINE_CLOCK_MAX_LIMIT);
      expect((await clock(who, NOW, 0)).entries).toHaveLength(DEADLINE_CLOCK_DEFAULT_LIMIT);
      expect((await clock(who, NOW, 1.5)).entries).toHaveLength(DEADLINE_CLOCK_DEFAULT_LIMIT);
      // Soonest first: the first three days of November.
      expect((await clock(who)).entries.map((e) => e.date)).toEqual([
        '2026-11-01',
        '2026-11-02',
        '2026-11-03',
      ]);
    },
    HEAVY,
  );

  it(
    'counts a document day against the end of that day where the person is, not UTC midnight',
    async () => {
      const dhaka = await person('dhaka@example.com', 'Asia/Dhaka');
      const la = await person('la@example.com', 'America/Los_Angeles');
      const dhakaDoc = await document(
        dhaka.ownerId,
        dhaka.applicantId,
        'PASSPORT',
        day('2026-10-26'),
      );
      const laDoc = await document(la.ownerId, la.applicantId, 'PASSPORT', day('2026-10-26'));
      const days = async (who: typeof dhaka, key: string, at: string) =>
        (await clock(who, new Date(at))).entries.find((e) => e.key === key)?.daysUntil;

      // 23:30 on 26 Oct in Dhaka is 17:30 UTC: still the expiry day, so today (0), not overdue.
      expect(await days(dhaka, `document_expires:${dhakaDoc}`, '2026-10-26T17:30:00Z')).toBe(0);
      // 00:30 on 27 Oct in Dhaka is 18:30 UTC the day before: the day has ended there.
      expect(await days(dhaka, `document_expires:${dhakaDoc}`, '2026-10-26T18:30:00Z')).toBe(-1);

      // 23:30 on 26 Oct in Los Angeles is already 06:30 on 27 Oct in UTC: still today there.
      expect(await days(la, `document_expires:${laDoc}`, '2026-10-27T06:30:00Z')).toBe(0);
      expect(await days(la, `document_expires:${laDoc}`, '2026-10-27T07:30:00Z')).toBe(-1);
      expect(
        Object.is(await days(la, `document_expires:${laDoc}`, '2026-10-27T06:30:00Z'), -0),
      ).toBe(false);
    },
    HEAVY,
  );

  it(
    "counts a task in its own time zone when it has one, else the person's",
    async () => {
      const la = await person('task-zone@example.com', 'America/Los_Angeles');
      const visa = await caseFor(la.ownerId, la.applicantId, 'Japan Visit');
      const own = await task(la.ownerId, visa, 'Own zone', day('2026-10-27'), 'Asia/Tokyo');
      const follows = await task(la.ownerId, visa, 'Follows person', day('2026-10-27'));
      // 08:00 UTC on 27 Oct: 17:00 on the 27th in Tokyo, 01:00 on the 27th in Los Angeles.
      const at = new Date('2026-10-27T08:00:00Z');
      const result = await clock(la, at, 5);
      expect(result.entries.find((e) => e.key === `task_due:${own}`)?.daysUntil).toBe(0);
      expect(result.entries.find((e) => e.key === `task_due:${follows}`)?.daysUntil).toBe(0);
      // 16:00 UTC on 27 Oct: the 28th in Tokyo (overdue there), still the 27th in Los Angeles.
      const later = await clock(la, new Date('2026-10-27T16:00:00Z'), 5);
      expect(later.entries.find((e) => e.key === `task_due:${own}`)?.daysUntil).toBe(-1);
      expect(later.entries.find((e) => e.key === `task_due:${follows}`)?.daysUntil).toBe(0);
    },
    HEAVY,
  );

  it(
    "counts an appointment's day where it happens",
    async () => {
      const who = await person('appointment-zone@example.com', 'Asia/Dhaka');
      const visa = await caseFor(who.ownerId, who.applicantId, 'Japan Visit');
      const created = await createAppointment(db, {
        actorAccountId: who.ownerId,
        missionId: visa,
        title: 'Biometrics',
        localDateTime: new Date('2026-10-27T09:00:00.000Z'),
        timezone: 'America/Los_Angeles',
        place: 'Embassy',
        channel: 'In Person',
      });
      if (!isOk(created)) throw new Error('appointment');
      const key = `appointment:${created.value.id}`;
      // 02:00 UTC on 27 Oct is still the 26th in Los Angeles: tomorrow there, today in Dhaka.
      const early = await clock(who, new Date('2026-10-27T02:00:00Z'));
      expect(early.entries.find((e) => e.key === key)?.daysUntil).toBe(1);
      expect(early.entries.find((e) => e.key === key)?.date).toBe('2026-10-27');
    },
    HEAVY,
  );

  it(
    'leaves out what is over: finished cases, answered requests, undated and assigned-away tasks, old dates and replaced documents',
    async () => {
      const who = await person('left-out@example.com');
      const orgId = await organization();
      const staffId = await account('staff@example.com');
      const open = await caseFor(who.ownerId, who.applicantId, 'Open Case');
      const closed = await caseFor(who.ownerId, who.applicantId, 'Closed Case');
      await db
        .update(schema.missions)
        .set({ state: 'CLOSED' })
        .where(eq(schema.missions.id, closed));
      await task(who.ownerId, closed, 'On a closed case', day('2026-10-28'));
      await task(who.ownerId, open, 'No date');
      const away = await task(who.ownerId, open, 'Agency task', day('2026-10-28'));
      await db
        .update(schema.missionTasks)
        .set({ assigneeAccountId: staffId })
        .where(eq(schema.missionTasks.id, away));
      await request(orgId, who.applicantId, {
        status: 'RECEIVED',
        missionId: open,
        dueDate: day('2026-10-28'),
      });
      await request(orgId, who.applicantId, {
        status: 'OPEN',
        missionId: closed,
        dueDate: day('2026-10-28'),
      });
      await document(who.ownerId, who.applicantId, 'PASSPORT', null);
      const old = await document(who.ownerId, who.applicantId, 'BANK_STATEMENT', day('2025-01-01'));
      const replaced = await document(who.ownerId, who.applicantId, 'PASSPORT', day('2026-11-02'));
      await db
        .update(schema.documents)
        .set({ supersededByDocumentId: old })
        .where(eq(schema.documents.id, replaced));
      expect((await clock(who, NOW, 10)).entries).toEqual([]);
    },
    HEAVY,
  );

  it(
    'keeps a date that just passed on the clock for a month, then lets it go',
    async () => {
      const who = await person('window@example.com');
      const visa = await caseFor(who.ownerId, who.applicantId, 'Japan Visit');
      const recent = await task(who.ownerId, visa, 'Missed', day('2026-09-26'));
      const older = await task(who.ownerId, visa, 'Missed long ago', day('2026-09-25'));
      const keys = (await clock(who, NOW, 10)).entries.map((e) => e.key);
      expect(DEADLINE_CLOCK_PAST_DAYS).toBe(30);
      expect(keys).toContain(`task_due:${recent}`);
      expect(keys).not.toContain(`task_due:${older}`);
      const entryFor = (await clock(who, NOW, 10)).entries.find(
        (e) => e.key === `task_due:${recent}`,
      );
      expect(entryFor).toMatchObject({ daysUntil: -30, urgency: 'overdue' });
    },
    HEAVY,
  );

  it(
    'marks the dates it is unsure of: an unaccepted kind, an expiry before issue, an unreadable zone',
    async () => {
      const who = await person('doubt@example.com');
      const visa = await caseFor(who.ownerId, who.applicantId, 'Japan Visit');
      const sure = await document(who.ownerId, who.applicantId, 'PASSPORT', day('2027-04-30'));
      const unnamed = await document(who.ownerId, who.applicantId, null, day('2027-05-01'));
      const backwards = await document(
        who.ownerId,
        who.applicantId,
        'BANK_STATEMENT',
        day('2027-05-02'),
        '2028-01-01',
      );
      const odd = await task(who.ownerId, visa, 'Odd zone', day('2026-11-02'));
      await db
        .update(schema.missionTasks)
        .set({ dueTimezone: 'Mars/Olympus_Mons' })
        .where(eq(schema.missionTasks.id, odd));
      const fine = await task(who.ownerId, visa, 'Fine zone', day('2026-11-03'), 'Asia/Dhaka');

      const doubts = new Map(
        (await clock(who, NOW, 10)).entries.map((e) => [e.key, e.doubt] as const),
      );
      expect(doubts.get(`document_expires:${sure}`)).toBeNull();
      expect(doubts.get(`document_expires:${unnamed}`)).toBe('kind_not_accepted');
      expect(doubts.get(`document_expires:${backwards}`)).toBe('date_before_issue');
      expect(doubts.get(`task_due:${odd}`)).toBe('time_zone_unknown');
      expect(doubts.get(`task_due:${fine}`)).toBeNull();
    },
    HEAVY,
  );

  it(
    "marks every count as unsure when the person's own time zone is not one it knows",
    async () => {
      const who = await person('no-zone@example.com', 'Mars/Olympus_Mons');
      const passport = await document(who.ownerId, who.applicantId, 'PASSPORT', day('2026-11-05'));
      const entries = (await clock(who, NOW, 10)).entries;
      expect(entries.find((e) => e.key === `document_expires:${passport}`)).toMatchObject({
        daysUntil: 10,
        doubt: 'time_zone_unknown',
      });
    },
    HEAVY,
  );

  it(
    'is empty, without error, for a person with no dates',
    async () => {
      const who = await person('empty@example.com');
      expect((await clock(who)).entries).toEqual([]);
    },
    HEAVY,
  );

  it(
    "never carries a saved value, a file name, a number or an agency's note",
    async () => {
      const who = await person('private@example.com');
      const orgId = await organization();
      const visa = await caseFor(who.ownerId, who.applicantId, `Case ${PASSPORT_NUMBER}`);
      await document(who.ownerId, who.applicantId, 'PASSPORT', day('2027-04-30'));
      await task(who.ownerId, visa, 'Pay the fee', day('2026-10-29'));
      await request(orgId, who.applicantId, { status: 'OPEN', dueDate: day('2026-10-28') });
      await createAppointment(db, {
        actorAccountId: who.ownerId,
        missionId: visa,
        title: `Biometrics for passport ${PASSPORT_NUMBER}`,
        localDateTime: new Date('2026-11-02T09:30:00.000Z'),
        timezone: 'Asia/Dhaka',
        place: 'Gulshan Avenue, House 12',
        channel: 'In Person',
      });
      const text = JSON.stringify((await clock(who, NOW, 10)).entries);
      for (const secret of [
        PASSPORT_NUMBER,
        FILE_NAME,
        'Nusrat',
        '0123456789',
        'bank statement',
        'Gulshan',
        'Biometrics',
        'In Person',
      ]) {
        expect(text, secret).not.toContain(secret);
      }
    },
    HEAVY,
  );

  it(
    "never shows another person's dates: each owner sees only their own",
    async () => {
      const ana = await person('ana@example.com', undefined, 'Ana');
      const bo = await person('bo@example.com', undefined, 'Bo');
      const anaDoc = await document(ana.ownerId, ana.applicantId, 'PASSPORT', day('2026-11-02'));
      const boDoc = await document(bo.ownerId, bo.applicantId, 'PASSPORT', day('2026-11-04'));
      expect((await clock(ana)).entries.map((e) => e.key)).toEqual([`document_expires:${anaDoc}`]);
      expect((await clock(bo)).entries.map((e) => e.key)).toEqual([`document_expires:${boDoc}`]);

      // A stranger cannot even get a proof for Ana's file.
      const strangerId = await account('stranger@example.com');
      expect(isErr(await proofFor(strangerId, ana.applicantId))).toBe(true);
    },
    HEAVY,
  );

  it(
    'is for the owner only: a shared viewer and a copied proof are refused',
    async () => {
      const { ownerId, applicantId } = await person('owner@example.com');
      const friendId = await account('friend@example.com');
      const grant = await createGrant(db, {
        actorAccountId: ownerId,
        applicantId,
        recipientAccountId: friendId,
        actions: ['VIEW_METADATA'],
        purpose: 'family-help',
      });
      if (!isOk(grant)) throw new Error('grant');
      const accepted = await acceptGrant(db, { actorAccountId: friendId, grantId: grant.value.id });
      if (!isOk(accepted)) throw new Error('accept');
      const friend = await proofFor(friendId, applicantId, 'family-help');
      expect(isOk(friend)).toBe(true);
      if (!isOk(friend)) return;
      const refused = await listDeadlineClock(friend.value, { now: NOW });
      expect(isErr(refused) && refused.error.code).toBe('forbidden');

      const owner = await proofFor(ownerId, applicantId);
      if (!isOk(owner)) throw new Error('owner proof');
      const copy = { ...owner.value } as unknown as typeof owner.value;
      const copied = await listDeadlineClock(copy, { now: NOW });
      expect(isErr(copied) && copied.error.code).toBe('forbidden');
    },
    HEAVY,
  );
});
