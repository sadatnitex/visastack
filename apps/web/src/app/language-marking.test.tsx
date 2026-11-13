import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));
// Language and address are set here directly: the page language comes from both (page-language.ts).
const current = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'bn',
  path: '/' as string | null,
  generation: 0,
}));
vi.mock('../lib/locale', () => ({ getLocale: async () => current.locale }));
vi.mock('../lib/request-path', () => ({ requestedPath: async () => current.path }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
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

import { I18nProvider } from '../components/i18n-provider';
import { authCatalog } from '../i18n/auth';
import { homeCatalog } from '../i18n/home';
import { statusCatalog } from '../i18n/status';
import { type ProbeResult, StatusView } from './status/status-view';

const { default: HomePage } = await import('./page');
const { default: SignInPage } = await import('./auth/sign-in/page');

const BENGALI = /[ঀ-৿]/;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

type Catalogue = { readonly en: Record<string, string>; readonly bn: Record<string, string> };

async function pageHtml(
  page: 'home' | 'sign-in',
  locale: 'en' | 'bn',
): Promise<{ doc: Document; pageLang: 'en' | 'bn' }> {
  current.locale = locale;
  current.path = page === 'home' ? '/' : '/auth/sign-in';
  current.generation += 1;
  const searchParams = Promise.resolve({});
  const element =
    page === 'home' ? await HomePage({ searchParams }) : await SignInPage({ searchParams });
  const pageLang = locale === 'bn' && page === 'sign-in' ? 'bn' : 'en';
  return { doc: new JSDOM(renderToStaticMarkup(element)).window.document, pageLang };
}

/** The language a screen reader would use for this node: the nearest lang, else the page's. */
function effectiveLang(node: Node, pageLang: string): string {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return el?.closest('[lang]')?.getAttribute('lang') ?? pageLang;
}

/** Every piece of text a person or a screen reader gets: text nodes and the marked attributes. */
function pieces(doc: Document, pageLang: string): { text: string; lang: string }[] {
  const out: { text: string; lang: string }[] = [];
  const walker = doc.createTreeWalker(doc.body, 4);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = norm(n.textContent ?? '');
    if (text) out.push({ text, lang: effectiveLang(n, pageLang) });
  }
  // An attribute on an element that also holds text cannot take its own lang (the element's
  // lang would be wrong for the text): the marking pass leaves those, so they are not checked.
  for (const el of doc.body.querySelectorAll('[aria-label],[title],[placeholder],[alt]'))
    for (const a of el.textContent?.trim() ? [] : ['aria-label', 'title', 'placeholder', 'alt']) {
      const value = el.getAttribute(a);
      if (value) out.push({ text: norm(value), lang: effectiveLang(el, pageLang) });
    }
  return out;
}

/**
 * Whole pieces of text that are a catalogue message with no parameters: the Bengali ones must be
 * read as bn, and the English fallback of a key with no Bengali must be read as en.
 */
function wrongLanguage(doc: Document, pageLang: string, catalogue: Catalogue) {
  const bengali = new Set(
    Object.values(catalogue.bn)
      .filter((v) => !v.includes('{'))
      .map(norm),
  );
  const fallback = new Set(
    Object.entries(catalogue.en)
      .filter(([k, v]) => !(k in catalogue.bn) && !v.includes('{'))
      .map(([, v]) => norm(v)),
  );
  const all = pieces(doc, pageLang);
  return {
    bengaliSeen: all.filter((p) => bengali.has(p.text)),
    fallbackSeen: all.filter((p) => fallback.has(p.text) && !bengali.has(p.text)),
    anyBengaliScriptNotBn: all.filter((p) => BENGALI.test(p.text) && p.lang !== 'bn'),
    fallbackNotEn: all.filter(
      (p) => fallback.has(p.text) && !bengali.has(p.text) && p.lang !== 'en',
    ),
    bengaliNotBn: all.filter((p) => bengali.has(p.text) && p.lang !== 'bn'),
  };
}

beforeEach(() => {
  vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'test-only-cookie-key-with-at-least-thirty-two-characters');
});
afterEach(() => {
  vi.unstubAllEnvs();
  current.locale = 'en';
  current.path = '/';
});

describe('the home page under Bengali (an English page)', () => {
  it('marks every Bengali message lang="bn" and leaves English text unmarked', async () => {
    const { doc, pageLang } = await pageHtml('home', 'bn');
    expect(pageLang).toBe('en');
    const r = wrongLanguage(doc, pageLang, homeCatalog as unknown as Catalogue);
    expect(r.bengaliSeen.length).toBeGreaterThan(10);
    expect(r.bengaliNotBn).toEqual([]);
    expect(r.anyBengaliScriptNotBn).toEqual([]);
    expect(doc.querySelectorAll('span[lang="bn"]').length).toBeGreaterThan(10);
    expect(doc.querySelectorAll('[lang="en"]').length).toBe(0);
  });

  it('adds no language markup at all under English', async () => {
    const { doc } = await pageHtml('home', 'en');
    expect(doc.querySelectorAll('[lang]').length).toBe(0);
  });
});

describe('the sign-in page under Bengali (a Bengali page)', () => {
  it('marks the English fallbacks lang="en" and leaves the Bengali unmarked', async () => {
    const { doc, pageLang } = await pageHtml('sign-in', 'bn');
    expect(pageLang).toBe('bn');
    const r = wrongLanguage(doc, pageLang, authCatalog as unknown as Catalogue);
    expect(r.bengaliSeen.length).toBeGreaterThan(3);
    // The Terms and Privacy links are Bengali since the owner's sign-off of 2026-11-12, so fewer
    // English fallbacks remain on this page.
    expect(r.fallbackSeen.length).toBeGreaterThan(1);
    expect(r.fallbackNotEn).toEqual([]);
    expect(r.bengaliNotBn).toEqual([]);
    expect(doc.querySelectorAll('[lang="en"]').length).toBeGreaterThan(1);
    expect(doc.querySelectorAll('[lang="bn"]').length).toBe(0);
  });

  it('adds no language markup at all under English', async () => {
    const { doc } = await pageHtml('sign-in', 'en');
    expect(doc.querySelectorAll('[lang]').length).toBe(0);
  });
});

describe('the status page under Bengali (an English page)', () => {
  const live: ProbeResult = { ok: true, status: 'live', data: { status: 'live' } };
  const ready: ProbeResult = {
    ok: true,
    status: 'ready',
    data: {
      status: 'ready',
      deploymentMode: 'controlled_pilot',
      platform: { authentication: 'available', documentUpload: 'available' },
    },
  };
  const status = (locale: 'en' | 'bn') =>
    new JSDOM(
      renderToStaticMarkup(
        <I18nProvider locale={locale} pageLang="en">
          <StatusView
            live={live}
            ready={ready}
            updatedAt="14:05:09"
            loading={false}
            onRefresh={() => undefined}
          />
        </I18nProvider>,
      ),
    ).window.document;

  it('marks the Bengali headings and buttons lang="bn"', () => {
    const doc = status('bn');
    const r = wrongLanguage(doc, 'en', statusCatalog as unknown as Catalogue);
    expect(r.bengaliSeen.length).toBeGreaterThan(2);
    expect(r.bengaliNotBn).toEqual([]);
    expect(r.anyBengaliScriptNotBn).toEqual([]);
    expect(doc.querySelectorAll('span[lang="bn"]').length).toBeGreaterThan(2);
  });

  it('adds no language markup at all under English', () => {
    expect(status('en').querySelectorAll('[lang]').length).toBe(0);
  });
});
