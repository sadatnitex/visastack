import { JSDOM } from 'jsdom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../components/i18n-provider';
import { liveClientDrafts } from '../i18n/public-lookup';
import { renderServer } from '../lib/next-mocks.test-support';

/**
 * LAND2: what a Bengali visitor reads on each public page, rendered for real. For every page: the
 * page is a Bengali page, its ordinary words are Bengali, the wording held for review is English and
 * says so, and no English is left unmarked. Each route in `BN_READY_ROUTES` is checked here.
 */
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', path: '/', generation: 0 }));
vi.mock('server-only', () => ({}));
vi.mock('../lib/locale', () => ({ getLocale: async () => current.locale }));
vi.mock('../lib/request-path', () => ({ requestedPath: async () => current.path }));
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
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => false }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => false }));
vi.mock('../lib/public-db', () => ({
  withPublicDb: async (fn: (db: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listPublicTrustPublished: async () => [],
}));

const BENGALI = /[ঀ-৿]/;
const LATIN = /[A-Za-z]{2,}/;

beforeEach(() => {
  vi.stubEnv('DEPLOYMENT_MODE', 'controlled_pilot');
});
afterEach(() => {
  vi.unstubAllEnvs();
  current.locale = 'en';
});

async function render(
  path: string,
  make: () => Promise<unknown> | unknown,
  locale: 'en' | 'bn' = 'bn',
) {
  current.locale = locale;
  current.path = path;
  current.generation += 1;
  const element = await make();
  // The root layout gives the client components the visitor's locale; the page alone has no provider.
  const html = await renderServer(
    <I18nProvider
      locale={locale}
      pageLang={locale}
      drafts={locale === 'bn' ? liveClientDrafts() : {}}
    >
      {element as ReactNode}
    </I18nProvider>,
  );
  return { html, doc: new JSDOM(html).window.document };
}

/** Latin-letter text that is neither the product name nor inside a part marked English. */
function looseEnglish(doc: Document): string[] {
  const loose: string[] = [];
  const walker = doc.createTreeWalker(doc.body, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    const parent = node.parentElement;
    if (!text || !parent || parent.closest('script, style, [lang="en"]')) continue;
    if (!LATIN.test(text.replaceAll('VisaStack', ''))) continue;
    if (BENGALI.test(text)) continue;
    loose.push(text);
  }
  return loose;
}

const PAGES = [
  {
    name: 'How It Works',
    path: '/how-it-works',
    load: async () => (await import('./how-it-works/page')).default(),
    bengali: ['এটি যেভাবে', 'চারটি ধাপ। প্রতিটি আপনার হাতে।', 'নিজের পাসপোর্ট দিয়ে'],
    heldEnglish: ['Choose what leaves, for whom, until when. Turn it off any time.'],
  },
  {
    name: 'For Agencies',
    path: '/for-agencies',
    load: async () => (await import('./for-agencies/page')).default(),
    bengali: ['ক্লায়েন্টরা আসেন', 'ভিসা ফাইলের একটি তালিকা', 'আপনার ক্লায়েন্টদের নিয়ে আসুন।'],
    heldEnglish: ['Clients own their record. You see what they share.'],
  },
  {
    name: 'Countries',
    path: '/countries',
    load: async () =>
      (await import('./countries/page')).default({ searchParams: Promise.resolve({}) }),
    bengali: ['প্রতিটি দেশ।', 'আলবেনিয়া', 'মোট ১৫৬টি দেশের মধ্যে ১২টি দেখানো হচ্ছে।', 'আরও দেখান'],
    heldEnglish: ['Visa Needed'],
  },
  {
    name: 'Privacy and Trust',
    path: '/trust',
    load: async () => (await import('./trust/page')).default(),
    bengali: ['আজ আমরা', 'আপনার ইতিহাস,', 'আমরা যা করি না।'],
    heldEnglish: ['Five promises.', 'Private by Default'],
  },
  {
    name: 'Privacy Notice',
    path: '/privacy',
    load: async () => (await import('./privacy/page')).default(),
    bengali: ['গোপনীয়তা নিয়ন্ত্রণ', 'ব্যবহারের শর্তাবলি পড়ুন'],
    heldEnglish: ['Information and Purpose', 'Separate Choices'],
  },
  {
    name: 'Terms of Use',
    path: '/terms',
    load: async () => (await import('./terms/page')).default(),
    bengali: ['গোপনীয়তা নোটিশ পড়ুন', 'অ্যাকাউন্ট তৈরিতে ফিরে যান'],
    heldEnglish: ['Visa Decisions', 'Your Information and Access'],
  },
  {
    name: 'Page Not Found',
    path: '/no-such-page',
    load: async () => (await import('./not-found')).default(),
    bengali: ['আমরা পাতাটি খুঁজে পাইনি', 'হোম পাতায় ফিরে যান'],
    heldEnglish: [],
  },
] as const;

describe('the public pages under Bengali', () => {
  for (const page of PAGES) {
    describe(page.name, () => {
      it('is written in Bengali, with the held wording in marked English and nothing unmarked', async () => {
        const { doc } = await render(page.path, page.load);
        const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ');
        for (const phrase of page.bengali) expect(text, phrase).toContain(phrase);
        const marked = [...doc.querySelectorAll('[lang="en"]')].map((el) =>
          (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        );
        for (const phrase of page.heldEnglish)
          expect(
            marked.some((m) => m.includes(phrase)),
            `${phrase} is English and marked`,
          ).toBe(true);
        expect(looseEnglish(doc)).toEqual([]);
        // Nothing marked English is Bengali (a Bengali link inside an English sentence marks itself).
        for (const el of doc.querySelectorAll('[lang="en"]')) {
          const copy = el.cloneNode(true) as Element;
          for (const inner of copy.querySelectorAll('[lang="bn"]')) inner.remove();
          expect(copy.textContent ?? '').not.toMatch(BENGALI);
        }
      });

      it('is exactly as before under English: no Bengali and no language mark', async () => {
        const { doc } = await render(page.path, page.load, 'en');
        expect(doc.body.textContent ?? '').not.toMatch(BENGALI);
        expect(doc.querySelectorAll('[lang]').length).toBe(0);
      });
    });
  }

  it('lists every Bengali-ready route among the pages checked here (a route cannot be marked ready unchecked)', async () => {
    const { BN_READY_ROUTES } = await import('../lib/page-language');
    const checked = new Set<string>([
      ...PAGES.map((page) => page.path),
      // checked by their own tests: the sign-in screens (auth-locale), Home (home-locale), status (status-locale)
      '/',
      '/status',
      '/auth/sign-in',
      '/auth/sign-up',
      '/auth/forgot-password',
      '/auth/reset-password',
      '/auth/reauth',
      '/auth/verify-email',
      '/auth/account-recovery',
    ]);
    for (const route of BN_READY_ROUTES) expect(checked.has(route), route).toBe(true);
  });
});
