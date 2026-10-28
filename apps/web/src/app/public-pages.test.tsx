import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));
// The client invitation page looks its link up in the database; these tests are about the handoff.
vi.mock('../lib/invitation-preview', () => ({
  loadClientInvitationPage: async () => ({ state: 'unavailable' }),
}));
// A signed-out visitor, without asking the sign-in service.
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => false }));

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
    expect(document.querySelector('h1')?.textContent).toBe('Terms of Use');
    expect(document.body.textContent).toContain('Account creation is free');
    expect(document.body.textContent).toContain('await legal review');
    expect([...document.querySelectorAll('h2')].map((h) => h.textContent)).toContain(
      'Visa Decisions',
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
    expect(document.body.textContent).toContain('Sign In');
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
    expect(document.body.textContent).toContain('Send the Link Again');
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
      expect(document.body.textContent).toContain('Opening this link accepts nothing');
      expect(html).toContain(encodeURIComponent(`${path}?token=${TOKEN}`));
      expect(document.querySelectorAll('h1')).toHaveLength(1);
    }
  });

  it('the invitation page shows nothing about the invitation when the link is incomplete', async () => {
    const { default: Invitation } = await import('./invitation/page');
    const document = dom(renderToStaticMarkup(await Invitation(SEARCH({ kind: 'team' }))));
    expect(document.querySelector('h1')?.textContent).toBe('Incomplete Invitation Link');
    expect(document.body.textContent).not.toContain('Opening this link');
  });

  it('sign-up shows where you are, puts the own-risk notice before the fields, and leaves consent unticked', async () => {
    const { default: SignUp } = await import('./auth/sign-up/page');
    const document = dom(renderToStaticMarkup(await SignUp(SEARCH())));
    const steps = document.querySelector('ol.auth-steps');
    expect(steps?.querySelector('[aria-current="step"]')?.textContent).toContain(
      'Create Your Account',
    );
    const notice = [...document.querySelectorAll('.notice')].find((n) =>
      n.textContent?.includes('at your own risk'),
    );
    const firstField = document.querySelector('input[name="name"]');
    expect(notice).toBeDefined();
    expect(notice && firstField && notice.compareDocumentPosition(firstField) & 4).toBeTruthy();
    const box = document.querySelector<HTMLInputElement>('input[name="acceptNotices"]');
    expect(box?.checked).toBe(false);
    expect(box?.required).toBe(true);
    expect(document.body.textContent).toContain(
      'This acknowledgement does not enable marketing, AI processing or sharing with an agency.',
    );
  });

  it('sign-in and confirm-email name the task and the step', async () => {
    const { default: SignIn } = await import('./auth/sign-in/page');
    const { default: Verify } = await import('./auth/verify-email/page');
    expect(dom(renderToStaticMarkup(await SignIn(SEARCH()))).querySelector('h1')?.textContent).toBe(
      'Sign In',
    );
    const verify = dom(renderToStaticMarkup(await Verify(SEARCH())));
    expect(verify.querySelector('[aria-current="step"]')?.textContent).toContain(
      'Confirm Your Email',
    );
  });

  it('the invitation page leads with the main action and the fact that nothing is accepted, then three steps', async () => {
    const { default: Invitation } = await import('./invitation/page');
    const document = dom(
      renderToStaticMarkup(await Invitation(SEARCH({ kind: 'client', token: TOKEN }))),
    );
    const text = document.body.textContent ?? '';
    const details = text.indexOf('What to Expect');
    expect(details).toBeGreaterThan(0);
    expect(text.indexOf('Create an Account to Review')).toBeLessThan(details);
    expect(text.indexOf('Opening this link accepts nothing')).toBeLessThan(details);
    expect(document.querySelectorAll('ol.invitation-steps li')).toHaveLength(3);
    expect(
      document.querySelector('ol.invitation-steps [aria-current="step"]')?.textContent,
    ).toContain('Sign In');
  });
});
