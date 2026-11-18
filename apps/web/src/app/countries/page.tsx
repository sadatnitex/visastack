import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { FlagRibbon } from '../../components/public-countries/flag-ribbon';
import { CountryChecklistPanel } from '../../components/public-countries/standins/checklist-panel';
import { ClosingBand } from '../../components/public-countries/standins/closing-band';
import { RiseIn } from '../../components/public-countries/standins/rise-in';
import { TypingSearch } from '../../components/public-countries/typing-search';
import { PublicButton } from '../../components/public-site/public-button';
import { publicText } from '../../components/public-site/public-text';
import { Chapter } from '../../components/public-site/scene';
import { HeadlineWords } from '../../components/public-site/story';
import { ShowMore } from '../../components/show-more';
import { componentsCatalog } from '../../i18n/components';
import { homeCatalog } from '../../i18n/home';
import { appHrefForCountry, startHrefForCountry } from '../../lib/country-start-links';
import { getPageLanguage, getServerT, primeLocale } from '../../lib/i18n-server';
import type { SearchParamsRecord } from '../../lib/paging';
import { isPublicBetaOpen } from '../../lib/public-beta';
import { isSignedIn } from '../../lib/signed-in';
import {
  NOT_RESEARCHED_WORDS,
  NO_SOURCE_WORDS,
  RIBBON_FLAGS,
  SEARCH_INDEX,
  countriesWindow,
  firstNewRowId,
  rowId,
  searchQueryOf,
} from './countries-data';
import './countries.css';

// The signed-in list at /app/countries is titled "Countries"; the public page's tab says what it adds.
export const metadata: Metadata = { title: 'Countries and Sources' };

const COUNTRY_NOUN = { one: 'country', other: 'countries' } as const;

/** The example checklist beside "Rules, Not Guesses": made-up records, always tagged Example. */
const CHECKLIST_ITEMS = [
  { kind: 'passport', label: 'Passport' },
  { kind: 'photo', label: 'Photo' },
  { kind: 'flight', label: 'Flights' },
  { kind: 'insurance', label: 'Insurance' },
  { kind: 'itinerary', label: 'Itinerary' },
  { kind: 'bank', label: 'Bank Statement' },
  { kind: 'hotel', label: 'Hotel Booking' },
  { kind: 'invitation', label: 'Invitation' },
] as const;

const CHECKLIST_COUNTRIES = [
  { code: 'sg', name: 'Singapore', have: [true, true, true, true, true, false, false, false] },
  { code: 'de', name: 'Germany', have: [true, true, false, true, false, false, false, false] },
  { code: 'jp', name: 'Japan', have: [true, true, true, false, true, true, false, false] },
] as const;

interface CountriesProps {
  readonly searchParams: Promise<SearchParamsRecord>;
}

// Two signatures: Next.js passes the address; shared page checks call the page with nothing, which
// reads as the first page.
export default function CountriesPage(): Promise<ReactElement>;
export default function CountriesPage(props: CountriesProps): Promise<ReactElement>;
/**
 * Public Countries page (WP-PUB4). Reads the sourced destination catalogue, which is public data
 * held in the code: no sign-in, no database, nothing private. 12 rows first, then Show More through
 * a plain `?show=` link, so the page works without script.
 */
