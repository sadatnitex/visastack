import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runIsolatedIntake } from './intake-runner';

const mocks = vi.hoisted(() => ({
  fresh: vi.fn(),
  pooled: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
  worker: vi.fn(),
  scan: vi.fn(),
  r2: vi.fn(),
}));
vi.mock('@visastack/db', () => ({ createPooledDb: mocks.pooled }));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  runIntakeWorker: mocks.worker,
}));
vi.mock('./clamav-scanner', () => ({
  checkSignatureFreshness: mocks.fresh,
  ClamAvScanner: class {
    name = 'clamav';
    version = 'verified-test';
    scan = mocks.scan;
  },
}));
vi.mock('./r2-storage', () => ({
  R2Storage: class {
    constructor(options: unknown) {
      mocks.r2(options);
    }
  },
}));
vi.mock('./vercel-blob', () => ({ VercelPrivateBlobStorage: class {} }));
vi.mock('./text-extraction', () => ({ DeterministicTextExtractor: class {} }));
vi.mock('./content-limits', () => ({ BuiltinContentLimitsChecker: class {} }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('GITHUB_REF', 'refs/heads/main');
  vi.stubEnv('INTAKE_DATABASE_URL', 'postgresql://fixture:fixture@ep-fixture.neon.tech/neondb'); // supply-chain-allow: nonexistent fixture hostname; DB factory mocked, no network.
  vi.stubEnv('CLAMAV_ENGINE_VERSION', 'ClamAV synthetic-test');
  vi.stubEnv('INTAKE_STORAGE_PROVIDER', '');
  for (const name of [
    'BLOB_SIGNING_SECRET',
    'BLOB_READ_WRITE_TOKEN',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
  ])
    vi.stubEnv(name, 'synthetic');
  vi.stubEnv('R2_ENDPOINT_URL', `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`);
  mocks.fresh.mockResolvedValue({ fresh: true });
  mocks.pooled.mockReturnValue({ db: {}, pool: { on: mocks.on, end: mocks.end } });
  mocks.worker.mockResolvedValue({ processed: 0, failed: 0 });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isolated intake worker', () => {
  it('keeps the working private store by default and selects R2 only explicitly', async () => {
    await runIsolatedIntake();
    expect(mocks.r2).not.toHaveBeenCalled();
    vi.stubEnv('INTAKE_STORAGE_PROVIDER', 'r2');
    await runIsolatedIntake();
    expect(mocks.r2).toHaveBeenCalledOnce();
    vi.stubEnv('INTAKE_STORAGE_PROVIDER', 'unknown');
    await expect(runIsolatedIntake()).rejects.toThrow('Unsupported');
  });
  it('refuses other refs, unknown engine versions and stale signatures before opening the queue', async () => {
    vi.stubEnv('GITHUB_REF', 'refs/heads/preview');
    await expect(runIsolatedIntake()).rejects.toThrow('requires main');
    vi.stubEnv('GITHUB_REF', 'refs/heads/main');
    vi.stubEnv('CLAMAV_ENGINE_VERSION', 'unknown');
    await expect(runIsolatedIntake()).rejects.toThrow('not verified');
    vi.stubEnv('CLAMAV_ENGINE_VERSION', 'ClamAV synthetic-test');
    mocks.fresh.mockResolvedValue({ fresh: false });
    await expect(runIsolatedIntake()).rejects.toThrow('stale');
    expect(mocks.pooled).not.toHaveBeenCalled();
  });
  it('claims only one job per lease, bounds each run and closes the connection', async () => {
    mocks.worker.mockResolvedValue({ processed: 1, failed: 0 });
    await runIsolatedIntake();
    expect(mocks.worker).toHaveBeenCalledTimes(10);
    for (const call of mocks.worker.mock.calls) expect(call[4]).toEqual({ limit: 1 });
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it('treats scanner outages as retries and infections as genuine unsafe results', async () => {
    mocks.worker.mockImplementation(async (_db, scanner) => {
      for (const detail of [
        'scanner unavailable',
        'scanner degraded',
        'clamav: scan error',
        'clamav: unrecognized response',
      ]) {
        mocks.scan.mockResolvedValue({ safe: false, detail });
        await expect(
          scanner.scan({ bucket: 'QUARANTINE', objectKey: 'synthetic' }),
        ).rejects.toThrow('retry');
      }
      mocks.scan.mockResolvedValue({ safe: false, detail: 'clamav: threat detected (Eicar)' });
      expect(await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'synthetic' })).toMatchObject({
        safe: false,
      });
      return { processed: 0, failed: 0 };
    });
    await runIsolatedIntake();
  });
  it('closes the connection on failure and reports pending retries as a failed run', async () => {
    mocks.worker
      .mockResolvedValueOnce({ processed: 0, failed: 1 })
      .mockResolvedValue({ processed: 0, failed: 0 });
    await expect(runIsolatedIntake()).rejects.toThrow('retries remain');
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
