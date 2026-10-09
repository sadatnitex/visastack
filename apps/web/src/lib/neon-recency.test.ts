import { describe, expect, it } from 'vitest';
import { neonReauthUrl, neonSessionAgeSeconds, safeReturnPath } from './neon-recency';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const reader = (createdAt: Date | string | null | undefined, data = true) => ({
  getSession: async () => ({
    data: data ? { session: createdAt === undefined ? null : { createdAt } } : null,
  }),
});

describe('neonSessionAgeSeconds', () => {
  it('measures from the sign-in time', async () => {
    expect(await neonSessionAgeSeconds(reader(new Date(NOW - 90_000)), () => NOW)).toBe(90);
    expect(
      await neonSessionAgeSeconds(reader(new Date(NOW - 90_000).toISOString()), () => NOW),
    ).toBe(90);
  });

  it('counts anything missing or unreadable as stale, so it can only ask for more sign-ins', async () => {
    for (const bad of [
      reader(undefined),
      reader(null),
      reader('not a date'),
      reader(null, false),
    ]) {
      expect(await neonSessionAgeSeconds(bad, () => NOW)).toBe(Number.POSITIVE_INFINITY);
    }
  });
});

describe('safeReturnPath', () => {
  it('keeps same-site paths and replaces everything else with the app home', () => {
    expect(safeReturnPath('/app/cases?x=1')).toBe('/app/cases?x=1');
    for (const bad of [
      undefined,
      null,
      '',
      'app',
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      '/app\nSet-Cookie: a=b',
    ]) {
      expect(safeReturnPath(bad)).toBe('/app');
    }
  });

  it('builds the re-check address from a safe path only', () => {
    expect(neonReauthUrl('/app/privacy')).toBe('/auth/reauth?returnTo=%2Fapp%2Fprivacy');
    expect(neonReauthUrl('//evil.test')).toBe('/auth/reauth?returnTo=%2Fapp');
  });
});
