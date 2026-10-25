import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Result, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { EACH_GRANT, accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { executeAccountDeletion, requestAccountDeletion } from './deletion';
import { runErasureWorker } from './erasure';
import type { ServiceError } from './errors';
import type { MalwareScannerPort } from './intake';
import { createOrganization, reviewOrganization } from './organizations';
import {
  PROFILE_PHOTO_KEY_PREFIX,
  PROFILE_PHOTO_MAX_INPUT_BYTES,
  type PhotoReencoderPort,
  getApplicantPhotoVersion,
  listApplicantPhotoVersions,
  readApplicantPhoto,
  removeApplicantPhoto,
  setApplicantPhoto,
} from './profile-photos';
import { RATE_LIMITS } from './rate-limit';
import { exhaustRateLimit } from './rate-limit.test-support';
import { acceptGrant, createGrant } from './sharing';
import type {
  BlobStore,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from './storage';

class FakeBlobStore implements BlobStore {
  readonly objects = new Map<string, StoredBytes & { readonly bucket: StorageBucket }>();
  async putObject(input: PutObjectInput): Promise<void> {
    if (this.objects.has(input.objectKey)) throw new Error('key reused');
    this.objects.set(input.objectKey, {
      bucket: input.bucket,
      contentType: input.contentType,
      bytes: input.bytes,
    });
  }
  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    return this.objects.get(objectKey);
  }
  async deleteObject(_bucket: StorageBucket, objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
  async listObjectKeys(): Promise<ListObjectsPage> {
    return { objectKeys: [...this.objects.keys()], cursor: undefined };
  }
}

const UNSAFE_MARKER = 0x66;

/** Flags any upload whose fifth byte is the marker, the way a real scanner flags a known-bad file. */
function fakeScanner(storage: BlobStore): MalwareScannerPort & { scanned: string[] } {
  const scanned: string[] = [];
  return {
    name: 'fake-scanner',
    version: '1',
    scanned,
    async scan(input) {
      scanned.push(input.objectKey);
      const object = await storage.getObject(input.objectKey);
      return { safe: object !== undefined && object.bytes[4] !== UNSAFE_MARKER };
    },
  };
}

/** A stand-in for the real re-encoder (packages/adapters has the sharp one and its metadata test). */
function fakeReencoder(): PhotoReencoderPort & { calls: number } {
  const encoder = {
    name: 'fake-reencoder',
    version: '1',
    calls: 0,
    async reencode(input: { readonly bytes: Uint8Array; readonly size: number }) {
      encoder.calls += 1;
      if (input.bytes[5] === 0x00) throw new Error('not an image');
      const digest = createHash('sha256').update(input.bytes).digest();
      return {
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, ...digest, 0xff, 0xd9]),
        width: input.size,
        height: input.size,
      };
    },
  };
  return encoder;
}

function jpegUpload(seed: string = randomUUID()): { contentType: string; bytes: Uint8Array } {
  return {
    contentType: 'image/jpeg',
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, ...Buffer.from(seed)]),
  };
}

function code<T>(result: Result<T, ServiceError>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const result = await provisionAccount(db, { email });
  if (!isOk(result)) throw new Error(`provision ${email}`);
  return result.value.id;
}

