'use client';

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { componentsCatalog } from '../../i18n/components';
import { countriesPublicCatalog } from '../../i18n/countries-public';
import { appHrefForCountry, startHrefForCountry } from '../../lib/country-start-links';
import { usePageLanguage, useT } from '../i18n-provider';
import { MotionToggle, useMotionPaused } from './motion-pause';
import {
  DEMO_WORD,
  SEARCH_LIMIT,
  SEARCH_MAX,
  type SearchEntry,
  matchCountries,
  normaliseQuery,
  searchStatus,
} from './search-match';

/** How often the demo adds or removes one letter, and how long it rests at each end (in steps). */
const STEP_MS = 170;
const REST_FULL = 10;
const REST_EMPTY = 3;
/** How long typing must pause before a screen reader hears the new count. */
const ANNOUNCE_MS = 500;

export interface TypingSearchProps {
  /** Every country the search can offer, from the public catalogue. */
  readonly index: readonly SearchEntry[];
  /** What the address asked for (`?q=`); a visitor who searched sees their own words and no demo. */
  readonly initialQuery: string;
  readonly signedIn: boolean;
  readonly signUpOpen: boolean;
}

/**
 * The hero search. It is a real search box first: a form that works without script (it asks the
 * page for `?q=`) and a field a person can type in at any time. Until they do, it types "Singapore"
 * by itself, over and over, so the page shows what it is for. The first focus, press or key stops
 * the demo and clears the demo word; it never takes a key from the person. Without motion, or
 * without script, it rests on the finished picture: the word typed and its results listed. The
 * results area keeps its height, so nothing moves while words come and go. A screen reader hears
 * the count after typing pauses, never on every key, and never while the demo runs.
 */
export function TypingSearch({ index, initialQuery, signedIn, signUpOpen }: TypingSearchProps) {
  const pageLang = usePageLanguage();
  const tc = useT(componentsCatalog);
  const t = useT(countriesPublicCatalog);
  const searched = normaliseQuery(initialQuery).length > 0;
  const [text, setText] = useState(searched ? initialQuery : DEMO_WORD);
  // The field holds the demo word (moving, or resting under reduced motion), not a person's text.
  const [demoWord, setDemoWord] = useState(!searched);
  const [moving, setMoving] = useState(false);
  const [askedToType, setAskedToType] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const demoRef = useRef(!searched);
  const paused = useMotionPaused();
  // Where the demo has got to, so Play carries on instead of starting over.
  const progress = useRef({ length: 0, direction: 1, rest: 0, started: false });

  const stopDemo = useCallback(() => {
    if (!demoRef.current) return;
    demoRef.current = false;
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    setMoving(false);
    setDemoWord(false);
    setText('');
  }, []);

  useEffect(() => {
    if (searched || !demoRef.current) return;
    const field = input.current;
    // A person who focused or typed before the page woke up keeps their own text; no demo then.
    if (
      !progress.current.started &&
      field &&
      (document.activeElement === field || field.value !== DEMO_WORD)
    ) {
      demoRef.current = false;
      setDemoWord(false);
      setText(field.value);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const step = progress.current;
    if (!step.started) {
      step.started = true;
      setMoving(true);
      setText('');
    }
    if (paused) return;
    timer.current = setInterval(() => {
      if (step.rest > 0) {
        step.rest -= 1;
        return;
      }
      step.length += step.direction;
      if (step.length >= DEMO_WORD.length) {
        step.direction = -1;
        step.rest = REST_FULL;
      } else if (step.length <= 0) {
        step.direction = 1;
        step.rest = REST_EMPTY;
      }
      setText(DEMO_WORD.slice(0, Math.max(0, step.length)));
    }, STEP_MS);
    return () => {
      if (timer.current !== null) clearInterval(timer.current);
      timer.current = null;
    };
  }, [searched, paused]);

  const matches = matchCountries(index, text, index.length);
  const results = matches.slice(0, SEARCH_LIMIT);
  const status = askedToType
    ? ({ kind: 'ask' } as const)
    : searchStatus(matches.length, text, SEARCH_LIMIT);
  const words =
    status.kind === 'ask'
      ? t('countriesPublic.search.typeACountry')
      : status.kind === 'short'
        ? t('countriesPublic.search.typeMore')
        : status.kind === 'none'
          ? tc('components.countryBrowser.noCountriesMatch')
          : status.kind === 'found'
            ? t('countriesPublic.search.found', { count: status.count })
            : status.kind === 'first'
              ? t('countriesPublic.search.foundFirst', {
                  count: status.count,
                  limit: status.limit,
                })
              : '';

  // The screen-reader copy follows after typing pauses; the demo says nothing at all.
  const [announced, setAnnounced] = useState(moving ? '' : words);
  useEffect(() => {
    if (moving) {
      setAnnounced('');
      return;
    }
    const wait = setTimeout(() => setAnnounced(words), ANNOUNCE_MS);
    return () => clearTimeout(wait);
  }, [moving, words]);

  const hrefFor = (code: string) =>
    signedIn ? appHrefForCountry(code) : startHrefForCountry(code, signUpOpen);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    // Searching while the demo word is still there would send the demo's letters: clear the field,
    // put the cursor in it and say what to do, so the button never looks dead.
    if (!demoRef.current) return;
    event.preventDefault();
    stopDemo();
    setAskedToType(true);
    input.current?.focus();
  };
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    stopDemo();
    setAskedToType(false);
    setText(event.target.value);
  };

  return (
    <div className="r4-search" data-demo={moving ? 'on' : 'off'}>
      <search>
        <form className="r4-search-form" action="/countries" method="get" onSubmit={onSubmit}>
          <svg className="r4-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20l-4.5-4.5" />
          </svg>
          <label className="sr-only" htmlFor="countries-search">
            {tc.node('components.countryBrowser.searchCountries')}
          </label>
          <input
            ref={input}
            id="countries-search"
            className="r4-search-input"
            name="q"
            type="search"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={SEARCH_MAX}
            placeholder={tc('components.countryBrowser.searchCountries')}
            {...(demoWord ? (pageLang === 'en' ? {} : { lang: 'en' }) : tc.lang('components.countryBrowser.searchCountries'))}
            value={text}
            onChange={onChange}
            onFocus={stopDemo}
            onPointerDown={stopDemo}
            onKeyDown={stopDemo}
          />
          <button className="pub-button pub-button-primary r4-search-go" type="submit">
            {tc.node('components.activityLog.search')}
          </button>
        </form>
      </search>
      <ul
        className="r4-results"
        aria-label={t('countriesPublic.search.matchingCountries')}
        data-count={results.length}
      >
        {results.map((entry) => (
          <li key={entry.c}>
            <a className="r4-result" href={hrefFor(entry.c)} {...(pageLang === 'en' ? {} : { lang: 'en' })}>
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
      <p className="r4-search-status" aria-hidden="true">
        {moving ? '' : words}
      </p>
      <MotionToggle />
      <output className="sr-only" aria-live={moving ? 'off' : 'polite'}>
        {announced}
      </output>
    </div>
  );
}
