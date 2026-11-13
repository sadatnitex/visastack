import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

import { appHomeCatalog } from '../../i18n/app-home';
import { primeLocale } from '../../lib/i18n-server';
import { renderServer, textOf } from '../../lib/next-mocks.test-support';
import { countryStartData } from '../../lib/country-start';
import { PersonCard, StartCaseTile } from './(home)/home-cards';
import { RecentActivity } from './(home)/recent-activity';
import { TidyUpCard } from './(home)/tidy-up';
import { FirstRunConsent, FirstRunCountry, FirstRunTask } from './first-run';

const BENGALI = /[ঀ-৿]/;
const bn = appHomeCatalog.bn as Record<string, string>;
const en = appHomeCatalog.en as Record<string, string>;

async function render(locale: 'en' | 'bn', which: 'tile' | 'consent'): Promise<string> {
  current.holder = null;
  current.locale = locale;
  await primeLocale();
  return textOf(
    await renderServer(
      which === 'tile' ? (
        <StartCaseTile href="/app/cases/new" />
      ) : (
        <FirstRunConsent locale={locale} />
      ),
    ),
  );
}

afterEach(() => {
  current.locale = 'en';
});

describe('the signed-in home under Bengali', () => {
  it('shows the Bengali label on the start-a-case tile', async () => {
    const text = await render('bn', 'tile');
    expect(text).toContain(bn['appHome.appHomeCards.startACase']);
    expect(text).not.toMatch(/appHome\./);
  });

  it('shows the consent screen in Bengali (signed off 2026-11-12)', async () => {
    const held = [
      'appHome.appFirstRun.letVisastackProcessMyDetails',
      'appHome.appFirstRun.thisDoesNotTurnOnAi',
      'appHome.appFirstRun.thisIsNeededBeforeAnythingCan',
    ];
    const text = await render('bn', 'consent');
    for (const key of held) {
      expect(key in bn, key).toBe(true);
      expect(text).toContain(bn[key]);
      expect(text).not.toContain(en[key] ?? 'MISSING');
    }
    expect(text).not.toMatch(/appHome\.|\{[A-Za-z]+\}/);
  });

  it('leaves no raw placeholder in any Bengali string', () => {
    for (const [key, text] of Object.entries(bn)) {
      // A named value such as {name} is filled at render time; it must match the English one.
      const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(names(text), key).toBe(names(en[key] ?? ''));
      expect(text, key).not.toMatch(/\{[^}\w]|[^\w]\}/);
    }
  });
});

/** A server piece of home or the first run, drawn as one request in the given language. */
async function draw(locale: 'en' | 'bn', node: () => React.ReactNode): Promise<string> {
  current.holder = null;
  current.locale = locale;
  await primeLocale();
  return renderServer(node());
}

/** The text and spoken names of a piece, with each Bengali value and no English or raw key. */
function expectBengali(html: string, keys: readonly string[]) {
  const text = `${textOf(html)}\n${[...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]).join('\n')}`;
  for (const key of keys) {
    const full = `appHome.${key}`;
    expect(full in bn, key).toBe(true);
    expect(text, key).toContain(bn[full]);
    expect(text, key).not.toContain(en[full]);
  }
  expect(text).not.toMatch(/appHome\.app[A-Z]/);
}

describe('the first run under Bengali', () => {
  it('what do you want to do: every task offered, with Skip for Now', async () => {
    const html = await draw('bn', () => (
      <FirstRunTask
        requestHref="/app/requests/r1"
        recordsHref="/app/applicant/a1"
        briefHref="/app/applicant/a1/outputs"
        countryName="Japan"
        countryHref="/app/countries/jp"
        documentsHref="/app/applicant/a1/documents"
        tripHref="/app/trips/new"
      />
    ));
    expectBengali(html, [
      'appFirstRun.whatIsUsuallyAskedForAnd',
      'appFirstRun.completeARequest',
      'appFirstRun.anAgencyAskedYouForSomething',
      'appFirstRun.addDocuments',
      'appFirstRun.uploadAPassportPageOrAny',
      'appFirstRun.startATrip',
      'appFirstRun.sayWhereAndWhyAndSee',
      'appFirstRun.prepareASummary',
      'appFirstRun.chooseWhatGoesInThenCopy',
      'appFirstRun.updateOrFindMyRecords',
      'appFirstRun.documentsDetailsAndDates',
      'appFirstRun.skipForNow',
    ]);
    // Left English at review: the country name inside it comes from an English-only list.
    expect(textOf(html)).toContain('See Your Japan Checklist');
  });

  it('where do you want to go: the country step says what it gives, in Bengali', async () => {
    const html = await draw('bn', () => (
      <FirstRunCountry data={countryStartData()} iso2={null} action={async () => undefined} />
    ));
    expectBengali(html, ['appFirstRun.pickACountryAndSeeWhat', 'appFirstRun.skipForNow']);
  });

  it('the permission step after a country: the chosen country can be changed, in Bengali', async () => {
    const html = await draw('bn', () => (
      <FirstRunConsent locale="bn" hasCountryStep countryName="Japan" countryIso2="JP" />
    ));
    expectBengali(html, ['appFirstRun.change']);
  });
});

describe('home cards under Bengali', () => {
  it('a person card says what is needed next, in both states', async () => {
    const card = (actionNeeded: boolean) => (
      <PersonCard
        href="/app/applicant/a1"
        name="Synthetic Self"
        documents={0}
        cases={0}
        requests={0}
        actionNeeded={actionNeeded}
      />
    );
    expectBengali(await draw('bn', () => card(true)), ['appHomeCards.actionNeeded']);
    expectBengali(await draw('bn', () => card(false)), ['appHomeCards.addADocument']);
  });

  it('recent activity: empty, then with a blocked entry and See All', async () => {
    expectBengali(
      await draw('bn', () => <RecentActivity entries={[]} seeAllHref="/app/activity" />),
      ['appRecentActivity.recentActivity', 'appRecentActivity.nothingYetEachTimeYourRecord'],
    );
    const entry = {
      id: '1',
      what: 'Opened your record',
      at: '2026-11-01T00:00:00.000Z',
      when: '1 Nov 2026',
      who: 'Acme Visas',
      blocked: true,
    };
    expectBengali(
      await draw('bn', () => <RecentActivity entries={[entry]} seeAllHref="/app/activity" />),
      ['appRecentActivity.blocked', 'appRecentActivity.seeAll'],
    );
  });

  it('the tidy-up card names its button in Bengali', async () => {
    expectBengali(
      await draw('bn', () => <TidyUpCard line="2 copies" href="/app/applicant/a1/documents" />),
      ['appTidyUp.tidyUp', 'appTidyUp.tidyUpDocuments'],
    );
  });
});

describe('the signed-in home under English', () => {
  it('renders the original English text with no Bengali', async () => {
    expect(await render('en', 'tile')).not.toMatch(BENGALI);
    expect(await render('en', 'consent')).not.toMatch(BENGALI);
  });
});
