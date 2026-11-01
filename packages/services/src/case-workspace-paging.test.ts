import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { listNotesForOwner } from './agency';
import { createApplicant } from './applicants';
import { listComplaintsForMission } from './complaints';
import { setConsent } from './consent';
import type { Db } from './db';
import { listFeedbackForMission } from './feedback';
import { createMission, listMissionSnapshots, listTasks } from './missions';
import { encodeSeqCursor } from './paging';

/**
 * WP-SB2: the case page reads each of its lists capped on the server. These tests fill one case
 * with far more rows than the page shows and check that a capped read returns only the first rows,
 * in a stable order, with the right totals, behind the same owner check as before, and that the
 * old uncapped call still returns everything.
 */

const BIG = 60;

interface Seeded {
  readonly db: Db;
  readonly ownerId: string;
  readonly strangerId: string;
  readonly missionId: string;
  readonly otherMissionId: string;
}

async function seedOwner(db: Db, email: string) {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  await setConsent(db, {
    actorAccountId: p.value.id,
    accountId: p.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: p.value.id,
    ownerAccountId: p.value.id,
    displayName: 'Synthetic traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const mission = await createMission(db, {
    actorAccountId: p.value.id,
    applicantId: applicant.value.id,
    title: 'Synthetic case',
  });
  if (!isOk(mission)) throw new Error('mission');
  return { accountId: p.value.id, missionId: mission.value.id };
}

/** A time a fixed number of minutes after a base, so the order is known. */
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 0, minutes));

let seeded: Seeded;

beforeAll(async () => {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema }) as unknown as Db;
  const owner = await seedOwner(db, 'sb2-owner@example.com');
  const stranger = await seedOwner(db, 'sb2-stranger@example.com');
  const { missionId } = owner;
  await db.insert(schema.missionSnapshots).values(
    Array.from({ length: BIG }, (_, i) => ({
      missionId,
      version: i + 1,
      content: { state: 'IN_PROGRESS' },
      checksum: `checksum-${i + 1}`,
    })),
  );
  // Every third task is still open, the rest are finished; the newest are finished, so a plain
  // newest-first cap would hide open work.
  await db.insert(schema.missionTasks).values(
    Array.from({ length: BIG }, (_, i) => ({
      missionId,
      description: `Task ${i}`,
      status: i % 3 === 0 && i < 30 ? ('OPEN' as const) : ('DONE' as const),
      createdAt: at(i),
    })),
  );
  await db.insert(schema.caseComplaints).values(
    Array.from({ length: BIG }, (_, i) => ({
      missionId,
      filedByAccountId: owner.accountId,
      description: `Complaint ${i}`,
      createdAt: at(i),
    })),
  );
  await db.insert(schema.caseFeedback).values(
    Array.from({ length: BIG }, (_, i) => ({
      missionId,
      submittedByAccountId: owner.accountId,
      comments: `Feedback ${i}`,
      createdAt: at(i),
    })),
  );
  // Shared and internal notes alternate: the capped read must still never show an internal one.
  await db.insert(schema.missionNotes).values(
    Array.from({ length: BIG }, (_, i) => ({
      missionId,
      visibility: i % 2 === 0 ? ('TRAVELLER_SHARED' as const) : ('AGENCY_INTERNAL' as const),
      body: `Note ${i}`,
      createdAt: at(i),
    })),
  );
  seeded = {
    db,
    ownerId: owner.accountId,
    strangerId: stranger.accountId,
    missionId,
    otherMissionId: stranger.missionId,
  };
}, 60_000);

