import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { type Server, type Socket, connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  BlobStore,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from '@visastack/services';
import { afterEach, describe, expect, it } from 'vitest';
import { ClamAvScanner, checkSignatureFreshness, probeClamdVersion } from './clamav-scanner';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Deterministic in-memory blob store, no S3, no network (same pattern as retention.test.ts etc). */
class FakeBlobStore implements BlobStore {
  private readonly objects = new Map<string, StoredBytes>();
  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.objectKey, { contentType: input.contentType, bytes: input.bytes });
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

/**
 * A fake clamd speaking the real wire protocol (INSTREAM's length-prefixed
 * chunk framing, VERSION), so the adapter's actual socket/framing/parsing
 * code is genuinely exercised, not bypassed, without needing a real
 * daemon for every test. `behavior` decides the canned reply once the
 * client's chunk stream (or VERSION command) is fully read.
 */
type FakeClamdBehavior =
  | { readonly kind: 'reply'; readonly response: string }
  | { readonly kind: 'hang' }
  | { readonly kind: 'reset' };

function startFakeClamd(
  behavior: FakeClamdBehavior,
): Promise<{ server: Server; socketPath: string }> {
  return new Promise((resolve, reject) => {
    const socketPath = join(tmpdir(), `fake-clamd-${randomUUID()}.sock`);
    const server = createServer((socket: Socket) => {
      const received: Buffer[] = [];
      let buffer = Buffer.alloc(0);
      let mode: 'command' | 'chunks' = 'command';

      socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        if (mode === 'command') {
          const nul = buffer.indexOf(0);
          if (nul === -1) return;
          const command = buffer.subarray(0, nul).toString('ascii');
          buffer = buffer.subarray(nul + 1);
          if (command === 'zVERSION') {
            if (behavior.kind === 'reply') socket.end(`${behavior.response}\0`);
            else if (behavior.kind === 'reset') socket.destroy();
            return; // 'hang': never respond
          }
          mode = 'chunks';
        }
        if (mode === 'chunks') {
          for (;;) {
            if (buffer.length < 4) return;
            const length = buffer.readUInt32BE(0);
            if (buffer.length < 4 + length) return;
            const chunk = buffer.subarray(4, 4 + length);
            buffer = buffer.subarray(4 + length);
            if (length === 0) {
              const full = Buffer.concat(received).toString('ascii');
              if (behavior.kind === 'reset') {
                socket.destroy();
              } else if (behavior.kind === 'reply') {
                const response =
                  behavior.response === '__ECHO_EICAR_CHECK__'
                    ? full.includes(EICAR)
                      ? 'stream: Test.Fixture.EICAR FOUND\0'
                      : 'stream: OK\0'
                    : `${behavior.response}\0`;
                socket.end(response);
              }
              // 'hang': accept the stream, never reply; exercises the client timeout.
              return;
            }
            received.push(Buffer.from(chunk));
          }
        }
      });
    });
    server.on('error', reject);
    server.listen(socketPath, () => resolve({ server, socketPath }));
  });
}

