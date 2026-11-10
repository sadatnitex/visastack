import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONFIRMED_PATH,
  confirmedCallbackNext,
  confirmedFailedDestination,
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
      confirmedCallbackNext(INVITE),
      confirmedFailedDestination(INVITE),
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

describe('the landing address Neon Auth sends the browser to', () => {
  it('always carries the validated destination, the home when there is none or it is unsafe', () => {
    expect(confirmedCallbackNext('/app')).toBe('%2Fapp');
    expect(confirmedCallbackNext(undefined)).toBe('%2Fapp');
    expect(confirmedCallbackNext(INVITE)).toBe(encodeURIComponent(INVITE));
    expect(confirmedCallbackNext('//evil.example')).toBe('%2Fapp');
    expect(confirmedCallbackNext('https://evil.example')).toBe('%2Fapp');
  });
});

describe('a link that failed (expired or already used)', () => {
  it('asks for a new link and never says the email is confirmed, signed in or not', () => {
    for (const signedIn of [true, false]) {
      expect(confirmedLandingDecision({ signedIn, next: undefined, failed: true })).toBe(
        '/auth/verify-email?e=expired',
      );
      expect(confirmedLandingDecision({ signedIn, next: INVITE, failed: true })).toBe(
        `/auth/verify-email?e=expired&next=${encodeURIComponent(INVITE)}`,
      );
      expect(
        confirmedLandingDecision({ signedIn, next: 'https://evil.example', failed: true }),
      ).toBe('/auth/verify-email?e=expired');
    }
  });
});

describe('a repeated or odd address parameter', () => {
  it('is refused like any unsafe destination instead of failing', () => {
    for (const next of [['/app/a', '/app/b'], 42, {}, null]) {
      expect(confirmedLandingDecision({ signedIn: true, next })).toBe('/app?confirmed=1');
      expect(confirmedLandingDecision({ signedIn: false, next })).toBe('/auth/sign-in?n=confirmed');
    }
  });
});

describe('where the sign-in check sends a visitor with no session', () => {
  it('spells out the validated destination so the raw one is never copied back', () => {
    expect(neonLoginUrlFor(CONFIRMED_PATH, '')).toBe('/auth/sign-in?n=confirmed&next=%2Fapp');
    expect(neonLoginUrlFor(CONFIRMED_PATH, `?next=${encodeURIComponent(INVITE)}`)).toBe(
      `/auth/sign-in?n=confirmed&next=${encodeURIComponent(INVITE)}`,
    );
    expect(neonLoginUrlFor(CONFIRMED_PATH, '?next=https%3A%2F%2Fevil.example')).toBe(
      '/auth/sign-in?n=confirmed&next=%2Fapp',
    );
  });

  it('sends a failed link to ask for a new one', () => {
    expect(neonLoginUrlFor(CONFIRMED_PATH, '?error=token_expired')).toBe(
      '/auth/verify-email?e=expired',
    );
  });

  it('is unchanged for every other protected page', () => {
    expect(neonLoginUrlFor('/app/privacy', '?x=1')).toBe(
      `/auth/sign-in?next=${encodeURIComponent('/app/privacy?x=1')}`,
    );
  });
});

describe('the request filter can load this file', () => {
  it('imports nothing that the edge runtime cannot compile', () => {
    // middleware.ts loads confirmed-landing.ts; a server-only module or node:crypto in its import
    // graph fails the production build (the unit tests alone would not notice).
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of ['confirmed-landing.ts', 'safe-return-path.ts']) {
      const source = readFileSync(join(here, file), 'utf8');
      const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
      for (const spec of imports)
        expect(spec, `${file} imports ${spec}`).toBe('./safe-return-path');
      expect(source).not.toMatch(/server-only|node:/);
    }
  });
});
