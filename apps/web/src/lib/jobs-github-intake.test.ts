import { afterEach, beforeAll, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pooled: vi.fn(), dispatch: vi.fn() }));
vi.mock('@visastack/db', async (load) => ({
  ...(await load<typeof import('@visastack/db')>()),
  createPooledDb: mocks.pooled,
}));
vi.mock('./github-intake', () => ({ dispatchGithubIntake: mocks.dispatch }));
vi.mock('./providers', () => ({
  createContentLimitsChecker: vi.fn(),
  createDocumentConverter: vi.fn(),
  createEmailPort: vi.fn(),
  createKeyManagementPort: vi.fn(),
  createMalwareScanner: vi.fn(),
  createObservabilityPort: vi.fn(),
  createStorage: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
// Loading the jobs module pulls in the whole service graph. Do it once, outside any test's 5 s
// limit: under full-suite load a cold load can exceed it, and the timed-out run then leaks into
// the next test.
let triggerIntakeWorker: typeof import('./jobs').triggerIntakeWorker;
beforeAll(async () => {
  ({ triggerIntakeWorker } = await import('./jobs'));
}, 60_000);

it('dispatches without opening a DB connection or consuming a job attempt', async () => {
  vi.stubEnv('MALWARE_SCANNER_PROVIDER', 'github_clamav');
  mocks.dispatch.mockResolvedValue(undefined);
  expect(await triggerIntakeWorker()).toEqual({ processed: 0, failed: 0, queued: true });
  expect(mocks.pooled).not.toHaveBeenCalled();
  expect(mocks.dispatch).toHaveBeenCalledOnce();
});
it('leaves jobs unclaimed on failed dispatch and exposes the failure to the scheduler', async () => {
  vi.stubEnv('MALWARE_SCANNER_PROVIDER', 'github_clamav');
  mocks.dispatch.mockRejectedValue(new Error('not queued'));
  await expect(triggerIntakeWorker()).rejects.toThrow('not queued');
  expect(mocks.pooled).not.toHaveBeenCalled();
});