export default async function CountriesPage(props?: CountriesProps): Promise<ReactElement> {
  await primeLocale();
  const lang = getPageLanguage();
  const say = (text: string) => publicText(text, lang);
  const t = getServerT(homeCatalog);
  const tc = getServerT(componentsCatalog);
  const params: SearchParamsRecord = (await props?.searchParams) ?? {};
  const view = countriesWindow(params);
  const signedIn = await isSignedIn();
  const signUpOpen = isPublicBetaOpen();
  const startFor = (iso2: string) =>
    signedIn ? appHrefForCountry(iso2) : startHrefForCountry(iso2, signUpOpen);
  const landOn = firstNewRowId(view);
  const query = searchQueryOf(params);
  // The start button reads the same words and goes the same way as For Agencies and Home.
  const startHref = !signedIn && signUpOpen ? '/auth/sign-up' : '/app';
  const startLabel = signedIn
    ? t.node('home.page.openYourWorkspace')
    : signUpOpen
      ? t.node('home.page.createYourFreeAccount')
      : t.node('home.page.signInToGetStarted');

  return (
    <>
      <Chapter tone="dark" labelledBy="countries-title" className="r4-hero">
        <div className="container r4-hero-inner">
          <h1 id="countries-title" className="r4-title">
            {say('Every Country.')} <HeadlineWords>{say('With Its Sources.')}</HeadlineWords>
          </h1>
          <p className="r4-lede">
            {say(
              'Pick where you are going and see what you need, with the official page for each rule.',
            )}
          </p>
          <TypingSearch
            index={SEARCH_INDEX}
            initialQuery={query}
            signedIn={signedIn}
            signUpOpen={signUpOpen}
          />
        </div>
      </Chapter>

      <Chapter tone="light" labelledBy="countries-list-title" className="r4-list-chapter">
        <FlagRibbon
          flags={RIBBON_FLAGS}
          href="#countries-list"
          linkLabel={tc.node('components.countryBrowser.allCountries')}
          pageLang={lang}
        />
        <div className="container" id="countries-list">
          <h2 id="countries-list-title" className="r4-h2">
            {say('All Countries')}
          </h2>
          <ul className="pub4c-rows" aria-label="Countries">
            {view.rows.map((row) => (
              <li
                key={row.iso2}
                id={rowId(row.iso2)}
                data-country-row={row.iso2}
                className="pub4c-row"
              >
                {row.flag ? (
                  <img
                    className="pub4c-flag"
                    src={`/flags/${row.flag}.svg`}
                    alt=""
                    width={36}
                    height={27}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="pub4c-flag pub4c-flag-none" aria-hidden="true" />
                )}
                <div className="pub4c-row-text">
                  <strong className="pub4c-name">{say(row.name)}</strong>
                  {row.researched ? (
                    <>
                      <span className="pub4c-facts">
                        {row.entry ? <span>{say(row.entry)}</span> : null}
                        <span>{say(row.source ? `Source: ${row.source}` : NO_SOURCE_WORDS)}</span>
                        <span>{row.checked ? say(row.checked) : null}</span>
                      </span>
                      {row.notes.length > 0 ? (
                        <span className="pub4c-notes">
                          {row.notes.map((note) => (
                            <span key={note}>{say(note)}</span>
                          ))}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="pub4c-facts">
                      <span>{say(NOT_RESEARCHED_WORDS)}</span>
                    </span>
                  )}
                </div>
                <a className="pub-button pub-button-secondary" href={startFor(row.iso2)}>
                  {say('Start')}
                  <span className="sr-only">{say(` With ${row.name}`)}</span>
                </a>
              </li>
            ))}
          </ul>
          <ShowMore
            id="countries-more"
            pathname="/countries"
            next={view.next === null ? null : { show: view.next }}
            shown={view.shown}
            total={view.total}
            noun={COUNTRY_NOUN}
            {...(landOn ? { landOn } : {})}
          />
        </div>
      </Chapter>

      <Chapter tone="light" labelledBy="countries-rules-title" className="r4-rules-chapter">
        <div className="container r4-rules">
          <RiseIn>
            <div className="r4-rules-copy">
              <h2 id="countries-rules-title" className="r4-h2">
                {say('Rules,')} <HeadlineWords>{say('Not Guesses.')}</HeadlineWords>
              </h2>
              <p className="r4-lede">
                {say(
                  'Each line shows where it came from and when it was last checked. Check the official page before you pay or travel.',
                )}
              </p>
              <p className="r4-source-chip">
                {say('Source: official page. Checked on an Example date.')}
              </p>
            </div>
          </RiseIn>
          <RiseIn delay={0.1}>
            <CountryChecklistPanel
              countries={CHECKLIST_COUNTRIES}
              items={CHECKLIST_ITEMS}
              active={0}
              pageLang={lang}
            />
          </RiseIn>
        </div>
      </Chapter>

      <ClosingBand
        title={
          <h2 className="r4-h2">
            {say('Pick a Country.')} <HeadlineWords>{say('See the Gap.')}</HeadlineWords>
          </h2>
        }
        sub={say('Add one document and see what the trip still needs.')}
        actions={
          <>
            <PublicButton href={startHref} variant="primary">
              {startLabel}
            </PublicButton>
            <PublicButton href="/for-agencies" variant="secondary">
              {say('For Agencies')}
            </PublicButton>
          </>
        }
      />
    </>
  );
}
