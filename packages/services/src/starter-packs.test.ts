import { type StarterPackDefinition, isErr, isOk, requirementNecessity } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import {
  newestPublishedVersion,
  removeDraftRequirement,
  updateDraftRequirement,
} from './pack-draft-edit';
import {
  approvePackVersion,
  cloneVersionToDraft,
  createPack,
  listPackVersions,
  listRequirements,
  publishPackVersion,
} from './packs';
import { grantPlatformRole } from './platform-roles';
import { applyStarterPack, previewStarterImport } from './starter-packs';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

const OWNER_EMAIL = 'admin@example.com';

/** A fresh Pack Studio scope for an account made a platform owner, as the web action mints one. */
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

function definition(
  lines: StarterPackDefinition['requirements'],
  hash = 'h1',
): StarterPackDefinition {
  return {
    key: 'starter.jp.tourist',
    name: 'Japan Tourist Starter List',
    description: 'Starter list from agency files. Not official. Check the official page.',
    jurisdiction: 'JP',
    purpose: 'tourism',
    starterPurpose: 'tourist',
    requirements: lines,
    contentHash: hash,
  };
}

describe('loading starter checklists into Pack Studio', () => {
  let db: Db;
  let actor: string;
  let staff: Awaited<ReturnType<typeof staffFor>>;
  beforeEach(async () => {
    db = await freshDb();
    const account = await provisionAccount(db, { email: 'admin@example.com' });
    if (!isOk(account)) throw new Error('provision');
    actor = account.value.id;
    staff = await staffFor(db, actor);
  });

  // The hash the importer compares is computed from stored content, so the tests build the
  // definition the way the core builder does.
  async function build(lines: StarterPackDefinition['requirements']) {
    const { starterContentHash } = await import('@visastack/core');
    return definition(lines, starterContentHash(lines));
  }

  it('creates a public pack that is not official, with every line kept as written', async () => {
    const def = await build([
      line('Valid passport, six months.'),
      line('Two photographs.', {
        docType: 'PHOTO',
        necessity: 'RECOMMENDED',
        appliesWhen: 'Employee',
      }),
    ]);
    const result = await applyStarterPack(db, staff, { definition: def });
    expect(isOk(result) && result.value).toEqual({ key: def.key, outcome: 'created', version: 1 });

    const [pack] = await db.select().from(schema.packs).where(eq(schema.packs.key, def.key));
    expect(pack?.authoritative).toBe(false);
    expect(pack?.ownerOrganizationId).toBeNull();
    expect([pack?.jurisdiction, pack?.purpose]).toEqual(['JP', 'tourism']);

    const versions = await listPackVersions(db, pack?.id ?? '');
    expect(versions.map((v) => v.status)).toEqual(['PUBLISHED']);
    const rows = await listRequirements(db, versions[0]?.id ?? '');
    expect(rows).toHaveLength(2);
    const photo = rows.find((r) => r.docType === 'PHOTO');
    expect(photo?.notes).toBe('Two photographs.');
    expect(photo?.interpretation).toBe('Employee');
    expect(photo && requirementNecessity(photo)).toBe('RECOMMENDED');
    expect(photo?.provenance).toBe('AGENCY_ADDED');
    expect(photo?.citation).toBe('Starter list: Japan Visa Requirement.pdf');
    expect(photo?.sourceType).toBe('agency_sheet');
  });

  it('leaves a list alone when nothing changed, and says so before and after', async () => {
    const def = await build([line('Valid passport.')]);
    expect((await previewStarterImport(db, [def]))[0]?.status).toBe('new');
    await applyStarterPack(db, staff, { definition: def });
    expect((await previewStarterImport(db, [def]))[0]?.status).toBe('unchanged');
    const again = await applyStarterPack(db, staff, { definition: def });
    expect(isOk(again) && again.value.outcome).toBe('unchanged');
    const versions = await db.select().from(schema.packVersions);
    expect(versions).toHaveLength(1);
  });

  it('makes the next version when a list changed, and the old one stays for the cases on it', async () => {
    const first = await build([
      line('Valid passport.'),
      line('Hotel booking.', { docType: 'HOTEL_BOOKING' }),
    ]);
    await applyStarterPack(db, staff, { definition: first });
    const second = await build([
      line('Valid passport.'),
      line('Return ticket.', { docType: 'FLIGHT_BOOKING' }),
    ]);
    const preview = (await previewStarterImport(db, [second]))[0];
    expect(preview).toMatchObject({ status: 'changed', added: 1, removed: 1, currentVersion: 1 });
    const done = await applyStarterPack(db, staff, { definition: second });
    expect(isOk(done) && done.value).toMatchObject({ outcome: 'updated', version: 2 });
    const versions = await db.select().from(schema.packVersions);
    expect(versions.map((v) => [v.version, v.status]).sort()).toEqual([
      [1, 'DEPRECATED'],
      [2, 'PUBLISHED'],
    ]);
  });

  it('counts an edited line as modified, so an admin sees what loading would replace', async () => {
    await applyStarterPack(db, staff, { definition: await build([line('Valid passport.')]) });
    const edited = await build([line('Valid passport.', { necessity: 'OPTIONAL' })]);
    const preview = (await previewStarterImport(db, [edited]))[0];
    expect(preview).toMatchObject({ status: 'changed', added: 0, removed: 0, modified: 1 });
  });

  it('refuses a list with a draft open, and leaves no half-built draft when a step fails', async () => {
    const def = await build([line('Valid passport.')]);
    await applyStarterPack(db, staff, { definition: def });
    const [pack] = await db.select().from(schema.packs);
    const [v1] = await db.select().from(schema.packVersions);
    const opened = await cloneVersionToDraft(db, staff, { fromPackVersionId: v1?.id ?? '' });
    expect(isOk(opened)).toBe(true);
    const next = await build([line('Valid passport.'), line('Hotel booking.')]);
    expect(isErr(await applyStarterPack(db, staff, { definition: next }))).toBe(true);
    const drafts = await db
      .select()
      .from(schema.packVersions)
      .where(eq(schema.packVersions.packId, pack?.id ?? ''));
    expect(drafts.filter((v) => v.status === 'DRAFT')).toHaveLength(1);
  });

  it("never touches a checklist that is official or an agency's own", async () => {
    await createPack(db, {
      actorAccountId: actor,
      key: 'starter.jp.tourist',
      name: 'Official look-alike',
      authoritative: true,
    });
    const def = await build([line('Valid passport.')]);
    const result = await applyStarterPack(db, staff, { definition: def });
    expect(isErr(result)).toBe(true);
    const packs = await db.select().from(schema.packs);
    expect(packs.map((p) => p.name)).toEqual(['Official look-alike']);
  });

  it('refuses a key that is not a starter key', async () => {
    const def = { ...(await build([line('Valid passport.')])), key: 'uk.tourist' };
    expect(isErr(await applyStarterPack(db, staff, { definition: def }))).toBe(true);
  });
});

