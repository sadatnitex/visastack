import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
// The locale is set here directly, as the auth screens' test does.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', generation: 0, betaOpen: false }));
vi.mock('../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
// Each cached function keeps its own result, per request.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T extends (...args: never[]) => unknown>(build: T): T => {
    let seen = -1;
    let value: unknown;
    const cached = (...args: Parameters<T>) => {
      if (seen !== current.generation || args.length > 0) {
        seen = current.generation;
        value = build(...args);
      }
      return value;
    };
    return cached as unknown as T;
  },
}));
vi.mock('../lib/request-path', () => ({ requestedPath: async () => '/' }));
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => current.betaOpen }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => false }));

import { homeCatalog } from '../i18n/home';
import { LANDING_MESSAGES } from '../i18n/landing-messages';

const { default: HomePage } = await import('./page');

/** Released messages this render does not show: the family steps and announcements (after a toggle) and the live-mode line. */
const NOT_YET = new Set([
  'landing.plan.familyCopiesLead',
  'landing.plan.familyCopiesBody',
  'landing.plan.announceSelf',
  'landing.plan.announceFamily',
  'landing.status.live',
  'landing.account.create',
  'landing.account.workspace',
]);

const BENGALI = /[\u0980-\u09FF]/;
const LATIN = /[A-Za-z]{2,}/;

async function renderHtml(locale: 'en' | 'bn') {
  current.locale = locale;
  current.generation += 1;
  return renderServer(HomePage({ searchParams: Promise.resolve({}) }));
}
async function render(locale: 'en' | 'bn') {
  return textOf(await renderHtml(locale));
}

describe('the home page under English (LAND1)', () => {
  it('reads in English, with no Bengali and no raw keys or tokens', async () => {
    const text = await render('en');
    expect(text).toContain('Your visa paperwork, in order.');
    expect(text).toContain('Sign in to get started');
    expect(text).not.toMatch(BENGALI);
    expect(text).not.toMatch(/landing\.|home\.page\./);
    expect(text).not.toMatch(/\{(link|country)\}/);
  });

  it('carries no language mark at all, as before', async () => {
    const html = await renderHtml('en');
    expect(html).not.toMatch(/ lang="/);
  });
});

describe('the home page under Bengali (LAND1)', () => {
  beforeEach(() => vi.stubEnv('DEPLOYMENT_MODE', 'controlled_pilot'));
  afterEach(() => vi.unstubAllEnvs());

  it('shows the whole page in Bengali: every released message, in each section', async () => {
    const html = await renderHtml('bn');
    const live = Object.entries(LANDING_MESSAGES).filter(([, m]) => m.live);
    expect(live.length).toBeGreaterThan(70);
    for (const [key, message] of live) {
      // Messages with a placeholder are shown elsewhere (plan title and guide link need a choice).
      if (message.bn.includes('{')) continue;
      // Shown only after a choice or in another deployment mode.
      if (NOT_YET.has(key)) continue;
      // The status reassurance and answers of the other modes are not on this page.
      expect(html, key).toContain(message.bn);
    }
    const text = textOf(html);
    expect(text).not.toMatch(/landing\.|home\.page\./);
    expect(text).not.toMatch(/\{(link|country)\}/);
  });

  it('names the destinations in Bengali and sends the English name', async () => {
    const html = await renderHtml('bn');
    const options = [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(
      (m) => [m[1], m[2]],
    );
    expect(options).toEqual([
      ['', 'গন্তব্য বেছে নিন'],
      ['Japan', 'জাপান'],
      ['Singapore', 'সিঙ্গাপুর'],
      ['United Kingdom', 'যুক্তরাজ্য'],
      ['Canada', 'কানাডা'],
      ['Germany', 'জার্মানি'],
      ['Australia', 'অস্ট্রেলিয়া'],
    ]);
    // The no-script path is unchanged: a plain GET with the English country name.
    expect(html).toMatch(/<form[^>]*action="\/countries"[^>]*method="get"/);
    expect(html).toMatch(/<select[^>]*name="q"/);
  });

  it('holds the claim, authority, status and example wording in English, marked English', async () => {
    const doc = new JSDOM(await renderHtml('bn')).window.document;
    // The words that are really in English: a Bengali part nested inside (a link in an English
    // sentence) names its own language, so it is left out of what is counted as English.
    const englishWords = (el: Element) => {
      const copy = el.cloneNode(true) as Element;
      for (const inner of copy.querySelectorAll('[lang="bn"]')) inner.remove();
      return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    };
    const marked = [...doc.querySelectorAll('[lang="en"]')].map(englishWords);
    const heldEnglish = Object.entries(LANDING_MESSAGES)
      .filter(([, m]) => !m.live)
      .map(([, m]) => m.en);
    // Every held message that this page state shows is there in English...
    for (const en of [
      LANDING_MESSAGES['landing.hero.lead'].en,
      LANDING_MESSAGES['landing.plan.intro'].en,
      LANDING_MESSAGES['landing.assurance.shareText'].en,
      LANDING_MESSAGES['landing.case.foot'].en,
      LANDING_MESSAGES['landing.faq.a4'].en,
    ])
      expect(
        marked.some((text) => text.includes(en)),
        en,
      ).toBe(true);
    // ...and nothing marked English is Bengali.
    for (const text of marked) expect(text).not.toMatch(BENGALI);
    expect(heldEnglish.length).toBeGreaterThan(5);
  });

  it('leaves no unmarked English: every Latin-letter text is the product name or marked lang="en"', async () => {
    const doc = new JSDOM(await renderHtml('bn')).window.document;
    const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    const loose: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      const parent = node.parentElement;
      if (!text || !parent || parent.closest('script, style')) continue;
      const bare = text.replaceAll('VisaStack', '').trim();
      if (!LATIN.test(bare)) continue;
      if (BENGALI.test(text)) continue;
      if (parent.closest('[lang="en"]')) continue;
      loose.push(text);
    }
    expect(loose).toEqual([]);
  });

  it('shows the status wording of the deployment in Bengali only once it is released', async () => {
    const text = await render('bn');
    // Held: the pilot reassurance stays English (marked), so no Bengali pilot sentence is shown yet.
    expect(text).toContain(LANDING_MESSAGES['landing.status.pilot'].en);
    expect(text).not.toContain(LANDING_MESSAGES['landing.status.pilot'].bn);
    expect(text).not.toContain(
      LANDING_MESSAGES['landing.faq.a5Pilot'].bn.split('{link}')[0] ?? 'x',
    );
  });

  it('keeps the sign-in button Bengali where the catalogue has Bengali', async () => {
    expect(await render('bn')).toContain('শুরু করতে সাইন ইন করুন');
  });

  it('shows the risk notice in Bengali while the public beta is open', async () => {
    current.betaOpen = true;
    try {
      const key = 'home.page.itIsFreeToUseAt' as const;
      const text = await render('bn');
      expect(text).toContain(homeCatalog.bn[key] ?? homeCatalog.en[key]);
      expect(text).toContain(LANDING_MESSAGES['landing.account.create'].bn);
    } finally {
      current.betaOpen = false;
    }
  });

  it('has no raw placeholder in any Bengali string', () => {
    for (const [key, value] of Object.entries(homeCatalog.bn)) {
      const bare = value.replace(/\{[A-Za-z]+\}/g, '');
      expect(bare, key).not.toMatch(/[{}]/);
    }
  });
});
