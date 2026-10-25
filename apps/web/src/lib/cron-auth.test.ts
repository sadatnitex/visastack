import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rejectUnauthorizedCron } from './cron-auth';

const jobsDir = fileURLToPath(new URL('../app/api/jobs/', import.meta.url));

const withAuth = (value?: string) =>
  new Request('https://example.com/api/jobs/any', {
    ...(value === undefined ? {} : { headers: { authorization: value } }),
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('rejectUnauthorizedCron', () => {
  it('fails closed when the scheduler secret is not set', () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(rejectUnauthorizedCron(withAuth('Bearer anything'))?.status).toBe(503);
  });

  it('refuses a missing, wrong, shorter or longer credential', () => {
    vi.stubEnv('CRON_SECRET', 'synthetic-cron');
    for (const value of [
      undefined,
      '',
      'Bearer wrong',
      'Bearer synthetic-cro',
      'Bearer synthetic-cron-extra',
      'synthetic-cron',
    ]) {
      expect(rejectUnauthorizedCron(withAuth(value))?.status).toBe(403);
    }
  });

  it('lets the signed scheduler request through', () => {
    vi.stubEnv('CRON_SECRET', 'synthetic-cron');
    expect(rejectUnauthorizedCron(withAuth('Bearer synthetic-cron'))).toBeNull();
  });

  it('is the first thing every scheduled-job route does, and the only credential check', () => {
    const routes = readdirSync(jobsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(`${jobsDir}${entry.name}/route.ts`))
      .map((entry) => `${jobsDir}${entry.name}/route.ts`);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      // Comments are stripped so a mention in prose cannot satisfy the check.
      const code = readFileSync(route, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const handler = code.match(
        /export async function GET\(request: Request\): Promise<Response> \{\s*([^\n]*)\s*([^\n]*)/,
      );
      expect(handler, route).not.toBeNull();
      expect(handler?.[1], route).toBe('const denied = rejectUnauthorizedCron(request);');
      expect(handler?.[2], route).toBe('if (denied) return denied;');
      expect(code, route).not.toContain('CRON_SECRET');
      expect(code, route).not.toMatch(/headers\.get\(\s*['"]authorization['"]/i);
    }
  });
});