describe('updating a published checklist system-wide', () => {
  let db: Db;
  let actor: string;
  let packId: string;
  let staff: Awaited<ReturnType<typeof staffFor>>;
  beforeEach(async () => {
    db = await freshDb();
    const account = await provisionAccount(db, { email: 'admin@example.com' });
    if (!isOk(account)) throw new Error('provision');
    actor = account.value.id;
    staff = await staffFor(db, actor);
    const { starterContentHash } = await import('@visastack/core');
    const lines = [line('Valid passport.'), line('Hotel booking.', { docType: 'HOTEL_BOOKING' })];
    await applyStarterPack(db, staff, { definition: definition(lines, starterContentHash(lines)) });
    const [pack] = await db.select().from(schema.packs);
    packId = pack?.id ?? '';
  });

  async function published() {
    const version = await newestPublishedVersion(db, packId);
    if (!version) throw new Error('no published version');
    return version;
  }

  it('starts a draft that is a copy of the published version, and refuses a second open draft', async () => {
    const v1 = await published();
    const draft = await cloneVersionToDraft(db, staff, { fromPackVersionId: v1.id });
    expect(isOk(draft) && draft.value).toMatchObject({ version: 2, status: 'DRAFT' });
    if (!isOk(draft)) return;
    const copied = await listRequirements(db, draft.value.id);
    const original = await listRequirements(db, v1.id);
    expect(copied.map((r) => [r.docType, r.notes, r.necessity]).sort()).toEqual(
      original.map((r) => [r.docType, r.notes, r.necessity]).sort(),
    );
    const again = await cloneVersionToDraft(db, staff, { fromPackVersionId: v1.id });
    expect(isErr(again)).toBe(true);
  });

  it('changes and removes items only in a draft, and publishes the draft as the next version', async () => {
    const v1 = await published();
    const original = await listRequirements(db, v1.id);
    const target = original[0];
    // A published version never changes.
    expect(
      isErr(
        await updateDraftRequirement(db, staff, {
          requirementId: target?.id ?? '',
          patch: { notes: 'x' },
        }),
      ),
    ).toBe(true);
    expect(
      isErr(
        await removeDraftRequirement(db, staff, {
          requirementId: target?.id ?? '',
        }),
      ),
    ).toBe(true);

    const draft = await cloneVersionToDraft(db, staff, { fromPackVersionId: v1.id });
    if (!isOk(draft)) throw new Error('clone');
    const items = await listRequirements(db, draft.value.id);
    const passport = items.find((r) => r.docType === 'PASSPORT');
    const hotel = items.find((r) => r.docType === 'HOTEL_BOOKING');
    const changed = await updateDraftRequirement(db, staff, {
      requirementId: passport?.id ?? '',
      patch: { notes: 'Passport valid for the whole stay.', necessity: 'RECOMMENDED' },
    });
    expect(isOk(changed) && changed.value.notes).toBe('Passport valid for the whole stay.');
    expect(isOk(changed) && changed.value.optional).toBe(false);
    expect(isOk(await removeDraftRequirement(db, staff, { requirementId: hotel?.id ?? '' }))).toBe(
      true,
    );

    const approved = await approvePackVersion(db, {
      actorAccountId: actor,
      packVersionId: draft.value.id,
    });
    expect(isOk(approved)).toBe(true);
    expect(
      isOk(await publishPackVersion(db, { actorAccountId: actor, packVersionId: draft.value.id })),
    ).toBe(true);
    const now = await listRequirements(db, (await published()).id);
    expect(now.map((r) => r.notes)).toEqual(['Passport valid for the whole stay.']);
    // The first version still holds its two items, for the cases on it.
    expect(await listRequirements(db, v1.id)).toHaveLength(2);
  });

  it('copies the rule details of each item into the new draft', async () => {
    const v1 = await published();
    const [original] = await listRequirements(db, v1.id);
    await db.insert(schema.packRequirementDetails).values({
      packRequirementId: original?.id ?? '',
      category: 'IDENTITY_TRAVEL_DOCUMENTS',
      translationNeeded: true,
    });
    const draft = await cloneVersionToDraft(db, staff, { fromPackVersionId: v1.id });
    if (!isOk(draft)) throw new Error('clone');
    const copied = await listRequirements(db, draft.value.id);
    const twin = copied.find((r) => r.notes === original?.notes);
    const [detail] = await db
      .select()
      .from(schema.packRequirementDetails)
      .where(eq(schema.packRequirementDetails.packRequirementId, twin?.id ?? ''));
    expect(detail).toMatchObject({ category: 'IDENTITY_TRAVEL_DOCUMENTS', translationNeeded: true });
  });

  it('refuses wording and audience notes that are too long', async () => {
    const v1 = await published();
    const draft = await cloneVersionToDraft(db, staff, { fromPackVersionId: v1.id });
    if (!isOk(draft)) throw new Error('clone');
    const [item] = await listRequirements(db, draft.value.id);
    const long = await updateDraftRequirement(db, staff, {
      requirementId: item?.id ?? '',
      patch: { notes: 'a'.repeat(401) },
    });
    expect(isErr(long)).toBe(true);
    const audience = await updateDraftRequirement(db, staff, {
      requirementId: item?.id ?? '',
      patch: { interpretation: 'b'.repeat(121) },
    });
    expect(isErr(audience)).toBe(true);
  });

  it('refuses an empty document type, a filler source and an unknown item', async () => {
    const v1 = await published();
    const draft = await cloneVersionToDraft(db, staff, { fromPackVersionId: v1.id });
    if (!isOk(draft)) throw new Error('clone');
    const [item] = await listRequirements(db, draft.value.id);
    expect(
      isErr(
        await updateDraftRequirement(db, staff, {
          requirementId: item?.id ?? '',
          patch: { docType: ' ' },
        }),
      ),
    ).toBe(true);
    expect(
      isErr(
        await updateDraftRequirement(db, staff, {
          requirementId: item?.id ?? '',
          patch: { citation: 'n/a' },
        }),
      ),
    ).toBe(true);
    expect(
      isErr(
        await updateDraftRequirement(db, staff, {
          requirementId: '00000000-0000-4000-8000-000000000000',
          patch: { notes: 'x' },
        }),
      ),
    ).toBe(true);
  });
});
