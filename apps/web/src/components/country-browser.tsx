'use client';
import type { EntryStatus } from '@visastack/core/destinations';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { showMoreCount } from './show-more';
import { EmptyState, StatusBadge } from './ui';

export interface CountryBrowserItem {
  readonly iso2: string;
  /** Where this country's own page is, built by the page that knows which workspace it is in. */
  readonly href: string;
  readonly name: string;
  readonly status: EntryStatus;
  readonly stay: string | null;
  readonly fee: string | null;
  readonly unconfirmed: boolean;
}

export interface CountryBrowserFilter {
  readonly status: EntryStatus;
  readonly label: string;
  readonly statusLabel: string;
}

type Choice = 'all' | EntryStatus;

/** How many countries show at first, and how many more each Show More adds (WP-SB8). */
export const COUNTRY_STEP = 12;
const COUNTRY_NOUN = { one: 'country', other: 'countries' } as const;

/**
 * Search and filter over a small list of countries. Nothing here reads a database or the full data.
 * The list shows 12 countries, then Show More adds 12 at a time (WP-SB8 scroll budget); a new
 * search or filter starts again from 12. Show More is a button, not a link, because the whole
 * list is already on the page: it moves keyboard focus to the first new country, and the count
 * above the list is a polite status, so a screen reader hears the new total.
 */
export function CountryBrowser({
  items,
  filters,
}: {
  readonly items: readonly CountryBrowserItem[];
  readonly filters: readonly CountryBrowserFilter[];
}) {
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState<Choice>('all');
  const [shown, setShown] = useState(COUNTRY_STEP);
  const [landAt, setLandAt] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const text = query.trim().toLocaleLowerCase();
  const matches = items.filter(
    (item) =>
      (choice === 'all' || item.status === choice) &&
      (text === '' ||
        item.name.toLocaleLowerCase().includes(text) ||
        item.iso2.toLowerCase() === text),
  );
  const count = (status: Choice) =>
    status === 'all' ? items.length : items.filter((item) => item.status === status).length;
  const labelOf = (status: EntryStatus) =>
    filters.find((f) => f.status === status)?.statusLabel ?? '';
  const visible = matches.slice(0, shown);
  const more = matches.length > visible.length;
  const choose = (next: Choice) => {
    setChoice(next);
    setShown(COUNTRY_STEP);
  };
  const search = (next: string) => {
    setQuery(next);
    setShown(COUNTRY_STEP);
  };
  const showMore = () => {
    setLandAt(visible.length);
    setShown(visible.length + COUNTRY_STEP);
  };

  useEffect(() => {
    if (landAt === null) return;
    listRef.current?.querySelectorAll<HTMLAnchorElement>('.country-row')[landAt]?.focus();
    setLandAt(null);
  }, [landAt]);

  return (
    <>
      <div className="country-filters" aria-label="Filter by entry rule">
        <button type="button" aria-pressed={choice === 'all'} onClick={() => choose('all')}>
          <span>All Countries</span>
          <strong>{count('all')}</strong>
        </button>
        {filters
          .filter((filter) => count(filter.status) > 0)
          .map((filter) => (
            <button
              key={filter.status}
              type="button"
              aria-pressed={choice === filter.status}
              onClick={() => choose(filter.status)}
            >
              <span>{filter.label}</span>
              <strong>{count(filter.status)}</strong>
            </button>
          ))}
      </div>
      <label className="country-search">
        Search Countries
        <input
          className="input"
          type="search"
          value={query}
          onChange={(event) => search(event.target.value)}
          placeholder="For example: Japan"
        />
      </label>
      <output className="muted country-count">
        {matches.length > 0
          ? showMoreCount({
              shown: visible.length,
              total: matches.length,
              noun: COUNTRY_NOUN,
              more,
            })
          : null}
        {matches.length === 0 ? <span className="sr-only">No countries match.</span> : null}
      </output>
      {matches.length > 0 ? (
        <>
          <ul className="country-list" ref={listRef}>
            {visible.map((item) => (
              <li key={item.iso2}>
                <Link href={item.href} className="country-row">
                  <span className="country-row-name">{item.name}</span>
                  <span className="country-row-facts">
                    <StatusBadge tone={item.status === 'NOT_FOUND' ? 'warning' : 'neutral'}>
                      {labelOf(item.status)}
                    </StatusBadge>
                    {item.stay ? <span className="muted">{item.stay}</span> : null}
                    {item.fee ? <span className="muted">{item.fee}</span> : null}
                    {item.unconfirmed ? (
                      <span className="badge badge-warning">Needs Checking</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {more ? (
            <div className="show-more country-more">
              <button
                type="button"
                className="btn btn-secondary u-btn-sm show-more-link"
                onClick={showMore}
              >
                Show More<span className="sr-only"> countries</span>
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon="search" title="No Countries Match">
          Clear the search or choose another filter.
        </EmptyState>
      )}
    </>
  );
}
