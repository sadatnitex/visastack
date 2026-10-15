'use client';
import type { EntryStatus } from '@visastack/core/destinations';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, StatusBadge } from './ui';

export interface CountryBrowserItem {
  readonly iso2: string;
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

/** Search and filter over a small list of countries. Nothing here reads a database or the full data. */
export function CountryBrowser({
  items,
  filters,
}: {
  readonly items: readonly CountryBrowserItem[];
  readonly filters: readonly CountryBrowserFilter[];
}) {
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState<Choice>('all');
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

  return (
    <>
      <div className="country-filters" aria-label="Filter by entry rule">
        <button type="button" aria-pressed={choice === 'all'} onClick={() => setChoice('all')}>
          <span>All countries</span>
          <strong>{count('all')}</strong>
        </button>
        {filters
          .filter((filter) => count(filter.status) > 0)
          .map((filter) => (
            <button
              key={filter.status}
              type="button"
              aria-pressed={choice === filter.status}
              onClick={() => setChoice(filter.status)}
            >
              <span>{filter.label}</span>
              <strong>{count(filter.status)}</strong>
            </button>
          ))}
      </div>
      <label className="country-search">
        Search countries
        <input
          className="input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="For example: Japan"
        />
      </label>
      <output className="muted">
        {matches.length} {matches.length === 1 ? 'country' : 'countries'} shown.
      </output>
      {matches.length > 0 ? (
        <ul className="country-list">
          {matches.map((item) => (
            <li key={item.iso2}>
              <Link href={`/app/countries/${item.iso2.toLowerCase()}`} className="country-row">
                <span className="country-row-name">{item.name}</span>
                <span className="country-row-facts">
                  <StatusBadge tone={item.status === 'NOT_FOUND' ? 'warning' : 'neutral'}>
                    {labelOf(item.status)}
                  </StatusBadge>
                  {item.stay ? <span className="muted">{item.stay}</span> : null}
                  {item.fee ? <span className="muted">{item.fee}</span> : null}
                  {item.unconfirmed ? (
                    <span className="badge badge-warning">Needs checking</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="search" title="No countries match">
          Clear the search or choose another filter.
        </EmptyState>
      )}
    </>
  );
}
