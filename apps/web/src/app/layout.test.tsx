import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';
const state = vi.hoisted(() => ({
  signedIn: false,
  languageChoice: false,
  noticeSeen: false,
  locale: 'en',
  pathname: null as string | null,
}));
vi.mock('../lib/page-language', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/page-language')>();
  // One route is marked ready for this test file, so the Bangla result is exercised through the real layout.
  return { ...actual, BN_READY_ROUTES: ['/trust'] };
});
vi.mock('next/headers', () => ({
  headers: async () => new Headers(state.pathname ? { 'x-vs-pathname': state.pathname } : {}),
}));
vi.mock('../lib/version-notice-state', () => ({
  hasSeenVersionNotice: async () => state.noticeSeen,
}));
vi.mock('next/font/local', () => ({ default: () => ({ variable: 'synthetic-font' }) }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => state.signedIn }));
vi.mock('../lib/locale', () => ({ getLocale: async () => state.locale }));
vi.mock('../lib/language-choice', () => ({
  get LANGUAGE_CHOICE_ENABLED() {
    return state.languageChoice;
  },
}));
vi.mock('../lib/deployment-mode', () => ({ getDeploymentMode: () => 'controlled_pilot' }));
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => true }));
vi.mock('./actions', () => ({ setLocaleAction: async () => undefined }));
const { default: RootLayout } = await import('./layout');
describe('public beta notice audience', () => {
  it('retains the public notice for a signed-out visitor', async () => {
    state.signedIn = false;
    expect(textOf(await renderServer(RootLayout({ children: <p>Public page</p> })))).toContain(
      'Free to use at your own risk.',
    );
  });
  it('does not render the notice for a signed-in user', async () => {
    state.signedIn = true;
    const html = await renderServer(RootLayout({ children: <p>Signed-in page</p> }));
    expect(html).not.toContain('pilot-banner');
    expect(textOf(html)).not.toContain('Free to use at your own risk.');
  });
});
describe('the notice is shown in full once per visitor (owner list item 17)', () => {
  it('folds to the slim label once this device has seen it, and keeps the footer link', async () => {
    state.signedIn = false;
    state.noticeSeen = false;
    let html = await renderServer(RootLayout({ children: <p>First page</p> }));
    expect(html).toContain('class="pilot-banner"');
    expect(html).toContain('href="/status#about-this-version"');
    state.noticeSeen = true;
    html = await renderServer(RootLayout({ children: <p>Next page</p> }));
    // Every page still says which version this is, as a slim label with the link.
    expect(html).toContain('class="pilot-banner pilot-banner-slim"');
    expect(textOf(html)).toContain('VisaStack Public Beta');
    expect(textOf(html)).not.toContain('Free to use at your own risk.');
    expect(html).toContain('href="/status#about-this-version"');
    expect(textOf(html)).toContain('About This Version');
    state.noticeSeen = false;
  });
});
describe('the language switch', () => {
  const BANGLA = 'বাংলা';
  it('is hidden when language choice is switched off (rollback state)', async () => {
    state.languageChoice = false;
    const html = await renderServer(RootLayout({ children: <p>Page</p> }));
    expect(html).not.toContain('lang-switch');
    expect(html).not.toContain(BANGLA);
    expect(html).not.toContain('aria-label="Language"');
  });
  it('comes back as it was when the one setting is turned on', async () => {
    state.languageChoice = true;
    const html = await renderServer(RootLayout({ children: <p>Page</p> }));
    expect(html).toContain('class="lang-switch"');
    expect(html).toContain(`lang="bn">${BANGLA}</button>`);
    state.languageChoice = false;
  });
});
describe('the page language (WCAG 3.1.2)', () => {
  afterEach(() => {
    state.locale = 'en';
    state.pathname = null;
  });
  const htmlLang = (html: string) => /<html[^>]*\blang="([^"]*)"/.exec(html)?.[1];
  it('stays English for a Bangla visitor on a page that is not translated yet', async () => {
    state.locale = 'bn';
    state.pathname = '/status';
    const html = await renderServer(RootLayout({ children: <p>Page</p> }));
    expect(htmlLang(html)).toBe('en');
  });
  it('is English when the page address is missing', async () => {
    state.locale = 'bn';
    state.pathname = null;
    expect(htmlLang(await renderServer(RootLayout({ children: <p>Page</p> })))).toBe('en');
  });
  it('is English for an English visitor', async () => {
    state.pathname = '/status';
    expect(htmlLang(await renderServer(RootLayout({ children: <p>Page</p> })))).toBe('en');
  });
  it('is Bangla for a Bangla visitor on a route marked ready, and only there', async () => {
    state.locale = 'bn';
    state.pathname = '/trust/uk';
    expect(htmlLang(await renderServer(RootLayout({ children: <p>Page</p> })))).toBe('bn');
    state.pathname = '/status';
    expect(htmlLang(await renderServer(RootLayout({ children: <p>Page</p> })))).toBe('en');
  });
});
