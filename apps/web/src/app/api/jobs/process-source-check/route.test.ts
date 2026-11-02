import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../../../lib/jobs', () => ({ triggerSourceCheck: mocks.run }));
beforeEach(() => {
  mocks.run.mockReset();
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
});
afterEach(() => {
  vi.unstubAllEnvs();
});
const request = (authorization?: string) =>
  new Request('https://example.com/api/jobs/process-source-check', {
    headers: authorization ? { authorization } : {},
  });
const counts = {
  status: 'COMPLETED',
  sourcesDue: 3,
  checked: 1,
  changed: 1,
  blocked: 1,
  failed: 0,
  unsupported: 1,
  deferred: 0,
};

it('fails closed without a scheduler secret, and refuses unsigned or wrongly signed requests', async () => {
  vi.stubEnv('CRON_SECRET', '');
  expect((await GET(request('Bearer synthetic-cron'))).status).toBe(503);
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
  expect((await GET(request())).status).toBe(403);
  expect((await GET(request('Bearer wrong'))).status).toBe(403);
  expect(mocks.run).not.toHaveBeenCalled();
});

it('returns counts only, never an address or page text', async () => {
  mocks.run.mockResolvedValue({
    ...counts,
    url: 'https://visas.synthetic-gov.example/secret',
    excerpt: 'page text',
  });
  const response = await GET(request('Bearer synthetic-cron'));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual(counts);
  expect(mocks.run.mock.calls[0]?.[0]).toMatchObject({
    kind: 'system',
    job: 'process-source-check',
  });
  expect(JSON.stringify(body)).not.toContain('synthetic-gov');
});

it('says so when it could not run, and reports not ready plainly before the migration', async () => {
  mocks.run.mockResolvedValue({ error: 'not_configured' });
  expect((await GET(request('Bearer synthetic-cron'))).status).toBe(503);
  mocks.run.mockResolvedValue({ ...counts, status: 'NOT_READY', sourcesDue: 0, checked: 0 });
  const response = await GET(request('Bearer synthetic-cron'));
  expect(response.status).toBe(200);
  expect((await response.json()).status).toBe('NOT_READY');
});
