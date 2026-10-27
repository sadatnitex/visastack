import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  RATE_LIMITS,
  accountPrincipal,
  createApplicant,
  createMission,
  createTask,
  provisionAccount,
  replaceCalendarFeedLink,
  requireAccess,
  setConsent,
  turnOffCalendarFeed,
  turnOnCalendarFeed,
} from '@visastack/services';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashedSubject } from './client-address';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('./public-db', () => ({
  withPublicDb: async (work: (db: unknown) => unknown) => work(state.db),
}));

const { calendarFeedSecretFrom, calendarFeedUrls, loadCalendarFeed } = await import(
  './calendar-feed'
);

// Made-up values that must never reach a calendar app.
const CASE_TITLE = 'Japan Visit BX7319046';
const TASK_TEXT = 'Send bank statement for account 0123456789';
const OTHER_CASE = 'Canada Study Permit';
const NOW = new Date('2026-10-26T12:00:00Z');
const HEAVY = 60_000;

let db: Db;
let owner: { accountId: string; applicantId: string };
let other: { accountId: string; applicantId: string };

async function person(email: string, caseTitle: string, due: string) {
  const made = await provisionAccount(db, { email });
  if (!made.ok) throw new Error('provision');
  const accountId = made.value.id;
  await setConsent(db, {
    actorAccountId: accountId,
    accountId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: 'Synthetic Traveller',
  });
  if (!applicant.ok) throw new Error('applicant');
  const mission = await createMission(db, {
    actorAccountId: accountId,
    applicantId: applicant.value.id,
    title: caseTitle,
  });
  if (!mission.ok) throw new Error('mission');
  const task = await createTask(db, {
    actorAccountId: accountId,
    missionId: mission.value.id,
    description: TASK_TEXT,
    dueDate: new Date(`${due}T00:00:00.000Z`),
  });
  if (!task.ok) throw new Error('task');
  return { accountId, applicantId: applicant.value.id };
}

async function manage(who: { accountId: string; applicantId: string }) {
  const proof = await requireAccess(
    db,
    accountPrincipal(who.accountId),
    'MANAGE',
    { applicantId: who.applicantId },
    { purpose: 'self' },
  );
  if (!proof.ok) throw new Error('manage proof');
  return proof.value;
}

async function turnOn(who: { accountId: string; applicantId: string }): Promise<string> {
  const on = await turnOnCalendarFeed(await manage(who));
  if (!on.ok) throw new Error('turn on');
  return on.value.secret;
}

let address = 0;
/** A fresh network address per test, so rate-limit counts never carry over. */
const nextAddress = () => `203.0.113.${++address}`;

beforeAll(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  state.db = db;
  owner = await person('feed-owner@example.test', CASE_TITLE, '2026-11-03');
  other = await person('feed-other@example.test', OTHER_CASE, '2026-12-24');
}, HEAVY);

beforeEach(async () => {
  await db.delete(schema.calendarFeeds);
});