function stopFakeClamd(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('ClamAvScanner, real clamd protocol (INSTREAM), against a fake wire-compatible server', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await stopFakeClamd(server);
      server = undefined;
    }
  });

  it('reports safe on a clean scan (stream: OK)', async () => {
    const fake = await startFakeClamd({ kind: 'reply', response: 'stream: OK' });
    server = fake.server;
    const storage = new FakeBlobStore();
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'k1',
      contentType: 'image/png',
      bytes: pngBytes(),
    });
    const scanner = new ClamAvScanner({
      blobStore: storage,
      socketPath: fake.socketPath,
      enforceSignatureFreshness: false,
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'k1' });
    expect(result.safe).toBe(true);
    expect(result.detail).toContain('clamav: OK');
  });

  it('reports unsafe with the signature name on a detection (stream: X FOUND)', async () => {
    const fake = await startFakeClamd({
      kind: 'reply',
      response: 'stream: Win.Test.EICAR_HDB-1 FOUND',
    });
    server = fake.server;
    const storage = new FakeBlobStore();
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'k1',
      contentType: 'image/png',
      bytes: pngBytes(),
    });
    const scanner = new ClamAvScanner({
      blobStore: storage,
      socketPath: fake.socketPath,
      enforceSignatureFreshness: false,
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'k1' });
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('Win.Test.EICAR_HDB-1');
  });

  it('really streams the actual bytes to clamd: the fake server detects EICAR content it inspects itself, not a canned answer', async () => {
    const fake = await startFakeClamd({ kind: 'reply', response: '__ECHO_EICAR_CHECK__' });
    server = fake.server;
    const storage = new FakeBlobStore();
    await storage.putObject({
      // text/plain so this reaches clamd through the structural gate rather
      // than being rejected as an unrecognized type beforehand -- otherwise
      // this test would pass for the wrong reason (structural rejection,
      // never actually contacting the fake server), the same bug a live-
      // clamd version of this test caught (see the live describe block
      // below).
      bucket: 'QUARANTINE',
      objectKey: 'eicar',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode(EICAR),
    });
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'clean',
      contentType: 'image/png',
      bytes: pngBytes(),
    });
    const scanner = new ClamAvScanner({
      blobStore: storage,
      socketPath: fake.socketPath,
      enforceSignatureFreshness: false,
    });
    const eicarResult = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'eicar' });
    expect(eicarResult.safe).toBe(false);
    expect(eicarResult.detail).toContain('EICAR');
    const cleanResult = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'clean' });
    expect(cleanResult.safe).toBe(true);
  });

  it('allows a structurally well-formed PDF through the structural gate to the real scanner (ADR-0012 follow-up)', async () => {
    const fake = await startFakeClamd({ kind: 'reply', response: 'stream: OK' });
    server = fake.server;
    const storage = new FakeBlobStore();
    const pdfBytes = new TextEncoder().encode('%PDF-1.4\n%%EOF');
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'k1',
      contentType: 'application/pdf',
      bytes: pdfBytes,
    });
    const scanner = new ClamAvScanner({
      blobStore: storage,
      socketPath: fake.socketPath,
      enforceSignatureFreshness: false,
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'k1' });
    expect(result.safe).toBe(true);
    expect(result.detail).toContain('pdf');
  });

  it('never reaches the real scanner for content the structural gate already rejects (an executable)', async () => {
    const fake = await startFakeClamd({ kind: 'reply', response: 'stream: OK' });
    server = fake.server;
    const storage = new FakeBlobStore();
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'k1',
      contentType: 'application/octet-stream',
      bytes: new Uint8Array([0x4d, 0x5a, 0x00, 0x00]), // MZ (PE executable)
    });
    const scanner = new ClamAvScanner({
      blobStore: storage,
      socketPath: fake.socketPath,
      enforceSignatureFreshness: false,
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'k1' });
    // The fake server would have answered "OK" if it were ever contacted --
    // getting `safe: false` here proves the structural gate short-circuited.
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('dos/pe executable');
  });

  it('fails closed (unsafe) on an unrecognized scanner response, never fail-open', async () => {
    const fake = await startFakeClamd({
      kind: 'reply',
      response: 'garbage the protocol never sends',
    });
    server = fake.server;
    const storage = new FakeBlobStore();
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'k1',
      contentType: 'image/png',
      bytes: pngBytes(),
    });
    const scanner = new ClamAvScanner({
      blobStore: storage,
      socketPath: fake.socketPath,
      enforceSignatureFreshness: false,
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'k1' });
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('unrecognized response');
  });

  it('fails closed on a connection reset mid-scan', async () => {
    const fake = await startFakeClamd({ kind: 'reset' });
    server = fake.server;
    const storage = new FakeBlobStore();
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'k1',
      contentType: 'image/png',
      bytes: pngBytes(),
    });
    const scanner = new ClamAvScanner({
      blobStore: storage,
      socketPath: fake.socketPath,
      enforceSignatureFreshness: false,
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'k1' });
    // A destroyed socket can surface as either a genuine 'error' event
    // (-> "scanner unavailable") or a clean EOF with no bytes sent
    // (-> "unrecognized response (<empty>)") depending on OS/Node timing --
    // both are legitimate fail-closed outcomes of the same dropped
    // connection, so this asserts the property that actually matters
    // (never `safe: true` on a dropped connection), not one specific path.
    expect(result.safe).toBe(false);
  });

  it('fails closed on a scan timeout (scanner accepts the stream but never answers)', async () => {
    const fake = await startFakeClamd({ kind: 'hang' });
    server = fake.server;
    const storage = new FakeBlobStore();
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'k1',
      contentType: 'image/png',
      bytes: pngBytes(),
    });
    const scanner = new ClamAvScanner({
      blobStore: storage,
      socketPath: fake.socketPath,
      enforceSignatureFreshness: false,
      timeoutMs: 100,
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'k1' });
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('scanner unavailable');
    expect(result.detail).toContain('timed out');
  }, 10_000);

  it('fails closed when nothing is listening at the configured socket', async () => {
    const storage = new FakeBlobStore();
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'k1',
      contentType: 'image/png',
      bytes: pngBytes(),
    });
    const scanner = new ClamAvScanner({
      blobStore: storage,
      socketPath: join(tmpdir(), `no-such-clamd-${randomUUID()}.sock`),
      enforceSignatureFreshness: false,
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'k1' });
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('scanner unavailable');
  });

  it('reports unsafe with an object-not-found detail when the blob store has nothing at that key', async () => {
    const storage = new FakeBlobStore();
    const scanner = new ClamAvScanner({
      blobStore: storage,
      socketPath: join(tmpdir(), 'unused.sock'),
      enforceSignatureFreshness: false,
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'missing' });
    expect(result).toEqual({ safe: false, detail: 'object bytes not found' });
  });

  it('exposes name=clamav and defaults version to "unknown" rather than fabricating one', () => {
    const scanner = new ClamAvScanner({
      blobStore: new FakeBlobStore(),
      socketPath: '/nonexistent',
      enforceSignatureFreshness: false,
    });
    expect(scanner.name).toBe('clamav');
    expect(scanner.version).toBe('unknown');
  });

  it('uses an operator-declared engineVersion when supplied, still without probing', () => {
    const scanner = new ClamAvScanner({
      blobStore: new FakeBlobStore(),
      socketPath: '/nonexistent',
      enforceSignatureFreshness: false,
      engineVersion: '1.5.3/27682',
    });
    expect(scanner.version).toBe('1.5.3/27682');
  });

  it('refuses to construct with either socketPath or host+port missing', () => {
    expect(
      () => new ClamAvScanner({ blobStore: new FakeBlobStore(), enforceSignatureFreshness: false }),
    ).toThrow(/socketPath or host\+port/);
  });

  it('refuses enforceSignatureFreshness:false when DEPLOYMENT_MODE=commercial (mirrors LocalEnvelopeKeyProvider)', () => {
    const key = 'DEPLOYMENT_MODE';
    const prior = process.env[key];
    process.env[key] = 'commercial';
    try {
      expect(
        () =>
          new ClamAvScanner({
            blobStore: new FakeBlobStore(),
            socketPath: '/nonexistent',
            enforceSignatureFreshness: false,
          }),
      ).toThrow(/commercial/);
    } finally {
      if (prior === undefined) delete process.env[key];
      else process.env[key] = prior;
    }
  });
});