describe('listMissionSnapshots with a page', () => {
  it('returns the newest page with a cursor, then the older rows, with no gap or repeat', async () => {
    const { db, ownerId, missionId } = seeded;
    const first = await listMissionSnapshots(db, ownerId, missionId, { limit: 5 });
    if (!first.ok) throw new Error('first page');
    expect(first.value.items.map((s) => s.version)).toEqual([60, 59, 58, 57, 56]);
    expect(first.value.nextCursor).not.toBeNull();
    const seen = [...first.value.items.map((s) => s.version)];
    let cursor = first.value.nextCursor;
    while (cursor) {
      const next = await listMissionSnapshots(db, ownerId, missionId, {
        limit: 25,
        before: cursor,
      });
      if (!next.ok) throw new Error('next page');
      seen.push(...next.value.items.map((s) => s.version));
      cursor = next.value.nextCursor;
    }
    expect(seen).toEqual(Array.from({ length: BIG }, (_, i) => BIG - i));
  });

  it('serves the first page for a cursor made for another case or a malformed one', async () => {
    const { db, ownerId, missionId, otherMissionId } = seeded;
    const foreign = encodeSeqCursor(10, `mission:${otherMissionId}:snapshots`);
    for (const before of [foreign, 'not-a-cursor', '']) {
      const page = await listMissionSnapshots(db, ownerId, missionId, { limit: 3, before });
      if (!page.ok) throw new Error('page');
      expect(page.value.items.map((s) => s.version)).toEqual([60, 59, 58]);
    }
  });

  it('clamps the page size to 100 and keeps the uncapped call unchanged', async () => {
    const { db, ownerId, missionId } = seeded;
    const huge = await listMissionSnapshots(db, ownerId, missionId, { limit: 10_000 });
    if (!huge.ok) throw new Error('huge');
    expect(huge.value.items).toHaveLength(BIG);
    expect(huge.value.nextCursor).toBeNull();
    const all = await listMissionSnapshots(db, ownerId, missionId);
    if (!all.ok) throw new Error('all');
    expect(all.value).toHaveLength(BIG);
  });

  it('refuses another account, page or not', async () => {
    const { db, strangerId, missionId } = seeded;
    expect((await listMissionSnapshots(db, strangerId, missionId, { limit: 5 })).ok).toBe(false);
    expect((await listMissionSnapshots(db, strangerId, missionId)).ok).toBe(false);
  });
});

describe('listTasks with a limit', () => {
  it('puts open tasks first, newest first, and counts the whole case', async () => {
    const { db, ownerId, missionId } = seeded;
    const capped = await listTasks(db, ownerId, missionId, { limit: 10 });
    if (!capped.ok) throw new Error('tasks');
    expect(capped.value.total).toBe(BIG);
    expect(capped.value.open).toBe(10);
    expect(capped.value.items).toHaveLength(10);
    expect(capped.value.items.every((t) => t.status === 'OPEN')).toBe(true);
    expect(capped.value.items.map((t) => t.description)).toEqual(
      [27, 24, 21, 18, 15, 12, 9, 6, 3, 0].map((i) => `Task ${i}`),
    );
    const next = await listTasks(db, ownerId, missionId, { limit: 12 });
    if (!next.ok) throw new Error('tasks');
    expect(next.value.items.slice(10).map((t) => t.description)).toEqual(['Task 59', 'Task 58']);
  });

  it('keeps the uncapped call and the owner check as they were', async () => {
    const { db, ownerId, strangerId, missionId } = seeded;
    const all = await listTasks(db, ownerId, missionId);
    if (!all.ok) throw new Error('all');
    expect(all.value).toHaveLength(BIG);
    expect((await listTasks(db, strangerId, missionId, { limit: 10 })).ok).toBe(false);
  });
});

describe('complaints and feedback with a limit', () => {
  it('returns the newest rows and the total', async () => {
    const { db, ownerId, missionId } = seeded;
    const complaints = await listComplaintsForMission(db, ownerId, missionId, { limit: 10 });
    const feedback = await listFeedbackForMission(db, ownerId, missionId, { limit: 10 });
    if (!complaints.ok || !feedback.ok) throw new Error('lists');
    expect(complaints.value.total).toBe(BIG);
    expect(complaints.value.items.map((c) => c.description)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Complaint ${BIG - 1 - i}`),
    );
    expect(feedback.value.total).toBe(BIG);
    expect(feedback.value.items.map((f) => f.comments)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Feedback ${BIG - 1 - i}`),
    );
  });

  it('refuses another account', async () => {
    const { db, strangerId, missionId } = seeded;
    expect((await listComplaintsForMission(db, strangerId, missionId, { limit: 10 })).ok).toBe(
      false,
    );
    expect((await listFeedbackForMission(db, strangerId, missionId, { limit: 10 })).ok).toBe(false);
  });
});

describe('listNotesForOwner with a limit', () => {
  it('returns only shared notes, newest first, with the shared total', async () => {
    const { db, ownerId, missionId } = seeded;
    const capped = await listNotesForOwner(db, ownerId, missionId, { limit: 10 });
    expect(capped.total).toBe(BIG / 2);
    expect(capped.items.map((n) => n.body)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Note ${58 - 2 * i}`),
    );
    const all = await listNotesForOwner(db, ownerId, missionId);
    expect(all).toHaveLength(BIG / 2);
  });

  it('gives a stranger nothing, capped or not', async () => {
    const { db, strangerId, missionId } = seeded;
    expect(await listNotesForOwner(db, strangerId, missionId, { limit: 10 })).toEqual({
      items: [],
      total: 0,
    });
    expect(await listNotesForOwner(db, strangerId, missionId)).toEqual([]);
  });
});
