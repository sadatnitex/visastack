import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  assignMember,
  listEvidenceRequestsForOrgDetailed,
  listNotes,
  listVisibleMissionsForMember,
} from './agency';
import { createApplicant } from './applicants';
import { listClientInvitations } from './client-invitations';
import { setConsent } from './consent';
import type { Db } from './db';
import { createMission } from './missions';
import { addMembership, createOrganization, reviewOrganization } from './organizations';
import { encodeTimeCursor } from './paging';
import { acceptGrant, createGrant } from './sharing';

/**
 * WP-SB5: the agency workspace reads its long lists one page at a time. These tests fill one
 * organization with far more cases, notes, evidence requests and client invitations than a page
 * shows, and check that every page read keeps the same access rules as the full read (a member
 * sees only assigned cases, another organization's internal notes stay hidden, lists stay
 * administrator data), walks the whole list with no gap or repeat, and treats a foreign or
 * malformed cursor as the first page.
 */

const CASES = 32;
const NOTES = 60;
const REQUESTS = 45;
const INVITATIONS = 40;

/** A time a fixed number of minutes after a base, so the order is known. */
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 0, minutes));

interface Seeded {
  readonly db: Db;
  readonly orgId: string;
  readonly otherOrgId: string;
  readonly adminId: string;
  readonly memberId: string;
  readonly strangerId: string;
  readonly applicantId: string;
  /** Newest opened first. */
  readonly missionIds: readonly string[];
  readonly assignedIds: ReadonlySet<string>;
  readonly notedMissionId: string;
}

let seeded: Seeded;

async function account(db: Db, email: string) {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  return p.value.id;
}

beforeAll(async () => {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema }) as unknown as Db;
  const travellerId = await account(db, 'sb5-traveller@example.com');
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, {
      actorAccountId: travellerId,
      accountId: travellerId,
      type,
      granted: true,
    });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: travellerId,
    ownerAccountId: travellerId,
    displayName: 'Synthetic traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const applicantId = applicant.value.id;

  const adminId = await account(db, 'sb5-admin@agency.example.com');
  const memberId = await account(db, 'sb5-member@agency.example.com');
  const strangerId = await account(db, 'sb5-stranger@agency.example.com');
  const reviewerId = await account(db, 'sb5-reviewer@platform.example.com');
  const org = await createOrganization(db, { actorAccountId: adminId, name: 'Synthetic Agency' });
  const other = await createOrganization(db, { actorAccountId: strangerId, name: 'Other Agency' });
  if (!isOk(org) || !isOk(other)) throw new Error('org');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewerId,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  await addMembership(db, {
    actorAccountId: adminId,
    organizationId: org.value.id,
    accountId: memberId,
    role: 'REVIEWER',
  });

  const created: string[] = [];
  for (let i = 0; i < CASES; i += 1) {
    const mission = await createMission(db, {
      actorAccountId: travellerId,
      applicantId,
      title: `Case ${i}`,
    });
    if (!isOk(mission)) throw new Error('mission');
    // Case i opened at minute i: the newest-first order is known.
    await db
      .update(schema.missions)
      .set({ createdAt: at(i) })
      .where(eq(schema.missions.id, mission.value.id));
    created.push(mission.value.id);
  }
  const grant = await createGrant(db, {
    actorAccountId: travellerId,
    applicantId,
    recipientOrganizationId: org.value.id,
    actions: ['MANAGE', 'COMMENT'],
    purpose: 'collaboration',
  });
  if (!isOk(grant)) throw new Error('grant');
  await acceptGrant(db, { actorAccountId: adminId, grantId: grant.value.id });

  // The member looks after every fifth case only.
  const assignedIds = new Set<string>();
  for (const [i, missionId] of created.entries()) {
    if (i % 5 !== 0) continue;
    const assigned = await assignMember(db, {
      actorAccountId: adminId,
      organizationId: org.value.id,
      memberAccountId: memberId,
      missionId,
    });
    if (!isOk(assigned)) throw new Error('assign');
    assignedIds.add(missionId);
  }

  // Notes on one case: shared, this organization's internal, and another organization's internal,
  // which must never appear on any page.
  const notedMissionId = created[0] as string;
  await db.insert(schema.missionNotes).values(
    Array.from({ length: NOTES }, (_, i) => ({
      missionId: notedMissionId,
      visibility: i % 3 === 2 ? ('AGENCY_INTERNAL' as const) : ('TRAVELLER_SHARED' as const),
      authorOrganizationId: i % 3 === 2 ? (i % 2 === 0 ? other.value.id : org.value.id) : null,
      body: `Note ${i}`,
      // Two notes share each minute, so the id decides between them.
      createdAt: at(Math.floor(i / 2)),
    })),
  );

  const statuses = ['OPEN', 'RECEIVED', 'NEEDS_REPLACEMENT'] as const;
  await db.insert(schema.evidenceRequests).values(
    Array.from({ length: REQUESTS }, (_, i) => ({
      organizationId: org.value.id,
      applicantId,
      kind: 'DOCUMENT' as const,
      docType: `doc_${i}`,
      status: statuses[i % 3] as (typeof statuses)[number],
      createdAt: at(Math.floor(i / 3)),
    })),
  );

  const inviteStatuses = ['PENDING', 'ACCEPTED', 'REVOKED', 'PENDING'] as const;
  await db.insert(schema.clientInvitations).values(
    Array.from({ length: INVITATIONS }, (_, i) => ({
      organizationId: org.value.id,
      caseOwnerAccountId: adminId,
      invitedByAccountId: adminId,
      displayName: `Client ${i}`,
      contactDestination: `client-${i}@example.com`,
      tokenHash: `sb5-token-${i}`,
      status: inviteStatuses[i % 4] as (typeof inviteStatuses)[number],
      expiresAt: at(100_000),
      createdAt: at(Math.floor(i / 2)),
    })),
  );

  seeded = {
    db,
    orgId: org.value.id,
    otherOrgId: other.value.id,
    adminId,
    memberId,
    strangerId,
    applicantId,
    missionIds: [...created].reverse(),
    assignedIds,
    notedMissionId,
  };
}, 120_000);

