import { beforeEach, expect, it, vi } from 'vitest';
import { triggerIntakeAndReading } from './run';

const mocks = vi.hoisted(() => ({ intake: vi.fn(), reading: vi.fn() }));
vi.mock('../../../../lib/jobs', () => ({
  triggerIntakeWorker: mocks.intake,
  triggerAiReadingWorker: mocks.reading,
}));
beforeEach(() => {
  mocks.intake.mockReset();
  mocks.reading.mockReset();
  mocks.reading.mockResolvedValue({ processed: 0, stopped: 0, failed: 0 });
});

it('reads right after intake finished at least one file, with a small pass and the job scope', async () => {
  mocks.intake.mockResolvedValue({ processed: 1, failed: 0 });
  await triggerIntakeAndReading();
  expect(mocks.reading).toHaveBeenCalledTimes(1);
  const [scope, options] = mocks.reading.mock.calls[0] ?? [];
  expect(scope).toMatchObject({ kind: 'system', job: 'process-ai-reading' });
  expect(options).toEqual({ limit: 3, timeBudgetMs: 25_000 });
});

it('reads nothing when intake finished nothing, is unavailable, or ran on the private worker', async () => {
  for (const outcome of [
    { processed: 0, failed: 0 },
    { processed: 0, failed: 1 },
    { processed: 0, failed: 0, unavailable: true },
    { processed: 0, failed: 0, queued: true },
  ]) {
    mocks.intake.mockResolvedValue(outcome);
    await triggerIntakeAndReading();
  }
  expect(mocks.reading).not.toHaveBeenCalled();
});
