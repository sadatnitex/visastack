import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { schema } from '@visastack/db';
import type { Db } from '@visastack/services';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyBlobToken } from './blob-token';
import { VercelPrivateBlobStorage } from './vercel-blob';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));
const SECRET = 'test-signing-secret';

/**
 * Mock `@vercel/blob` itself — this suite proves the ADAPTER's own logic
 * (pathname convention, opaque-key round-trip, private access, token
 * plumbing) without a live BLOB_READ_WRITE_TOKEN or network access. It is
 * NOT a substitute for exercising the adapter against a real Vercel Blob
 * store, which requires a live token this sandbox does not have.
 */
const put = vi.fn();
const get = vi.fn();
const del = vi.fn();
vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => put(...args),
  get: (...args: unknown[]) => get(...args),
  del: (...args: unknown[]) => del(...args),
}));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe('VercelPrivateBlobStorage', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
    put.mockReset();
    get.mockReset();
    del.mockReset();
  });

  it('putObject stores under a private, non-suffixed, non-overwritable pathname derived from bucket + opaque key', async () => {
    put.mockResolvedValue({ url: 'https://blob.vercel-storage.com/quarantine/abc123' });
    const storage = new VercelPrivateBlobStorage({
      db,
      signingSecret: SECRET,
      baseUrl: 'https://app.example',
      token: 'rw-token',
    });

    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'abc123',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(put).toHaveBeenCalledTimes(1);
    const call = put.mock.calls[0];
    if (!call) throw new Error('put was not called');
    const [pathname, body, options] = call;
    expect(pathname).toBe('quarantine/abc123');
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(options).toMatchObject({
      access: 'private',
      contentType: 'application/pdf',
      addRandomSuffix: false,
      allowOverwrite: false,
      token: 'rw-token',
    });
  });

  it('getObject resolves the bucket from storage_objects and fetches privately by the derived pathname', async () => {
    await db
      .insert(schema.storageObjects)
      .values({ bucket: 'CLEAN', objectKey: 'obj-1', contentHash: null, sizeBytes: 5 });
    get.mockResolvedValue({
      statusCode: 200,
      stream: streamOf('hello'),
      blob: { contentType: 'text/plain', size: 5 },
    });

    const storage = new VercelPrivateBlobStorage({
      db,
      signingSecret: SECRET,
      baseUrl: 'https://app.example',
      token: 'rw-token',
    });
    const result = await storage.getObject('obj-1');

    expect(get).toHaveBeenCalledWith('clean/obj-1', { access: 'private', token: 'rw-token' });
    expect(result?.contentType).toBe('text/plain');
    expect(new TextDecoder().decode(result?.bytes)).toBe('hello');
  });

  it('getObject returns undefined (never calling the blob backend) when the object is not registered', async () => {
    const storage = new VercelPrivateBlobStorage({
      db,
      signingSecret: SECRET,
      baseUrl: 'https://app.example',
    });
    const result = await storage.getObject('unknown-key');
    expect(result).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it('getObject returns undefined when the blob backend reports the object missing', async () => {
    await db.insert(schema.storageObjects).values({ bucket: 'CLEAN', objectKey: 'obj-gone' });
    get.mockResolvedValue(null);
    const storage = new VercelPrivateBlobStorage({
      db,
      signingSecret: SECRET,
      baseUrl: 'https://app.example',
    });
    expect(await storage.getObject('obj-gone')).toBeUndefined();
  });

  it('issueReadRef mints a signed reference to the app’s own serving route, never a direct Vercel URL', async () => {
    const storage = new VercelPrivateBlobStorage({
      db,
      signingSecret: SECRET,
      baseUrl: 'https://app.example/',
    });
    const ref = await storage.issueReadRef({
      bucket: 'CLEAN',
      objectKey: 'obj-1',
      disposition: 'preview',
      variant: 'original',
      expiresInSeconds: 300,
    });

    expect(ref.url.startsWith('https://app.example/api/blob/obj-1?')).toBe(true);
    const url = new URL(ref.url);
    const fields = {
      objectKey: 'obj-1',
      disposition: url.searchParams.get('d') ?? '',
      variant: url.searchParams.get('v') ?? '',
      exp: Number(url.searchParams.get('exp')),
      sig: url.searchParams.get('sig') ?? '',
    };
    expect(verifyBlobToken(SECRET, fields)).toBe(true);
  });

  it('deleteObject deletes by the derived private pathname', async () => {
    const storage = new VercelPrivateBlobStorage({
      db,
      signingSecret: SECRET,
      baseUrl: 'https://app.example',
      token: 'rw-token',
    });
    await storage.deleteObject('QUARANTINE', 'obj-9');
    expect(del).toHaveBeenCalledWith('quarantine/obj-9', { token: 'rw-token' });
  });
});

describe('pre-registration upload verification', () => {
  it('reads only the reserved quarantine path without requiring storage metadata first', async () => {
    get.mockReset();
    get.mockResolvedValue({
      statusCode: 200,
      stream: streamOf('hello'),
      blob: { contentType: 'text/plain', size: 5 },
    });
    const storage = new VercelPrivateBlobStorage({
      db: {} as never,
      signingSecret: SECRET,
      baseUrl: 'https://app.example',
      token: 'test',
    });
    expect((await storage.getPendingUpload('opaque-reserved-key'))?.bytes).toEqual(
      new Uint8Array(Buffer.from('hello')),
    );
    expect(get).toHaveBeenCalledWith('quarantine/opaque-reserved-key', {
      access: 'private',
      token: 'test',
    });
    await expect(storage.getPendingUpload('../clean/other')).rejects.toThrow('invalid');
  });
});
