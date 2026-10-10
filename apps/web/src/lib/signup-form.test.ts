import { SIGNUP_FORM_LIFETIME_MS } from '@visastack/services';

// Next owns this SDK's request context. Keep configuration and signing real in these tests.
vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const publicDb = vi.fn();
vi.mock('./public-db', () => ({ withPublicDb: (fn: unknown) => publicDb(fn) }));
vi.mock('./server-error', () => ({ reportServerError: vi.fn() }));

beforeEach(() => {
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'test-only-cookie-key-with-at-least-thirty-two-characters');
  vi.clearAllMocks();
});

describe('signed signup forms', () => {
  it('creates separate forms and accepts an intact signature only during its lifetime', async () => {
    const { createSignupForm, readSignupForm } = await import('./signup-form');
    const now = Date.now();
    const token = createSignupForm(now);
    expect(readSignupForm(token, now)?.expiresAt).toBe(now + SIGNUP_FORM_LIFETIME_MS);
    expect(createSignupForm(now)).not.toBe(token);
    expect(readSignupForm(token, now - 1)).toBeNull();
    expect(readSignupForm(token, now + SIGNUP_FORM_LIFETIME_MS)).toBeNull();
  });

  it('rejects forged, tampered and oversized tokens', async () => {
    const { createSignupForm, readSignupForm } = await import('./signup-form');
    const now = Date.now();
    const token = createSignupForm(now);
    const [payload, mac] = token.split('.');
    for (const bad of [
      '',
      `${payload}.invalid`,
      `${payload}x.${mac}`,
      `${token}.extra`,
      'x'.repeat(1025),
    ]) {
      expect(readSignupForm(bad, now)).toBeNull();
    }
    vi.stubEnv(
      'NEON_AUTH_COOKIE_SECRET',
      'different-test-only-cookie-key-with-thirty-two-characters',
    );
    expect(readSignupForm(token, now)).toBeNull();
  });

  it('fails closed when the acknowledgement store is unavailable', async () => {
    const { createSignupForm, readSignupForm, consumeSignupForm } = await import('./signup-form');
    const input = readSignupForm(createSignupForm());
    if (!input) throw new Error('test form was not valid');
    publicDb.mockRejectedValue(new Error('database unavailable'));
    expect(await consumeSignupForm(input)).toBe(false);
  });
});
