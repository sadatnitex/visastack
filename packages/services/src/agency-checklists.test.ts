import { type StarterPackDefinition, isErr, isOk, starterContentHash } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AgencyChecklistScope,
  agencyChecklistPrincipal,
} from './access/agency-checklist-scope';
import { staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import {
  addAgencyItem,
  discardAgencyDraft,
  getAgencyListDetail,
  listAgencyOwnLists,
  listAgencyStartingLists,
  makeAgencyCopy,
  publishAgencyDraft,
  removeAgencyItem,
  startAgencyListUpdate,
  updateAgencyItem,
} from './agency-checklists';
import type { Db } from './db';
import { addMembership, createOrganization } from './organizations';
import { updateDraftRequirement } from './pack-draft-edit';
import { cloneVersionToDraft, listRequirements } from './packs';
import { grantPlatformRole } from './platform-roles';
import { applyStarterPack } from './starter-packs';

/** Synthetic data only. An agency owner or admin keeps its own copy of a country checklist. */

const OWNER_EMAIL = 'platform@example.com';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error('provision');
  return made.value.id;
}

async function staffFor(db: Db, accountId: string) {
  const granted = await grantPlatformRole(db, {
    actor: { accountId, email: OWNER_EMAIL, bootstrapEmails: [OWNER_EMAIL] },
    targetAccountId: accountId,
    role: 'PLATFORM_OWNER',
    reason: 'seed',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  const minted = await staffPrincipal(
    db,
    { accountId, email: OWNER_EMAIL, bootstrapEmails: [OWNER_EMAIL] },
    'PACK_MANAGE',
  );
  if (!isOk(minted)) throw new Error('scope');
  return minted.value;
}

const line = (text: string, over: Partial<StarterPackDefinition['requirements'][number]> = {}) => ({
  text,
  docType: 'PASSPORT',
  necessity: 'MANDATORY' as const,
  appliesWhen: 'All applicants',
  reference: 'Japan Visa Requirement.pdf',
  ...over,
});

function definition(lines: StarterPackDefinition['requirements']): StarterPackDefinition {
  return {
    key: 'starter.jp.tourist',
    name: 'Japan Tourist Starter List',
    description: 'Starter list from agency files. Not official. Check the official page.',
    jurisdiction: 'JP',
    purpose: 'tourism',
    starterPurpose: 'tourist',
    requirements: lines,
    contentHash: starterContentHash(lines),
  };
}

async function scopeFor(db: Db, accountId: string, organizationId: string) {
  const made = await agencyChecklistPrincipal(db, accountId, organizationId);
  if (!isOk(made)) throw new Error(`no scope: ${made.error.message}`);
  return made.value;
}

describe('agency checklists', () => {
  let db: Db;
  let ownerA: string;
  let ownerB: string;
  let member: string;
  let orgA: string;
  let orgB: string;
  let scopeA: AgencyChecklistScope;
  let sharedVersionId: string;

  beforeEach(async () => {
    db = await freshDb();
    const platform = await account(db, OWNER_EMAIL);
    ownerA = await account(db, 'owner-a@example.com');
    ownerB = await account(db, 'owner-b@example.com');
    member = await account(db, 'member-a@example.com');
    const a = await createOrganization(db, { actorAccountId: ownerA, name: 'Agency A' });
    const b = await createOrganization(db, { actorAccountId: ownerB, name: 'Agency B' });
    if (!isOk(a) || !isOk(b)) throw new Error('org');
    orgA = a.value.id;
    orgB = b.value.id;
    const added = await addMembership(db, {
      actorAccountId: ownerA,
      organizationId: orgA,
      accountId: member,
      role: 'CASE_MANAGER',
    });
    if (!isOk(added)) throw new Error('member');
    const staff = await staffFor(db, platform);
    const loaded = await applyStarterPack(db, staff, {
      definition: definition([
        line('Valid passport, six months.'),
        line('Hotel booking.', { docType: 'HOTEL_BOOKING', necessity: 'RECOMMENDED' }),
      ]),
    });
    if (!isOk(loaded)) throw new Error('starter');
    const [version] = await db
      .select()
      .from(schema.packVersions)
      .where(eq(schema.packVersions.status, 'PUBLISHED'));
    sharedVersionId = version?.id ?? '';
    scopeA = await scopeFor(db, ownerA, orgA);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('who may act', () => {
    it('refuses a member who is not an owner or admin, and a person who is not in the agency', async () => {
      expect(isErr(await agencyChecklistPrincipal(db, member, orgA))).toBe(true);
      expect(isErr(await agencyChecklistPrincipal(db, ownerB, orgA))).toBe(true);
      expect(isErr(await agencyChecklistPrincipal(db, ownerA, 'not-an-id'))).toBe(true);
    });

    it('refuses an agency that is closed', async () => {
      await db
        .update(schema.organizations)
        .set({ status: 'SUSPENDED' })
        .where(eq(schema.organizations.id, orgA));
      expect(isErr(await agencyChecklistPrincipal(db, ownerA, orgA))).toBe(true);
    });

    it('an admin the owner added may act too', async () => {
      const admin = await account(db, 'admin-a@example.com');
      await addMembership(db, {
        actorAccountId: ownerA,
        organizationId: orgA,
        accountId: admin,
        role: 'ADMIN',
      });
      expect(isOk(await agencyChecklistPrincipal(db, admin, orgA))).toBe(true);
    });

    it('refuses a copied scope and an old one', async () => {
      const forged = { ...scopeA } as unknown as AgencyChecklistScope;
      expect(isErr(await listAgencyOwnLists(db, forged))).toBe(true);
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 6 * 60 * 1000);
      expect(isErr(await listAgencyOwnLists(db, scopeA))).toBe(true);
    });
  });

  describe('making a copy', () => {
    it('lists the shared lists, then copies one into a list the agency owns', async () => {
      const shared = await listAgencyStartingLists(db, scopeA);
      expect(isOk(shared) && shared.value.map((l) => [l.packName, l.starter])).toEqual([
        ['Japan Tourist Starter List', true],
      ]);
      const made = await makeAgencyCopy(db, scopeA, { fromPackVersionId: sharedVersionId });
      expect(isOk(made)).toBe(true);
      if (!isOk(made)) return;
      const [pack] = await db
        .select()
        .from(schema.packs)
        .where(eq(schema.packs.id, made.value.packId));
      expect(pack).toMatchObject({ ownerOrganizationId: orgA, authoritative: false });
      const items = await listRequirements(db, made.value.draftVersionId);
      expect(items.map((i) => i.notes).sort()).toEqual([
        'Hotel booking.',
        'Valid passport, six months.',
      ]);
      expect(items.every((i) => i.provenance === 'AGENCY_ADDED')).toBe(true);
      const after = await listAgencyStartingLists(db, scopeA);
      expect(isOk(after) && after.value[0]?.ownCopyPackId).toBe(made.value.packId);
    });

    it('refuses a second copy of the same list', async () => {
      await makeAgencyCopy(db, scopeA, { fromPackVersionId: sharedVersionId });
      expect(isErr(await makeAgencyCopy(db, scopeA, { fromPackVersionId: sharedVersionId }))).toBe(
        true,
      );
    });

    it("never copies another agency's list, and never offers one", async () => {
      const made = await makeAgencyCopy(db, scopeA, { fromPackVersionId: sharedVersionId });
      if (!isOk(made)) throw new Error('copy');
      await publishAgencyDraft(db, scopeA, { packVersionId: made.value.draftVersionId });
      const [own] = await db
        .select()
        .from(schema.packVersions)
        .where(eq(schema.packVersions.packId, made.value.packId));
      const scopeB = await scopeFor(db, ownerB, orgB);
      const shared = await listAgencyStartingLists(db, scopeB);
      expect(isOk(shared) && shared.value.map((l) => l.packName)).toEqual([
        'Japan Tourist Starter List',
      ]);
      expect(isOk(shared) && shared.value[0]?.ownCopyPackId).toBeNull();
      expect(isErr(await makeAgencyCopy(db, scopeB, { fromPackVersionId: own?.id ?? '' }))).toBe(
        true,
      );
    });
  });

  describe('changing and publishing its own list', () => {
    async function copyOf() {
      const made = await makeAgencyCopy(db, scopeA, { fromPackVersionId: sharedVersionId });
      if (!isOk(made)) throw new Error('copy');
      return made.value;
    }

    it('edits the draft, adds an item, publishes it, then starts the next version', async () => {
      const own = await copyOf();
      const items = await listRequirements(db, own.draftVersionId);
      const passport = items.find((i) => i.notes?.startsWith('Valid passport'));
      const updated = await updateAgencyItem(db, scopeA, {
        requirementId: passport?.id ?? '',
        patch: { notes: 'Passport valid for nine months.', necessity: 'MANDATORY' },
      });
      expect(isOk(updated) && updated.value.notes).toBe('Passport valid for nine months.');
      const hotel = items.find((i) => i.notes === 'Hotel booking.');
      expect(isOk(await removeAgencyItem(db, scopeA, { requirementId: hotel?.id ?? '' }))).toBe(
        true,
      );
      const added = await addAgencyItem(db, scopeA, {
        packVersionId: own.draftVersionId,
        wording: 'Letter from your employer.',
        docType: 'EMPLOYMENT_LETTER',
        necessity: 'RECOMMENDED',
        appliesWhen: 'Employed',
      });
      expect(isOk(added) && added.value).toMatchObject({
        provenance: 'AGENCY_ADDED',
        notes: 'Letter from your employer.',
        interpretation: 'Employed',
      });
      const published = await publishAgencyDraft(db, scopeA, { packVersionId: own.draftVersionId });
      expect(isOk(published) && published.value).toMatchObject({ version: 1, status: 'PUBLISHED' });

      const next = await startAgencyListUpdate(db, scopeA, { packId: own.packId });
      expect(isOk(next) && next.value).toMatchObject({ version: 2, status: 'DRAFT' });
      const lists = await listAgencyOwnLists(db, scopeA);
      expect(isOk(lists) && lists.value[0]).toMatchObject({
        publishedVersion: 1,
        openDraftVersion: 2,
      });
      const detail = await getAgencyListDetail(db, scopeA, { packId: own.packId });
      expect(isOk(detail) && detail.value.version.status).toBe('DRAFT');
      expect(isOk(detail) && detail.value.items.map((i) => i.notes).sort()).toEqual([
        'Letter from your employer.',
        'Passport valid for nine months.',
      ]);
    });

    it('throws away an open draft and leaves the published version alone', async () => {
      const own = await copyOf();
      await publishAgencyDraft(db, scopeA, { packVersionId: own.draftVersionId });
      const next = await startAgencyListUpdate(db, scopeA, { packId: own.packId });
      if (!isOk(next)) throw new Error('update');
      expect(isOk(await discardAgencyDraft(db, scopeA, { packVersionId: next.value.id }))).toBe(
        true,
      );
      const lists = await listAgencyOwnLists(db, scopeA);
      expect(isOk(lists) && lists.value[0]).toMatchObject({
        publishedVersion: 1,
        openDraftVersion: null,
      });
      // The published version is never discarded.
      expect(
        isErr(await discardAgencyDraft(db, scopeA, { packVersionId: own.draftVersionId })),
      ).toBe(true);
    });

    it('refuses wording that is too long or empty, and an item with no type', async () => {
      const own = await copyOf();
      const base = {
        packVersionId: own.draftVersionId,
        docType: 'PASSPORT',
        necessity: 'OPTIONAL' as const,
      };
      expect(isErr(await addAgencyItem(db, scopeA, { ...base, wording: ' ' }))).toBe(true);
      expect(isErr(await addAgencyItem(db, scopeA, { ...base, wording: 'a'.repeat(401) }))).toBe(
        true,
      );
      expect(isErr(await addAgencyItem(db, scopeA, { ...base, wording: 'Ok', docType: ' ' }))).toBe(
        true,
      );
    });
  });

  describe('keeping agencies and the platform apart', () => {
    it("another agency finds nothing of this agency's list, and can change nothing in it", async () => {
      const made = await makeAgencyCopy(db, scopeA, { fromPackVersionId: sharedVersionId });
      if (!isOk(made)) throw new Error('copy');
      const [item] = await listRequirements(db, made.value.draftVersionId);
      const scopeB = await scopeFor(db, ownerB, orgB);
      const ownB = await listAgencyOwnLists(db, scopeB);
      expect(isOk(ownB) && ownB.value).toEqual([]);
      expect(isErr(await getAgencyListDetail(db, scopeB, { packId: made.value.packId }))).toBe(
        true,
      );
      expect(
        isErr(
          await updateAgencyItem(db, scopeB, {
            requirementId: item?.id ?? '',
            patch: { notes: 'x' },
          }),
        ),
      ).toBe(true);
      expect(isErr(await removeAgencyItem(db, scopeB, { requirementId: item?.id ?? '' }))).toBe(
        true,
      );
      expect(
        isErr(
          await addAgencyItem(db, scopeB, {
            packVersionId: made.value.draftVersionId,
            wording: 'Sneaky.',
            docType: 'PASSPORT',
            necessity: 'OPTIONAL',
          }),
        ),
      ).toBe(true);
      expect(
        isErr(await publishAgencyDraft(db, scopeB, { packVersionId: made.value.draftVersionId })),
      ).toBe(true);
      expect(
        isErr(await discardAgencyDraft(db, scopeB, { packVersionId: made.value.draftVersionId })),
      ).toBe(true);
      expect(isErr(await startAgencyListUpdate(db, scopeB, { packId: made.value.packId }))).toBe(
        true,
      );
      // Nothing changed.
      const after = await listRequirements(db, made.value.draftVersionId);
      expect(after.map((i) => i.notes).sort()).toEqual([
        'Hotel booking.',
        'Valid passport, six months.',
      ]);
    });

    it('an agency cannot start an update of, or change, a shared platform list', async () => {
      expect(
        isErr(await cloneVersionToDraft(db, scopeA, { fromPackVersionId: sharedVersionId })),
      ).toBe(true);
      const staff = await staffFor(
        db,
        (await db.select().from(schema.accounts).where(eq(schema.accounts.email, OWNER_EMAIL)))[0]
          ?.id ?? '',
      );
      const draft = await cloneVersionToDraft(db, staff, { fromPackVersionId: sharedVersionId });
      if (!isOk(draft)) throw new Error('platform draft');
      const [item] = await listRequirements(db, draft.value.id);
      expect(
        isErr(
          await updateDraftRequirement(db, scopeA, {
            requirementId: item?.id ?? '',
            patch: { notes: 'x' },
          }),
        ),
      ).toBe(true);
      const unchanged = await listRequirements(db, draft.value.id);
      expect(unchanged.map((i) => i.notes)).toContain('Valid passport, six months.');
    });

    it('does not offer an agency copy of another agency as a shared list', async () => {
      const made = await makeAgencyCopy(db, scopeA, { fromPackVersionId: sharedVersionId });
      if (!isOk(made)) throw new Error('copy');
      await publishAgencyDraft(db, scopeA, { packVersionId: made.value.draftVersionId });
      const scopeB = await scopeFor(db, ownerB, orgB);
      const shared = await listAgencyStartingLists(db, scopeB, { search: 'Japan' });
      expect(isOk(shared) && shared.value).toHaveLength(1);
    });
  });

  it('writes an audit record for each step', async () => {
    const made = await makeAgencyCopy(db, scopeA, { fromPackVersionId: sharedVersionId });
    if (!isOk(made)) throw new Error('copy');
    await publishAgencyDraft(db, scopeA, { packVersionId: made.value.draftVersionId });
    const events = await db
      .select({ type: schema.auditEvents.eventType, actor: schema.auditEvents.actorAccountId })
      .from(schema.auditEvents);
    const mine = events.filter((e) => e.actor === ownerA).map((e) => e.type);
    expect(mine).toEqual(
      expect.arrayContaining(['PACK_CREATED', 'PACK_VERSION_OPENED', 'PACK_VERSION_CLONED']),
    );
  });
});
