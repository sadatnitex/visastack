import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));

const SEARCH = (value: Record<string, string> = {}) => ({ searchParams: Promise.resolve(value) });
const TOKEN = 'A'.repeat(43);

beforeEach(() => {
  vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'test-only-cookie-key-with-at-least-thirty-two-characters');
  vi.stubEnv('PUBLIC_BETA_OPEN', 'false');
});
afterEach(() => vi.unstubAllEnvs());

const dom = (html: string) => new JSDOM(html).window.document;

/** Characterization of the public and entry pages, written before their redesign (Phase 9 and 10). */
describe('public and entry pages today', () => {
  it('terms of use keeps one top heading, the free-account line and the visa decisions section', async () => {
    const { default: Terms } = await import('./terms/page');
    const document = dom(renderToStaticMarkup(<Terms />));
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelector('h1')?.textContent).toBe('Terms of use');
    expect(document.body.textContent).toContain('Account creation is free');
    expect(document.body.textContent).toContain('await legal review');
    expect([...document.querySelectorAll('h2')].map((h) => h.textContent)).toContain(
      'Visa decisions',
    );
  });

  it('sign-in has one heading, a labelled email and password, and links to recovery and sign-up', async () => {
    const { default: SignIn } = await import('./auth/sign-in/page');
    const document = dom(renderToStaticMarkup(await SignIn(SEARCH())));
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelector('input[name="email"]')?.getAttribute('autocomplete')).toBe(
      'email',
    );
    expect(document.querySelector('input[name="password"]')?.getAttribute('type')).toBe('password');
    expect(document.querySelector('a[href="/auth/forgot-password"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Sign in');
  });

  it('sign-in says why it failed in words, and only after an attempt', async () => {
    const { default: SignIn } = await import('./auth/sign-in/page');
    const fresh = dom(renderToStaticMarkup(await SignIn(SEARCH())));
    expect(fresh.body.textContent).not.toContain('We could not sign you in');
    const failed = dom(renderToStaticMarkup(await SignIn(SEARCH({ e: 'failed' }))));
    expect(failed.body.textContent).toContain('We could not sign you in with those details');
  });

  it('confirm-email page offers to send the link again and a way back to sign-in', async () => {
    const { default: Verify } = await import('./auth/verify-email/page');
    const document = dom(renderToStaticMarkup(await Verify(SEARCH({ s: '1' }))));
    expect(document.querySelector('input[name="email"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Send the link again');
    expect(document.querySelector('a[href^="/auth/sign-in"]')).not.toBeNull();
  });

  it('forgot-password asks only for an email address', async () => {
    const { default: Forgot } = await import('./auth/forgot-password/page');
    const document = dom(renderToStaticMarkup(await Forgot(SEARCH())));
    expect(document.querySelector('input[name="email"]')).not.toBeNull();
    expect(document.querySelector('input[name="password"]')).toBeNull();
  });

  it('the invitation page accepts nothing and sends each kind to its own accept page after sign-in', async () => {
    const { default: Invitation } = await import('./invitation/page');
    for (const [kind, path] of [
      ['team', '/app/invitations/accept'],
      ['client', '/app/client-invitations/accept'],
      ['sharing', '/app/sharing-invitations/accept'],
    ] as const) {
      const html = renderToStaticMarkup(await Invitation(SEARCH({ kind, token: TOKEN })));
      const document = dom(html);
      expect(document.body.textContent).toContain('Opening the link does not accept it');
      expect(html).toContain(encodeURIComponent(`${path}?token=${TOKEN}`));
      expect(document.querySelectorAll('h1')).toHaveLength(1);
    }
  });

  it('the invitation page shows nothing about the invitation when the link is incomplete', async () => {
    const { default: Invitation } = await import('./invitation/page');
    const document = dom(renderToStaticMarkup(await Invitation(SEARCH({ kind: 'team' }))));
    expect(document.querySelector('h1')?.textContent).toBe('Incomplete invitation link');
    expect(document.body.textContent).not.toContain('Opening the link');
  });
});
