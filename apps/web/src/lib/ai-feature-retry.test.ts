import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_FEATURE_RETRY_LIFETIME_S,
  aiFeatureRetryCookieOptions,
  decodeAiFeatureRetry,
  encodeAiFeatureRetry,
} from './ai-feature-retry';

const NOW = new Date('2026-10-30T10:00:00Z');
const TYPED = { feature: 'ai_app_suggestions', enabled: false, dailyLimit: '' } as const;

beforeEach(() => {
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'x'.repeat(64));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the AI Features values kept across a fresh sign-in check', () => {
  it('come back as signed, for the same account only, until they expire', () => {
    const value = encodeAiFeatureRetry(TYPED, 'acct-1', NOW) ?? undefined;
    expect(decodeAiFeatureRetry(value, 'acct-1', NOW)).toEqual(TYPED);
    expect(decodeAiFeatureRetry(value, 'acct-2', NOW)).toBeNull();
    const later = new Date(NOW.getTime() + (AI_FEATURE_RETRY_LIFETIME_S + 1) * 1000);
    expect(decodeAiFeatureRetry(value, 'acct-1', later)).toBeNull();
  });

  it('refuses a changed value, another key, or no secret', () => {
    const value = encodeAiFeatureRetry(TYPED, 'acct-1', NOW) ?? '';
    const [payload, signature] = value.split('.');
    const changed = Buffer.from(
      JSON.stringify({ f: 'ai_app_suggestions', o: true, l: '', a: 'acct-1', x: 9e9 }),
    ).toString('base64url');
    expect(decodeAiFeatureRetry(`${changed}.${signature}`, 'acct-1', NOW)).toBeNull();
    expect(decodeAiFeatureRetry(`${payload}.${signature}.x`, 'acct-1', NOW)).toBeNull();
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'y'.repeat(64));
    expect(decodeAiFeatureRetry(value, 'acct-1', NOW)).toBeNull();
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', '');
    expect(encodeAiFeatureRetry(TYPED, 'acct-1', NOW)).toBeNull();
  });

  it('is httpOnly, short-lived and sent to the AI Features page only', () => {
    expect(aiFeatureRetryCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/app/admin/ai',
      maxAge: 900,
    });
  });
});
