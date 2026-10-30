import { describe, expect, it } from 'vitest';
import { hostingPlatform, isProductionSite } from './hosting';

function env(values: Record<string, string>): (name: string) => string | undefined {
  return (name) => values[name];
}

describe('hosting', () => {
  it('keeps the Vercel answers exactly as before: only VERCEL_ENV=production is production', () => {
    expect(isProductionSite(env({ VERCEL_ENV: 'production' }))).toBe(true);
    for (const where of ['preview', 'development']) {
      expect(isProductionSite(env({ VERCEL_ENV: where }))).toBe(false);
      // A stray Render marker never turns a Vercel preview into production.
      expect(isProductionSite(env({ VERCEL_ENV: where, HOSTING_PLATFORM: 'render' }))).toBe(false);
    }
    expect(hostingPlatform(env({ VERCEL_ENV: 'production' }))).toBe('vercel');
  });

  it('treats the Render fallback, marked HOSTING_PLATFORM=render, as the production site', () => {
    expect(hostingPlatform(env({ HOSTING_PLATFORM: 'render' }))).toBe('render');
    expect(isProductionSite(env({ HOSTING_PLATFORM: 'render' }))).toBe(true);
  });

  it('is never production on a laptop, in tests or with any other marker', () => {
    expect(hostingPlatform(env({}))).toBe('other');
    expect(isProductionSite(env({}))).toBe(false);
    for (const value of ['Render', 'true', 'vercel', '']) {
      expect(isProductionSite(env({ HOSTING_PLATFORM: value }))).toBe(false);
    }
  });
});
