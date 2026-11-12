import { defineCatalog } from '@visastack/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'bn' as 'en' | 'bn', holder: null as unknown }));

vi.mock('./locale', () => ({ getLocale: async () => state.locale }));
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

  it('throws, naming primeLocale, when not primed (test and development)', () => {
    expect(() => renderToStaticMarkup(<Card />)).toThrow(/primeLocale/);
  });

  it('falls back to English in production when not primed', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(renderToStaticMarkup(<Card />)).toBe('<h2>Documents</h2>');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('getT primes and translates', async () => {
    const t = await getT(catalog);
    expect(t('demo.card.title')).toBe('ডকুমেন্ট');
    expect(renderToStaticMarkup(<Card />)).toBe('<h2>ডকুমেন্ট</h2>');
  });
});