describe('profile photos', () => {
  let db: Db;
  let storage: FakeBlobStore;
  let scanner: ReturnType<typeof fakeScanner>;
  let reencoder: ReturnType<typeof fakeReencoder>;
  let ownerId: string;
  let applicantId: string;

  const ports = () => ({ storage, scanner, reencoder });
  const manage = async (accountId = ownerId) => {
    const proof = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { applicantId },
      { purpose: EACH_GRANT },
    );
    if (!proof.ok) throw new Error(`manage proof: ${proof.error.code}`);
    return proof.value;
  };
  const view = async (accountId = ownerId) => {
    const proof = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: EACH_GRANT },
    );
    if (!proof.ok) throw new Error(`view proof: ${proof.error.code}`);
    return proof.value;
  };
  const photoRow = async () =>
    (
      await db
        .select()
        .from(schema.applicantPhotos)
        .where(eq(schema.applicantPhotos.applicantId, applicantId))
    )[0];
  const auditTypes = async () =>
    (
      await db
        .select({ eventType: schema.auditEvents.eventType, metadata: schema.auditEvents.metadata })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.applicantId, applicantId))
        .orderBy(schema.auditEvents.seq)
    ).filter((row) => row.eventType.startsWith('PROFILE_PHOTO_'));
  const storedKeys = () => [...storage.objects.keys()];

  beforeEach(async () => {
    db = await freshDb();
    storage = new FakeBlobStore();
    scanner = fakeScanner(storage);
    reencoder = fakeReencoder();
    ownerId = await account(db, 'owner@example.com');
    for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
      await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
    }
    const applicant = await createApplicant(db, {
      actorAccountId: ownerId,
      ownerAccountId: ownerId,
      displayName: 'Rahima Akter',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    applicantId = applicant.value.id;
  });

  it('lets the owner add a photo: scanned, re-encoded, stored privately in the clean bucket and audited without image data', async () => {
    const upload = jpegUpload();
    const result = await setApplicantPhoto(await manage(), ports(), upload);
    expect(isOk(result)).toBe(true);
    if (!result.ok) return;

    const row = await photoRow();
    expect(row).toBeDefined();
    expect(result.value.version).toBe(row?.contentSha256.slice(0, 16));
    // Only the re-encoded copy is left; the uploaded original was scanned and then deleted.
    expect(storedKeys()).toHaveLength(1);
    const [key] = storedKeys();
    expect(key?.startsWith(PROFILE_PHOTO_KEY_PREFIX)).toBe(true);
    expect(key?.startsWith('profile-photo-upload-')).toBe(false);
    expect(storage.objects.get(key ?? '')?.bucket).toBe('CLEAN');
    expect(storage.objects.get(key ?? '')?.contentType).toBe('image/jpeg');
    expect(scanner.scanned).toHaveLength(1);
    expect(scanner.scanned[0]?.startsWith('profile-photo-upload-')).toBe(true);
    const registered = await db.select().from(schema.storageObjects);
    expect(registered.map((o) => o.objectKey)).toEqual([key]);

    const events = await auditTypes();
    expect(events.map((e) => e.eventType)).toEqual(['PROFILE_PHOTO_SET']);
    const serialized = JSON.stringify(events[0]?.metadata);
    expect(serialized).not.toContain(key ?? 'none');
    expect(serialized).not.toContain(row?.contentSha256 ?? 'none');
    expect(events[0]?.metadata).toEqual({
      replaced: false,
      sizeBytes: 38,
      width: 512,
      height: 512,
    });

    const read = await readApplicantPhoto(await view(), storage);
    expect(read.ok && read.value.contentType).toBe('image/jpeg');
    expect(read.ok && read.value.bytes).toEqual(storage.objects.get(key ?? '')?.bytes);
    const version = await getApplicantPhotoVersion(await view());
    expect(version.ok && version.value).toBe(result.value.version);
  });

  it('replacing a photo removes the old bytes at once and queues a verified erasure for them', async () => {
    const first = await setApplicantPhoto(await manage(), ports(), jpegUpload('first'));
    if (!first.ok) throw new Error('first');
    const [oldKey] = storedKeys();
    const second = await setApplicantPhoto(await manage(), ports(), jpegUpload('second'));
    if (!second.ok) throw new Error('second');
    expect(second.value.version).not.toBe(first.value.version);
    expect(storedKeys()).toHaveLength(1);
    expect(storedKeys()).not.toContain(oldKey);

    const jobs = await db.select().from(schema.erasureJobs);
    expect(jobs.map((j) => [j.reason, j.objectKey, j.status])).toEqual([
      ['PROFILE_PHOTO_REMOVAL', oldKey, 'PENDING'],
    ]);
    const worker = await runErasureWorker(db, storage, { limit: 5 });
    expect(worker.processed).toBe(1);
    const remaining = await db.select().from(schema.storageObjects);
    expect(remaining).toHaveLength(1);
    expect((await photoRow())?.storageObjectId).toBe(remaining[0]?.id);
    expect((await auditTypes()).map((e) => e.metadata)).toEqual([
      expect.objectContaining({ replaced: false }),
      expect.objectContaining({ replaced: true }),
    ]);
  });

  it('removing a photo deletes the stored object, queues its verified erasure, and is a quiet no-op the second time', async () => {
    await setApplicantPhoto(await manage(), ports(), jpegUpload());
    const removed = await removeApplicantPhoto(await manage(), storage);
    expect(removed.ok && removed.value.removed).toBe(true);
    expect(await photoRow()).toBeUndefined();
    expect(storedKeys()).toEqual([]);
    expect(code(await readApplicantPhoto(await view(), storage))).toBe('not_found');
    const version = await getApplicantPhotoVersion(await view());
    expect(version.ok && version.value).toBeNull();

    await runErasureWorker(db, storage, { limit: 5 });
    expect(await db.select().from(schema.storageObjects)).toEqual([]);
    const jobs = await db.select().from(schema.erasureJobs);
    expect(jobs.map((j) => [j.reason, j.status])).toEqual([['PROFILE_PHOTO_REMOVAL', 'VERIFIED']]);

    const again = await removeApplicantPhoto(await manage(), storage);
    expect(again.ok && again.value.removed).toBe(false);
    expect((await auditTypes()).map((e) => e.eventType)).toEqual([
      'PROFILE_PHOTO_SET',
      'PROFILE_PHOTO_REMOVED',
    ]);
  });

  it('refuses other accounts at the gate, and refuses a copied proof', async () => {
    const strangerId = await account(db, 'stranger@example.com');
    for (const action of ['MANAGE', 'VIEW_METADATA'] as const) {
      const proof = await requireAccess(
        db,
        accountPrincipal(strangerId),
        action,
        { applicantId },
        { purpose: EACH_GRANT },
      );
      expect(code(proof)).toBe('forbidden');
    }
    const copy = { ...(await manage()) } as never;
    expect(code(await setApplicantPhoto(copy, ports(), jpegUpload()))).toBe('forbidden');
    expect(code(await removeApplicantPhoto(copy, storage))).toBe('forbidden');
    expect(code(await readApplicantPhoto(copy, storage))).toBe('forbidden');
    expect(storedKeys()).toEqual([]);
  });

  it('never lets someone the record is shared with see or change the photo, even with a grant covering the whole record', async () => {
    await setApplicantPhoto(await manage(), ports(), jpegUpload());
    const agentId = await account(db, 'agent@acme.example.com');
    const org = await createOrganization(db, { actorAccountId: agentId, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const reviewer = await account(db, 'reviewer@platform.example.com');
    await reviewOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: ownerId,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['VIEW_METADATA', 'MANAGE'],
      purpose: 'visa-review',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    const accepted = await acceptGrant(db, { actorAccountId: agentId, grantId: grant.value.id });
    if (!isOk(accepted)) throw new Error('accept');

    // The gate itself lets the agency see the record's details...
    const viewProof = await view(agentId);
    expect(viewProof.actor.kind).toBe('organization_member');
    // ...but a photo is the owner's alone.
    expect(code(await readApplicantPhoto(viewProof, storage))).toBe('forbidden');
    expect(code(await getApplicantPhotoVersion(viewProof))).toBe('forbidden');
    const manageProof = await manage(agentId);
    expect(code(await setApplicantPhoto(manageProof, ports(), jpegUpload()))).toBe('forbidden');
    expect(code(await removeApplicantPhoto(manageProof, storage))).toBe('forbidden');
    expect(await photoRow()).toBeDefined();
  });

  it('refuses oversize, wrong-type and mislabelled files before storing or decoding anything', async () => {
    const proof = await manage();
    const big = new Uint8Array(PROFILE_PHOTO_MAX_INPUT_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    const cases = [
      { contentType: 'image/jpeg', bytes: big },
      { contentType: 'image/jpeg', bytes: new Uint8Array() },
      { contentType: 'image/gif', bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]) },
      { contentType: 'image/webp', bytes: jpegUpload().bytes },
      { contentType: 'image/svg+xml', bytes: new TextEncoder().encode('<svg/>') },
      { contentType: 'image/png', bytes: jpegUpload().bytes },
      { contentType: 'image/jpeg', bytes: new TextEncoder().encode('MZ not a photo') },
    ];
    for (const input of cases) {
      expect(code(await setApplicantPhoto(proof, ports(), input))).toBe('invalid');
    }
    expect(scanner.scanned).toEqual([]);
    expect(reencoder.calls).toBe(0);
    expect(storedKeys()).toEqual([]);
    expect(await db.select().from(schema.storageObjects)).toEqual([]);
    expect(await auditTypes()).toEqual([]);
  });

  it('refuses a photo that fails the safety scan or cannot be decoded, and cleans up the upload', async () => {
    const unsafe = jpegUpload();
    unsafe.bytes[4] = UNSAFE_MARKER;
    expect(code(await setApplicantPhoto(await manage(), ports(), unsafe))).toBe('invalid');
    expect(reencoder.calls).toBe(0);
    const broken = jpegUpload();
    broken.bytes[5] = 0x00;
    expect(code(await setApplicantPhoto(await manage(), ports(), broken))).toBe('invalid');
    expect(reencoder.calls).toBe(1);
    expect(storedKeys()).toEqual([]);
    expect(await db.select().from(schema.storageObjects)).toEqual([]);
    expect(await photoRow()).toBeUndefined();
  });

  it('refuses output from the re-encoder that is not a square JPEG of the expected size', async () => {
    const wrong: PhotoReencoderPort = {
      name: 'wrong',
      version: '1',
      async reencode() {
        return { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), width: 512, height: 512 };
      },
    };
    const result = await setApplicantPhoto(
      await manage(),
      { storage, scanner, reencoder: wrong },
      jpegUpload(),
    );
    expect(code(result)).toBe('invalid');
    expect(storedKeys()).toEqual([]);
  });

  it('does not serve bytes that no longer match what was saved', async () => {
    await setApplicantPhoto(await manage(), ports(), jpegUpload());
    const [key] = storedKeys();
    const object = storage.objects.get(key ?? '');
    if (!object) throw new Error('object');
    storage.objects.set(key ?? '', { ...object, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]) });
    expect(code(await readApplicantPhoto(await view(), storage))).toBe('not_found');
  });

  it('limits how often a photo can be changed', async () => {
    await exhaustRateLimit(db, ownerId, 'profile_photo.change', RATE_LIMITS.PROFILE_PHOTO_CHANGE);
    expect(code(await setApplicantPhoto(await manage(), ports(), jpegUpload()))).toBe(
      'rate_limited',
    );
    expect(scanner.scanned).toEqual([]);
  });

  it('erases the photo with the account: rows go at once and the bytes through verified erasure', async () => {
    await setApplicantPhoto(await manage(), ports(), jpegUpload());
    const now = new Date();
    const requested = await requestAccountDeletion(db, {
      actorAccountId: ownerId,
      accountId: ownerId,
      gracePeriodMs: 0,
      now,
    });
    if (!isOk(requested)) throw new Error(`request: ${requested.error.message}`);
    const executed = await executeAccountDeletion(db, { accountId: ownerId, now });
    if (!isOk(executed)) throw new Error(`execute: ${executed.error.message}`);
    expect(await db.select().from(schema.applicantPhotos)).toEqual([]);
    const jobs = await db.select().from(schema.erasureJobs);
    expect(jobs.map((j) => j.reason)).toEqual(['ACCOUNT_DELETION']);
    await runErasureWorker(db, storage, { limit: 5 });
    expect(storedKeys()).toEqual([]);
    expect(await db.select().from(schema.storageObjects)).toEqual([]);
  });

  it('keeps the photo table private to this module, account deletion and the owner export: no share or pack reads it', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const readers = readdirSync(here, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => path.join(entry.parentPath, entry.name))
      .filter((file) => !/\.test(-d)?\.ts$|\.test-support\.ts$/.test(file))
      .filter((file) => /\bschema\.applicantPhotos\b/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(here, file))
      .sort();
    expect(readers).toEqual(['account-export.ts', 'deletion.ts', 'profile-photos.ts']);
  });

  it("reads the photo versions of several owned records in one call, and refuses one proof that is not the owner's", async () => {
    const second = await createApplicant(db, {
      actorAccountId: ownerId,
      ownerAccountId: ownerId,
      displayName: 'Second Traveller',
      relationship: 'FAMILY_MEMBER',
      authorityConfirmed: true,
    });
    if (!isOk(second)) throw new Error('second');
    const saved = await setApplicantPhoto(await manage(), ports(), jpegUpload());
    if (!saved.ok) throw new Error('save');
    const secondProof = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'VIEW_METADATA',
      { applicantId: second.value.id },
      { purpose: EACH_GRANT },
    );
    if (!secondProof.ok) throw new Error('proof');
    const versions = await listApplicantPhotoVersions(await view(), secondProof.value);
    expect(versions.ok && [...versions.value]).toEqual([[applicantId, saved.value.version]]);
    const copy = { ...secondProof.value } as never;
    expect(code(await listApplicantPhotoVersions(await view(), copy))).toBe('forbidden');
  });

  it('also limits how often a photo can be removed', async () => {
    await setApplicantPhoto(await manage(), ports(), jpegUpload());
    await exhaustRateLimit(db, ownerId, 'profile_photo.change', RATE_LIMITS.PROFILE_PHOTO_CHANGE);
    expect(code(await removeApplicantPhoto(await manage(), storage))).toBe('rate_limited');
    expect(await photoRow()).toBeDefined();
  });

  describe('before migration 0088 has run (no photo table yet)', () => {
    beforeEach(async () => {
      await db.execute(sql`drop table applicant_photos`);
    });

    it('answers "no photo" everywhere instead of failing', async () => {
      const version = await getApplicantPhotoVersion(await view());
      expect(version.ok && version.value).toBeNull();
      const versions = await listApplicantPhotoVersions(await view());
      expect(versions.ok && versions.value.size).toBe(0);
      expect(code(await readApplicantPhoto(await view(), storage))).toBe('not_found');
      const removed = await removeApplicantPhoto(await manage(), storage);
      expect(removed.ok && removed.value.removed).toBe(false);
    });

    it('refuses a new photo plainly before storing anything', async () => {
      const result = await setApplicantPhoto(await manage(), ports(), jpegUpload());
      expect(code(result)).toBe('upstream_error');
      expect(scanner.scanned).toEqual([]);
      expect(storedKeys()).toEqual([]);
    });

    it('still deletes the account, with the rest of its transaction intact', async () => {
      const now = new Date();
      const requested = await requestAccountDeletion(db, {
        actorAccountId: ownerId,
        accountId: ownerId,
        gracePeriodMs: 0,
        now,
      });
      if (!isOk(requested)) throw new Error(`request: ${requested.error.message}`);
      const executed = await executeAccountDeletion(db, { accountId: ownerId, now });
      expect(isOk(executed)).toBe(true);
      expect(await db.select().from(schema.applicants)).toEqual([]);
      expect(
        await db.select().from(schema.accounts).where(eq(schema.accounts.id, ownerId)),
      ).toEqual([]);
      const events = await db
        .select({ eventType: schema.auditEvents.eventType })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'ACCOUNT_DELETION_EXECUTED'));
      expect(events).toHaveLength(1);
    });
  });
});
