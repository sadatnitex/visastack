import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';

const state = vi.hoisted(() => ({
  signedIn: false,
  name: 'Asha' as string | null,
  locale: 'en',
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../lib/version-notice-state', () => ({ hasSeenVersionNotice: async () => true }));
vi.mock('next/font/local', () => ({ default: () => ({ variable: 'synthetic-font' }) }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => state.signedIn }));
vi.mock('../lib/public-account', () => ({ signedInFirstName: async () => state.name }));
vi.mock('../lib/locale', () => ({ getLocale: async () => state.locale }));
vi.mock('../lib/language-choice', () => ({ LANGUAGE_CHOICE_ENABLED: true }));
vi.mock('../lib/deployment-mode', () => ({ getDeploymentMode: () => 'controlled_pilot' }));
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => true }));
vi.mock('./actions', () => ({ setLocaleAction: async () => undefined }));
const { default: RootLayout } = await import('./layout');

const header = (html: string) => html.slice(html.indexOf('<header'), html.indexOf('</header>'));
const footer = (html: string) => html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
const render = () => renderServer(RootLayout({ children: <p>Page</p> }));

describe('the signed-in public header (NAV3)', () => {
  afterEach(() => {
    state.signedIn = false;
    state.name = 'Asha';
    state.locale = 'en';
  });

  it('shows a named round account button and its menu rows, beside the Workspace pill', async () => {
    state.signedIn = true;
    const nav = header(await render());
    expect(nav).toContain('record-account-public');
    expect(nav).toContain('aria-label="Asha, Account Menu"');
    expect(nav).toContain('href="/app">Workspace</a>');
    expect(nav).toContain('href="/app/account"');
    expect(textOf(nav)).toContain('Your Account');
    expect(textOf(nav)).toContain('Sign Out');
  });

  it('uses first name only and never the email', async () => {
    state.signedIn = true;
    state.name = 'Asha';
    const html = await render();
    expect(textOf(header(html))).toContain('Asha');
    expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  });

  it('Sign Out is a form button using the workspace sign-out action, never a link', async () => {
    state.signedIn = true;
    const nav = header(await render());
    const forms = [
      ...nav.matchAll(/<form[^>]*>(?:(?!<\/form>).)*Sign Out(?:(?!<\/form>).)*<\/form>/gs),
    ];
    // The account menu's form and the phone menu's copy.
    expect(forms.length).toBe(2);
    for (const [form] of forms) {
      expect(form).toContain('type="submit"');
      expect(form).not.toMatch(/method="get"/i);
    }
    expect(nav).not.toMatch(/<a[^>]*>\s*(?:<[^>]+>\s*)*Sign Out/);
    const source = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
    expect(source).toContain("'use server'");
    expect(source).toContain("signOutCurrentUser('/', form)");
  });

  it('adds the phone menu block with Workspace, Your Account and Sign Out', async () => {
    state.signedIn = true;
    const nav = header(await render());
    const block = nav.slice(nav.indexOf('menu-account'));
    expect(block).toContain('href="/app"');
    expect(block).toContain('href="/app/account"');
    expect(textOf(block)).toContain('Sign Out');
  });

  it('says every new label in Bangla', async () => {
    state.signedIn = true;
    state.locale = 'bn';
    const nav = header(await render());
    expect(textOf(nav)).toContain('সাইন আউট করুন');
    expect(textOf(nav)).toContain('আপনার অ্যাকাউন্ট');
    expect(nav).toContain('অ্যাকাউন্ট মেনু');
  });

  it('falls back to a plain account label when there is no first name', async () => {
    state.signedIn = true;
    state.name = null;
    const nav = header(await render());
    expect(nav).toContain('aria-label="Account, Account Menu"');
  });

  it('leaves the signed-out header without any account control', async () => {
    const html = await render();
    const nav = header(html);
    expect(nav).not.toContain('record-account-public');
    expect(nav).not.toContain('menu-account');
    expect(textOf(nav)).not.toContain('Sign Out');
    expect(nav).toContain('href="/app">Sign In</a>');
  });
});

describe('the footer account group follows the session (NAV3)', () => {
  afterEach(() => {
    state.signedIn = false;
  });
  it('signed in: Workspace and Sign Out, no sign-up', async () => {
    state.signedIn = true;
    const foot = footer(await render());
    expect(foot).toContain('href="/app">Workspace</a>');
    expect(foot).toContain('footer-signout');
    expect(textOf(foot)).toContain('Sign Out');
    expect(foot).not.toContain('/auth/sign-up');
  });
  it('signed out: unchanged, no Sign Out', async () => {
    const foot = footer(await render());
    expect(foot).toContain('href="/app">Sign In</a>');
    expect(textOf(foot)).not.toContain('Sign Out');
  });
});
