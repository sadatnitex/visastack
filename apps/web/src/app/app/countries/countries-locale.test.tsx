import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

import { appCountriesCatalog } from '../../../i18n/app-countries';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';
import CountriesPage from './(list)/page';
import CountryPage from './[iso2]/page';

const BENGALI = /[ঀ-৿]/;
const bn = appCountriesCatalog.bn as Record<string, string>;
const en = appCountriesCatalog.en as Record<string, string>;

async function render(locale: 'en' | 'bn', iso2?: string): Promise<string> {
  current.holder = null;
  current.locale = locale;
  return textOf(
    await renderServer(iso2 ? CountryPage({ params: Promise.resolve({ iso2 }) }) : CountriesPage()),
  );
}

afterEach(() => {
  current.locale = 'en';
});

describe('country pages under Bengali', () => {
  it('shows Bengali headings and keeps the official rule content in English', async () => {
    const list = await render('bn');
    expect(list).toContain(
      bn['appCountries.appCountriesCountriesView.visaRulesForABangladeshiPassport'],
    );
    // The long guidance paragraph has no released Bengali, so it shows in English.
    expect(list).toContain('does not mean no visa is needed');
    expect(list).not.toMatch(/appCountries\./);
    const gb = await render('bn', 'gb');
    expect(gb).toMatch(BENGALI);
    expect(gb).toContain(bn['appCountries.appCountriesCountryView.visaTypes']);
    // Official facts are never translated.
    expect(gb).toContain('Up to 180 days');
    expect(gb).toContain('BDT 22,450');
    expect(gb).not.toMatch(/appCountries\.|\{[A-Za-z]+\}/);
  });

  it('holds back the document-age requirement so it can only show in English', () => {
    const key = 'appCountries.appCountriesCountryView.mustBeDatedWithinMaxagedaysDays';
    expect(key in en).toBe(true);
    expect(key in bn).toBe(false);
  });

  it('leaves no raw placeholder in any Bengali string', () => {
    for (const [key, text] of Object.entries(bn)) expect(text, key).not.toMatch(/\{[^}]*\}/);
  });
});

describe('country pages under English', () => {
  it('render the original English text with no Bengali', async () => {
    expect(await render('en')).not.toMatch(BENGALI);
    expect(await render('en', 'gb')).not.toMatch(BENGALI);
  });
});
