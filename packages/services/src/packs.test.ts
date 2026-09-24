import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  clearRequirementSourceInaccessible,
  createPack,
  diffPackVersions,
  listPackVersions,
  listPackVersionsDueForReview,
  listPacks,
  listPublishedPackVersions,
  markRequirementSourceInaccessible,
  publishPackVersion,
  verifyPackChecksum,
  withdrawPackVersion,
} from './packs';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function authorId(db: Db): Promise<string> {
  const p = await provisionAccount(db, { email: 'author@example.com' });
  if (!isOk(p)) throw new Error('provision');
  return p.value.id;
}

describe('Pack Studio — versioned, cited, admin-approved requirement packs', () => {
  let db: Db;
  let actor: string;
  beforeEach(async () => {
    db = await freshDb();
    actor = await authorId(db);
  });

  async function draftWithRequirement() {
    const pack = await createPack(db, {
      actorAccountId: actor,
      key: 'uk.tourist',
      name: 'UK Tourist',
    });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const req = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport.number',
      citation: 'UK Immigration Rules Appendix V 4.2',
    });
    if (!isOk(req)) throw new Error('req');
    return version.value.id;
  }

  it('opens sequential versions', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'p1', name: 'P1' });
    if (!isOk(pack)) throw new Error('pack');
    const v1 = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    const v2 = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    expect(isOk(v1) && isOk(v2)).toBe(true);
    if (!isOk(v1) || !isOk(v2)) return;
    expect(v1.value.version).toBe(1);
    expect(v2.value.version).toBe(2);
  });

  it('lists packs and pack versions (highest version first)', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'pv', name: 'PV' });
    if (!isOk(pack)) throw new Error('pack');
    await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });

    const packs = await listPacks(db);
    expect(packs.map((p) => p.key)).toContain('pv');

    const versions = await listPackVersions(db, pack.value.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it('rejects a requirement with no citation', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'p2', name: 'P2' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const req = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport.number',
      citation: '   ',
    });
    expect(isErr(req)).toBe(true);
    if (isErr(req)) expect(req.error.code).toBe('invalid');
  });

  it('approves (freezing a checksum), then publishes; content then frozen', async () => {
    const versionId = await draftWithRequirement();

    const approved = await approvePackVersion(db, {
      actorAccountId: actor,
      packVersionId: versionId,
    });
    expect(isOk(approved)).toBe(true);
    if (!isOk(approved)) return;
    expect(approved.value.status).toBe('APPROVED');
    expect(approved.value.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyPackChecksum(db, versionId)).toBe(true);

    // No more requirement edits once out of DRAFT.
    const late = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      citation: 'x',
    });
    expect(isErr(late)).toBe(true);

    const published = await publishPackVersion(db, {
      actorAccountId: actor,
      packVersionId: versionId,
    });
    expect(isOk(published)).toBe(true);
    if (isOk(published)) expect(published.value.status).toBe('PUBLISHED');
  });

  it('refuses to approve an empty version and to publish an unapproved one', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'p3', name: 'P3' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');

    const approveEmpty = await approvePackVersion(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
    });
    expect(isErr(approveEmpty)).toBe(true);

    const publishUnapproved = await publishPackVersion(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
    });
    expect(isErr(publishUnapproved)).toBe(true);
    if (isErr(publishUnapproved)) expect(publishUnapproved.error.code).toBe('invalid');
  });
});

