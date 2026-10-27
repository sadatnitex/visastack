import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ rewrap: vi.fn() }));
vi.mock('../../../../lib/jobs', () => ({ triggerDataKeyRewrap: mocks.rewrap }));
beforeEach(() => {
  mocks.rewrap.mockReset();
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
});
afterEach(() => {
  vi.unstubAllEnvs();
});
const request = () =>
  new Request('https://example.com/api/jobs/rewrap-data-keys', {
    headers: { authorization: 'Bearer synthetic-cron' },
  });

it('fails closed without a scheduler secret', async () => {
  vi.stubEnv('CRON_SECRET', '');
  expect((await GET(request())).status).toBe(503);
  expect(mocks.rewrap).not.toHaveBeenCalled();
});
it('refuses anonymous requests without moving any key', async () => {
  expect((await GET(new Request('https://example.com/api/jobs/rewrap-data-keys'))).status).toBe(
    403,
  );
  expect(mocks.rewrap).not.toHaveBeenCalled();
});
it('returns the counts of a finished run', async () => {
  mocks.rewrap.mockResolvedValue({ available: true, rewrapped: 3, remaining: 0, failed: 0 });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ available: true, rewrapped: 3, remaining: 0, failed: 0 });
});
it('does not read as finished when the run could not start or the column is missing', async () => {
  mocks.rewrap.mockResolvedValue({ error: 'key_service_unavailable' });
  expect((await GET(request())).status).toBe(503);
  mocks.rewrap.mockResolvedValue({ available: false });
  expect((await GET(request())).status).toBe(503);
});
