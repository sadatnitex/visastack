import { type Result, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type BlobStore,
  type Db,
  EACH_GRANT,
  type ListObjectsPage,
  type PutObjectInput,
  type StoredBytes,
  accountPrincipal,
  createApplicant,
  provisionAccount,
  readApplicantPhoto,
  requireAccess,
  setApplicantPhoto,
  setConsent,
} from '@visastack/services';
import { drizzle } from 'drizzle-orm/pglite';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SharpPhotoReencoder } from './photo-reencoder';
import { BasicSafetyScanner } from './scanner';

const SIZE = 512;
const PIXELS = 40_000_000;
// Distinctive GPS values (23 deg 46 min 12.34 s North, Dhaka) whose bytes are searched for below.
const LATITUDE = [
  [23, 1],
  [46, 1],
  [1234, 100],
] as const;

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}
function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/**
 * A big-endian EXIF block with IFD0 pointing at a GPS IFD holding a latitude
 * and its reference, wrapped as a JPEG APP1 segment. Written by hand so the
 * test does not trust the library under test to have produced it.
 */
function gpsApp1Segment(): Uint8Array {
  const tiff: number[] = [0x4d, 0x4d, ...u16(42), ...u32(8)];
  // IFD0 at 8: one entry, GPSInfo (0x8825, LONG) -> GPS IFD at 26.
  tiff.push(...u16(1), ...u16(0x8825), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
  // GPS IFD at 26: two entries, then the latitude rationals at 26 + 2 + 24 + 4 = 56.
  tiff.push(...u16(2));
  tiff.push(...u16(0x0001), ...u16(2), ...u32(2), 0x4e, 0x00, 0x00, 0x00); // GPSLatitudeRef "N"
  tiff.push(...u16(0x0002), ...u16(5), ...u32(3), ...u32(56)); // GPSLatitude
  tiff.push(...u32(0));
  for (const [numerator, denominator] of LATITUDE)
    tiff.push(...u32(numerator), ...u32(denominator));
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
  return new Uint8Array([0xff, 0xe1, ...u16(payload.length + 2), ...payload]);
}

function withSegmentAfterSoi(jpeg: Uint8Array, segment: Uint8Array): Uint8Array {
  const out = new Uint8Array(jpeg.byteLength + segment.byteLength);
  out.set(jpeg.subarray(0, 2));
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.byteLength);
  return out;
}

function contains(haystack: Uint8Array, needle: readonly number[]): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

const LATITUDE_BYTES = LATITUDE.flatMap(([n, d]) => [...u32(n), ...u32(d)]);
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

async function photoWithGps(width = 900, height = 600): Promise<Uint8Array> {
  const plain = await sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();
  return withSegmentAfterSoi(new Uint8Array(plain), gpsApp1Segment());
}

describe('SharpPhotoReencoder', () => {
  const reencoder = new SharpPhotoReencoder();

  it('strips EXIF location data while producing a square JPEG', async () => {
    const input = await photoWithGps();
    // The fixture really carries the location the re-encode must remove.
    expect(contains(input, LATITUDE_BYTES)).toBe(true);
    const inputMeta = await sharp(input).metadata();
    expect(inputMeta.exif).toBeDefined();

    const output = await reencoder.reencode({ bytes: input, size: SIZE, maxInputPixels: PIXELS });
    expect([output.width, output.height]).toEqual([SIZE, SIZE]);
    const meta = await sharp(output.bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([SIZE, SIZE]);
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(contains(output.bytes, EXIF_HEADER)).toBe(false);
    expect(contains(output.bytes, LATITUDE_BYTES)).toBe(false);
  });

  it('accepts a PNG with transparency and flattens it into a JPEG', async () => {
    const png = await sharp({
      create: { width: 300, height: 700, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const output = await reencoder.reencode({
      bytes: new Uint8Array(png),
      size: SIZE,
      maxInputPixels: PIXELS,
    });
    const meta = await sharp(output.bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.hasAlpha).toBe(false);
    expect([meta.width, meta.height]).toEqual([SIZE, SIZE]);
  });

  it('refuses formats other than JPEG and PNG, bytes that are not an image, and images above the pixel limit', async () => {
    const gif = new Uint8Array(
      await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
        .gif()
        .toBuffer(),
    );
    await expect(
      reencoder.reencode({ bytes: gif, size: SIZE, maxInputPixels: PIXELS }),
    ).rejects.toThrow();
    const junk = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
    await expect(
      reencoder.reencode({ bytes: junk, size: SIZE, maxInputPixels: PIXELS }),
    ).rejects.toThrow();
    const large = await photoWithGps(200, 200);
    await expect(
      reencoder.reencode({ bytes: large, size: SIZE, maxInputPixels: 10_000 }),
    ).rejects.toThrow();
  });
});

class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, StoredBytes>();
  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.objectKey, { contentType: input.contentType, bytes: input.bytes });
  }
  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    return this.objects.get(objectKey);
  }
  async deleteObject(_bucket: string, objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
  async listObjectKeys(): Promise<ListObjectsPage> {
    return { objectKeys: [...this.objects.keys()], cursor: undefined };
  }
}

function unwrap<T>(result: Result<T, { readonly message: string }>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('a profile photo saved through the real scanner and re-encoder', () => {
  it('stores and serves only the clean, location-free copy', async () => {
    const db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
    const owner = unwrap(await provisionAccount(db, { email: 'owner@example.com' }));
    await setConsent(db, {
      actorAccountId: owner.id,
      accountId: owner.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = unwrap(
      await createApplicant(db, {
        actorAccountId: owner.id,
        ownerAccountId: owner.id,
        displayName: 'Owner',
      }),
    );
    const proof = async <A extends 'MANAGE' | 'VIEW_METADATA'>(action: A) =>
      unwrap(
        await requireAccess(
          db,
          accountPrincipal(owner.id),
          action,
          { applicantId: applicant.id },
          { purpose: EACH_GRANT },
        ),
      );
    const storage = new MemoryBlobStore();
    const saved = await setApplicantPhoto(
      await proof('MANAGE'),
      {
        storage,
        scanner: new BasicSafetyScanner({ blobStore: storage }),
        reencoder: new SharpPhotoReencoder(),
      },
      { contentType: 'image/jpeg', bytes: await photoWithGps() },
    );
    expect(isOk(saved)).toBe(true);
    expect(storage.objects.size).toBe(1);
    const served = unwrap(await readApplicantPhoto(await proof('VIEW_METADATA'), storage));
    expect(contains(served.bytes, LATITUDE_BYTES)).toBe(false);
    expect((await sharp(served.bytes).metadata()).exif).toBeUndefined();
  });
});