/** Reads every page from the first, following each next cursor. */
async function walk<T>(
  read: (before: string | undefined) => Promise<{ items: readonly T[]; next: string | null }>,
): Promise<T[]> {
  const seen: T[] = [];
  let before: string | undefined;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await read(before);
    seen.push(...page.items);
    if (!page.next) return seen;
    before = page.next;
  }
  throw new Error('paging never ended');
}

describe('listVisibleMissionsForMember with a page', () => {
  it('gives an administrator every case, newest opened first, with no gap or repeat', async () => {
    const { db, orgId, adminId, missionIds } = seeded;
    const first = await listVisibleMissionsForMember(db, orgId, adminId, { limit: 15 });
    expect(first.admin).toBe(true);
    expect(first.total).toBe(CASES);
    expect(first.missions).toHaveLength(15);
    expect(first.nextCursor).not.toBeNull();
    const all = await walk(async (before) => {
      const page = await listVisibleMissionsForMember(db, orgId, adminId, {
        limit: 15,
        ...(before ? { before } : {}),
      });
      return { items: page.missions.map((m) => m.missionId), next: page.nextCursor };
    });
    expect(all).toEqual(missionIds);
  });

  it('gives a member only the cases assigned to them, on every page', async () => {
    const { db, orgId, memberId, assignedIds } = seeded;
    const all = await walk(async (before) => {
      const page = await listVisibleMissionsForMember(db, orgId, memberId, {
        limit: 2,
        ...(before ? { before } : {}),
      });
      expect(page.admin).toBe(false);
      expect(page.total).toBe(assignedIds.size);
      return { items: page.missions.map((m) => m.missionId), next: page.nextCursor };
    });
    expect(new Set(all)).toEqual(assignedIds);
    expect(all).toHaveLength(assignedIds.size);
  });

  it('opens one case only when the reader may already see it', async () => {
    const { db, orgId, adminId, memberId, missionIds, assignedIds } = seeded;
    const notAssigned = missionIds.find((id) => !assignedIds.has(id)) as string;
    const assigned = [...assignedIds][0] as string;
    const forAdmin = await listVisibleMissionsForMember(db, orgId, adminId, {
      only: notAssigned,
    });
    expect(forAdmin.missions.map((m) => m.missionId)).toEqual([notAssigned]);
    expect(forAdmin.total).toBe(1);
    const forMember = await listVisibleMissionsForMember(db, orgId, memberId, {
      only: notAssigned,
    });
    expect(forMember).toEqual({ admin: false, missions: [], nextCursor: null, total: 0 });
    const own = await listVisibleMissionsForMember(db, orgId, memberId, { only: assigned });
    expect(own.missions.map((m) => m.missionId)).toEqual([assigned]);
    const outsider = await listVisibleMissionsForMember(db, orgId, seeded.strangerId, {
      only: assigned,
    });
    expect(outsider.missions).toEqual([]);
  });

  it('serves the first page for a cursor from another organization or a malformed one', async () => {
    const { db, orgId, otherOrgId, adminId, missionIds } = seeded;
    const foreign = encodeTimeCursor(
      { at: '2026-10-01T00:05:00.000000Z', id: missionIds[0] as string },
      `org:${otherOrgId}:visible-cases`,
    );
    for (const before of [foreign, 'not-a-cursor', '']) {
      const page = await listVisibleMissionsForMember(db, orgId, adminId, { limit: 3, before });
      expect(page.missions.map((m) => m.missionId)).toEqual(missionIds.slice(0, 3));
    }
  });

  it('keeps the old call returning every visible case', async () => {
    const { db, orgId, adminId, memberId, assignedIds } = seeded;
    expect((await listVisibleMissionsForMember(db, orgId, adminId)).missions).toHaveLength(CASES);
    expect((await listVisibleMissionsForMember(db, orgId, memberId)).missions).toHaveLength(
      assignedIds.size,
    );
  });
});

