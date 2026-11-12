import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

import { authCatalog } from '../../i18n/auth';
import ForgotPasswordPage from './forgot-password/page';
import SignInPage from './sign-in/page';
import SignUpPage from './sign-up/page';

const BENGALI = /[ঀ-৿]/;

async function render(page: 'in' | 'up' | 'forgot'): Promise<Document> {
  current.holder = null;
  const searchParams = Promise.resolve({});
  const element =
    page === 'in'
      ? await SignInPage({ searchParams })
      : page === 'up'
        ? await SignUpPage({ searchParams })
        : await ForgotPasswordPage({ searchParams });
  return new JSDOM(renderToStaticMarkup(element)).window.document;
}

beforeEach(() => {
  vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'test-only-cookie-key-with-at-least-thirty-two-characters');
});
afterEach(() => {
  vi.unstubAllEnvs();
  current.locale = 'en';
});

// Not asserted here: that nothing inside these screens sets a lang other than bn. English fallback
// text (a key with no Bengali) currently sits inside lang="bn", which fails WCAG 3.1.2. A separate
// programme-level package will mark such fallbacks lang="en"; the rule belongs there, not in this pilot.
describe('auth screens under Bengali', () => {
  it('shows the Bengali drafts on sign-in and sign-up, and English where a key has no Bengali', async () => {
    current.locale = 'bn';
    const signIn = await render('in');
    const signUp = await render('up');
    expect(signIn.querySelector('button[type="submit"]')?.textContent).toBe(
      authCatalog.bn['auth.authSignInPage.signIn'],
    );
    expect(signIn.querySelector('button[type="submit"]')?.textContent).toMatch(BENGALI);
    expect(signIn.body.textContent).toContain(
      authCatalog.bn['auth.authSignInPage.forgotYourPassword'],
    );
    expect(signUp.body.textContent).toMatch(BENGALI);
    // These two shared-shell keys have no Bengali yet, so English must show instead of a key.
    expect('auth.authAuthUi.visastack' in authCatalog.bn).toBe(false);
    expect('auth.authAuthUi.youStayInControlOfYour' in authCatalog.bn).toBe(false);
    // Held back in English (scripts/i18n/register.mjs HOLDBACK, and the privacy, consent and legal
    // queue until the owner signs it off).
    for (const key of [
      'auth.authAuthUi.privacy',
      'auth.authAuthUi.terms',
      'auth.authSignUpPage.visastackIsAFreePublicBeta',
      'auth.authSignUpPage.thisAcknowledgementDoesNotEnableMarketing',
    ]) {
      expect(key in authCatalog.bn, key).toBe(false);
      expect(signUp.body.textContent ?? '').toContain(
        authCatalog.en[key as keyof typeof authCatalog.en] ?? 'MISSING',
      );
    }
    for (const doc of [signIn, signUp]) {
      expect(doc.body.textContent).toContain('Privacy');
      expect(doc.body.textContent).toContain(
        authCatalog.en['auth.authAuthUi.youStayInControlOfYour'],
      );
      expect(doc.body.textContent).not.toMatch(/auth\.auth[A-Za-z]+\./);
    }
  });

  it('shows the Bengali drafts on forgot-password', async () => {
    current.locale = 'bn';
    const doc = await render('forgot');
    expect(doc.body.textContent).toContain(
      authCatalog.bn['auth.authForgotPasswordPage.sendMeALink'],
    );
  });

  it('leaves no raw placeholder in any Bengali string', () => {
    for (const [key, text] of Object.entries(authCatalog.bn)) {
      expect(text, key).not.toMatch(/\{[^}]*\}/);
    }
  });
});

describe('auth screens under English', () => {
  it('render the original English text', async () => {
    current.locale = 'en';
    const signIn = await render('in');
    expect(signIn.querySelector('button[type="submit"]')?.textContent).toBe('Sign In');
    expect(signIn.body.textContent).toContain('Forgot your password?');
    expect(signIn.body.textContent).not.toMatch(BENGALI);
    const signUp = await render('up');
    expect(signUp.body.textContent).not.toMatch(BENGALI);
    expect((await render('forgot')).body.textContent).not.toMatch(BENGALI);
  });
});
