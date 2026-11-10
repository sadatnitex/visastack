import { describe, expect, it } from 'vitest';
import {
  CONFIRMED_PATH,
  confirmedCallbackUrl,
  confirmedLandingDecision,
  confirmedSignInFallback,
  confirmedSignedInDestination,
  neonLoginUrlFor,
} from './confirmed-landing';

const INVITE = '/app/invitations/accept?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HOSTILE = [
  'https://evil.example/steal',
  '//evil.example/steal',
  '/\\evil.example',
  'javascript:alert(1)',
  '/app\r\nSet-Cookie: x=1',
  '',
  'app',
];

describe('what happens after the confirmation link', () => {
  it('sends a signed-in person to the ordinary home with the one-time confirmed line', () => {
    expect(confirmedLandingDecision({ signedIn: true, next: undefined })).toBe('/app?confirmed=1');
    expect(confirmedLandingDecision({ signedIn: true, next: '/app' })).toBe('/app?confirmed=1');
  });

  it('keeps the task they came for, unchanged, when signed in', () => {
    expect(confirmedLandingDecision({ signedIn: true, next: INVITE })).toBe(INVITE);
  });

  it("sends a person with no sign-in to today's sign-in form with the confirmed line", () => {
    expect(confirmedLandingDecision({ signedIn: false, next: undefined })).toBe(
      '/auth/sign-in?n=confirmed',
    );
    expect(confirmedLandingDecision({ signedIn: false, next: INVITE })).toBe(
      `/auth/sign-in?n=confirmed&next=${encodeURIComponent(INVITE)}`,
    );
  });

  it('falls back to the safe default for every unsafe destination, signed in or not', () => {
    for (const next of HOSTILE) {
      expect(confirmedLandingDecision({ signedIn: true, next }), next).toBe('/app?confirmed=1');
      expect(confirmedLandingDecision({ signedIn: false, next }), next).toBe(
        '/auth/sign-in?n=confirmed',
      );
      expect(confirmedSignedInDestination(next), next).not.toContain('evil');
      expect(confirmedSignInFallback(next), next).not.toContain('evil');
    }
  });

  it('never puts an email address in any address it builds', () => {
    const email = 'someone@example.test';
    const built = [
      confirmedCallbackUrl('https://app.example.test', INVITE),
      confirmedLandingDecision({ signedIn: true, next: INVITE }),
      confirmedLandingDecision({ signedIn: false, next: INVITE }),
      neonLoginUrlFor(CONFIRMED_PATH, `?next=${encodeURIComponent(INVITE)}`),
    ];
    for (const url of built) {
      expect(url).not.toContain(email);
      expect(url).not.toContain('@');
    }
  });
});

describe('the address Neon Auth sends the browser to', () => {
  it('is the landing page, with a validated destination only when it is not the home', () => {
    expect(confirmedCallbackUrl('https://app.example.test', '/app')).toBe(
      'https://app.example.test/auth/confirmed',
    );
    expect(confirmedCallbackUrl('https://app.example.test', INVITE)).toBe(
      `https://app.example.test/auth/confirmed?next=${encodeURIComponent(INVITE)}`,
    );
    expect(confirmedCallbackUrl('https://app.example.test', '//evil.example')).toBe(
      'https://app.example.test/auth/confirmed',
    );
  });
});

describe('where the sign-in check sends a visitor with no session', () => {
  it('keeps the confirmed line and the validated destination on the landing path', () => {
    expect(neonLoginUrlFor(CONFIRMED_PATH, '')).toBe('/auth/sign-in?n=confirmed');
    expect(neonLoginUrlFor(CONFIRMED_PATH, `?next=${encodeURIComponent(INVITE)}`)).toBe(
      `/auth/sign-in?n=confirmed&next=${encodeURIComponent(INVITE)}`,
    );
    expect(neonLoginUrlFor(CONFIRMED_PATH, '?next=https%3A%2F%2Fevil.example')).toBe(
      '/auth/sign-in?n=confirmed',
    );
  });

  it('is unchanged for every other protected page', () => {
    expect(neonLoginUrlFor('/app/privacy', '?x=1')).toBe(
      `/auth/sign-in?next=${encodeURIComponent('/app/privacy?x=1')}`,
    );
  });
});
