import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';
const state = vi.hoisted(() => ({
  signedIn: false,
  languageChoice: false,
  noticeSeen: false,
  locale: 'en',
  pathname: null as string | null,
  beta: true,
}));
vi.mock('../lib/page-language', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/page-language')>();
  // The real list plus one extra route is marked ready for this test file, so the Bangla result is exercised through the real layout.
  return {
    ...actual,
    pageLanguage: (locale: string, pathname: string | null) =>
      actual.pageLanguage(locale, pathname, [...actual.BN_READY_ROUTES, '/trust']),
  };
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
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => state.beta }));
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
  it('follows the real list: the sign-in screen is Bangla for a Bangla visitor and English for an English one', async () => {
    state.pathname = '/auth/sign-in';
    state.locale = 'bn';
    expect(htmlLang(await renderServer(RootLayout({ children: <p>Page</p> })))).toBe('bn');
    state.locale = 'en';
    expect(htmlLang(await renderServer(RootLayout({ children: <p>Page</p> })))).toBe('en');
  });
  it('records the chosen language for typography even when the page is marked English', async () => {
    state.locale = 'bn';
    state.pathname = '/status';
    const html = await renderServer(RootLayout({ children: <p>Page</p> }));
    expect(htmlLang(html)).toBe('en');
    expect(/<html[^>]*\bdata-locale="bn"/.test(html)).toBe(true);
    state.locale = 'en';
    expect(
      /<html[^>]*\bdata-locale="en"/.test(
        await renderServer(RootLayout({ children: <p>Page</p> })),
      ),
    ).toBe(true);
  });
  it('is Bangla for a Bangla visitor on a route marked ready, and only there', async () => {
    state.locale = 'bn';
    state.pathname = '/trust/uk';
    expect(htmlLang(await renderServer(RootLayout({ children: <p>Page</p> })))).toBe('bn');
    state.pathname = '/status';
    expect(htmlLang(await renderServer(RootLayout({ children: <p>Page</p> })))).toBe('en');
  });
});

const { PILOT_BANNER_COPY } = await import('../components/pilot-banner');
const { PUBLIC_NAV } = await import('../components/public-site/public-nav');

describe('the public site frame (WP-PUB1)', () => {
  afterEach(() => {
    state.signedIn = false;
    state.noticeSeen = false;
    state.beta = true;
    state.pathname = null;
  });
  const header = (html: string) => html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  const footer = (html: string) => html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));

  it('lists the five public pages in the header, for visitors and signed-in people alike', async () => {
    for (const signedIn of [false, true]) {
      state.signedIn = signedIn;
      const nav = header(await renderServer(RootLayout({ children: <p>Page</p> })));
      const labels = [...nav.matchAll(/<div class="site-nav-pages">(.*?)<\/div>/g)][0]?.[1] ?? '';
      expect(textOf(labels).replace(/\s+/g, '')).toBe(
        PUBLIC_NAV.map((entry) => entry.label.replace(/\s+/g, '')).join(''),
      );
      expect(nav).toContain(signedIn ? 'href="/app">Workspace</a>' : 'href="/app">Sign In</a>');
      // The home page's country picker is only drawn for visitors.
      expect(nav).toContain(
        signedIn ? 'href="/app/countries">Countries</a>' : 'href="/#start">Countries</a>',
      );
    }
  });

  it('keeps every footer link it had before', async () => {
    const foot = footer(await renderServer(RootLayout({ children: <p>Page</p> })));
    for (const fragment of [
      'href="/#capabilities">Features</a>',
      'href="/trust">Public Trust</a>',
      'href="/status">Status</a>',
      'href="/status#about-this-version">About This Version</a>',
      'href="/privacy">Privacy</a>',
      'href="/terms">Terms</a>',
      'href="/app">Sign In</a>',
    ])
      expect(foot, fragment).toContain(fragment);
  });

  // Every public route that exists today, plus the pages the new header adds later.
  const PUBLIC_ROUTES = [
    '/',
    '/trust',
    '/privacy',
    '/terms',
    '/status',
    '/invitation',
    '/auth/sign-in',
    '/auth/sign-up',
    '/pilot-access-denied',
  ];
  it('shows the pilot notice with its exact words on every public route', async () => {
    const pilot = PILOT_BANNER_COPY.controlled_pilot;
    for (const pathname of PUBLIC_ROUTES) {
      state.pathname = pathname;
      state.beta = false;
      const text = textOf(await renderServer(RootLayout({ children: <p>Page</p> })));
      expect(text, pathname).toContain(pilot.label);
      expect(text, pathname).toContain(pilot.detail);
      state.beta = true;
      const beta = textOf(await renderServer(RootLayout({ children: <p>Page</p> })));
      expect(beta, pathname).toContain('VisaStack Public Beta');
      expect(beta, pathname).toContain(
        'Free to use at your own risk. Some protections, such as virus scanning of uploads, are not switched on yet.',
      );
    }
    expect(pilot.detail).toBe(
      'Invite-only test version. Please use made-up details, or documents with all personal information permanently blacked out.',
    );
  });
});
