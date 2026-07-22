import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  checkUploadQuota,
  getAccountEvidenceBytes,
  getApplicantEvidenceBytes,
  getPlatformEvidenceBytes,
  loadUploadQuotaConfig,
} from './quotas';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seedApplicantWithEvidence(
  db: Db,
  email: string,
  sizes: readonly number[],
): Promise<{ accountId: string; applicantId: string }> {
  const account = await provisionAccount(db, { email });
  if (!isOk(account)) throw new Error('provision failed');
  await setConsent(db, {
    actorAccountId: account.value.id,
    accountId: account.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.value.id,
    ownerAccountId: account.value.id,
    displayName: 'Evidence Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant failed');

  const doc = (
    await db
      .insert(schema.documents)
      .values({
        applicantId: applicant.value.id,
        originalName: 'evidence.pdf',
        uploaderAccountId: account.value.id,
      })
      .returning()
  )[0];
  if (!doc) throw new Error('document insert failed');

  for (const [i, size] of sizes.entries()) {
    const object = (
      await db
        .insert(schema.storageObjects)
        .values({ bucket: 'CLEAN', objectKey: `obj-${email}-${i}`, sizeBytes: size })
        .returning()
    )[0];
    if (!object) throw new Error('storage object insert failed');
    await db.insert(schema.documentVersions).values({
      documentId: doc.id,
      versionNumber: i + 1,
      storageObjectId: object.id,
      sizeBytes: size,
    });
  }

  return { accountId: account.value.id, applicantId: applicant.value.id };
}

describe('upload quotas — configuration', () => {
  it('uses the pilot defaults (10/50/100/500/700 MB) with no env overrides', () => {
    const config = loadUploadQuotaConfig({});
    expect(config.maxUploadBytes).toBe(10 * 1024 * 1024);
    expect(config.maxApplicantEvidenceBytes).toBe(50 * 1024 * 1024);
    expect(config.maxAccountEvidenceBytes).toBe(100 * 1024 * 1024);
    expect(config.platformWarningBytes).toBe(500 * 1024 * 1024);
    expect(config.platformHardStopBytes).toBe(700 * 1024 * 1024);
  });

  it('lets an administrator lower a limit via env override, never silently raising it above what is set', () => {
    const config = loadUploadQuotaConfig({ QUOTA_MAX_UPLOAD_MB: '2' });
    expect(config.maxUploadBytes).toBe(2 * 1024 * 1024);
  });

  it('ignores an invalid override and keeps the safe default', () => {
    const config = loadUploadQuotaConfig({ QUOTA_MAX_UPLOAD_MB: 'not-a-number' });
    expect(config.maxUploadBytes).toBe(10 * 1024 * 1024);
  });
});

describe('upload quotas — usage rollups', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('sums evidence bytes per applicant, per account, and platform-wide', async () => {
    const oneMb = 1024 * 1024;
    const a = await seedApplicantWithEvidence(db, 'rollup-a@example.com', [oneMb, 2 * oneMb]);
    const b = await seedApplicantWithEvidence(db, 'rollup-b@example.com', [3 * oneMb]);

    expect(await getApplicantEvidenceBytes(db, a.applicantId)).toBe(3 * oneMb);
    expect(await getApplicantEvidenceBytes(db, b.applicantId)).toBe(3 * oneMb);
    expect(await getAccountEvidenceBytes(db, a.accountId)).toBe(3 * oneMb);
    expect(await getPlatformEvidenceBytes(db)).toBe(6 * oneMb);
  });

  it('returns 0 for an applicant with no evidence yet', async () => {
    const { applicantId } = await seedApplicantWithEvidence(db, 'empty@example.com', []);
    expect(await getApplicantEvidenceBytes(db, applicantId)).toBe(0);
  });
});

