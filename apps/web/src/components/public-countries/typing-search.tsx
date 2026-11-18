'use client';

import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { appHrefForCountry, startHrefForCountry } from '../../lib/country-start-links';
import {
  DEMO_WORD,
  SEARCH_LIMIT,
  type SearchEntry,
  matchCountries,
  normaliseQuery,
  resultCountWords,
} from './search-match';

/** How often the demo adds or removes one letter, and how long it rests at each end (in steps). */
const STEP_MS = 170;
const REST_FULL = 10;
const REST_EMPTY = 3;

export interface TypingSearchProps {
  /** Every country the search can offer, from the public catalogue. */
  readonly index: readonly SearchEntry[];
  /** What the address asked for (`?q=`); a visitor who searched sees their own words and no demo. */
  readonly initialQuery: string;
  readonly signedIn: boolean;
  readonly signUpOpen: boolean;
  /** The page's language: country names are English, so they are marked so on a Bangla page. */
  readonly pageLang?: string;
}

/**
 * The hero search. It is a real search box first: a form that works without script (it asks the
 * page for `?q=`) and a field a person can type in at any time. Until they do, it types "Singapore"
 * by itself, over and over, so the page shows what it is for. The first focus, press or key stops
 * the demo and clears the demo word; it never takes a key from the person. Without motion, or
 * without script, it rests on the finished picture: the word typed and its results listed. The
 * results area keeps its height, so nothing moves while words come and go.
 */
export function TypingSearch({
  index,
  initialQuery,
  signedIn,
  signUpOpen,
  pageLang = 'en',
}: TypingSearchProps) {
  const searched = normaliseQuery(initialQuery).length > 0;
  const [text, setText] = useState(searched ? initialQuery : DEMO_WORD);
  const [demo, setDemo] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopDemo = useCallback(() => {
    if (timer.current === null) return;
    clearInterval(timer.current);
    timer.current = null;
    setDemo(false);
    setText('');
  }, []);

  useEffect(() => {
    if (searched) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let length = 0;
    let direction = 1;
    let rest = 0;
    setDemo(true);
    setText('');
    timer.current = setInterval(() => {
      if (rest > 0) {
        rest -= 1;
        return;
      }
      length += direction;
      if (length >= DEMO_WORD.length) {
        direction = -1;
        rest = REST_FULL;
      } else if (length <= 0) {
        direction = 1;
        rest = REST_EMPTY;
      }
      setText(DEMO_WORD.slice(0, Math.max(0, length)));
    }, STEP_MS);
    return () => {
      if (timer.current !== null) clearInterval(timer.current);
      timer.current = null;
    };
  }, [searched]);

  const matches = matchCountries(index, text, index.length);
  const results = matches.slice(0, SEARCH_LIMIT);
  // The count is of every match, so a long list never reads as a short one.
  const words = resultCountWords(matches.length, text);
  const hrefFor = (code: string) =>
    signedIn ? appHrefForCountry(code) : startHrefForCountry(code, signUpOpen);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    stopDemo();
    setText(event.target.value);
  };

  return (
    <div className="r4-search" data-demo={demo ? 'on' : 'off'}>
      <search>
        <form className="r4-search-form" action="/countries" method="get">
          <svg className="r4-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20l-4.5-4.5" />
          </svg>
          <label className="sr-only" htmlFor="countries-search">
            Search Countries
          </label>
          <input
            id="countries-search"
            className="r4-search-input"
            name="q"
            type="search"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={60}
            placeholder="Search Countries"
            value={text}
            onChange={onChange}
            onFocus={stopDemo}
            onPointerDown={stopDemo}
            onKeyDown={stopDemo}
          />
          <button className="pub-button pub-button-primary r4-search-go" type="submit">
            Search
          </button>
        </form>
      </search>
      <ul className="r4-results" aria-label="Matching Countries" data-count={results.length}>
        {results.map((entry) => (
          <li key={entry.c}>
            <a
              className="r4-result"
              href={hrefFor(entry.c)}
              lang={pageLang === 'en' ? undefined : 'en'}
            >
              {entry.f ? (
                <img
                  src={`/flags/${entry.f}.svg`}
                  alt=""
                  width={30}
                  height={22}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="r4-result-flag-none" aria-hidden="true" />
              )}
              <span>{entry.n}</span>
            </a>
          </li>
        ))}
      </ul>
      <output className="sr-only" aria-live={demo ? 'off' : 'polite'}>
        {demo ? '' : words}
      </output>
    </div>
  );
}
