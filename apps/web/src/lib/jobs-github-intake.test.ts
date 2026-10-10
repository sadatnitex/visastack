import { afterEach, expect, it, vi } from 'vitest';

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
it('dispatches without opening a DB connection or consuming a job attempt', async () => {
  vi.stubEnv('MALWARE_SCANNER_PROVIDER', 'github_clamav');
  mocks.dispatch.mockResolvedValue(undefined);
  const { triggerIntakeWorker } = await import('./jobs');
  expect(await triggerIntakeWorker()).toEqual({ processed: 0, failed: 0, queued: true });
  expect(mocks.pooled).not.toHaveBeenCalled();
  expect(mocks.dispatch).toHaveBeenCalledOnce();
});
it('leaves jobs unclaimed on failed dispatch and exposes the failure to the scheduler', async () => {
  vi.stubEnv('MALWARE_SCANNER_PROVIDER', 'github_clamav');
  mocks.dispatch.mockRejectedValue(new Error('not queued'));
  const { triggerIntakeWorker } = await import('./jobs');
  await expect(triggerIntakeWorker()).rejects.toThrow('not queued');
  expect(mocks.pooled).not.toHaveBeenCalled();
});