describe('probeClamdVersion, best-effort, never fabricates', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await stopFakeClamd(server);
      server = undefined;
    }
  });

  it('returns the real reply when the command is enabled', async () => {
    const fake = await startFakeClamd({ kind: 'reply', response: 'ClamAV 1.5.3/27682/Tue Sep 16' });
    server = fake.server;
    const version = await probeClamdVersion({ socketPath: fake.socketPath });
    expect(version).toContain('ClamAV 1.5.3');
  });

  it('returns undefined, not a guess, when the command is disabled (the packaged default)', async () => {
    const fake = await startFakeClamd({ kind: 'reply', response: 'COMMAND UNAVAILABLE' });
    server = fake.server;
    const version = await probeClamdVersion({ socketPath: fake.socketPath });
    expect(version).toBeUndefined();
  });

  it('returns undefined, not a guess, when nothing is reachable', async () => {
    const version = await probeClamdVersion({
      socketPath: join(tmpdir(), `no-clamd-${randomUUID()}.sock`),
    });
    expect(version).toBeUndefined();
  });
});

describe('checkSignatureFreshness, real filesystem, no clamd needed', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('is not fresh when the directory has no official .cvd/.cld database at all', async () => {
    dir = await mkdtemp(join(tmpdir(), 'clamav-db-'));
    await writeFile(join(dir, 'custom.hdb'), '44d88612fea8a8f36de82e1278abb02f:68:Test\n');
    const result = await checkSignatureFreshness(dir, 24 * 60 * 60 * 1000);
    expect(result.fresh).toBe(false);
    expect(result.detail).toContain('no official');
  });

  it('is fresh when a .cvd file was written within the max age', async () => {
    dir = await mkdtemp(join(tmpdir(), 'clamav-db-'));
    const file = join(dir, 'daily.cvd');
    await writeFile(file, 'not a real cvd, only mtime matters for this test');
    const result = await checkSignatureFreshness(dir, 24 * 60 * 60 * 1000);
    expect(result.fresh).toBe(true);
    expect(result.ageMs).not.toBeNull();
  });

  it('is stale when the newest .cld file is older than the max age', async () => {
    dir = await mkdtemp(join(tmpdir(), 'clamav-db-'));
    const file = join(dir, 'daily.cld');
    await writeFile(file, 'stale');
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(file, oldTime, oldTime);
    const result = await checkSignatureFreshness(dir, 24 * 60 * 60 * 1000);
    expect(result.fresh).toBe(false);
    expect(result.detail).toContain('h old');
  });

  it('is not fresh (fails closed) when the directory does not exist', async () => {
    const result = await checkSignatureFreshness(
      '/no/such/directory/anywhere',
      24 * 60 * 60 * 1000,
    );
    expect(result.fresh).toBe(false);
    expect(result.ageMs).toBeNull();
  });
});

