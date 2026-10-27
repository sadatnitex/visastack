import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), after: vi.fn(), trigger: vi.fn() }));
vi.mock('./run', () => ({ runWhatsAppInbox: mocks.run }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('../../../../lib/jobs', () => ({ triggerNotificationWorker: mocks.trigger }));
const { GET } = await import('./route');

const request = (secret?: string) =>
  new Request('https://example.com/api/jobs/process-whatsapp-inbox', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

beforeEach(() => {
  mocks.run.mockReset();
  mocks.after.mockReset();
  mocks.trigger.mockReset().mockResolvedValue({ sent: 0, retrying: 0, failed: 0 });
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

it('fails closed without the scheduler secret and refuses a wrong one', async () => {
  vi.stubEnv('CRON_SECRET', '');
  expect((await GET(request('synthetic-cron'))).status).toBe(503);
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
  expect((await GET(request())).status).toBe(403);
  expect((await GET(request('wrong'))).status).toBe(403);
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
});

it('sends the emails a pass queued right after it, not at the next day', async () => {
  mocks.run.mockResolvedValue({
    status: 'ok',
    handled: 1,
    failed: 0,
    sent: 1,
    sendFailed: 0,
    purged: 0,
  });
  await GET(request('synthetic-cron'));
  expect(mocks.after).toHaveBeenCalledTimes(1);
  await (mocks.after.mock.calls[0]?.[0] as () => Promise<unknown>)();
  expect(mocks.trigger).toHaveBeenCalledTimes(1);
});

it('runs one pass and reports counts only', async () => {
  mocks.run.mockResolvedValue({
    status: 'ok',
    handled: 2,
    failed: 0,
    sent: 2,
    sendFailed: 0,
    purged: 1,
  });
  const response = await GET(request('synthetic-cron'));
  expect(response.status).toBe(200);
  // The daily pass is the one that removes data past its retention.
  expect(mocks.run).toHaveBeenCalledWith({ purge: true });
  expect(await response.json()).toEqual({
    status: 'ok',
    handled: 2,
    failed: 0,
    sent: 2,
    sendFailed: 0,
    purged: 1,
  });
});

it('says unavailable while the channel is off or not set up', async () => {
  mocks.run.mockResolvedValue({
    status: 'unavailable',
    handled: 0,
    failed: 0,
    sent: 0,
    sendFailed: 0,
    purged: 0,
  });
  expect((await GET(request('synthetic-cron'))).status).toBe(503);
});
