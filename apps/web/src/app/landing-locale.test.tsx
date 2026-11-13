import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';

/*
 * The landing page's former split headings, step numbers and pilot sentence, and the site
 * header and footer, under both languages. English must render exactly as before; Bengali shows
 * only where the register has a passing draft, and held or undrafted words stay English.
 */

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'bn',
  generation: 0,
  beta: false,
  signedIn: false,
  pathname: '/' as string | null,
}));
vi.mock('../lib/locale', () => ({ getLocale: async () => state.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T extends (...args: never[]) => unknown>(build: T): T => {
    let seen = -1;
    let value: unknown;
    const cached = (...args: Parameters<T>) => {
      if (seen !== state.generation || args.length > 0) {
        seen = state.generation;
        value = build(...args);
      }
      return value;
    };
    return cached as unknown as T;
  },
}));
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => state.beta }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => state.signedIn }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(state.pathname ? { 'x-vs-pathname': state.pathname } : {}),
}));
vi.mock('../lib/version-notice-state', () => ({ hasSeenVersionNotice: async () => true }));
vi.mock('next/font/local', () => ({ default: () => ({ variable: 'synthetic-font' }) }));
vi.mock('../lib/deployment-mode', () => ({ getDeploymentMode: () => 'controlled_pilot' }));
vi.mock('../lib/language-choice', () => ({ LANGUAGE_CHOICE_ENABLED: true }));
vi.mock('./actions', () => ({ setLocaleAction: async () => undefined }));

import { authCatalog } from '../i18n/auth';
import { homeCatalog } from '../i18n/home';

const { default: HomePage } = await import('./page');
const { default: RootLayout } = await import('./layout');

const bn = homeCatalog.bn;
const SIGN_IN_BN = authCatalog.bn['auth.authSignInPage.signIn'];
const YEAR = new Date().getFullYear();
const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';
const bengaliNumber = (n: number) =>
  String(n).replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)] ?? d);

function next(locale: 'en' | 'bn', { beta = false, signedIn = false, pathname = '/' } = {}) {
  state.locale = locale;
  state.beta = beta;
  state.signedIn = signedIn;
  state.pathname = pathname;
  state.generation += 1;
}

async function page(locale: 'en' | 'bn', options: { beta?: boolean; signedIn?: boolean } = {}) {
  next(locale, options);
  return renderServer(HomePage({ searchParams: Promise.resolve({}) }));
}

async function shell(
  locale: 'en' | 'bn',
  options: { beta?: boolean; signedIn?: boolean; pathname?: string } = {},
) {
  next(locale, options);
  return renderServer(RootLayout({ children: <p>Page</p> }));
}