describe('Pack Studio - coverage model, rule conditions, and source grounding (RUL-01/02/03)', () => {
  let db: Db;
  let actor: string;
  beforeEach(async () => {
    db = await freshDb();
    actor = await authorId(db);
  });

  it('persists coverage-model fields on the pack itself', async () => {
    const pack = await createPack(db, {
      actorAccountId: actor,
      key: 'uk.tourist.covmodel',
      name: 'UK Tourist',
      jurisdiction: 'UK',
      route: 'Standard Visitor',
      purpose: 'tourism',
      nationalityApplicability: ['BD'],
      residenceApplicability: ['BD'],
      authoritative: true,
    });
    expect(isOk(pack)).toBe(true);
    if (!isOk(pack)) return;
    expect(pack.value.jurisdiction).toBe('UK');
    expect(pack.value.route).toBe('Standard Visitor');
    expect(pack.value.purpose).toBe('tourism');
    expect(pack.value.nationalityApplicability).toEqual(['BD']);
    expect(pack.value.residenceApplicability).toEqual(['BD']);
    expect(pack.value.authoritative).toBe(true);
  });

  it('defaults a new pack to non-authoritative', async () => {
    const pack = await createPack(db, {
      actorAccountId: actor,
      key: 'agency.custom',
      name: 'Custom',
    });
    if (!isOk(pack)) throw new Error('pack');
    expect(pack.value.authoritative).toBe(false);
  });

  it('stores a valid rule condition and source-grounding fields on a requirement, and records its author', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'cond.ok', name: 'Cond OK' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    expect(version.value.authoredByAccountId).toBe(actor);

    const observed = new Date('2026-01-15');
    const req = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport_expiry',
      citation: 'UK Immigration Rules Appendix V 4.2',
      condition: { op: 'exists', field: 'passport_expiry' },
      sourceUrl: 'https://www.gov.uk/standard-visitor',
      sourceTitle: 'Standard Visitor visa',
      publisher: 'UK Home Office',
      officialExtract: 'Applicants must hold a valid passport.',
      interpretation: 'Passport must not be expired at time of travel.',
      sourceType: 'government',
      observedDate: observed,
      changeReason: 'initial authoring',
    });
    expect(isOk(req)).toBe(true);
    if (!isOk(req)) return;
    expect(req.value.condition).toEqual({ op: 'exists', field: 'passport_expiry' });
    expect(req.value.sourceUrl).toBe('https://www.gov.uk/standard-visitor');
    expect(req.value.publisher).toBe('UK Home Office');
    expect(req.value.observedDate?.getTime()).toBe(observed.getTime());
    expect(req.value.authorAccountId).toBe(actor);
  });

  it('refuses a requirement whose condition is not a recognized rule shape', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'cond.bad', name: 'Cond Bad' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');

    const req = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport_expiry',
      citation: 'x',
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input, proving the service layer rejects it
      condition: { op: 'eval', code: 'process.exit()' } as any,
    });
    expect(isErr(req)).toBe(true);
    if (isErr(req)) expect(req.error.code).toBe('invalid');
  });
});

