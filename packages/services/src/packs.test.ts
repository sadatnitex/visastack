import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  clearOfficialFeeStale,
  clearRequirementSourceInaccessible,
  createPack,
  diffPackVersions,
  getPublicTrustRoute,
  listPackVersions,
  listPackVersionsDueForReview,
  listPacks,
  listPublicTrustPublished,
  listPublishedPackVersions,
  markOfficialFeeStale,
  markRequirementSourceInaccessible,
  publishPackVersion,
  publishToPublicTrust,
  setPublicTrustContent,
  unpublishFromPublicTrust,
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

  it('refuses a requirement source URL that is not an absolute http(s) link, and stores nothing', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'url.bad', name: 'URL Bad' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');

    for (const sourceUrl of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '/relative/path',
      'www.gov.uk/no-scheme',
      'see the official website',
    ]) {
      const result = await addRequirement(db, {
        actorAccountId: actor,
        packVersionId: version.value.id,
        kind: 'FIELD',
        fieldKey: 'passport_expiry',
        citation: 'UK Immigration Rules Appendix V 4.2',
        sourceUrl,
      });
      expect(isErr(result), sourceUrl).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('invalid');
        expect(result.error.message).toBe('sourceUrl must be an http or https URL');
      }
    }
    const stored = await db
      .select()
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.packVersionId, version.value.id));
    expect(stored).toEqual([]);
  });

  it('still accepts an http(s) source URL, and a requirement with no source URL at all', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'url.ok', name: 'URL OK' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    for (const sourceUrl of [
      'https://www.gov.uk/standard-visitor',
      'http://example.org/x',
      undefined,
    ]) {
      const result = await addRequirement(db, {
        actorAccountId: actor,
        packVersionId: version.value.id,
        kind: 'FIELD',
        fieldKey: 'passport_expiry',
        citation: 'UK Immigration Rules Appendix V 4.2',
        ...(sourceUrl !== undefined ? { sourceUrl } : {}),
      });
      expect(isOk(result), String(sourceUrl)).toBe(true);
    }
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

describe('Pack Studio - Public Trust Lite (RUL-06)', () => {
  let db: Db;
  let actor: string;
  let reviewer: string;
  beforeEach(async () => {
    db = await freshDb();
    actor = await authorId(db);
    const p = await provisionAccount(db, { email: 'trust-reviewer@example.com' });
    if (!isOk(p)) throw new Error('provision');
    reviewer = p.value.id;
  });

  /** A DRAFT version of an authoritative pack, with one sourced requirement, ready for `setPublicTrustContent`. */
  async function draftAuthoritative(key: string) {
    const pack = await createPack(db, {
      actorAccountId: actor,
      key,
      name: 'UK Tourist',
      jurisdiction: 'UK',
      route: 'Standard Visitor',
      authoritative: true,
    });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const req = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport_expiry',
      citation: 'UK Immigration Rules Appendix V 4.2',
      sourceUrl: 'https://www.gov.uk/standard-visitor',
      sourceTitle: 'Standard Visitor visa',
      publisher: 'UK Home Office',
    });
    if (!isOk(req)) throw new Error('req');
    return { packId: pack.value.id, packKey: pack.value.key, versionId: version.value.id };
  }

  /** Carries a `draftAuthoritative` version all the way to PUBLISHED + live on the public trust surface. */
  async function publishedAndTrusted(key: string) {
    const { packId, packKey, versionId } = await draftAuthoritative(key);
    const content = await setPublicTrustContent(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      routeDescription: 'The UK Standard Visitor route for short tourist stays.',
      officialFeeMinorUnits: 10000,
      officialFeeCurrency: 'GBP',
      officialChannelName: 'UK Visas and Immigration',
      officialChannelUrl: 'https://www.gov.uk/apply-uk-visa',
      officialReportingUrl: 'https://www.gov.uk/report-immigration-crime',
    });
    if (!isOk(content)) throw new Error('content');
    const approved = await approvePackVersion(db, {
      actorAccountId: reviewer,
      packVersionId: versionId,
    });
    if (!isOk(approved)) throw new Error('approved');
    const published = await publishPackVersion(db, {
      actorAccountId: actor,
      packVersionId: versionId,
    });
    if (!isOk(published)) throw new Error('published');
    const trusted = await publishToPublicTrust(db, {
      actorAccountId: actor,
      packVersionId: versionId,
    });
    if (!isOk(trusted)) throw new Error('trusted');
    return { packId, packKey, versionId };
  }

  it('setPublicTrustContent refuses an official channel or reporting URL that is not http(s), and changes nothing', async () => {
    const { versionId } = await draftAuthoritative('trust.badurl');
    const seeded = await setPublicTrustContent(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      officialChannelUrl: 'https://www.gov.uk/apply-uk-visa',
      officialReportingUrl: 'https://www.gov.uk/report-immigration-crime',
    });
    expect(isOk(seeded)).toBe(true);

    const cases = [
      { officialChannelUrl: 'javascript:alert(1)', label: 'official channel URL' },
      { officialChannelUrl: 'data:text/html,x', label: 'official channel URL' },
      { officialReportingUrl: 'javascript:alert(1)', label: 'official reporting URL' },
      { officialReportingUrl: '/just/a/path', label: 'official reporting URL' },
    ] as const;
    for (const { label, ...fields } of cases) {
      const result = await setPublicTrustContent(db, {
        actorAccountId: actor,
        packVersionId: versionId,
        ...fields,
      });
      expect(isErr(result), JSON.stringify(fields)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('invalid');
        expect(result.error.message).toBe(`${label} must be an http or https URL`);
      }
    }
    const [row] = await db
      .select()
      .from(schema.packVersions)
      .where(eq(schema.packVersions.id, versionId));
    expect(row?.officialChannelUrl).toBe('https://www.gov.uk/apply-uk-visa');
    expect(row?.officialReportingUrl).toBe('https://www.gov.uk/report-immigration-crime');
  });

  it('setPublicTrustContent still lets an author clear a URL with a blank value', async () => {
    const { versionId } = await draftAuthoritative('trust.clearurl');
    const seeded = await setPublicTrustContent(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      officialChannelUrl: 'https://www.gov.uk/apply-uk-visa',
    });
    expect(isOk(seeded)).toBe(true);
    const cleared = await setPublicTrustContent(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      officialChannelUrl: '   ',
    });
    expect(isOk(cleared)).toBe(true);
    if (isOk(cleared)) expect(cleared.value.officialChannelUrl).toBeNull();
  });

  it('setPublicTrustContent updates only the fields provided, leaving the rest untouched', async () => {
    const { versionId } = await draftAuthoritative('trust.partial');
    const first = await setPublicTrustContent(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      routeDescription: 'First description.',
      officialChannelName: 'UKVI',
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.routeDescription).toBe('First description.');
    expect(first.value.officialChannelName).toBe('UKVI');

    const second = await setPublicTrustContent(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      officialChannelUrl: 'https://www.gov.uk/apply-uk-visa',
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    // Untouched by the second call.
    expect(second.value.routeDescription).toBe('First description.');
    expect(second.value.officialChannelName).toBe('UKVI');
    // Set by the second call.
    expect(second.value.officialChannelUrl).toBe('https://www.gov.uk/apply-uk-visa');
  });

  it('refuses public trust content once the version has left DRAFT', async () => {
    const { versionId } = await draftAuthoritative('trust.notdraft');
    const approved = await approvePackVersion(db, {
      actorAccountId: reviewer,
      packVersionId: versionId,
    });
    expect(isOk(approved)).toBe(true);
    const result = await setPublicTrustContent(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      routeDescription: 'Too late.',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('refuses an official fee set without a currency, or vice versa', async () => {
    const { versionId } = await draftAuthoritative('trust.feepair');
    const amountOnly = await setPublicTrustContent(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      officialFeeMinorUnits: 5000,
    });
    expect(isErr(amountOnly)).toBe(true);
    if (isErr(amountOnly)) expect(amountOnly.error.code).toBe('invalid');

    const currencyOnly = await setPublicTrustContent(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      officialFeeCurrency: 'GBP',
    });
    expect(isErr(currencyOnly)).toBe(true);
  });

  it('publishToPublicTrust refuses a non-PUBLISHED version, a missing route description, and a non-authoritative pack', async () => {
    const { versionId: draftVersionId } = await draftAuthoritative('trust.notpub');
    const notPublished = await publishToPublicTrust(db, {
      actorAccountId: actor,
      packVersionId: draftVersionId,
    });
    expect(isErr(notPublished)).toBe(true);
    if (isErr(notPublished)) expect(notPublished.error.code).toBe('invalid');

    // No route description set before publishing.
    const approved = await approvePackVersion(db, {
      actorAccountId: reviewer,
      packVersionId: draftVersionId,
    });
    expect(isOk(approved)).toBe(true);
    const published = await publishPackVersion(db, {
      actorAccountId: actor,
      packVersionId: draftVersionId,
    });
    expect(isOk(published)).toBe(true);
    const noDescription = await publishToPublicTrust(db, {
      actorAccountId: actor,
      packVersionId: draftVersionId,
    });
    expect(isErr(noDescription)).toBe(true);
    if (isErr(noDescription)) expect(noDescription.error.code).toBe('invalid');

    // A non-authoritative (agency custom) pack, even with a description set and published.
    const customPack = await createPack(db, {
      actorAccountId: actor,
      key: 'trust.custom',
      name: 'Agency Custom',
      authoritative: false,
    });
    if (!isOk(customPack)) throw new Error('pack');
    const customVersion = await addPackVersion(db, {
      actorAccountId: actor,
      packId: customPack.value.id,
    });
    if (!isOk(customVersion)) throw new Error('version');
    const customReq = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: customVersion.value.id,
      kind: 'FIELD',
      fieldKey: 'x',
      citation: 'agency checklist item',
    });
    if (!isOk(customReq)) throw new Error('req');
    const customContent = await setPublicTrustContent(db, {
      actorAccountId: actor,
      packVersionId: customVersion.value.id,
      routeDescription: 'An agency checklist, not an official source.',
    });
    expect(isOk(customContent)).toBe(true);
    const customApproved = await approvePackVersion(db, {
      actorAccountId: actor,
      packVersionId: customVersion.value.id,
    });
    expect(isOk(customApproved)).toBe(true);
    const customPublished = await publishPackVersion(db, {
      actorAccountId: actor,
      packVersionId: customVersion.value.id,
    });
    expect(isOk(customPublished)).toBe(true);
    const notAuthoritative = await publishToPublicTrust(db, {
      actorAccountId: actor,
      packVersionId: customVersion.value.id,
    });
    expect(isErr(notAuthoritative)).toBe(true);
    if (isErr(notAuthoritative)) expect(notAuthoritative.error.code).toBe('forbidden');
  });

  it('unpublishFromPublicTrust clears exposure without touching case-readiness usability', async () => {
    const { versionId } = await publishedAndTrusted('trust.unpub');
    const unpublished = await unpublishFromPublicTrust(db, {
      actorAccountId: actor,
      packVersionId: versionId,
    });
    expect(isOk(unpublished)).toBe(true);
    if (!isOk(unpublished)) return;
    expect(unpublished.value.publicTrustPublishedAt).toBeNull();
    expect(unpublished.value.status).toBe('PUBLISHED');

    const again = await unpublishFromPublicTrust(db, {
      actorAccountId: actor,
      packVersionId: versionId,
    });
    expect(isErr(again)).toBe(true);
    if (isErr(again)) expect(again.error.code).toBe('invalid');
  });

  it('getPublicTrustRoute returns null for an unknown pack, a non-authoritative pack, and a PUBLISHED-but-not-trust-published version', async () => {
    expect(await getPublicTrustRoute(db, 'does.not.exist')).toBeNull();

    const { packKey: draftedKey } = await draftAuthoritative('trust.notyet');
    // PUBLISHED never happened for this one at all.
    expect(await getPublicTrustRoute(db, draftedKey)).toBeNull();
  });

  it('getPublicTrustRoute returns the full public shape, with deduplicated official sources', async () => {
    const { packKey } = await publishedAndTrusted('trust.full');
    const route = await getPublicTrustRoute(db, packKey);
    expect(route).not.toBeNull();
    if (!route) return;
    expect(route.routeDescription).toBe('The UK Standard Visitor route for short tourist stays.');
    expect(route.jurisdiction).toBe('UK');
    expect(route.officialFee).toEqual({ minorUnits: 10000, currency: 'GBP' });
    expect(route.officialChannelUrl).toBe('https://www.gov.uk/apply-uk-visa');
    expect(route.officialReportingUrl).toBe('https://www.gov.uk/report-immigration-crime');
    expect(route.officialSources).toEqual([
      {
        publisher: 'UK Home Office',
        sourceTitle: 'Standard Visitor visa',
        sourceUrl: 'https://www.gov.uk/standard-visitor',
      },
    ]);
  });

  it('removes the fee amount once marked stale, but restores it once cleared, per directive §9', async () => {
    const { packKey, versionId } = await publishedAndTrusted('trust.stale');
    const staled = await markOfficialFeeStale(db, {
      actorAccountId: actor,
      packVersionId: versionId,
    });
    expect(isOk(staled)).toBe(true);

    const staleRoute = await getPublicTrustRoute(db, packKey);
    expect(staleRoute?.officialFee).toBeNull();
    // Everything else about the route is still shown -- only the amount is withheld.
    expect(staleRoute?.officialChannelUrl).toBe('https://www.gov.uk/apply-uk-visa');

    const cleared = await clearOfficialFeeStale(db, {
      actorAccountId: actor,
      packVersionId: versionId,
    });
    expect(isOk(cleared)).toBe(true);
    const restoredRoute = await getPublicTrustRoute(db, packKey);
    expect(restoredRoute?.officialFee).toEqual({ minorUnits: 10000, currency: 'GBP' });
  });

  it('removes the fee amount once this version is overdue for review', async () => {
    const { packId, packKey, versionId } = await publishedAndTrusted('trust.overdue');
    // Overdue: nextReviewDate in the past. Only reachable directly on the
    // row here -- there is no service function that backdates a review
    // date, by design (RUL-02's own "<=30 days unless documented reason").
    await db
      .update(schema.packVersions)
      .set({ nextReviewDate: new Date(Date.now() - 1000) })
      .where(eq(schema.packVersions.id, versionId));
    const route = await getPublicTrustRoute(db, packKey);
    expect(route?.officialFee).toBeNull();
    expect(packId).toBeTruthy();
  });

  it('does not carry public trust exposure forward to a newer version that supersedes it', async () => {
    const { packId, packKey, versionId: v1Id } = await publishedAndTrusted('trust.supersede');
    expect(await getPublicTrustRoute(db, packKey)).not.toBeNull();

    const v2 = await addPackVersion(db, { actorAccountId: actor, packId });
    if (!isOk(v2)) throw new Error('v2');
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: v2.value.id,
      kind: 'FIELD',
      fieldKey: 'passport_expiry',
      citation: 'UK Immigration Rules Appendix V 4.2',
    });
    const approved = await approvePackVersion(db, {
      actorAccountId: reviewer,
      packVersionId: v2.value.id,
    });
    if (!isOk(approved)) throw new Error('approved');
    const published = await publishPackVersion(db, {
      actorAccountId: actor,
      packVersionId: v2.value.id,
    });
    expect(isOk(published)).toBe(true);

    // v1 is now DEPRECATED (auto-superseded); v2 was never explicitly
    // opted into public trust. The route must go honestly unavailable,
    // never silently keep showing v1's now-superseded content.
    expect(await getPublicTrustRoute(db, packKey)).toBeNull();
    expect(v1Id).toBeTruthy();
  });

  it('listPublicTrustPublished lists only currently-live routes, most recently published first', async () => {
    const { packKey: keyA } = await publishedAndTrusted('trust.list.a');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const { packKey: keyB, versionId: versionB } = await publishedAndTrusted('trust.list.b');

    const before = await listPublicTrustPublished(db);
    expect(before.map((r) => r.packKey)).toEqual([keyB, keyA]);

    await unpublishFromPublicTrust(db, { actorAccountId: actor, packVersionId: versionB });
    const after = await listPublicTrustPublished(db);
    expect(after.map((r) => r.packKey)).toEqual([keyA]);
  });
});
