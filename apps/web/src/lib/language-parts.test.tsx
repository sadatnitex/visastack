import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineCatalog } from '@visastack/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  locale: 'bn' as 'en' | 'bn',
  path: null as string | null,
  holder: null as unknown,
}));

vi.mock('./locale', () => ({ getLocale: async () => state.locale }));
vi.mock('./request-path', () => ({ requestedPath: async () => state.path }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    state.holder ??= build();
    return state.holder;
  },
}));

const { getPageLanguage, getServerT, getT, primeLocale } = await import('./i18n-server');

const catalog = defineCatalog({
  en: { 'demo.both': 'Documents', 'demo.only': 'Only English', 'demo.n': '{n} files' },
  bn: { 'demo.both': 'ডকুমেন্ট' },
});
const keys = ['demo.both', 'demo.only', 'demo.n'] as const;

describe('language of parts (server)', () => {
  beforeEach(() => {
    state.holder = null;
    state.locale = 'bn';
    state.path = null;
  });

  it('under en, node renders exactly what the string translator returns', async () => {
    state.locale = 'en';
    state.path = '/auth/sign-in';
    await primeLocale();
    const t = getServerT(catalog);
    for (const k of keys) {
      expect(renderToStaticMarkup(t.node(k, { n: 3 }))).toBe(t(k, { n: 3 }));
      expect(t.lang(k)).toEqual({});
    }
  });

  it('marks Bengali text on an English page with lang="bn"', async () => {
    state.path = '/dashboard';
    await primeLocale();
    expect(getPageLanguage()).toBe('en');
    const t = getServerT(catalog);
    expect(renderToStaticMarkup(t.node('demo.both'))).toBe('<span lang="bn">ডকুমেন্ট</span>');
    expect(renderToStaticMarkup(t.node('demo.only'))).toBe('Only English');
    expect(t.lang('demo.both')).toEqual({ lang: 'bn' });
  });

  it('marks English fallback text on a Bengali page with lang="en"', async () => {
    state.path = '/auth/sign-in';
    const t = await getT(catalog);
    expect(getPageLanguage()).toBe('bn');
    expect(renderToStaticMarkup(t.node('demo.only'))).toBe('<span lang="en">Only English</span>');
    expect(renderToStaticMarkup(t.node('demo.both'))).toBe('ডকুমেন্ট');
    expect(t.lang('demo.only')).toEqual({ lang: 'en' });
    expect(t.lang('demo.both')).toEqual({});
  });

  it('with no request path the page is English', async () => {
    await primeLocale();
    expect(getPageLanguage()).toBe('en');
  });
});

describe('root layout wiring', () => {
  const layout = readFileSync(resolve(__dirname, '../app/layout.tsx'), 'utf8');
  it('takes <html lang> from the primed page language and hands the same value to the provider', () => {
    expect(layout).toContain('const { locale, pageLang: htmlLang } = await primePage();');
    expect(layout).toContain('<html lang={htmlLang}');
    expect(layout).toContain('<I18nProvider locale={locale} pageLang={htmlLang}>');
    expect(layout).not.toMatch(/pageLanguage\(/);
  });
});
