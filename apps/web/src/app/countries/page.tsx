import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { FlagRing } from '../../components/public-site/flag-ring';
import { PublicButton } from '../../components/public-site/public-button';
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
      <Chapter tone="dark" labelledBy="countries-title" className="pub4-hero">
        <div className="container pub4-hero-grid">
          <div className="pub4-hero-copy">
            <h1 id="countries-title" className="pub4-title">
              Every Country, <HeadlineWords>With Its Source</HeadlineWords>
            </h1>
            <p className="pub4-lede">
              Visa facts for Bangladeshi passports, each with its source and the day we checked it.
            </p>
          </div>
          <FlagRing codes={RING_CODES} label="Countries We Hold" />
        </div>
      </Chapter>

      <Chapter tone="light" labelledBy="countries-list-title" className="pub4-list-chapter">
        <div className="container">
          <h2 id="countries-list-title" className="pub4-h2">
            All Countries
          </h2>
          <ul className="pub4-rows">
            {view.rows.map((row) => (
              <li
                key={row.iso2}
                id={rowId(row.iso2)}
                data-country-row={row.iso2}
                className="pub4-row"
              >
                {row.flag ? (
                  <img
                    className="pub4-flag"
                    src={`/flags/${row.flag}.svg`}
                    alt=""
                    width={36}
                    height={27}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="pub4-flag pub4-flag-none" aria-hidden="true" />
                )}
                <div className="pub4-row-text">
                  <strong className="pub4-name">{row.name}</strong>
                  {row.researched ? (
                    <span className="pub4-facts">
                      {[
                        row.entry,
                        row.source ? `Source: ${row.source}` : 'No Source Given',
                        row.checked,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  ) : (
                    <span className="pub4-facts">{NOT_RESEARCHED_WORDS}</span>
                  )}
                </div>
                <PublicButton href={startFor(row.iso2)} variant="secondary">
                  Start<span className="sr-only"> With {row.name}</span>
                </PublicButton>
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

      <Chapter tone="dark" className="pub4-read-chapter">
        <Scene name="read" len={2} steps={3} labelledBy="countries-read-title">
          <div className="container pub4-read">
            <h2 id="countries-read-title" className="pub4-h2">
              How to Read These Facts
            </h2>
            <div className="pub4-read-grid">
              <StoryCard title="Source" body="Every fact names the page it came from." />
              <StoryCard
                title="Checked On"
                body="The day we last looked. Check the official page before you pay or travel."
              />
              <StoryCard
                title="Not Researched Yet"
                body="We hold only an official link here. No date, and no claim."
              />
            </div>
          </div>
        </Scene>
      </Chapter>
      <ScenesRuntime />
    </>
  );
}
