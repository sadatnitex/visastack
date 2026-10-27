import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ worker: vi.fn() }));
vi.mock('../../../../lib/jobs', () => ({
  triggerAiReadingWorker: mocks.worker,
  triggerIntakeWorker: vi.fn(),
}));
beforeEach(() => {
  mocks.worker.mockReset();
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
});
afterEach(() => {
  vi.unstubAllEnvs();
});
const request = () =>
  new Request('https://example.com/api/jobs/process-ai-reading', {
    headers: { authorization: 'Bearer synthetic-cron' },
  });

it('fails closed without a scheduler secret', async () => {
  vi.stubEnv('CRON_SECRET', '');
  expect((await GET(request())).status).toBe(503);
  expect(mocks.worker).not.toHaveBeenCalled();
});

it('refuses anonymous and wrong-secret requests without running a worker', async () => {
  expect((await GET(new Request('https://example.com/api/jobs/process-ai-reading'))).status).toBe(
    403,
  );
  expect(
    (
      await GET(
        new Request('https://example.com/api/jobs/process-ai-reading', {
          headers: { authorization: 'Bearer wrong' },
        }),
      )
    ).status,
  ).toBe(403);
  expect(mocks.worker).not.toHaveBeenCalled();
});

it('runs the worker under its own job scope with a bounded pass and reports counts only', async () => {
  mocks.worker.mockResolvedValue({ processed: 2, stopped: 1, failed: 0 });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ processed: 2, stopped: 1, failed: 0 });
  expect(mocks.worker).toHaveBeenCalledTimes(1);
  const [scope, options] = mocks.worker.mock.calls[0] ?? [];
  expect(scope).toMatchObject({ kind: 'system', job: 'process-ai-reading' });
  expect(options.limit).toBeLessThanOrEqual(20);
  expect(options.timeBudgetMs).toBeLessThanOrEqual(45_000);
});

it('reports an outage to the scheduler instead of a successful empty pass', async () => {
  mocks.worker.mockResolvedValue({ processed: 0, stopped: 0, failed: 0, unavailable: true });
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: 'unavailable' });
});
