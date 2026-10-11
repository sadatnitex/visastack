import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyBlobToken } from './blob-token';
import { R2Storage, validateR2Endpoint } from './r2-storage';

const { send, configured } = vi.hoisted(() => ({ send: vi.fn(), configured: vi.fn() }));
vi.mock('@aws-sdk/client-s3', async (load) => {
  const actual = await load<typeof import('@aws-sdk/client-s3')>();
  return {
    ...actual,
    S3Client: class {
      constructor(options: unknown) {
        configured(options);
      }
      send = send;
    },
  };
});
const legacy = {
  putObject: vi.fn(),
  getObject: vi.fn(),
  deleteObject: vi.fn(),
  listObjectKeys: vi.fn(),
  issueReadRef: vi.fn(),
};
const endpoint = `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`;
function storage(bucket: 'CLEAN' | 'QUARANTINE' | undefined = undefined) {
  const query = {
    from: () => query,
    where: () => query,
    limit: async () => (bucket ? [{ bucket }] : []),
  };
  return new R2Storage({
    db: { select: () => query } as never,
    signingSecret: 'test-secret',
    baseUrl: 'https://app.example',
    endpoint,
    accessKeyId: 'test',
    secretAccessKey: 'test',
    legacy,
  });
}
beforeEach(() => {
  send.mockReset();
  configured.mockReset();
  for (const fn of Object.values(legacy)) fn.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
describe('R2 private storage and legacy continuity', () => {
  it('uses the configured region and retains path-style routing with the auto fallback', async () => {
    for (const region of ['auto', 'custom-region', '']) {
      vi.stubEnv('R2_REGION', region);
      await storage().putObject({
        bucket: 'QUARANTINE',
        objectKey: 'region-probe',
        bytes: Buffer.from('hello'),
        contentType: 'text/plain',
      });
      expect(configured).toHaveBeenLastCalledWith(
        expect.objectContaining({
          region: region || 'auto',
          forcePathStyle: true,
          endpoint,
        }),
      );
    }
  });
  it('allows only R2 HTTPS endpoints without credentials, paths or ports', () => {
    expect(validateR2Endpoint(endpoint)).toBe(endpoint);
    for (const bad of [
      'http://localhost',
      'https://example.com',
      `${endpoint}/path`,
      `${endpoint}?key=bad`,
      `${endpoint}:444`,
    ]) {
      expect(() => validateR2Endpoint(bad)).toThrow();
    }
  });
  it('streams private immutable writes without public ACLs or filenames', async () => {
    await storage().putObject({
      bucket: 'QUARANTINE',
      objectKey: 'opaque-1',
      bytes: Buffer.from('hello'),
      contentType: 'text/plain',
    });
    const input = send.mock.calls[0]?.[0].input;
    expect(input).toMatchObject({
      Bucket: 'visastack-document-backups',
      Key: 'documents/quarantine/opaque-1',
      IfNoneMatch: '*',
      ContentLength: 5,
    });
    expect(input.ACL).toBeUndefined();
    expect(input.Body).toBeInstanceOf(Readable);
    await expect(
      storage().putObject({
        bucket: 'CLEAN',
        objectKey: '../database/latest',
        bytes: Buffer.from('x'),
        contentType: 'text/plain',
      }),
    ).rejects.toThrow('opaque');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('verifies fresh uploads before registration and preserves legacy reads only on 404', async () => {
    send.mockResolvedValue({
      Body: Readable.from([Buffer.from('hello')]),
      ContentLength: 5,
      ContentType: 'text/plain',
    });
    expect((await storage().getObject('opaque-1'))?.bytes).toEqual(Buffer.from('hello'));
    expect(send.mock.calls[0]?.[0].input.Key).toBe('documents/quarantine/opaque-1');
    send.mockRejectedValue({ $metadata: { httpStatusCode: 404 } });
    legacy.getObject.mockResolvedValue({ bytes: Buffer.from('legacy'), contentType: 'text/plain' });
    expect((await storage('CLEAN').getObject('old'))?.bytes).toEqual(Buffer.from('legacy'));
    send.mockRejectedValue({ $metadata: { httpStatusCode: 403 } });
    await expect(storage().getObject('old')).rejects.toThrow('read failed');
    expect(legacy.getObject).toHaveBeenCalledTimes(1);
  });
  it('rejects actual stream overflow and erases both storage boundaries', async () => {
    send.mockResolvedValue({ Body: Readable.from([Buffer.from('too large')]), ContentLength: 1 });
    await expect(storage().getObject('opaque-1')).rejects.toThrow();
    send.mockResolvedValue({});
    await storage().deleteObject('CLEAN', 'old');
    expect(legacy.deleteObject).toHaveBeenCalledWith('CLEAN', 'old');
  });
  it('paginates both providers without including the SQL backup namespace', async () => {
    send.mockResolvedValue({ Contents: [{ Key: 'documents/clean/one' }], IsTruncated: false });
    expect(await storage().listObjectKeys({ bucket: 'CLEAN' })).toEqual({
      objectKeys: ['one'],
      cursor: 'legacy:',
    });
    legacy.listObjectKeys.mockResolvedValue({ objectKeys: ['old'], cursor: undefined });
    expect(await storage().listObjectKeys({ bucket: 'CLEAN', cursor: 'legacy:' })).toEqual({
      objectKeys: ['old'],
      cursor: undefined,
    });
    expect(legacy.listObjectKeys).toHaveBeenCalledWith({ bucket: 'CLEAN' });
    expect(send.mock.calls[0]?.[0].input.Prefix).toBe('documents/clean/');
  });
  it('issues only app-controlled signed read references', async () => {
    const ref = await storage().issueReadRef({
      bucket: 'CLEAN',
      objectKey: 'one',
      disposition: 'download',
      variant: 'original',
      expiresInSeconds: 60,
      filename: 'passport.pdf',
    });
    const url = new URL(ref.url);
    expect(url.origin).toBe('https://app.example');
    expect(
      verifyBlobToken('test-secret', {
        objectKey: 'one',
        disposition: 'download',
        variant: 'original',
        exp: Number(url.searchParams.get('exp')),
        sig: url.searchParams.get('sig') ?? '',
        filename: 'passport.pdf',
      }),
    ).toBe(true);
  });
});

it('preserves expiring account exports without document bounds or permanent R2 replication', async () => {
  const objectKey = `exports/${'00000000-0000-4000-8000-000000000001'}-${'00000000-0000-4000-8000-000000000002'}.zip.enc`;
  const input = {
    bucket: 'CLEAN' as const,
    objectKey,
    bytes: new Uint8Array(0),
    contentType: 'application/octet-stream',
  };
  await storage().putObject(input);
  await storage().getObject(objectKey);
  await storage().deleteObject('CLEAN', objectKey);
  expect(legacy.putObject).toHaveBeenCalledWith(input);
  expect(legacy.getObject).toHaveBeenCalledWith(objectKey);
  expect(legacy.deleteObject).toHaveBeenCalledWith('CLEAN', objectKey);
  expect(send).not.toHaveBeenCalled();
});
