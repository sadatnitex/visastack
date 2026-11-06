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
import { createMission, getMissionForOwner } from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import { listFittingPublicPacks } from './pack-matching';
import { acceptGrant, createGrant } from './sharing';
import {
  attachSelectedPackVersion,
  listSelectablePackVersions,
  pinnedPackNotice,
} from './umpe-pack-selection';

/**
 * VS-006: which checklists a person may pick and attach (synthetic data only). Pins that an
 * unreviewed global pack and another agency's private pack are neither listed nor attachable, that
 * a reviewed public pack, the case's own agency pack and a pack the case already holds all keep
 * working, and that the low-level attach primitive is unchanged.
 */

const UK = ['GB', 'United Kingdom', 'UK'];
const TOURISM = ['Tourism'];
const NONE = { terms: [], known: false };
const UNKNOWN = { nationality: NONE, residence: NONE };

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

describe('pack selection', () => {
  let db: Db;
  let actor: string;
  let applicantId: string;
  let missionId: string;
  let agencyA: string;
  let agencyB: string;
  let n = 0;

  beforeEach(async () => {
    db = await freshDb();
    const account = await provisionAccount(db, { email: 'select-owner@example.com' });
    if (!isOk(account)) throw new Error('provision');
    actor = account.value.id;
    await setConsent(db, {
      actorAccountId: actor,
      accountId: actor,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: actor,
      ownerAccountId: actor,
      displayName: 'Synthetic Traveller',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    applicantId = applicant.value.id;
    const mission = await createMission(db, {
      actorAccountId: actor,
      applicantId,
      title: 'Synthetic UK trip',
      destination: 'United Kingdom',
      purpose: 'Tourism',
    });
    if (!isOk(mission)) throw new Error('mission');
    missionId = mission.value.id;
    const orgs = await db
      .insert(schema.organizations)
      .values([
        { name: 'Synthetic Agency A', status: 'ACTIVE' },
        { name: 'Synthetic Agency B', status: 'ACTIVE' },
      ])
      .returning();
    agencyA = orgs[0]?.id ?? '';
    agencyB = orgs[1]?.id ?? '';
  });

  async function pack(input: {
    readonly status?: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN';
    readonly authoritative?: boolean;
    readonly organizationId?: string | null;
    readonly jurisdiction?: string;
    readonly name?: string;
    readonly nextReviewDate?: Date | null;
    readonly requirements?: number;
    readonly key?: string;
  }) {
    n += 1;
    const [row] = await db
      .insert(schema.packs)
      .values({
        key: input.key ?? `synthetic.selection.${n}`,
        name: input.name ?? `Synthetic Pack ${n}`,
        jurisdiction: input.jurisdiction ?? 'UK',
        purpose: 'Tourism',
        ownerOrganizationId: input.organizationId ?? null,
        authoritative: input.authoritative ?? true,
      })
      .returning();
    if (!row) throw new Error('pack');
    const [version] = await db
      .insert(schema.packVersions)
      .values({
        packId: row.id,
        version: 1,
        status: input.status ?? 'PUBLISHED',
        nextReviewDate: input.nextReviewDate ?? null,
      })
      .returning();
    if (!version) throw new Error('version');
    for (let i = 0; i < (input.requirements ?? 0); i += 1) {
      await db.insert(schema.packRequirements).values({
        packVersionId: version.id,
        kind: 'FIELD',
        fieldKey: `synthetic.field.${i}`,
        citation: `Synthetic rule ${i}`,
        optional: false,
      });
    }
    return version.id;
  }

  /** The gate's proof for this traveller record, as the case page and the actions get it. */
  async function proofFor<A extends 'MANAGE' | 'VIEW_METADATA'>(
    action: A,
    accountId = actor,
    forApplicant = applicantId,
  ) {
    const proof = await requireAccess(
      db,
      accountPrincipal(accountId),
      action,
      { applicantId: forApplicant },
      { purpose: 'self' },
    );
    if (!isOk(proof)) throw new Error(`proof: ${proof.error.message}`);
    return proof.value;
  }

  /** A stranger's own traveller record and case, so their proof is genuine but for another record. */
  async function strangerWithCase() {
    const account = await provisionAccount(db, { email: 'select-stranger@example.com' });
    if (!isOk(account)) throw new Error('provision');
    await setConsent(db, {
      actorAccountId: account.value.id,
      accountId: account.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const own = await createApplicant(db, {
      actorAccountId: account.value.id,
      ownerAccountId: account.value.id,
      displayName: 'Stranger',
    });
    if (!isOk(own)) throw new Error('applicant');
    return { accountId: account.value.id, applicantId: own.value.id };
  }

  /** A genuine MANAGE proof for an agency member the traveller shared this record with: not the owner. */
  async function sharedMemberProof<A extends 'MANAGE' | 'VIEW_METADATA'>(action: A) {
    const admin = await provisionAccount(db, { email: 'select-agency-admin@example.com' });
    if (!isOk(admin)) throw new Error('provision');
    for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
      await setConsent(db, {
        actorAccountId: actor,
        accountId: actor,
        type,
        granted: true,
      });
    }
    const org = await createOrganization(db, {
      actorAccountId: admin.value.id,
      name: 'Shared Agency',
    });
    if (!isOk(org)) throw new Error('org');
    const reviewer = await provisionAccount(db, { email: 'select-reviewer@example.com' });
    if (!isOk(reviewer)) throw new Error('reviewer');
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('review');
    const grant = await createGrant(db, {
      actorAccountId: actor,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['VIEW_METADATA', 'COMMENT', 'MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    const accepted = await acceptGrant(db, {
      actorAccountId: admin.value.id,
      grantId: grant.value.id,
    });
    if (!isOk(accepted)) throw new Error('accept');
    const proof = await requireAccess(
      db,
      accountPrincipal(admin.value.id),
      action,
      { applicantId },
      { purpose: 'collaboration' },
    );
    if (!isOk(proof)) throw new Error(`member proof: ${proof.error.message}`);
    return proof.value;
  }

  const select = async (input: { fitting?: readonly { packVersionId: string }[] } = {}) => {
    const listed = await listSelectablePackVersions(await proofFor('VIEW_METADATA'), {
      missionId,
      ...input,
    });
    if (!isOk(listed)) throw new Error(listed.error.message);
    return listed.value;
  };
  const setCaseAgency = (organizationId: string | null) =>
    db
      .update(schema.missions)
      .set({ ownerOrganizationId: organizationId })
      .where(eq(schema.missions.id, missionId));
  const heldPack = async () => {
    const held = await getMissionForOwner(db, actor, missionId);
    return isOk(held) ? held.value.packVersionId : 'unreadable';
  };

  describe('listSelectablePackVersions', () => {
    it('lists a reviewed public pack and hides an unreviewed one (the Visitor1 case)', async () => {
      const reviewed = await pack({ name: 'Reviewed Pack', requirements: 3 });
      await pack({ name: 'Visitor1', authoritative: false, requirements: 2 });
      const listed = await select();
      expect(listed.map((p) => p.packName)).toEqual(['Reviewed Pack']);
      expect(listed[0]).toMatchObject({
        packVersionId: reviewed,
        requirementCount: 3,
        authoritative: true,
        ownedByCaseAgency: false,
      });
    });

    it('never lists a draft or withdrawn version', async () => {
      await pack({ status: 'DRAFT' });
      await pack({ status: 'WITHDRAWN' });
      expect(await select()).toEqual([]);
    });

    it('lists the pack of the agency the case belongs to, and never another agency pack', async () => {
      const ownA = await pack({ organizationId: agencyA, authoritative: false, name: 'A Own' });
      await pack({ organizationId: agencyB, authoritative: false, name: 'B Private' });
      expect(await select()).toEqual([]);
      await setCaseAgency(agencyA);
      const listed = await select();
      expect(listed.map((p) => p.packName)).toEqual(['A Own']);
      expect(listed[0]).toMatchObject({ packVersionId: ownA, ownedByCaseAgency: true });
    });

    it('narrows reviewed public packs to the fitting list but keeps the agency own packs', async () => {
      const fits = await pack({ name: 'Fits' });
      await pack({ name: 'Elsewhere', jurisdiction: 'Canada' });
      const own = await pack({ organizationId: agencyA, authoritative: false, name: 'Own' });
      await setCaseAgency(agencyA);
      expect((await select({ fitting: [{ packVersionId: fits }] })).map((p) => p.packName)).toEqual(
        ['Fits', 'Own'],
      );
      // No fitting pack at all is the honest answer for an uncovered route: only own packs remain.
      expect((await select({ fitting: [] })).map((p) => p.packVersionId)).toEqual([own]);
    });

    it('works from the real fitting list: a pack for another destination is not offered', async () => {
      await pack({ name: 'UK', jurisdiction: 'UK' });
      await pack({ name: 'Canada', jurisdiction: 'Canada' });
      const fitting = await listFittingPublicPacks(db, {
        country: UK,
        purpose: TOURISM,
        traveller: UNKNOWN,
      });
      expect((await select({ fitting })).map((p) => p.packName)).toEqual(['UK']);
    });

    it('marks a review-overdue version but still lists it', async () => {
      const now = new Date('2026-11-04T00:00:00Z');
      await pack({ name: 'Overdue', nextReviewDate: new Date('2026-10-23T00:00:00Z') });
      await pack({ name: 'Current', nextReviewDate: new Date('2027-01-01T00:00:00Z') });
      await pack({ name: 'Undated' });
      const listed = await listSelectablePackVersions(await proofFor('VIEW_METADATA'), {
        missionId,
        now,
      });
      if (!isOk(listed)) throw new Error('list');
      expect(listed.value.map((p) => [p.packName, p.reviewOverdue])).toEqual([
        ['Current', false],
        ['Overdue', true],
        ['Undated', false],
      ]);
    });

    it("refuses another traveller's proof as 'not found', the same as a missing case", async () => {
      const stranger = await strangerWithCase();
      const proof = await proofFor('VIEW_METADATA', stranger.accountId, stranger.applicantId);
      const refused = await listSelectablePackVersions(proof, { missionId });
      const missing = await listSelectablePackVersions(proof, {
        missionId: '00000000-0000-4000-8000-000000000000',
      });
      expect(isErr(refused) && refused.error.code).toBe('not_found');
      expect(isErr(refused) && refused.error).toEqual(isErr(missing) && missing.error);
    });

    it('refuses a proof that is not the record owner, and a copied or wrong-action proof', async () => {
      const member = await sharedMemberProof('VIEW_METADATA');
      expect(member.actor.kind).not.toBe('applicant_owner');
      const asMember = await listSelectablePackVersions(member, { missionId });
      expect(isErr(asMember) && asMember.error.code).toBe('forbidden');
      const owner = await proofFor('VIEW_METADATA');
      const copy = { ...owner } as unknown as Parameters<typeof listSelectablePackVersions>[0];
      const refusedCopy = await listSelectablePackVersions(copy, { missionId });
      expect(isErr(refusedCopy) && refusedCopy.error.code).toBe('forbidden');
    });
  });

  describe('attachSelectedPackVersion', () => {
    const attach = async (packVersionId: string) =>
      attachSelectedPackVersion(await proofFor('MANAGE'), { missionId, packVersionId });

    it('attaches a reviewed public pack', async () => {
      const id = await pack({});
      const attached = await attach(id);
      expect(isOk(attached) && attached.value.packVersionId).toBe(id);
    });

    it('refuses an unreviewed global pack, even with a crafted id, and attaches nothing', async () => {
      const visitor = await pack({ authoritative: false, requirements: 2 });
      const refused = await attach(visitor);
      expect(isErr(refused) && refused.error.code).toBe('invalid');
      expect(isErr(refused) && refused.error.message).toMatch(/not been reviewed/);
      expect(await heldPack()).toBeNull();
    });

    it('refuses a draft or withdrawn version', async () => {
      for (const status of ['DRAFT', 'WITHDRAWN'] as const) {
        const id = await pack({ status });
        const refused = await attach(id);
        expect(isErr(refused) && refused.error.code).toBe('invalid');
      }
      expect(await heldPack()).toBeNull();
    });

    it("answers 'not found' for another agency's private pack, as for a missing one", async () => {
      const theirs = await pack({ organizationId: agencyB, authoritative: false });
      const refused = await attach(theirs);
      const missing = await attach('00000000-0000-4000-8000-000000000000');
      expect(isErr(refused) && refused.error).toEqual(isErr(missing) && missing.error);
      expect(isErr(refused) && refused.error.code).toBe('not_found');
      // Even the case's own agency cannot take another agency's pack.
      await setCaseAgency(agencyA);
      const stillRefused = await attach(theirs);
      expect(isErr(stillRefused) && stillRefused.error.code).toBe('not_found');
      expect(await heldPack()).toBeNull();
    });

    it("answers another agency's draft or withdrawn pack exactly as a missing id (check order)", async () => {
      const missing = await attach('00000000-0000-4000-8000-000000000000');
      for (const status of ['DRAFT', 'WITHDRAWN'] as const) {
        const theirs = await pack({ organizationId: agencyB, authoritative: false, status });
        const refused = await attach(theirs);
        expect(isErr(refused) && refused.error).toEqual(isErr(missing) && missing.error);
        expect(isErr(refused) && refused.error.code).toBe('not_found');
      }
      // The case's own agency draft is a different answer: it exists for them, it just is not published.
      await setCaseAgency(agencyA);
      const ownDraft = await attach(await pack({ organizationId: agencyA, status: 'DRAFT' }));
      expect(isErr(ownDraft) && ownDraft.error.code).toBe('invalid');
    });

    it("attaches the case agency's own unreviewed-by-the-public pack", async () => {
      const own = await pack({ organizationId: agencyA, authoritative: false });
      expect(isErr(await attach(own))).toBe(true);
      await setCaseAgency(agencyA);
      const attached = await attach(own);
      expect(isOk(attached) && attached.value.packVersionId).toBe(own);
    });

    it("refuses another traveller's proof as 'not found', the same as a missing case, and attaches nothing", async () => {
      const id = await pack({});
      const stranger = await strangerWithCase();
      const proof = await proofFor('MANAGE', stranger.accountId, stranger.applicantId);
      const refused = await attachSelectedPackVersion(proof, { missionId, packVersionId: id });
      const missing = await attachSelectedPackVersion(proof, {
        missionId: '00000000-0000-4000-8000-000000000000',
        packVersionId: id,
      });
      expect(isErr(refused) && refused.error.code).toBe('not_found');
      expect(isErr(refused) && refused.error).toEqual(isErr(missing) && missing.error);
      expect(await heldPack()).toBeNull();
    });

    it('refuses a proof that is not the record owner (a shared agency member), a copy and a wrong-action proof', async () => {
      const id = await pack({});
      const member = await sharedMemberProof('MANAGE');
      expect(member.actor.kind).not.toBe('applicant_owner');
      const asMember = await attachSelectedPackVersion(member, { missionId, packVersionId: id });
      expect(isErr(asMember) && asMember.error.code).toBe('forbidden');
      const owner = await proofFor('MANAGE');
      const copy = { ...owner } as unknown as typeof owner;
      const refusedCopy = await attachSelectedPackVersion(copy, { missionId, packVersionId: id });
      expect(isErr(refusedCopy) && refusedCopy.error.code).toBe('forbidden');
      const viewOnly = (await proofFor('VIEW_METADATA')) as unknown as typeof owner;
      const refusedAction = await attachSelectedPackVersion(viewOnly, {
        missionId,
        packVersionId: id,
      });
      expect(isErr(refusedAction) && refusedAction.error.code).toBe('forbidden');
      expect(await heldPack()).toBeNull();
    });

    it('a case that already holds an unreviewed pack keeps it, and may attach a reviewed one later', async () => {
      const visitor = await pack({ authoritative: false });
      await db
        .update(schema.missions)
        .set({ packVersionId: visitor })
        .where(eq(schema.missions.id, missionId));
      const reviewed = await pack({});
      expect(await heldPack()).toBe(visitor);
      const attached = await attach(reviewed);
      expect(isOk(attached) && attached.value.packVersionId).toBe(reviewed);
    });
  });

  describe('pinnedPackNotice', () => {
    const now = new Date('2026-11-04T00:00:00Z');
    const reviewedPack = { authoritative: true, ownerOrganizationId: null };
    const version = (
      status: string,
      nextReviewDate: Date | null,
      withdrawnAt: Date | null = null,
    ) => ({ status, nextReviewDate, withdrawnAt });

    it('warns about an overdue published version and says nothing when it is current', () => {
      const due = new Date('2026-10-23T00:00:00Z');
      expect(pinnedPackNotice(version('PUBLISHED', due), reviewedPack, now)).toEqual({
        kind: 'REVIEW_OVERDUE',
        since: due,
      });
      expect(
        pinnedPackNotice(version('PUBLISHED', new Date('2027-01-01')), reviewedPack, now),
      ).toBeNull();
      expect(pinnedPackNotice(version('PUBLISHED', null), reviewedPack, now)).toBeNull();
    });

    it('says a withdrawn version is withdrawn, ahead of any review date', () => {
      const withdrawnAt = new Date('2026-10-30T00:00:00Z');
      expect(
        pinnedPackNotice(
          version('WITHDRAWN', new Date('2026-01-01'), withdrawnAt),
          reviewedPack,
          now,
        ),
      ).toEqual({ kind: 'WITHDRAWN', since: withdrawnAt });
    });

    it('says an unowned, unreviewed pack is not reviewed, and an agency pack is not', () => {
      expect(
        pinnedPackNotice(
          version('PUBLISHED', null),
          { authoritative: false, ownerOrganizationId: null },
          now,
        ),
      ).toEqual({ kind: 'NOT_REVIEWED' });
      expect(
        pinnedPackNotice(
          version('PUBLISHED', null),
          { authoritative: false, ownerOrganizationId: 'org' },
          now,
        ),
      ).toBeNull();
    });
  });
  describe('starter checklists (agency files, not official)', () => {
    it('is attachable by the person, and listed only when it fits the case route', async () => {
      const starter = await pack({
        key: 'starter.gb.tourist',
        authoritative: false,
        requirements: 2,
        name: 'United Kingdom Tourist Starter List',
      });
      const proof = await proofFor('VIEW_METADATA');
      // With no route to narrow by, nothing starter is offered.
      const open = await listSelectablePackVersions(proof, { missionId });
      expect(isOk(open) && open.value.map((v) => v.packVersionId)).toEqual([]);
      // With the route fitting, it is offered and marked as a starter list.
      const listed = await listSelectablePackVersions(proof, {
        missionId,
        fitting: [{ packVersionId: starter }],
      });
      expect(isOk(listed) && listed.value).toEqual([
        expect.objectContaining({ packVersionId: starter, starter: true, authoritative: false }),
      ]);
      // Another route's fit does not list it.
      const other = await listSelectablePackVersions(proof, { missionId, fitting: [] });
      expect(isOk(other) && other.value).toEqual([]);
      const attached = await attachSelectedPackVersion(await proofFor('MANAGE'), {
        missionId,
        packVersionId: starter,
      });
      expect(isOk(attached) && attached.value.packVersionId).toBe(starter);
    });

    it("is never linked on the person's behalf: the automatic match ignores it", async () => {
      await pack({ key: 'starter.gb.tourist', authoritative: false, requirements: 1 });
      const fit = await listFittingPublicPacks(db, {
        country: UK,
        purpose: TOURISM,
        traveller: UNKNOWN,
      });
      expect(fit).toEqual([]);
    });

    it('keeps refusing an unreviewed pack that is not a starter list', async () => {
      const unreviewed = await pack({ authoritative: false, requirements: 1 });
      const refused = await attachSelectedPackVersion(await proofFor('MANAGE'), {
        missionId,
        packVersionId: unreviewed,
      });
      expect(isErr(refused)).toBe(true);
    });
  });
});
