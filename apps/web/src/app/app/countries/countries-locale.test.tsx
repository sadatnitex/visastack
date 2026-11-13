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

// One United States route gains a scam-reporting page and a fact to check again, so those states
// render; the batch data has no fraud reporting link yet. Every other route is the real data.
vi.mock('@visastack/core/destinations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@visastack/core/destinations')>();
  return {
    ...real,
    routesForDestination: (destination: Parameters<typeof real.routesForDestination>[0]) =>
      real.routesForDestination(destination).map((route, at) =>
        destination.iso2 === 'US' && at === 0
          ? {
              ...route,
              fraudReportingUrl: 'https://example.test/report',
              requirements: route.requirements.map((item, n) =>
                n === 0 && item.source
                  ? { ...item, source: { ...item.source, needsCheck: true } }
                  : item,
              ),
            }
          : route,
      ),
  };
});

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

describe('country page states under Bengali', () => {
  const v = (key: string) => bn[`appCountries.appCountriesCountryView.${key}`] ?? key;

  it('shows the dated rules, scam reporting and check-again labels in Bengali (United States)', async () => {
    const us = await render('bn', 'us');
    for (const key of ['rulesTakeEffect', 'reportAScam', 'officialReportingPage', 'needsChecking'])
      expect(us, key).toContain(v(key));
    expect(us).not.toContain('Report a Scam');
    expect(us).not.toContain('Rules Take Effect');
    expect(us).not.toMatch(/appCountries\./);
    const usEn = await render('en', 'us');
    expect(usEn).toContain('Report a Scam');
    expect(usEn).not.toMatch(BENGALI);
  });

  it('marks an optional requirement in Bengali (Canada)', async () => {
    const ca = await render('bn', 'ca');
    expect(ca).toContain(v('optional'));
    expect(ca).not.toContain('(optional)');
    expect(ca).not.toMatch(/appCountries\./);
  });

  it('says in Bengali that a country is not researched yet (Kuwait)', async () => {
    const kw = await render('bn', 'kw');
    expect(kw).toContain(v('notYetResearched'));
    // The status badge beside it comes from an English label list outside the catalogue.
    expect(kw).toContain('Not Yet Researched');
    expect(kw).not.toMatch(/appCountries\./);
  });
});

describe('country pages under English', () => {
  it('render the original English text with no Bengali', async () => {
    expect(await render('en')).not.toMatch(BENGALI);
    expect(await render('en', 'gb')).not.toMatch(BENGALI);
  });
});
