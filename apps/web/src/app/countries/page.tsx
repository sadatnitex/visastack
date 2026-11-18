import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { FlagRing } from '../../components/public-site/flag-ring';
import { Chapter, Scene } from '../../components/public-site/scene';
import { ScenesRuntime } from '../../components/public-site/scenes-runtime';
import { HeadlineWords, StoryCard } from '../../components/public-site/story';
import { ShowMore } from '../../components/show-more';
import { appHrefForCountry, startHrefForCountry } from '../../lib/country-start-links';
import type { SearchParamsRecord } from '../../lib/paging';
import { isPublicBetaOpen } from '../../lib/public-beta';
import { isSignedIn } from '../../lib/signed-in';
import {
  NOT_RESEARCHED_WORDS,
  RING_CODES,
  countriesWindow,
  firstNewRowId,
  rowId,
} from './countries-data';
import './countries.css';

/**
 * A function, not a fixed `metadata` value: the signed-in list at /app/countries is also titled
 * "Countries" (owner's page title for this public page), and the title check forbids two fixed
 * titles that match. The two pages are told apart by their address and their frame.
 */
export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Countries' };
}

const COUNTRY_NOUN = { one: 'country', other: 'countries' } as const;

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
  const params: SearchParamsRecord = (await props?.searchParams) ?? {};
  const view = countriesWindow(params);
  const signedIn = await isSignedIn();
  const signUpOpen = isPublicBetaOpen();
  const startFor = (iso2: string) =>
    signedIn ? appHrefForCountry(iso2) : startHrefForCountry(iso2, signUpOpen);
  const landOn = firstNewRowId(view);

  return (
    <>
      <Chapter tone="dark" labelledBy="countries-title" className="pub4c-hero">
        <div className="container pub4c-hero-grid">
          <div className="pub4c-hero-copy">
            <h1 id="countries-title" className="pub4c-title">
              Countries, <HeadlineWords>With Their Sources</HeadlineWords>
            </h1>
            <p className="pub4c-lede">
              Visa facts for Bangladeshi passports, with sources. Always confirm on the official
              page.
            </p>
          </div>
          <FlagRing codes={RING_CODES} label="Countries We Hold" />
        </div>
      </Chapter>

      <Chapter tone="light" labelledBy="countries-list-title" className="pub4c-list-chapter">
        <div className="container">
          <h2 id="countries-list-title" className="pub4c-h2">
            All Countries
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
                  <strong className="pub4c-name">{row.name}</strong>
                  {row.researched ? (
                    <span className="pub4c-facts">
                      {row.entry ? <span>{row.entry}</span> : null}
                      <span>{row.source ? `Source: ${row.source}` : 'No Source Given'}</span>
                      <span>{row.checked}</span>
                    </span>
                  ) : (
                    <span className="pub4c-facts">
                      <span>{NOT_RESEARCHED_WORDS}</span>
                    </span>
                  )}
                </div>
                <a className="pub-button pub-button-secondary" href={startFor(row.iso2)}>
                  Start<span className="sr-only"> With {row.name}</span>
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

      <Chapter tone="dark" className="pub4c-read-chapter">
        <Scene name="read" len={2} steps={3} labelledBy="countries-read-title">
          <div className="container pub4c-read">
            <h2 id="countries-read-title" className="pub4c-h2">
              How to Read These Facts
            </h2>
            <div className="pub4c-read-grid">
              <StoryCard
                title="Source"
                body="Each fact we list names the page it came from, where one is given."
              />
              <StoryCard
                title="Checked On"
                body="The latest day we checked anything for this country. Check the official page before you pay or travel."
              />
              <StoryCard
                title="Not Researched Yet"
                body="We have not checked this country yet. Use the official page. No date, and no claim."
              />
            </div>
          </div>
        </Scene>
      </Chapter>
      <ScenesRuntime />
    </>
  );
}