describe('the live calendar feed', () => {
  it(
    'serves the owner their own dates, with general titles and nothing personal',
    async () => {
      const secret = await turnOn(owner);
      const answer = await loadCalendarFeed(secret, nextAddress(), NOW);
      if (answer.state !== 'feed') throw new Error(`expected a feed, got ${answer.state}`);
      const ics = answer.ics;
      expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
      expect(ics).toContain('X-WR-CALNAME:VisaStack Dates');
      expect(ics).toContain('SUMMARY:Task Due\r\n');
      expect(ics).toContain('DTSTART;VALUE=DATE:20261103');
      expect(ics).toContain('DESCRIPTION:From VisaStack. Open VisaStack for the details.');
      expect(ics).toMatch(/UID:[0-9a-f]{32}@visastack/);
      expect(ics).toMatch(/SEQUENCE:\d+/);
      expect(ics).toContain('CLASS:PRIVATE');
      for (const secretThing of [CASE_TITLE, 'BX7319046', TASK_TEXT, '0123456789', 'Synthetic']) {
        expect(ics).not.toContain(secretThing);
      }
      expect(ics).not.toContain('BEGIN:VALARM');
      expect(ics).not.toContain(secret);
    },
    HEAVY,
  );

  it(
    "never carries another person's dates, even when both have links",
    async () => {
      const mine = await turnOn(owner);
      const theirs = await turnOn(other);
      const a = await loadCalendarFeed(mine, nextAddress(), NOW);
      const b = await loadCalendarFeed(theirs, nextAddress(), NOW);
      if (a.state !== 'feed' || b.state !== 'feed') throw new Error('feeds');
      expect(a.ics).toContain('20261103');
      expect(a.ics).not.toContain('20261224');
      expect(b.ics).toContain('20261224');
      expect(b.ics).not.toContain('20261103');
      const uids = (ics: string) => [...ics.matchAll(/UID:(\S+)/g)].map((m) => m[1]);
      expect(uids(a.ics).filter((uid) => uids(b.ics).includes(uid))).toEqual([]);
    },
    HEAVY,
  );

  it(
    'answers not found for a stopped link, a replaced link, an unknown link and a malformed one',
    async () => {
      const first = await turnOn(owner);
      const replaced = await replaceCalendarFeedLink(await manage(owner));
      if (!replaced.ok) throw new Error('replace');
      expect((await loadCalendarFeed(first, nextAddress(), NOW)).state).toBe('not_found');
      expect((await loadCalendarFeed(replaced.value.secret, nextAddress(), NOW)).state).toBe(
        'feed',
      );

      expect((await turnOffCalendarFeed(await manage(owner))).ok).toBe(true);
      expect((await loadCalendarFeed(replaced.value.secret, nextAddress(), NOW)).state).toBe(
        'not_found',
      );
      expect((await loadCalendarFeed('A'.repeat(43), nextAddress(), NOW)).state).toBe('not_found');
      expect((await loadCalendarFeed('../../etc', nextAddress(), NOW)).state).toBe('not_found');
    },
    HEAVY,
  );

  it(
    'stops as soon as the account that made the link no longer owns the traveller',
    async () => {
      const secret = await turnOn(owner);
      await db
        .update(schema.applicants)
        .set({ ownerAccountId: other.accountId })
        .where(eq(schema.applicants.id, owner.applicantId));
      try {
        expect((await loadCalendarFeed(secret, nextAddress(), NOW)).state).toBe('not_found');
      } finally {
        await db
          .update(schema.applicants)
          .set({ ownerAccountId: owner.accountId })
          .where(eq(schema.applicants.id, owner.applicantId));
      }
    },
    HEAVY,
  );

  it(
    'slows an address that tries unknown links, but never one fetching real links',
    async () => {
      const secret = await turnOn(owner);
      const guesser = nextAddress();
      for (let i = 0; i < RATE_LIMITS.CALENDAR_FEED_MISS_IP.limit; i++) {
        const guess = `${'B'.repeat(40)}${String(i).padStart(3, '0')}`;
        expect((await loadCalendarFeed(guess, guesser, NOW)).state).toBe('not_found');
      }
      expect((await loadCalendarFeed('C'.repeat(43), guesser, NOW)).state).toBe('busy');
      // A real link from the same address still works: only unknown links are slowed.
      expect((await loadCalendarFeed(secret, guesser, NOW)).state).toBe('feed');

      // A calendar service fetching real links from one address is never counted for them.
      const service = nextAddress();
      for (let i = 0; i < 5; i++) {
        expect((await loadCalendarFeed(secret, service, NOW)).state).toBe('feed');
      }
      const counted = await db
        .select()
        .from(schema.rateLimitBuckets)
        .where(eq(schema.rateLimitBuckets.subjectId, hashedSubject('net', service)));
      expect(counted).toEqual([]);
      await db.delete(schema.rateLimitBuckets);
    },
    HEAVY,
  );

  it(
    'bounds how often one link is read',
    async () => {
      const secret = await turnOn(owner);
      for (let i = 0; i < RATE_LIMITS.CALENDAR_FEED_READ.limit; i++) {
        expect((await loadCalendarFeed(secret, nextAddress(), NOW)).state).toBe('feed');
      }
      expect((await loadCalendarFeed(secret, nextAddress(), NOW)).state).toBe('busy');
      await db.delete(schema.rateLimitBuckets);
    },
    HEAVY * 2,
  );
});

describe('calendar link addresses', () => {
  it('builds the https and webcal forms, and reads the secret back with or without .ics', () => {
    const secret = 'S'.repeat(43);
    expect(calendarFeedUrls('https://vs.example.test/', secret)).toEqual({
      https: `https://vs.example.test/api/calendar-feed/${secret}.ics`,
      webcal: `webcal://vs.example.test/api/calendar-feed/${secret}.ics`,
    });
    expect(calendarFeedSecretFrom(`${secret}.ics`)).toBe(secret);
    expect(calendarFeedSecretFrom(secret)).toBe(secret);
    expect(calendarFeedSecretFrom(`${secret}.ics.ics`)).toBeNull();
    expect(calendarFeedSecretFrom('short.ics')).toBeNull();
  });
});