describe('Pack Studio - review interval and author/reviewer distinctness (RUL-02/05)', () => {
  let db: Db;
  let actor: string;
  let other: string;
  beforeEach(async () => {
    db = await freshDb();
    actor = await authorId(db);
    const p = await provisionAccount(db, { email: 'reviewer@example.com' });
    if (!isOk(p)) throw new Error('provision');
    other = p.value.id;
  });

  async function draftedBy(accountId: string, options: { readonly authoritative?: boolean } = {}) {
    const pack = await createPack(db, {
      actorAccountId: accountId,
      key: `review-${accountId}`,
      name: 'Review test',
      authoritative: options.authoritative ?? false,
    });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: accountId, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const req = await addRequirement(db, {
      actorAccountId: accountId,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'x',
      citation: 'x',
    });
    if (!isOk(req)) throw new Error('req');
    return version.value.id;
  }

  it('defaults nextReviewDate to 30 days out when omitted', async () => {
    const versionId = await draftedBy(actor);
    const before = Date.now();
    const approved = await approvePackVersion(db, {
      actorAccountId: actor,
      packVersionId: versionId,
    });
    expect(isOk(approved)).toBe(true);
    if (!isOk(approved)) return;
    const days = ((approved.value.nextReviewDate?.getTime() ?? 0) - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('refuses a next-review date more than 30 days out with no documented reason, allows it with one', async () => {
    const versionId = await draftedBy(actor);
    const farOut = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const noReason = await approvePackVersion(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      nextReviewDate: farOut,
    });
    expect(isErr(noReason)).toBe(true);
    if (isErr(noReason)) expect(noReason.error.code).toBe('invalid');

    const withReason = await approvePackVersion(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      nextReviewDate: farOut,
      reviewIntervalReason: 'annual government review cycle confirmed by publisher',
    });
    expect(isOk(withReason)).toBe(true);
    if (isOk(withReason)) expect(withReason.value.nextReviewDate?.getTime()).toBe(farOut.getTime());
  });

  it('refuses the version author to approve their own authoritative pack, but allows a different reviewer', async () => {
    const versionId = await draftedBy(actor, { authoritative: true });

    const selfApprove = await approvePackVersion(db, {
      actorAccountId: actor,
      packVersionId: versionId,
    });
    expect(isErr(selfApprove)).toBe(true);
    if (isErr(selfApprove)) expect(selfApprove.error.code).toBe('forbidden');

    const distinctApprove = await approvePackVersion(db, {
      actorAccountId: other,
      packVersionId: versionId,
    });
    expect(isOk(distinctApprove)).toBe(true);
  });

  it('allows the same account to author and approve a non-authoritative (agency custom) pack', async () => {
    const versionId = await draftedBy(actor, { authoritative: false });
    const approved = await approvePackVersion(db, {
      actorAccountId: actor,
      packVersionId: versionId,
    });
    expect(isOk(approved)).toBe(true);
  });
});

describe('Pack Studio - auto-supersede on publish and explicit withdrawal (RUL-05)', () => {
  let db: Db;
  let actor: string;
  beforeEach(async () => {
    db = await freshDb();
    actor = await authorId(db);
  });

  async function publishedVersion(packId: string) {
    const version = await addPackVersion(db, { actorAccountId: actor, packId });
    if (!isOk(version)) throw new Error('version');
    const req = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'x',
      citation: 'x',
    });
    if (!isOk(req)) throw new Error('req');
    const approved = await approvePackVersion(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
    });
    if (!isOk(approved)) throw new Error('approve');
    const published = await publishPackVersion(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
    });
    if (!isOk(published)) throw new Error('publish');
    return published.value;
  }

  it('publishing a newer version automatically deprecates the prior PUBLISHED version of the same pack', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'supersede.1', name: 'S1' });
    if (!isOk(pack)) throw new Error('pack');
    const v1 = await publishedVersion(pack.value.id);
    expect(v1.status).toBe('PUBLISHED');

    const v2 = await publishedVersion(pack.value.id);
    expect(v2.status).toBe('PUBLISHED');

    const versions = await listPackVersions(db, pack.value.id);
    const reloadedV1 = versions.find((v) => v.id === v1.id);
    expect(reloadedV1?.status).toBe('DEPRECATED');
    expect(reloadedV1?.supersededAt).not.toBeNull();

    // listPublishedPackVersions reflects only the current version once superseded.
    const published = await listPublishedPackVersions(db);
    const forThisPack = published.filter(
      (p) => p.packVersionId === v1.id || p.packVersionId === v2.id,
    );
    expect(forThisPack.map((p) => p.packVersionId)).toEqual([v2.id]);
  });

  it("never touches a different pack's published version", async () => {
    const packA = await createPack(db, { actorAccountId: actor, key: 'supersede.a', name: 'A' });
    const packB = await createPack(db, { actorAccountId: actor, key: 'supersede.b', name: 'B' });
    if (!isOk(packA) || !isOk(packB)) throw new Error('pack');
    const aV1 = await publishedVersion(packA.value.id);
    const bV1 = await publishedVersion(packB.value.id);
    await publishedVersion(packA.value.id);

    const bVersions = await listPackVersions(db, packB.value.id);
    expect(bVersions.find((v) => v.id === bV1.id)?.status).toBe('PUBLISHED');
    const aVersions = await listPackVersions(db, packA.value.id);
    expect(aVersions.find((v) => v.id === aV1.id)?.status).toBe('DEPRECATED');
  });

  it('withdrawPackVersion requires a PUBLISHED version and a reason, and records who/why/when', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'withdraw.1', name: 'W1' });
    if (!isOk(pack)) throw new Error('pack');
    const v1 = await publishedVersion(pack.value.id);

    const noReason = await withdrawPackVersion(db, {
      actorAccountId: actor,
      packVersionId: v1.id,
      reason: '   ',
    });
    expect(isErr(noReason)).toBe(true);

    const withdrawn = await withdrawPackVersion(db, {
      actorAccountId: actor,
      packVersionId: v1.id,
      reason: 'source page taken down by publisher',
    });
    expect(isOk(withdrawn)).toBe(true);
    if (!isOk(withdrawn)) return;
    expect(withdrawn.value.status).toBe('WITHDRAWN');
    expect(withdrawn.value.withdrawnByAccountId).toBe(actor);
    expect(withdrawn.value.withdrawnReason).toBe('source page taken down by publisher');
    expect(withdrawn.value.withdrawnAt).not.toBeNull();
  });

  it('refuses to withdraw a DRAFT or APPROVED version', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'withdraw.2', name: 'W2' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');

    const draftWithdraw = await withdrawPackVersion(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      reason: 'x',
    });
    expect(isErr(draftWithdraw)).toBe(true);
    if (isErr(draftWithdraw)) expect(draftWithdraw.error.code).toBe('invalid');
  });
});

