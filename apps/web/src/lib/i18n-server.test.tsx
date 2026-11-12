import { defineCatalog } from '@visastack/i18n';
import { notFound } from 'next/navigation';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  locale: 'bn' as 'en' | 'bn',
  holder: null as unknown,
  failWith: null as unknown,
}));

vi.mock('./locale', () => ({
  getLocale: async () => {
    if (state.failWith) throw state.failWith;
    return state.locale;
  },
}));
// Outside the server runtime React's `cache` does not remember anything, so stand in for one
// request: the first call builds the holder and later calls return it until the test resets it.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    state.holder ??= build();
    return state.holder;
  },
}));

const { getServerT, getT, primeLocale } = await import('./i18n-server');

const catalog = defineCatalog({
  en: { 'demo.card.title': 'Documents' },
  bn: { 'demo.card.title': 'ডকুমেন্ট' },
});

function Card() {
  return <h2>{getServerT(catalog)('demo.card.title')}</h2>;
}

describe('server translation', () => {
  beforeEach(() => {
    state.holder = null;
    state.locale = 'bn';
    state.failWith = null;
  });

  it('renders Bengali in a sync server component after primeLocale', async () => {
    await primeLocale();
    expect(renderToStaticMarkup(<Card />)).toBe('<h2>ডকুমেন্ট</h2>');
  });

  it('renders English when the locale is en', async () => {
    state.locale = 'en';
    await primeLocale();
    expect(renderToStaticMarkup(<Card />)).toBe('<h2>Documents</h2>');
  });

  it('throws, naming primeLocale, when not primed under next dev', () => {
    vi.stubEnv('NODE_ENV', 'development');
    try {
      expect(() => renderToStaticMarkup(<Card />)).toThrow(/primeLocale/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('falls back to English when not primed in tests and production', () => {
    expect(renderToStaticMarkup(<Card />)).toBe('<h2>Documents</h2>');
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(renderToStaticMarkup(<Card />)).toBe('<h2>Documents</h2>');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('primeLocale falls back to English when the locale cannot be read', async () => {
    state.failWith = new Error('cookies was called outside a request scope');
    await expect(primeLocale()).resolves.toBe('en');
    expect(renderToStaticMarkup(<Card />)).toBe('<h2>Documents</h2>');
  });

  it('primeLocale rethrows Next signals instead of swallowing them', async () => {
    try {
      notFound();
    } catch (signal) {
      state.failWith = signal;
    }
    expect(state.failWith).toBeTruthy();
    await expect(primeLocale()).rejects.toBe(state.failWith);
  });

  it('getT primes and translates', async () => {
    const t = await getT(catalog);
    expect(t('demo.card.title')).toBe('ডকুমেন্ট');
    expect(renderToStaticMarkup(<Card />)).toBe('<h2>ডকুমেন্ট</h2>');
  });
});