/**
 * Genuine live verification against a real ClamAV daemon (`clamd`), not a
 * fake: only runs when `CLAMAV_TEST_SOCKET_PATH` is actually set and
 * reachable. Skipped, not faked, everywhere else (per the directive: "never
 * fake a live pass"). Set up in CI by installing and starting `clamav-daemon`
 * before the test step; can be reproduced locally the same way.
 */
function readEnv(name: string): string | undefined {
  return process.env[name];
}
const liveSocketPath = readEnv('CLAMAV_TEST_SOCKET_PATH');

describe.skipIf(!liveSocketPath)('ClamAvScanner, live verification against a real clamd', () => {
  it('a real clamd genuinely detects the standard EICAR test string and passes clean content', async () => {
    if (!liveSocketPath) return;
    const storage = new FakeBlobStore();
    await storage.putObject({
      // The standard EICAR fixture is plain printable ASCII (by design --
      // it's meant to be a harmless, editable text file every AV vendor
      // agrees to flag), so it is declared the same way a real EICAR.com
      // upload would be: as text. It must pass the structural gate on
      // content shape alone and be caught by the real engine, not by the
      // structural/magic-byte layer -- that is the whole point of this test.
      bucket: 'QUARANTINE',
      objectKey: 'eicar',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode(EICAR),
    });
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'clean',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('nothing malicious here, just a clean test file'),
    });
    const scanner = new ClamAvScanner({
      blobStore: storage,
      socketPath: liveSocketPath,
      // This session's own sandbox has no route to database.clamav.net (the
      // outbound network policy blocks it, confirmed via the agent proxy's
      // own status endpoint) so only a minimal EICAR-only test database is
      // loaded, not the real signed daily.cvd. Freshness enforcement is
      // real production behavior this test deliberately does not exercise
      // here -- it is exercised in isolation above with a real filesystem,
      // not against this specific live daemon.
      enforceSignatureFreshness: false,
    });

    const eicarResult = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'eicar' });
    expect(eicarResult.safe).toBe(false);
    expect(eicarResult.detail?.toLowerCase()).toContain('eicar');

    const cleanResult = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'clean' });
    expect(cleanResult.safe).toBe(true);
  });

  it('connects with plain node:net the same way the adapter does, confirming the socket is genuinely a clamd and not something else', async () => {
    if (!liveSocketPath) return;
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect(liveSocketPath);
      const chunks: Buffer[] = [];
      socket.on('connect', () => socket.write('PING\n'));
      socket.on('data', (d) => chunks.push(d));
      socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
      socket.on('error', reject);
    });
    expect(reply).toBe('PONG');
  });
});

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
}