describe('Pack Studio - per-requirement source inaccessibility (RUL-05)', () => {
  let db: Db;
  let actor: string;
  beforeEach(async () => {
    db = await freshDb();
    actor = await authorId(db);
  });

  it('marks and clears a requirement source as inaccessible', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'inaccessible.1', name: 'I1' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const req = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'x',
      citation: 'x',
    });
    if (!isOk(req)) throw new Error('req');

    const marked = await markRequirementSourceInaccessible(db, {
      actorAccountId: actor,
      requirementId: req.value.id,
    });
    expect(isOk(marked)).toBe(true);
    if (isOk(marked)) expect(marked.value.sourceInaccessibleAt).not.toBeNull();

    const cleared = await clearRequirementSourceInaccessible(db, {
      actorAccountId: actor,
      requirementId: req.value.id,
    });
    expect(isOk(cleared)).toBe(true);
    if (isOk(cleared)) expect(cleared.value.sourceInaccessibleAt).toBeNull();
  });

  it('returns not_found for an unknown requirement id', async () => {
    const result = await markRequirementSourceInaccessible(db, {
      actorAccountId: actor,
      requirementId: '00000000-0000-0000-0000-000000000000',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('not_found');
  });
});

describe('Pack Studio - review queue and version diff (RUL-05)', () => {
  let db: Db;
  let actor: string;
  beforeEach(async () => {
    db = await freshDb();
    actor = await authorId(db);
  });

  async function publishedVersionWithReview(packId: string, nextReviewDate: Date): Promise<string> {
    const version = await addPackVersion(db, { actorAccountId: actor, packId });
    if (!isOk(version)) throw new Error('version');
    const req = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'x',
      citation: 'x',
    });
    if (!isOk(req)) throw new Error('req');
    const approved = await approvePackVersion(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      nextReviewDate,
      reviewIntervalReason: 'test fixture',
    });
    if (!isOk(approved)) throw new Error('approve');
    const published = await publishPackVersion(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
    });
    if (!isOk(published)) throw new Error('publish');
    return published.value.id;
  }

  it('lists only PUBLISHED versions whose next-review date has passed, most overdue first', async () => {
    // Three SEPARATE packs, not three versions of one pack: publishPackVersion
    // auto-supersedes (DEPRECATED) any prior PUBLISHED version of the SAME
    // pack (RUL-05), so publishing three versions of one pack in sequence
    // would leave only the last one actually PUBLISHED - exactly the trap
    // this fixture originally fell into.
    const packSooner = await createPack(db, {
      actorAccountId: actor,
      key: 'review.sooner',
      name: 'S',
    });
    const packEarlier = await createPack(db, {
      actorAccountId: actor,
      key: 'review.earlier',
      name: 'E',
    });
    const packNotDue = await createPack(db, {
      actorAccountId: actor,
      key: 'review.notdue',
      name: 'N',
    });
    if (!isOk(packSooner) || !isOk(packEarlier) || !isOk(packNotDue)) throw new Error('pack');

    const now = new Date();
    const overdueByTwoDays = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const overdueByOneDay = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const notYetDue = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

    const dueSoonerId = await publishedVersionWithReview(packSooner.value.id, overdueByOneDay);
    const dueEarlierId = await publishedVersionWithReview(packEarlier.value.id, overdueByTwoDays);
    await publishedVersionWithReview(packNotDue.value.id, notYetDue);

    const due = await listPackVersionsDueForReview(db, now);
    const relevantIds = due
      .map((d) => d.packVersionId)
      .filter((id) => id === dueSoonerId || id === dueEarlierId);
    expect(relevantIds).toEqual([dueEarlierId, dueSoonerId]);
    expect(due.some((d) => d.packId === packNotDue.value.id)).toBe(false);
  });

  it('never lists a DRAFT/APPROVED version or a version with no next-review date set', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'review.2', name: 'R2' });
    if (!isOk(pack)) throw new Error('pack');
    const draft = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(draft)) throw new Error('draft');

    const due = await listPackVersionsDueForReview(db, new Date());
    expect(due.some((d) => d.packVersionId === draft.value.id)).toBe(false);
  });

  it('diffs two versions of the same pack: added, removed, changed, and unchanged requirements', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'diff.1', name: 'D1' });
    if (!isOk(pack)) throw new Error('pack');

    const v1 = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(v1)) throw new Error('v1');
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: v1.value.id,
      kind: 'FIELD',
      fieldKey: 'unchanged.field',
      citation: 'same citation',
    });
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: v1.value.id,
      kind: 'FIELD',
      fieldKey: 'changed.field',
      citation: 'old citation',
    });
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: v1.value.id,
      kind: 'DOCUMENT',
      docType: 'removed_doc',
      citation: 'gone in v2',
    });

    const v2 = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(v2)) throw new Error('v2');
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: v2.value.id,
      kind: 'FIELD',
      fieldKey: 'unchanged.field',
      citation: 'same citation',
    });
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: v2.value.id,
      kind: 'FIELD',
      fieldKey: 'changed.field',
      citation: 'new citation',
    });
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: v2.value.id,
      kind: 'DOCUMENT',
      docType: 'added_doc',
      citation: 'new in v2',
    });

    const diff = await diffPackVersions(db, v1.value.id, v2.value.id);
    expect(isOk(diff)).toBe(true);
    if (!isOk(diff)) return;
    const byKey = Object.fromEntries(diff.value.entries.map((e) => [e.key, e]));

    expect(byKey['FIELD:unchanged.field']?.change).toBe('unchanged');
    expect(byKey['FIELD:unchanged.field']?.changedFields).toEqual([]);

    expect(byKey['FIELD:changed.field']?.change).toBe('changed');
    expect(byKey['FIELD:changed.field']?.changedFields).toEqual(['citation']);

    expect(byKey['DOCUMENT:removed_doc']?.change).toBe('removed');
    expect(byKey['DOCUMENT:removed_doc']?.to).toBeNull();

    expect(byKey['DOCUMENT:added_doc']?.change).toBe('added');
    expect(byKey['DOCUMENT:added_doc']?.from).toBeNull();
  });

  it('refuses to diff versions from two different packs', async () => {
    const packA = await createPack(db, { actorAccountId: actor, key: 'diff.a', name: 'A' });
    const packB = await createPack(db, { actorAccountId: actor, key: 'diff.b', name: 'B' });
    if (!isOk(packA) || !isOk(packB)) throw new Error('pack');
    const vA = await addPackVersion(db, { actorAccountId: actor, packId: packA.value.id });
    const vB = await addPackVersion(db, { actorAccountId: actor, packId: packB.value.id });
    if (!isOk(vA) || !isOk(vB)) throw new Error('version');

    const result = await diffPackVersions(db, vA.value.id, vB.value.id);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('returns not_found for an unknown version id on either side', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'diff.missing', name: 'M' });
    if (!isOk(pack)) throw new Error('pack');
    const v1 = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(v1)) throw new Error('v1');

    const missing = '00000000-0000-0000-0000-000000000000';
    const result = await diffPackVersions(db, v1.value.id, missing);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('not_found');
  });
});
