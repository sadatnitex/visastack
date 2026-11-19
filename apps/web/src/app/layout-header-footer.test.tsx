// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer } from '../lib/next-mocks.test-support';

const state = vi.hoisted(() => ({
  signedIn: false,
  languageChoice: true,
  locale: 'en',
  beta: true,
  mode: 'controlled_pilot',
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../lib/version-notice-state', () => ({ hasSeenVersionNotice: async () => false }));
vi.mock('next/font/local', () => ({ default: () => ({ variable: 'synthetic-font' }) }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => state.signedIn }));
vi.mock('../lib/locale', () => ({ getLocale: async () => state.locale }));
vi.mock('../lib/language-choice', () => ({
  get LANGUAGE_CHOICE_ENABLED() {
    return state.languageChoice;
  },
}));
vi.mock('../lib/deployment-mode', () => ({ getDeploymentMode: () => state.mode }));
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => state.beta }));
vi.mock('./actions', () => ({ setLocaleAction: async () => undefined }));
const { default: RootLayout } = await import('./layout');
const { LIVE_ROUTES, PUBLIC_NAV } = await import('../components/public-site/public-nav');

const APP = dirname(fileURLToPath(import.meta.url));

async function page(): Promise<Document> {
  const html = await renderServer(RootLayout({ children: <p>Page</p> }));
  return new DOMParser().parseFromString(html, 'text/html');
}
const texts = (list: Iterable<Element>) =>
  [...list].map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());

afterEach(() => {
  state.signedIn = false;
  state.languageChoice = true;
  state.locale = 'en';
  state.beta = true;
  state.mode = 'controlled_pilot';
  navigationState.pathname = '/';
});

describe('the header (NAV2)', () => {
  it('draws the brand, the five pages and the actions in one bar, in that order', async () => {
    const doc = await page();
    const bar = doc.querySelector('header.nav');
    expect(bar).not.toBeNull();
    const order = [...(bar?.children ?? [])].map((el) => el.className.split(' ')[0]);
    expect(order).toEqual(['brand', 'site-navigation']);
    const inner = [...(bar?.querySelector('.site-navigation')?.children ?? [])].map(
      (el) => el.className.split(' ')[0],
    );
    expect(inner).toEqual(['site-menu-panel', 'site-nav-actions', 'site-menu-toggle']);
    expect(texts(doc.querySelectorAll('.site-nav-pages a'))).toEqual(
      PUBLIC_NAV.map((entry) => entry.label),
    );
  });

  it('marks the current page with aria-current and no other page', async () => {
    for (const entry of PUBLIC_NAV) {
      navigationState.pathname = entry.route;
      const doc = await page();
      const current = doc.querySelectorAll('.site-nav-pages a[aria-current="page"]');
      expect(texts(current), entry.route).toEqual([entry.label]);
    }
    navigationState.pathname = '/trust/uk.standard-visitor';
    expect(
      texts((await page()).querySelectorAll('.site-nav-pages a[aria-current="page"]')),
    ).toEqual(['Privacy and Trust']);
    navigationState.pathname = '/privacy';
    expect((await page()).querySelectorAll('.site-nav-pages a[aria-current]').length).toBe(0);
  });

  it('has one filled action: Get Started, with Sign In quiet beside it and repeated in the menu', async () => {
    const doc = await page();
    const actions = doc.querySelector('.site-nav-actions');
    expect(texts(actions?.querySelectorAll('.btn-primary') ?? [])).toEqual(['Get Started']);
    expect(doc.querySelectorAll('header .btn-primary').length).toBe(1);
    const barSignIn = actions?.querySelector('a.nav-signin.site-bar-only');
    expect(barSignIn?.textContent).toBe('Sign In');
    expect(barSignIn?.getAttribute('href')).toBe('/app');
    expect(doc.querySelector('.site-menu-extras a.menu-signin')?.textContent).toBe('Sign In');
    expect(actions?.querySelector('button.lang-switch')).not.toBeNull();
    expect(doc.querySelectorAll('.lang-switch').length).toBe(1);
    // One hidden language field in the page (the bar's); the menu's button carries its own value.
    expect(doc.querySelectorAll('input[name="locale"]').length).toBe(1);
    const menuButton = doc.querySelector('.site-menu-extras .menu-lang');
    expect([menuButton?.getAttribute('name'), menuButton?.getAttribute('value')]).toEqual([
      'locale',
      'bn',
    ]);
    expect(doc.querySelector('.site-menu-extras .menu-lang')?.getAttribute('lang')).toBe('bn');
  });

  it('keeps Sign In as the only, filled action while sign-up is closed', async () => {
    state.beta = false;
    const doc = await page();
    expect(texts(doc.querySelectorAll('header .btn-primary'))).toEqual(['Sign In']);
    expect(doc.querySelector('header a[href="/auth/sign-up"]')).toBeNull();
    expect(doc.querySelector('.menu-signin')).toBeNull();
  });

  it('shows a signed-in person Workspace as the one action, once', async () => {
    state.signedIn = true;
    const doc = await page();
    expect(texts(doc.querySelectorAll('header .btn-primary'))).toEqual(['Workspace']);
    expect(texts(doc.querySelectorAll('header a[href="/app"]'))).toEqual(['Workspace']);
    expect(doc.querySelectorAll('.site-nav-pages a').length).toBe(5);
  });

  it('puts no language switch in the bar or the menu while the choice is off', async () => {
    state.languageChoice = false;
    const doc = await page();
    expect(doc.querySelector('.lang-switch, .menu-lang')).toBeNull();
  });

  it('keeps the menu button and the site landmark named, with the menu closed to start', async () => {
    const doc = await page();
    const button = doc.querySelector('button.site-menu-toggle');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.textContent).toContain('Menu');
    const panelId = button?.getAttribute('aria-controls') ?? '';
    expect(doc.getElementById(panelId)?.classList.contains('site-menu-panel')).toBe(true);
    expect(doc.querySelector('nav.nav-links')?.getAttribute('aria-label')).toBe('Site');
  });
});

