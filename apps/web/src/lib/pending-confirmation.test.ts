import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  PENDING_CONFIRMATION_LIFETIME_S,
  decodePendingConfirmation,
  encodePendingConfirmation,
  maskEmail,
  pendingConfirmationCookieOptions,
} = await import('./pending-confirmation');

const NOW = new Date('2026-10-29T10:00:00Z');

beforeEach(() => {
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'x'.repeat(64));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the address waiting for confirmation, remembered in the browser', () => {
  it('comes back exactly as it was signed, until it expires', () => {
    const value = encodePendingConfirmation('Traveller@Example.com', NOW);
    expect(value).not.toBeNull();
    expect(decodePendingConfirmation(value ?? undefined, NOW)).toBe('Traveller@Example.com');
    const later = new Date(NOW.getTime() + (PENDING_CONFIRMATION_LIFETIME_S + 1) * 1000);
    expect(decodePendingConfirmation(value ?? undefined, later)).toBeNull();
  });

  it('refuses a value VisaStack did not sign, or one changed after signing', () => {
    const value = encodePendingConfirmation('a@example.com', NOW) ?? '';
    const [payload] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ e: 'b@example.com', x: 9e9 })).toString(
      'base64url',
    );
    expect(decodePendingConfirmation(`${forged}.${value.split('.')[1]}`, NOW)).toBeNull();
    expect(decodePendingConfirmation(`${payload}.not-the-signature`, NOW)).toBeNull();
    expect(decodePendingConfirmation(`${value}.extra`, NOW)).toBeNull();
    expect(decodePendingConfirmation('', NOW)).toBeNull();
    expect(decodePendingConfirmation(undefined, NOW)).toBeNull();
    // Signed under another secret: not ours.
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'y'.repeat(64));
    expect(decodePendingConfirmation(value, NOW)).toBeNull();
  });

  it('is not written at all without a proper secret, so the page simply asks for the address', () => {
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'short');
    expect(encodePendingConfirmation('a@example.com', NOW)).toBeNull();
  });

  it('shows the address masked, and the cookie is server-only and scoped to the sign-in pages', () => {
    expect(maskEmail('sadat@nitex.com')).toBe('s•••@nitex.com');
    expect(maskEmail('not-an-address')).toBe('•••');
    expect(pendingConfirmationCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/auth',
      maxAge: PENDING_CONFIRMATION_LIFETIME_S,
    });
  });
});
