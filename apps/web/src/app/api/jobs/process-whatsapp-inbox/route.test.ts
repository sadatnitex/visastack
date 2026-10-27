import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('./run', () => ({ runWhatsAppInbox: mocks.run }));
const { GET } = await import('./route');

const request = (secret?: string) =>
  new Request('https://example.com/api/jobs/process-whatsapp-inbox', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

beforeEach(() => {
  mocks.run.mockReset();
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