const header = (html: string) => /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
const footer = (html: string) => /<footer[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';

afterEach(() => next('en'));

describe('the landing page headings that used to be split by a line break', () => {
  it('render their exact old English and line breaks under en', async () => {
    const html = await page('en');
    for (const fragment of [
      '<p class="c1-phonename">Ready for<br/>what’s next.</p>',
      '<h3>Keep the details.<br/>Lose the repetition.</h3>',
      '<h3>See exactly<br/>what’s missing.</h3>',
      '<h3>Share the part.<br/>Not the whole.</h3>',
      '<h3>Yesterday stays<br/>yesterday.</h3>',
    ])
      expect(html, fragment).toContain(fragment);
    expect(html).not.toMatch(/\slang="/);
  });

  it('show the Bengali drafts as one marked line under bn', async () => {
    const html = await page('bn');
    expect(bn['home.page.readyForWhatSNext']).toBe('পরের ধাপের জন্য প্রস্তুত।');
    expect(bn['home.page.shareThePartNotTheWhole']).toBe('অংশ শেয়ার করুন। পুরোটা নয়।');
    expect(html).toContain(
      `<p class="c1-phonename" lang="bn">${bn['home.page.readyForWhatSNext']}</p>`,
    );
    expect(html).toContain(`<h3 lang="bn">${bn['home.page.shareThePartNotTheWhole']}</h3>`);
    expect(html).not.toContain('Ready for');
    expect(html).not.toContain('Share the part.');
  });

  it('keep the three headings with no Bengali draft in English, with their line breaks', async () => {
    const html = await page('bn');
    for (const key of [
      'home.page.keepTheDetailsLoseTheRepetition',
      'home.page.seeExactlyWhatSMissing',
      'home.page.yesterdayStaysYesterday',
    ] as const) {
      expect(key in bn, key).toBe(false);
      expect(html, key).toContain(`<h3>${homeCatalog.en[key].replaceAll('\n', '<br/>')}</h3>`);
    }
  });
});

describe('the step numbers', () => {
  it('read Step 1 to Step 3 under en', async () => {
    const text = textOf(await page('en'));
    for (const n of [1, 2, 3]) expect(text).toContain(`Step ${n} `);
  });

  it('use the Bengali word and Bengali digits under bn', async () => {
    const html = await page('bn');
    for (const n of [1, 2, 3])
      expect(html).toContain(`<span lang="bn">ধাপ ${bengaliNumber(n)}</span>`);
    expect(textOf(html)).not.toMatch(/Step \d/);
  });
});

describe('the "what works today" sentence, one message per state', () => {
  const PILOT =
    'VisaStack is in a private pilot, so some features are still being switched on. The status page shows what works today. Checking a file shows how complete it is, never a guess at your chances of approval.';
  const BETA =
    'VisaStack is in public beta, so some features are still being switched on. The status page shows what works today. Checking a file shows how complete it is, never a guess at your chances of approval.';

  it('reads exactly as before in both states under en', async () => {
    expect(textOf(await page('en'))).toContain(PILOT);
    expect(textOf(await page('en', { beta: true }))).toContain(BETA);
  });

  it('stays English under bn in both states (no Bengali draft yet)', async () => {
    expect('home.page.visastackIsInAPrivatePilot' in bn).toBe(false);
    expect('home.page.visastackIsInPublicBetaSo' in bn).toBe(false);
    expect(textOf(await page('bn'))).toContain(PILOT);
    expect(textOf(await page('bn', { beta: true }))).toContain(BETA);
  });
});

describe('the site header', () => {
  it('reads exactly as before under en, signed out and in public beta', async () => {
    const html = await shell('en', { beta: true });
    expect(html).toContain('<a class="skip-link" href="#main">Skip to Content</a>');
    const nav = header(html);
    for (const fragment of [
      '</svg>VisaStack</a>',
      'href="/#product">Product</a>',
      'href="/#for-agencies">For Agencies</a>',
      'href="/trust">Privacy and Control</a>',
      'href="/#how-it-works">How It Works</a>',
      'aria-label="Language"',
      'lang="bn">বাংলা</button>',
      'href="/app">Sign In</a>',
      'class="btn btn-primary nav-cta">Get Started</a>',
    ])
      expect(nav, fragment).toContain(fragment);
  });

  it('shows Workspace to a signed-in visitor under en', async () => {
    expect(header(await shell('en', { signedIn: true }))).toContain('href="/app">Workspace</a>');
  });

  it('shows the Bengali drafts under bn, marked as Bengali on an English page', async () => {
    const html = await shell('bn', { beta: true });
    expect(html).toContain(
      `<a class="skip-link" href="#main"><span lang="bn">${bn['home.layout.skipToContent']}</span></a>`,
    );
    const nav = header(html);
    for (const [href, key] of [
      ['/#product', 'home.layout.product'],
      ['/#for-agencies', 'home.page.forAgencies'],
      ['/#how-it-works', 'home.page.howItWorks'],
    ] as const)
      expect(nav, key).toContain(`href="${href}"><span lang="bn">${bn[key]}</span></a>`);
    expect(nav).toContain(
      `href="/auth/sign-up" class="btn btn-primary nav-cta"><span lang="bn">${bn['home.layout.getStarted']}</span></a>`,
    );
    expect(bn['home.layout.product']).toBe('প্রোডাক্ট');
    expect(bn['home.page.forAgencies']).toBe('এজেন্সির জন্য');
    expect(bn['home.layout.getStarted']).toBe('শুরু করুন');
    expect(bn['home.layout.skipToContent']).toBe('মূল বিষয়বস্তুতে যান');
    expect(nav).not.toMatch(/home\.(layout|page)\./);
  });

  it('keeps the undrafted form name in English under bn', async () => {
    const nav = header(await shell('bn'));
    expect('home.layout.language' in bn).toBe(false);
    expect(nav).toContain('aria-label="Language"');
  });

  it('shows the released privacy link in Bengali under bn (owner sign-off of the privacy queue)', async () => {
    expect(bn['home.layout.privacyAndControl']).toBe('গোপনীয়তা ও নিয়ন্ত্রণ');
    expect(header(await shell('bn'))).toContain(
      `href="/trust"><span lang="bn">${bn['home.layout.privacyAndControl']}</span></a>`,
    );
  });

  it('names Sign In exactly as the sign-in screen does under bn', async () => {
    expect(SIGN_IN_BN).toBe('সাইন ইন করুন');
    const html = await shell('bn');
    expect(header(html)).toContain(`href="/app"><span lang="bn">${SIGN_IN_BN}</span></a>`);
    expect(footer(html)).toContain(`href="/app"><span lang="bn">${SIGN_IN_BN}</span></a>`);
    expect(textOf(html)).not.toContain('Sign In');
  });

  it('keeps the product name and the English switch label as they are under bn', async () => {
    const nav = header(await shell('bn', { signedIn: true }));
    expect(nav).toContain('</svg>VisaStack</a>');
    expect(nav).toContain('lang="en">English</button>');
    expect(nav).toContain(`href="/app"><span lang="bn">${bn['home.layout.workspace']}</span></a>`);
    expect(bn['home.layout.workspace']).toBe('ওয়ার্কস্পেস');
  });

  it('marks the English that stays as English on a page marked Bengali', async () => {
    const html = await shell('bn', { pathname: '/auth/sign-in' });
    expect(footer(html)).toContain('href="/status"><span lang="en">Status</span></a>');
    expect(footer(html)).toContain('href="/trust"><span lang="en">Public Trust</span></a>');
    expect(header(html)).toContain(`href="/#product">${bn['home.layout.product']}</a>`);
    expect(header(html)).toContain(`href="/app">${SIGN_IN_BN}</a>`);
  });
});

describe('the site footer', () => {
  it('reads exactly as before under en', async () => {
    const foot = footer(await shell('en', { signedIn: true }));
    for (const fragment of [
      `<span>© ${YEAR} VisaStack. Proprietary and confidential.</span>`,
      'aria-label="Footer"',
      'href="/#capabilities">Features</a>',
      'href="/trust">Public Trust</a>',
      'href="/status">Status</a>',
      'href="/status#about-this-version">About This Version</a>',
      'href="/privacy">Privacy</a>',
      'href="/terms">Terms</a>',
      'href="/app">Workspace</a>',
    ])
      expect(foot, fragment).toContain(fragment);
  });

  it('shows the Bengali drafts under bn, with the year in Bengali digits', async () => {
    const foot = footer(await shell('bn'));
    expect(foot).toContain(
      `<span><span lang="bn">© ${bengaliNumber(YEAR)} VisaStack। মালিকানাধীন ও গোপনীয়।</span></span>`,
    );
    expect(foot).toContain(`aria-label="${bn['home.layout.footer']}"`);
    for (const [href, key] of [
      ['/#capabilities', 'home.layout.features'],
      ['/status#about-this-version', 'home.layout.aboutThisVersion'],
      ['/terms', 'home.layout.terms'],
      ['/privacy', 'home.layout.privacy'],
    ] as const)
      expect(foot, key).toContain(`href="${href}"><span lang="bn">${bn[key]}</span></a>`);
    expect(bn['home.layout.footer']).toBe('ফুটার');
    expect(bn['home.layout.features']).toBe('বৈশিষ্ট্য');
    expect(bn['home.layout.aboutThisVersion']).toBe('এই সংস্করণ সম্পর্কে');
    expect(bn['home.layout.terms']).toBe('শর্তাবলি');
    expect(bn['home.layout.privacy']).toBe('গোপনীয়তা');
    expect(foot).not.toMatch(/home\.(layout|page)\./);
  });

  it('keeps held and undrafted footer words in English under bn', async () => {
    const foot = footer(await shell('bn'));
    // Public Trust is held (its draft names the page differently from the page's own link);
    // Status has no draft.
    for (const key of ['home.layout.publicTrust', 'home.layout.status'] as const)
      expect(key in bn, key).toBe(false);
    for (const fragment of ['href="/trust">Public Trust</a>', 'href="/status">Status</a>'])
      expect(foot, fragment).toContain(fragment);
  });
});
