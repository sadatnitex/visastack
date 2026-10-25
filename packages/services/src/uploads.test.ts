import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { RATE_LIMITS } from './rate-limit';
import { exhaustRateLimit } from './rate-limit.test-support';
import type { BlobStore } from './storage';
import { failUpload, finalizeUpload, reserveUpload, sweepAbandonedUploads } from './uploads';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
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
  maxPdfPages: 50,
  maxImageMegapixels: 40,
};

describe('reserveUpload - rate limiting (Part 9 SEC-02)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('refuses with rate_limited once the account has hit its upload limit, and reserves nothing', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(
      db,
      'limited@example.com',
      [],
    );
    await exhaustRateLimit(db, accountId, 'upload.reserve', RATE_LIMITS.UPLOAD_RESERVE);

    const result = await reserveUpload(db, { accountId, applicantId, sizeBytes: MB }, tightConfig);

    expect(isErr(result)).toBe(true);
    if (isOk(result)) return;
    expect(result.error.code).toBe('rate_limited');
    expect(await db.select().from(schema.uploadIntents)).toHaveLength(0);
  });

  it('an oversized file is rejected on size first and does not spend the allowance', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(db, 'big@example.com', []);

    const result = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: 6 * MB },
      { ...tightConfig, maxUploadBytes: 5 * MB },
    );

    expect(isErr(result) && result.error.code).not.toBe('rate_limited');
    expect(
      await db
        .select()
        .from(schema.rateLimitBuckets)
        .where(eq(schema.rateLimitBuckets.subjectId, accountId)),
    ).toHaveLength(0);
  });

  it('counts each reservation attempt against the account (not just finished uploads)', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(
      db,
      'counted@example.com',
      [],
    );

    await reserveUpload(db, { accountId, applicantId, sizeBytes: MB }, tightConfig);
    await reserveUpload(db, { accountId, applicantId, sizeBytes: MB }, tightConfig);

    const [bucket] = await db
      .select()
      .from(schema.rateLimitBuckets)
      .where(eq(schema.rateLimitBuckets.subjectId, accountId));
    expect(bucket?.action).toBe('upload.reserve');
    expect(bucket?.count).toBe(2);
  });

  it("another account's uploads are unaffected by this account being limited", async () => {
    const limited = await seedApplicantWithEvidence(db, 'limited@example.com', []);
    const other = await seedApplicantWithEvidence(db, 'other@example.com', []);
    await exhaustRateLimit(db, limited.accountId, 'upload.reserve', RATE_LIMITS.UPLOAD_RESERVE);

    const refused = await reserveUpload(db, { ...limited, sizeBytes: MB }, tightConfig);
    expect(isErr(refused) && refused.error.code).toBe('rate_limited');
    const allowed = await reserveUpload(db, { ...other, sizeBytes: MB }, tightConfig);

    expect(isOk(allowed)).toBe(true);
  });

  it('explains the refusal in plain language, never naming the internal action', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(db, 'msg@example.com', []);
    await exhaustRateLimit(db, accountId, 'upload.reserve', RATE_LIMITS.UPLOAD_RESERVE);

    const result = await reserveUpload(db, { accountId, applicantId, sizeBytes: MB }, tightConfig);

    if (isOk(result)) throw new Error('expected a refusal');
    expect(result.error.message).toContain('upload');
    expect(result.error.message).not.toContain('upload.reserve');
  });
});

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

  it('under real concurrency, two simultaneous uploads racing for the same remaining quota never both succeed (Part 3 §11: proven, not sequentially simulated)', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(db, 'race@example.com', []);
    // 6 + 6 = 12 MB > the 10 MB applicant cap: at most one of these two
    // genuinely concurrent reservations may succeed. A broken advisory lock
    // would let both pass their own pre-lock read before either commits.
    const [a, b] = await Promise.all([
      reserveUpload(db, { accountId, applicantId, sizeBytes: 6 * MB }, tightConfig),
      reserveUpload(db, { accountId, applicantId, sizeBytes: 6 * MB }, tightConfig),
    ]);
    const results = [a, b];
    expect(results.filter(isOk)).toHaveLength(1);
    expect(results.filter(isErr)).toHaveLength(1);

    const reservedTotal = await db
      .select()
      .from(schema.uploadIntents)
      .where(eq(schema.uploadIntents.applicantId, applicantId));
    const activeReservations = reservedTotal.filter((r) => r.status === 'RESERVED');
    expect(activeReservations).toHaveLength(1);
    expect(activeReservations[0]?.reservedBytes).toBe(6 * MB);
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

/** An in-memory BlobStore fixture whose deleteObject calls are recorded, so a test can assert exactly which object keys a sweep actually cleaned up. */
function fakeBlobStore(objectsPresent: ReadonlySet<string>): BlobStore & { deletedKeys: string[] } {
  const deletedKeys: string[] = [];
  return {
    deletedKeys,
    async getObject(objectKey: string) {
      return objectsPresent.has(objectKey)
        ? { contentType: 'application/pdf', bytes: new Uint8Array([1]) }
        : undefined;
    },
    async putObject() {
      throw new Error('not used in this test');
    },
    async deleteObject(_bucket, objectKey: string) {
      deletedKeys.push(objectKey);
    },
    async listObjectKeys() {
      throw new Error('not used in this test');
    },
  };
}

describe('sweepAbandonedUploads - 24h cleanup of abandoned reservations (directive Part 3 §3)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('cleans up a RESERVED intent whose reservation expired more than 24 hours ago: deletes its bytes and marks it FAILED', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(
      db,
      'abandoned@example.com',
      [],
    );
    const reserved = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: MB },
      tightConfig,
    );
    if (!isOk(reserved)) throw new Error('reserve failed');
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000); // expired 25h ago
    await db
      .update(schema.uploadIntents)
      .set({ expiresAt: longAgo })
      .where(eq(schema.uploadIntents.id, reserved.value.id));

    const blobStore = fakeBlobStore(new Set([reserved.value.objectKey]));
    const result = await sweepAbandonedUploads(db, blobStore);
    expect(result).toEqual({ checked: 1, cleaned: 1 });
    expect(blobStore.deletedKeys).toEqual([reserved.value.objectKey]);

    const [row] = await db
      .select()
      .from(schema.uploadIntents)
      .where(eq(schema.uploadIntents.id, reserved.value.id));
    expect(row?.status).toBe('FAILED');
    expect(row?.failureReason).toContain('abandoned');
  });

  it('best-effort cleans up an abandoned intent even when no bytes were ever written for it (the crash happened before the blob write)', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(
      db,
      'never-wrote@example.com',
      [],
    );
    const reserved = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: MB },
      tightConfig,
    );
    if (!isOk(reserved)) throw new Error('reserve failed');
    await db
      .update(schema.uploadIntents)
      .set({ expiresAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(schema.uploadIntents.id, reserved.value.id));

    // No key present in the blob store at all -- deleteObject is still called
    // (best-effort, no-op on the backend side) and the sweep still succeeds.
    const blobStore = fakeBlobStore(new Set());
    const result = await sweepAbandonedUploads(db, blobStore);
    expect(result).toEqual({ checked: 1, cleaned: 1 });

    const [row] = await db
      .select()
      .from(schema.uploadIntents)
      .where(eq(schema.uploadIntents.id, reserved.value.id));
    expect(row?.status).toBe('FAILED');
  });

  it('never touches a reservation that has not yet passed the 24h grace period, even if its 10-minute quota TTL already expired', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(
      db,
      'recent@example.com',
      [],
    );
    const reserved = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: MB },
      tightConfig,
    );
    if (!isOk(reserved)) throw new Error('reserve failed');
    // Expired for quota purposes (in the past), but well within the 24h
    // cleanup grace period -- a genuinely still-in-flight upload must never
    // be swept just because its short quota TTL alone has lapsed.
    await db
      .update(schema.uploadIntents)
      .set({ expiresAt: new Date(Date.now() - 60 * 1000) })
      .where(eq(schema.uploadIntents.id, reserved.value.id));

    const blobStore = fakeBlobStore(new Set([reserved.value.objectKey]));
    const result = await sweepAbandonedUploads(db, blobStore);
    expect(result).toEqual({ checked: 0, cleaned: 0 });
    expect(blobStore.deletedKeys).toEqual([]);

    const [row] = await db
      .select()
      .from(schema.uploadIntents)
      .where(eq(schema.uploadIntents.id, reserved.value.id));
    expect(row?.status).toBe('RESERVED');
  });

  it('never touches an intent that already completed or failed normally, however old', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(
      db,
      'completed@example.com',
      [],
    );
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
    await db
      .update(schema.uploadIntents)
      .set({ expiresAt: new Date(Date.now() - 48 * 60 * 60 * 1000) })
      .where(eq(schema.uploadIntents.id, reserved.value.id));

    const blobStore = fakeBlobStore(new Set([reserved.value.objectKey]));
    const result = await sweepAbandonedUploads(db, blobStore);
    expect(result).toEqual({ checked: 0, cleaned: 0 });

    const [row] = await db
      .select()
      .from(schema.uploadIntents)
      .where(eq(schema.uploadIntents.id, reserved.value.id));
    expect(row?.status).toBe('COMPLETED');
  });

  it('records one summary abandoned_upload_cleaned observability event per sweep that actually cleaned something (directive Part 3 §13), and none when nothing was cleaned', async () => {
    const { accountId, applicantId } = await seedApplicantWithEvidence(
      db,
      'observed@example.com',
      [],
    );
    const reserved = await reserveUpload(
      db,
      { accountId, applicantId, sizeBytes: MB },
      tightConfig,
    );
    if (!isOk(reserved)) throw new Error('reserve failed');
    await db
      .update(schema.uploadIntents)
      .set({ expiresAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(schema.uploadIntents.id, reserved.value.id));

    const events: Array<{ name: string; severity: string; metadata?: Record<string, unknown> }> =
      [];
    const observability = { record: (event: (typeof events)[number]) => events.push(event) };
    const blobStore = fakeBlobStore(new Set([reserved.value.objectKey]));

    await sweepAbandonedUploads(db, blobStore, undefined, observability);
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe('abandoned_upload_cleaned');
    expect(events[0]?.severity).toBe('warning');
    expect(events[0]?.metadata).toEqual({ checked: 1, cleaned: 1 });

    // A second, immediate sweep finds nothing left to clean -- no further event.
    await sweepAbandonedUploads(db, blobStore, undefined, observability);
    expect(events).toHaveLength(1);
  });
});
