import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
const { status } = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock('@visastack/adapters', () => ({ hasRecentDatabaseBackup: status }));
const env = [
  'CRON_SECRET',
  'VERCEL_ENV',
  'R2_ENDPOINT_URL',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'GITHUB_BACKUP_DISPATCH_TOKEN',
  'HOSTING_PLATFORM',
];
const original = new Map(env.map((name) => [name, process.env[name]]));
beforeEach(() => {
  for (const name of env) process.env[name] = 'test';
  process.env[env[1] ?? 'VERCEL_ENV'] = 'production';
  delete process.env[env[6] ?? 'HOSTING_PLATFORM'];
  status.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of env) {
    const value = original.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
const request = (auth = 'Bearer test') =>
  new Request('https://app.example/api/jobs/process-database-backup', {
    headers: { authorization: auth },
  });
describe('weekly backup trigger', () => {
  it('rejects anonymous calls before accessing backup storage', async () => {
    expect((await GET(request(''))).status).toBe(403);
    expect(status).not.toHaveBeenCalled();
  });
  it('does not dispatch another backup when this week already completed', async () => {
    status.mockResolvedValue(true);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await GET(request());
    expect(await result.json()).toEqual({
      backupCompleted: true,
      restoreVerified: false,
      dispatched: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports accepted dispatch as pending, never as a completed backup', async () => {
    status.mockResolvedValue(false);
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const result = await GET(request());
    expect(result.status).toBe(202);
    expect(await result.json()).toEqual({ dispatched: true, backupCompleted: false });
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({ ref: 'main' });
  });
  it('runs on the production site only: Vercel production or the Render fallback', async () => {
    status.mockResolvedValue(true);
    process.env[env[1] ?? 'VERCEL_ENV'] = 'preview';
    expect((await GET(request())).status).toBe(403);
    delete process.env[env[1] ?? 'VERCEL_ENV'];
    expect((await GET(request())).status).toBe(403);
    expect(status).not.toHaveBeenCalled();
    process.env[env[6] ?? 'HOSTING_PLATFORM'] = 'render';
    expect((await GET(request())).status).toBe(200);
  });
  it('fails closed on provider errors and missing dispatch credentials', async () => {
    status.mockRejectedValue(new Error('offline'));
    expect((await GET(request())).status).toBe(502);
    status.mockResolvedValue(false);
    delete process.env[env[5] ?? 'GITHUB_BACKUP_DISPATCH_TOKEN'];
    expect((await GET(request())).status).toBe(503);
  });
});