describe('the footer (NAV2)', () => {
  const groups = async () => {
    const doc = await page();
    const out: Partial<Record<'Product' | 'Trust' | 'Account', string[]>> = {};
    for (const group of doc.querySelectorAll('footer .site-footer-group')) {
      const name = group.querySelector('.site-footer-heading')?.textContent ?? '';
      out[name as 'Product' | 'Trust' | 'Account'] = texts(group.querySelectorAll('a'));
    }
    return { doc, out };
  };

  it('groups its links as Product, Trust and Account, with the names the header uses', async () => {
    const { out } = await groups();
    expect(out).toEqual({
      Product: ['How It Works', 'Countries', 'For Agencies'],
      Trust: ['Privacy and Trust', 'Privacy', 'Terms', 'Status', 'About This Version'],
      Account: ['Sign In', 'Get Started'],
    });
  });

  it('offers Workspace, and no Get Started, to a signed-in person, and none while sign-up is closed', async () => {
    state.signedIn = true;
    expect((await groups()).out.Account).toEqual(['Workspace']);
    state.signedIn = false;
    state.beta = false;
    expect((await groups()).out.Account).toEqual(['Sign In']);
  });

  it('points every link at a page that exists', async () => {
    const { doc } = await groups();
    const links = [...doc.querySelectorAll('footer a[href]')];
    expect(links.length).toBeGreaterThan(10);
    for (const link of links) {
      const [path = '/', anchor] = (link.getAttribute('href') ?? '').split('#');
      const route = path || '/';
      const file = route === '/' ? 'page.tsx' : join(route.slice(1), 'page.tsx');
      if (route === '/app') continue; // the signed-in area, sent on to the sign-in provider
      expect(existsSync(join(APP, file)), `${route} has a page`).toBe(true);
      // Pages the header lists are the public ones that are live today.
      if (PUBLIC_NAV.some((entry) => entry.route === route)) {
        expect(LIVE_ROUTES.has(route), route).toBe(true);
      }
      if (anchor) expect(anchor).toBe('about-this-version');
    }
  });

  it('says what VisaStack is in one line and shows the version line from the page notice, word for word', async () => {
    const doc = await page();
    expect(doc.querySelector('.site-footer-about')?.textContent).toBe(
      'One private profile for every visa.',
    );
    expect(doc.querySelector('.site-footer-beta')?.textContent).toBe('VisaStack Public Beta');
    state.beta = false;
    expect((await page()).querySelector('.site-footer-beta')?.textContent).toBe(
      'VisaStack Private Pilot. Test version. Made-up details only.',
    );
  });

  it('makes no claim the product cannot back up', async () => {
    const doc = await page();
    const words = (doc.querySelector('footer')?.textContent ?? '').toLowerCase();
    for (const claim of [
      'certif',
      'complian',
      'bank-grade',
      'bank grade',
      'guarantee',
      'approval rate',
      'approved visas',
      'iso 27001',
      'soc 2',
      'gdpr',
      'users',
      'trusted by',
      'secure',
    ])
      expect(words, claim).not.toContain(claim);
  });

  it('ends with the copyright line', async () => {
    const doc = await page();
    expect(doc.querySelector('.site-footer-base > span')?.textContent).toMatch(
      /^© \d{4} VisaStack\. Proprietary and confidential\.$/,
    );
  });
});

describe('the stylesheet block (NAV2)', () => {
  it('keeps the public header and footer out of the signed-in app and the sign-in frame, above its own display rules', () => {
    const css = readFileSync(join(APP, 'globals.css'), 'utf8');
    const block = css.slice(css.indexOf('/* WP-NAV2 '), css.indexOf('/* end WP-NAV2 */'));
    expect(block.length).toBeGreaterThan(1000);
    // The header's own rules set display (grid, flex); without a rule that out-ranks them the
    // public header would draw above every signed-in page. The e2e appearance checks assert it hidden.
    for (const frame of ['.app-frame', '.auth-shell'])
      for (const part of ['.nav', '.footer'])
        expect(block).toContain(`html body:has(${frame}) > ${part}`);
    expect(block).toMatch(/html body:has\(\.auth-shell\) > \.footer \{\s*display: none;/);
  });

  it('writes the English and the Bengali menu rules as the same rules (they cannot drift apart)', () => {
    const css = readFileSync(join(APP, 'globals.css'), 'utf8');
    const block = css.slice(css.indexOf('/* WP-NAV2 '), css.indexOf('/* end WP-NAV2 */'));
    const rules = (width: string, guard: string) => {
      const start = block.indexOf(`@media (max-width: ${width}) {\n  ${guard} .nav {`);
      expect(start, width).toBeGreaterThan(-1);
      // The media block ends at the first line that closes it at column zero.
      const body = block.slice(start, block.indexOf('\n}\n', start));
      return body.replaceAll(`${guard} `, '').split('\n').slice(1).join('\n');
    };
    const english = rules('899.98px', 'html:not([data-locale="bn"])');
    const bengali = rules('899.98px', 'html[data-locale="bn"]');
    expect(english.length).toBeGreaterThan(1500);
    expect(bengali).toBe(english);
    // And each rule really carries its own language guard.
    expect(block.match(/html:not\(\[data-locale="bn"\]\) /g)?.length).toBeGreaterThan(10);
    expect(block.match(/html\[data-locale="bn"\] \.nav/g)?.length).toBeGreaterThan(0);
  });
});
