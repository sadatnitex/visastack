import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { TRAVELLER_PLAN_KEY } from './entitlements';
import { getAccountEvidenceBytes, getApplicantEvidenceBytes } from './quotas';
import { getTravellerPlanSummary } from './traveller-plan';

let db: Db;

beforeEach(async () => {
  const client = await createMigratedPglite();
  db = drizzle(client, { schema }) as unknown as Db;
}, 60_000);

async function traveller(email: string): Promise<string> {
  const account = await provisionAccount(db, { email });
  if (!isOk(account)) throw new Error('provision failed');
  await setConsent(db, {
    actorAccountId: account.value.id,
    accountId: account.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  return account.value.id;
}

async function profile(
  accountId: string,
  displayName: string,
  sizes: readonly number[],
): Promise<string> {
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName,
  });
  if (!isOk(applicant)) throw new Error('applicant failed');
  if (sizes.length === 0) return applicant.value.id;
  const [doc] = await db
    .insert(schema.documents)
    .values({
      applicantId: applicant.value.id,
      originalName: 'evidence.pdf',
      uploaderAccountId: accountId,
    })
    .returning();
  if (!doc) throw new Error('document insert failed');
  for (const [i, size] of sizes.entries()) {
    const [object] = await db
      .insert(schema.storageObjects)
      .values({ bucket: 'CLEAN', objectKey: `obj-${applicant.value.id}-${i}`, sizeBytes: size })
      .returning();
    if (!object) throw new Error('storage object insert failed');
    await db.insert(schema.documentVersions).values({
      documentId: doc.id,
      versionNumber: i + 1,
      storageObjectId: object.id,
      sizeBytes: size,
    });
  }
  return applicant.value.id;
}

describe('getTravellerPlanSummary', () => {
  it('names the traveller plan every traveller is on', async () => {
    const accountId = await traveller('plan@example.com');
    const summary = await getTravellerPlanSummary(db, { actorAccountId: accountId });
    expect(summary.plan?.key).toBe(TRAVELLER_PLAN_KEY);
    expect(summary.plan?.name.length).toBeGreaterThan(0);
    // The plan's own rule for each traveller AI feature, apart from whether it works now.
    expect(summary.features?.ai_automatic_reading).toEqual(
      expect.objectContaining({ included: expect.any(Boolean) }),
    );
  });

  it('counts storage per owned profile and in total, the same way the upload limits do', async () => {
    const accountId = await traveller('storage@example.com');
    const self = await profile(accountId, 'Self', [1000, 2500]);
    const child = await profile(accountId, 'Child', [400]);
    const empty = await profile(accountId, 'Spouse', []);

    const summary = await getTravellerPlanSummary(db, { actorAccountId: accountId });

    expect(new Map(summary.profiles.map((p) => [p.applicantId, p.usedBytes]))).toEqual(
      new Map([
        [self, 3500],
        [child, 400],
        [empty, 0],
      ]),
    );
    expect(summary.usedBytes).toBe(3900);
    expect(summary.usedBytes).toBe(await getAccountEvidenceBytes(db, accountId));
    for (const p of summary.profiles) {
      expect(p.usedBytes).toBe(await getApplicantEvidenceBytes(db, p.applicantId));
    }
  });

  it("never reads another account's profiles", async () => {
    const mine = await traveller('mine@example.com');
    const theirs = await traveller('theirs@example.com');
    await profile(mine, 'Mine', [10]);
    await profile(theirs, 'Theirs', [999]);

    const summary = await getTravellerPlanSummary(db, { actorAccountId: mine });

    expect(summary.profiles.map((p) => p.displayName)).toEqual(['Mine']);
    expect(summary.usedBytes).toBe(10);
  });

  it('reports nothing stored for an account with no profiles yet', async () => {
    const accountId = await traveller('new@example.com');
    const summary = await getTravellerPlanSummary(db, { actorAccountId: accountId });
    expect(summary.profiles).toEqual([]);
    expect(summary.usedBytes).toBe(0);
  });
});
