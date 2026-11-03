/**
 * UMPE P13: package changes and checklist updates shown on Home only while they need the
 * traveller. Synthetic data only. Pins:
 * 1. An open P4 package change on an active case is one item linking to the case's package.
 * 2. A P11 rule impact shows only while the case is still on the older version.
 * 3. Resolved changes and closed, cancelled or submitted cases show nothing.
 * 4. A case with both shows once (the package change).
 * 5. Only the owner may read; anyone else is refused, never shown another person's cases.
 * 6. Missing tables (code ahead of its migration) give an empty list, never an error.
 */
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { attachPackVersion, createMission } from './missions';
import {
  type RequirementInput,
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from './packs';
import { PACKAGE_NOTICE_TITLES, listPackageNotices } from './umpe-experience-notices';
import { PACKAGE_CHANGE_LABELS } from './umpe-package-phrases';

const TEST_TIMEOUT_MS = 90_000;

const PASSPORT: RequirementInput = {
  kind: 'DOCUMENT',
  docType: 'passport',
  citation: 'Synthetic rule 1',
};

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function person(db: Db, email: string) {
  const account = await provisionAccount(db, { email });
  if (!isOk(account)) throw new Error('provision');
  await setConsent(db, {
    actorAccountId: account.value.id,
    accountId: account.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.value.id,
    ownerAccountId: account.value.id,
    displayName: 'Synthetic Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { actor: account.value.id, applicantId: applicant.value.id };
}

async function publishedVersion(db: Db, actor: string, packId?: string) {
  let id = packId;
  if (!id) {
    const pack = await createPack(db, {
      actorAccountId: actor,
      key: `p13.${Math.random().toString(36).slice(2)}`,
      name: 'P13 Synthetic',
    });
    if (!isOk(pack)) throw new Error('pack');
    id = pack.value.id;
  }
  const version = await addPackVersion(db, { actorAccountId: actor, packId: id });
  if (!isOk(version)) throw new Error('version');
  const added = await addRequirement(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
    ...PASSPORT,
  });
  if (!isOk(added)) throw new Error('requirement');
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
  return { packId: id, versionId: version.value.id };
}

async function caseOn(
  db: Db,
  actor: string,
  applicantId: string,
  versionId: string,
  title: string,
) {
  const mission = await createMission(db, { actorAccountId: actor, applicantId, title });
  if (!isOk(mission)) throw new Error('mission');
  const attached = await attachPackVersion(db, {
    actorAccountId: actor,
    missionId: mission.value.id,
    packVersionId: versionId,
  });
  if (!isOk(attached)) throw new Error('attach');
  return mission.value.id;
}

async function packageChange(
  db: Db,
  missionId: string,
  applicantId: string,
  options: { readonly resolved?: boolean } = {},
) {
  await db.insert(schema.umpePackageChanges).values({
    missionId,
    applicantId,
    kind: 'NEWER_DOCUMENT',
    signature: `NEWER_DOCUMENT|-:${missionId}`,
    detail: {},
    source: 'SWEEP',
    ...(options.resolved ? { resolvedAt: new Date(), resolution: 'REVIEWED' } : {}),
  });
}

async function ruleImpact(
  db: Db,
  missionId: string,
  older: { packId: string; versionId: string },
  newer: { versionId: string },
) {
  // Publishing the newer version already opened its run (P11 publish hook); reuse it.
  await db
    .insert(schema.umpeRuleImpactRuns)
    .values({ packId: older.packId, packVersionId: newer.versionId })
    .onConflictDoNothing();
  const [run] = await db
    .select({ id: schema.umpeRuleImpactRuns.id })
    .from(schema.umpeRuleImpactRuns)
    .where(eq(schema.umpeRuleImpactRuns.packVersionId, newer.versionId));
  if (!run) throw new Error('run');
  await db.insert(schema.umpeRuleImpacts).values({
    runId: run.id,
    packVersionId: newer.versionId,
    previousPackVersionId: older.versionId,
    subjectKind: 'CASE',
    missionId,
    changeKind: 'ADDED',
    itemKind: 'DOCUMENT',
    itemKey: 'hotel_booking',
    changedCount: 1,
  });
}

async function ownerProof(db: Db, actor: string, applicantId: string) {
  const proof = await requireAccess(
    db,
    accountPrincipal(actor),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'self' },
  );
  if (!isOk(proof)) throw new Error('owner proof');
  return proof.value;
}

describe('package notices for Home (UMPE P13)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  }, TEST_TIMEOUT_MS);

  it(
    'lists an open package change and a rule update that still applies, one per case, linking to the package',
    async () => {
      const { actor, applicantId } = await person(db, 'p13-owner@example.com');
      const older = await publishedVersion(db, actor);
      const changed = await caseOn(db, actor, applicantId, older.versionId, 'Synthetic Change');
      const updated = await caseOn(db, actor, applicantId, older.versionId, 'Synthetic Update');
      const both = await caseOn(db, actor, applicantId, older.versionId, 'Synthetic Both');
      const newer = await publishedVersion(db, actor, older.packId);
      await packageChange(db, changed, applicantId);
      await ruleImpact(db, updated, older, newer);
      await packageChange(db, both, applicantId);
      await ruleImpact(db, both, older, newer);

      const listed = await listPackageNotices(await ownerProof(db, actor, applicantId));
      if (!isOk(listed)) throw new Error(listed.error.message);
      const byCase = new Map(listed.value.map((item) => [item.caseId, item]));
      expect(listed.value).toHaveLength(3);
      expect(byCase.get(changed)).toMatchObject({
        kind: 'case_changed',
        tier: 4,
        title: PACKAGE_NOTICE_TITLES.package,
        why: PACKAGE_CHANGE_LABELS.NEWER_DOCUMENT,
        caseTitle: 'Synthetic Change',
        href: `/app/mission/${changed}#trip-package`,
      });
      expect(byCase.get(updated)?.title).toBe(PACKAGE_NOTICE_TITLES.rule);
      expect(byCase.get(updated)?.why).toContain('Hotel');
      expect(byCase.get(updated)?.why).toContain('Review it before you share anything.');
      // The case with both shows once, as its package change.
      expect(byCase.get(both)?.title).toBe(PACKAGE_NOTICE_TITLES.package);
      expect(new Set(listed.value.map((item) => item.key)).size).toBe(3);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'shows nothing once a change is resolved, the case moved on, or the case is no longer active',
    async () => {
      const { actor, applicantId } = await person(db, 'p13-quiet@example.com');
      const older = await publishedVersion(db, actor);
      const resolved = await caseOn(db, actor, applicantId, older.versionId, 'Synthetic Resolved');
      const moved = await caseOn(db, actor, applicantId, older.versionId, 'Synthetic Moved');
      const closed = await caseOn(db, actor, applicantId, older.versionId, 'Synthetic Closed');
      const submitted = await caseOn(db, actor, applicantId, older.versionId, 'Synthetic Sent');
      const newer = await publishedVersion(db, actor, older.packId);
      await packageChange(db, resolved, applicantId, { resolved: true });
      await ruleImpact(db, moved, older, newer);
      await db
        .update(schema.missions)
        .set({ packVersionId: newer.versionId })
        .where(eq(schema.missions.id, moved));
      await packageChange(db, closed, applicantId);
      await db
        .update(schema.missions)
        .set({ state: 'CANCELLED' })
        .where(eq(schema.missions.id, closed));
      await ruleImpact(db, submitted, older, newer);
      await db
        .update(schema.missions)
        .set({ state: 'SUBMITTED' })
        .where(eq(schema.missions.id, submitted));

      const listed = await listPackageNotices(await ownerProof(db, actor, applicantId));
      if (!isOk(listed)) throw new Error(listed.error.message);
      expect(listed.value).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "never lists another person's cases and refuses anyone but the owner",
    async () => {
      const owner = await person(db, 'p13-one@example.com');
      const other = await person(db, 'p13-two@example.com');
      const version = await publishedVersion(db, owner.actor);
      const theirs = await caseOn(db, other.actor, other.applicantId, version.versionId, 'Theirs');
      await packageChange(db, theirs, other.applicantId);

      const own = await listPackageNotices(await ownerProof(db, owner.actor, owner.applicantId));
      if (!isOk(own)) throw new Error(own.error.message);
      expect(own.value).toEqual([]);

      // A forged proof (a plain object, not one the gate issued) is refused.
      const genuine = await ownerProof(db, other.actor, other.applicantId);
      const forged = { ...genuine } as typeof genuine;
      const refused = await listPackageNotices(forged);
      expect(isOk(refused)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'gives an empty list, never an error, while the tables are missing',
    async () => {
      const { actor, applicantId } = await person(db, 'p13-early@example.com');
      await db.execute(sql`drop table umpe_package_changes cascade`);
      await db.execute(sql`drop table umpe_rule_impacts cascade`);
      const listed = await listPackageNotices(await ownerProof(db, actor, applicantId));
      if (!isOk(listed)) throw new Error(listed.error.message);
      expect(listed.value).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