describe('listNotes with a page', () => {
  it('pages the readable notes newest first, never another organization’s internal note', async () => {
    const { db, orgId, applicantId, notedMissionId } = seeded;
    const everything = await listNotes(db, orgId, applicantId, notedMissionId);
    const first = await listNotes(db, orgId, applicantId, notedMissionId, {
      limit: 10,
      withTotal: true,
    });
    expect(first.items).toHaveLength(10);
    expect(first.total).toBe(everything.length);
    const all = await walk(async (before) => {
      const page = await listNotes(db, orgId, applicantId, notedMissionId, {
        limit: 7,
        ...(before ? { before } : {}),
      });
      return { items: page.items, next: page.nextCursor };
    });
    expect(all.map((n) => n.id).sort()).toEqual(everything.map((n) => n.id).sort());
    expect(new Set(all.map((n) => n.id)).size).toBe(all.length);
    for (const note of all) {
      expect(note.visibility === 'TRAVELLER_SHARED' || note.authorOrganizationId === orgId).toBe(
        true,
      );
    }
    const times = all.map((n) => n.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('continues after any note through its own cursor, as the Activity page merges cases', async () => {
    const { db, orgId, applicantId, notedMissionId } = seeded;
    const first = await listNotes(db, orgId, applicantId, notedMissionId, { limit: 10 });
    const fourth = first.items[3];
    if (!fourth) throw new Error('fourth note');
    const after = await listNotes(db, orgId, applicantId, notedMissionId, {
      limit: 6,
      before: fourth.cursor,
    });
    expect(after.items.map((n) => n.id)).toEqual(first.items.slice(4, 10).map((n) => n.id));
  });

  it('gives an organization without access an empty page, whatever the cursor', async () => {
    const { db, otherOrgId, applicantId, notedMissionId } = seeded;
    const page = await listNotes(db, otherOrgId, applicantId, notedMissionId, {
      limit: 10,
      withTotal: true,
    });
    expect(page).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('serves the first page for a foreign cursor', async () => {
    const { db, orgId, otherOrgId, applicantId, notedMissionId } = seeded;
    const first = await listNotes(db, orgId, applicantId, notedMissionId, { limit: 5 });
    const foreign = encodeTimeCursor(
      { at: '2026-10-01T00:03:00.000000Z', id: first.items[0]?.id as string },
      `org:${otherOrgId}:notes`,
    );
    const again = await listNotes(db, orgId, applicantId, notedMissionId, {
      limit: 5,
      before: foreign,
    });
    expect(again.items.map((n) => n.id)).toEqual(first.items.map((n) => n.id));
  });
});

describe('listEvidenceRequestsForOrgDetailed with a page', () => {
  it('pages every request newest first, with counts per status', async () => {
    const { db, orgId, adminId } = seeded;
    const everything = await listEvidenceRequestsForOrgDetailed(db, adminId, orgId);
    if (!everything.ok) throw new Error('full read');
    const first = await listEvidenceRequestsForOrgDetailed(db, adminId, orgId, { limit: 15 });
    if (!first.ok) throw new Error('first page');
    expect(first.value.total).toBe(REQUESTS);
    expect(first.value.statusCounts).toEqual({
      OPEN: REQUESTS / 3,
      RECEIVED: REQUESTS / 3,
      NEEDS_REPLACEMENT: REQUESTS / 3,
    });
    expect(first.value.items[0]?.applicantName).toBe('Synthetic traveller');
    const all = await walk(async (before) => {
      const page = await listEvidenceRequestsForOrgDetailed(db, adminId, orgId, {
        limit: 15,
        ...(before ? { before } : {}),
      });
      if (!page.ok) throw new Error('page');
      return { items: page.value.items.map((r) => r.id), next: page.value.nextCursor };
    });
    expect(all).toHaveLength(REQUESTS);
    expect(new Set(all)).toEqual(new Set(everything.value.map((r) => r.id)));
  });

  it('filters by status before paging', async () => {
    const { db, orgId, adminId } = seeded;
    const all = await walk(async (before) => {
      const page = await listEvidenceRequestsForOrgDetailed(db, adminId, orgId, {
        limit: 4,
        statuses: ['OPEN'],
        ...(before ? { before } : {}),
      });
      if (!page.ok) throw new Error('page');
      expect(page.value.total).toBe(REQUESTS / 3);
      return { items: page.value.items, next: page.value.nextCursor };
    });
    expect(all).toHaveLength(REQUESTS / 3);
    expect(all.every((r) => r.status === 'OPEN')).toBe(true);
  });

  it('stays administrator data', async () => {
    const { db, orgId, memberId } = seeded;
    const page = await listEvidenceRequestsForOrgDetailed(db, memberId, orgId, { limit: 15 });
    expect(page.ok).toBe(false);
  });
});

describe('listClientInvitations with a page', () => {
  it('pages one status newest first with its total', async () => {
    const { db, orgId, adminId } = seeded;
    const input = { actorAccountId: adminId, organizationId: orgId };
    const all = await walk(async (before) => {
      const page = await listClientInvitations(db, input, {
        limit: 15,
        status: 'PENDING',
        ...(before ? { before } : {}),
      });
      if (!page.ok) throw new Error('page');
      expect(page.value.total).toBe(INVITATIONS / 2);
      return { items: page.value.items, next: page.value.nextCursor };
    });
    expect(all).toHaveLength(INVITATIONS / 2);
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
    expect(all.every((i) => i.status === 'PENDING')).toBe(true);
    const times = all.map((i) => i.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('refuses anyone who is not an owner or administrator', async () => {
    const { db, orgId, memberId, strangerId } = seeded;
    for (const actorAccountId of [memberId, strangerId]) {
      const page = await listClientInvitations(
        db,
        { actorAccountId, organizationId: orgId },
        { limit: 15 },
      );
      expect(page.ok).toBe(false);
    }
  });

  it('serves the first page for a cursor made for another organization', async () => {
    const { db, orgId, otherOrgId, adminId } = seeded;
    const input = { actorAccountId: adminId, organizationId: orgId };
    const first = await listClientInvitations(db, input, { limit: 5 });
    if (!first.ok) throw new Error('first');
    const foreign = encodeTimeCursor(
      { at: '2026-10-01T00:10:00.000000Z', id: first.value.items[0]?.id as string },
      `org:${otherOrgId}:client-invitations`,
    );
    const again = await listClientInvitations(db, input, { limit: 5, before: foreign });
    if (!again.ok) throw new Error('again');
    expect(again.value.items.map((i) => i.id)).toEqual(first.value.items.map((i) => i.id));
  });
});