describe('upload quotas — fail-closed enforcement (never silently exceeded)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  const tightConfig = {
    maxUploadBytes: 5 * 1024 * 1024,
    maxApplicantEvidenceBytes: 10 * 1024 * 1024,
    maxAccountEvidenceBytes: 20 * 1024 * 1024,
    platformWarningBytes: 40 * 1024 * 1024,
    platformHardStopBytes: 50 * 1024 * 1024,
  };

  it('allows an upload comfortably within every limit', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(db, 'ok@example.com', []);
    const decision = await checkUploadQuota(
      db,
      { applicantId, accountId, uploadSizeBytes: 1024 * 1024 },
      tightConfig,
    );
    expect(decision.allowed).toBe(true);
  });

  it('refuses a single file larger than the per-file limit', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(
      db,
      'big-file@example.com',
      [],
    );
    const decision = await checkUploadQuota(
      db,
      { applicantId, accountId, uploadSizeBytes: 6 * 1024 * 1024 },
      tightConfig,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain('upload limit');
  });

  it('refuses when the applicant total would be exceeded, even if the file itself is within the per-file limit', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(
      db,
      'applicant-cap@example.com',
      [9 * 1024 * 1024],
    );
    const decision = await checkUploadQuota(
      db,
      { applicantId, accountId, uploadSizeBytes: 2 * 1024 * 1024 },
      tightConfig,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain('applicant');
  });

  it('refuses when the account total would be exceeded across multiple applicants, even for a third applicant with no evidence of its own', async () => {
    const first = await seedApplicantWithEvidence(db, 'acct-cap-1@example.com', [8 * 1024 * 1024]);
    // Second applicant owned by the SAME account (reuse accountId via a second createApplicant call).
    const secondApplicant = (
      await db
        .insert(schema.applicants)
        .values({ ownerAccountId: first.accountId, displayName: 'Second' })
        .returning()
    )[0];
    if (!secondApplicant) throw new Error('applicant insert failed');
    const doc = (
      await db
        .insert(schema.documents)
        .values({ applicantId: secondApplicant.id, originalName: 'more.pdf' })
        .returning()
    )[0];
    if (!doc) throw new Error('document insert failed');
    const object = (
      await db
        .insert(schema.storageObjects)
        .values({ bucket: 'CLEAN', objectKey: 'obj-second', sizeBytes: 8 * 1024 * 1024 })
        .returning()
    )[0];
    if (!object) throw new Error('storage object insert failed');
    await db.insert(schema.documentVersions).values({
      documentId: doc.id,
      versionNumber: 1,
      storageObjectId: object.id,
      sizeBytes: 8 * 1024 * 1024,
    });

    // A THIRD applicant, same account, with no evidence of its own — isolates the
    // account-level check from the per-applicant check (which would otherwise
    // trip first if the upload targeted an applicant that already holds bytes).
    const thirdApplicant = (
      await db
        .insert(schema.applicants)
        .values({ ownerAccountId: first.accountId, displayName: 'Third' })
        .returning()
    )[0];
    if (!thirdApplicant) throw new Error('applicant insert failed');

    // Account now has 16 MB across the first two applicants; a further 5 MB for
    // the (empty) third applicant is well within its own 10 MB cap but would
    // push the account to 21 MB, exceeding the 20 MB account cap.
    const decision = await checkUploadQuota(
      db,
      {
        applicantId: thirdApplicant.id,
        accountId: first.accountId,
        uploadSizeBytes: 5 * 1024 * 1024,
      },
      tightConfig,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain('account');
  });

  it('refuses when the platform-wide hard stop would be exceeded, even for a fresh applicant/account', async () => {
    // Fill platform usage close to the hard stop via a different applicant.
    await seedApplicantWithEvidence(db, 'platform-fill@example.com', [48 * 1024 * 1024]);
    const { accountId, applicantId } = await seedApplicantWithEvidence(db, 'fresh@example.com', []);
    const decision = await checkUploadQuota(
      db,
      { applicantId, accountId, uploadSizeBytes: 4 * 1024 * 1024 },
      tightConfig,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain('platform');
  });
});
