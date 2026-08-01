import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { failUpload, finalizeUpload, reserveUpload } from './uploads';

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

const MB = 1024 * 1024;
// maxUploadBytes deliberately matches maxApplicantEvidenceBytes (not a
// separate, smaller value) so an 8 MB reservation used to set up an
// applicant/account/platform-level scenario is never itself blocked by the
// per-file cap first; the one test that specifically exercises the per-file
// cap overrides it to something smaller.
const tightConfig = {
  maxUploadBytes: 10 * MB,
  maxApplicantEvidenceBytes: 10 * MB,
  maxAccountEvidenceBytes: 20 * MB,
  platformWarningBytes: 40 * MB,
  platformHardStopBytes: 50 * MB,
};

describe('reserveUpload — atomic quota reservation (master directive §7 "PR 6")', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('reserves an upload comfortably within every limit', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(db, 'ok@example.com', []);
    const result = await reserveUpload(db, { accountId, applicantId, sizeBytes: MB }, tightConfig);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('RESERVED');
      expect(result.value.reservedBytes).toBe(MB);
      expect(result.value.objectKey.length).toBeGreaterThan(0);
    }
  });

  it('refuses a single file larger than the per-file limit, without touching the database', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(db, 'big@example.com', []);
    const result = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: 6 * MB },
      { ...tightConfig, maxUploadBytes: 5 * MB },
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toContain('upload limit');
  });

  it('refuses when committed evidence plus this upload would exceed the applicant limit', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(
      db,
      'applicant-cap@example.com',
      [9 * MB],
    );
    const result = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: 2 * MB },
      tightConfig,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toContain('applicant');
  });

  it("a still-active reservation from another in-flight upload counts toward the applicant limit, even though it hasn't committed any bytes yet — the exact TOCTOU gap the old read-only check left open", async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(
      db,
      'inflight@example.com',
      [],
    );
    const first = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: 8 * MB },
      tightConfig,
    );
    expect(isOk(first)).toBe(true);

    // The first upload is still "in flight" — no document version exists for
    // it yet, so a plain committed-bytes-only check would see 0 bytes used
    // and wrongly allow this second reservation. 8 + 5 = 13 MB > 10 MB cap.
    const second = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: 5 * MB },
      tightConfig,
    );
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.message).toContain('applicant');
  });

  it('an expired reservation no longer counts toward any limit — an abandoned upload cannot hold quota hostage', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(
      db,
      'expired@example.com',
      [],
    );
    const first = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: 8 * MB },
      tightConfig,
    );
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    await db
      .update(schema.uploadIntents)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.uploadIntents.id, first.value.id));

    // Would have been refused (8 + 5 > 10) had the first still counted.
    const second = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: 5 * MB },
      tightConfig,
    );
    expect(isOk(second)).toBe(true);
  });

  it('refuses when the account total (across multiple applicants) would be exceeded, even for a third applicant with no evidence of its own', async () => {
    const first = await seedApplicantWithEvidence(db, 'acct-cap-1@example.com', [8 * MB]);
    const secondApplicant = await createApplicant(db, {
      actorAccountId: first.accountId,
      ownerAccountId: first.accountId,
      displayName: 'Second',
    });
    if (!isOk(secondApplicant)) throw new Error('applicant failed');
    const secondReserve = await reserveUpload(
      db,
      { accountId: first.accountId, applicantId: secondApplicant.value.id, sizeBytes: 8 * MB },
      tightConfig,
    );
    expect(isOk(secondReserve)).toBe(true);

    const thirdApplicant = await createApplicant(db, {
      actorAccountId: first.accountId,
      ownerAccountId: first.accountId,
      displayName: 'Third',
    });
    if (!isOk(thirdApplicant)) throw new Error('applicant failed');

    // Account now holds 8 MB committed + 8 MB reserved = 16 MB; a further
    // 5 MB for the (empty) third applicant is within ITS OWN 10 MB cap but
    // would push the account to 21 MB, exceeding the 20 MB account cap.
    const result = await reserveUpload(
      db,
      { accountId: first.accountId, applicantId: thirdApplicant.value.id, sizeBytes: 5 * MB },
      tightConfig,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toContain('account');
  });

  it('refuses when the platform-wide hard stop would be exceeded, even for a fresh applicant/account', async () => {
    await seedApplicantWithEvidence(db, 'platform-fill@example.com', [48 * MB]);
    const { accountId, applicantId } = await seedApplicantWithEvidence(db, 'fresh@example.com', []);
    const result = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: 4 * MB },
      tightConfig,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toContain('platform');
  });
});

describe('finalizeUpload / failUpload — reservation lifecycle', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('finalizeUpload marks the intent COMPLETED and links the resulting document version', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(db, 'final@example.com', []);
    const reserved = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: MB },
      tightConfig,
    );
    if (!isOk(reserved)) throw new Error('reserve failed');

    const registered = await registerDocument(db, {
      actorAccountId: accountId,
      applicantId,
      originalName: 'passport.pdf',
    });
    if (!isOk(registered)) throw new Error('register failed');
    const versioned = await addDocumentVersion(db, {
      actorAccountId: accountId,
      documentId: registered.value.id,
      bucket: 'QUARANTINE',
      objectKey: reserved.value.objectKey,
      sizeBytes: MB,
    });
    if (!isOk(versioned)) throw new Error('version failed');

    await finalizeUpload(db, reserved.value.id, versioned.value.version.id);

    const [row] = await db
      .select()
      .from(schema.uploadIntents)
      .where(eq(schema.uploadIntents.id, reserved.value.id));
    expect(row?.status).toBe('COMPLETED');
    expect(row?.documentVersionId).toBe(versioned.value.version.id);
  });

  it('failUpload releases the reservation immediately, letting a fresh upload that would otherwise be denied now succeed', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(db, 'fail@example.com', []);
    const reserved = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: 8 * MB },
      tightConfig,
    );
    if (!isOk(reserved)) throw new Error('reserve failed');

    const blockedWhileReserved = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: 5 * MB },
      tightConfig,
    );
    expect(isErr(blockedWhileReserved)).toBe(true);

    await failUpload(db, reserved.value.id, 'storage.putObject threw: network error');

    const [row] = await db
      .select()
      .from(schema.uploadIntents)
      .where(eq(schema.uploadIntents.id, reserved.value.id));
    expect(row?.status).toBe('FAILED');
    expect(row?.failureReason).toContain('network error');

    const afterFailure = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: 5 * MB },
      tightConfig,
    );
    expect(isOk(afterFailure)).toBe(true);
  });
});
