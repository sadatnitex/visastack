'use client';

import { type ReactNode, useState } from 'react';
import type { RowNoun } from '../show-more';
import { ListFilterBar } from './list-filter-bar';

/** One row a person can search for: the words it is found by, and the row as the server drew it. */
export interface SearchableItem {
  readonly id: string;
  /** Everything a person might type to find it (a name, a country, a stage). */
  readonly text: string;
  readonly node: ReactNode;
}

/**
 * Every typed word has to be somewhere in the text, in any order, ignoring capital letters
 * ("japan tourist" finds "Tourist visa for Japan").
 */
export function matchesSearch(text: string, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = text.toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * The search box above a server-drawn list (Cases, Group Trips), like the one at the top of Drive
 * or Gmail. It searches only the rows the page already holds: nothing is asked of the server.
 * With nothing typed the page's own layout shows untouched (`children`: its folders, its
 * headings, its links). Typing swaps it for one flat list of the matching rows, in the order the
 * page gave them, and says how many match; with no match one plain line says what to do.
 */
export function SearchableList({
  items,
  noun,
  searchLabel,
  placeholder,
  minRows = 5,
  resultsTag = 'div',
  resultsClassName,
  children,
}: {
  readonly items: readonly SearchableItem[];
  readonly noun: RowNoun;
  /** The accessible name of the search box ("Search Cases"). */
  readonly searchLabel: string;
  readonly placeholder?: string;
  /** How many rows before the box is drawn: a short list needs no search. */
  readonly minRows?: number;
  readonly resultsTag?: 'div' | 'ul';
  readonly resultsClassName?: string;
  /** The page's own layout of these rows, shown while nothing is typed. */
  readonly children: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const matches = searching ? items.filter((item) => matchesSearch(item.text, query)) : items;
  const Results = resultsTag;
  return (
    <>
      <ListFilterBar
        rows={items.length}
        minRows={minRows}
        query={query}
        onQuery={setQuery}
        searchLabel={searchLabel}
        placeholder={placeholder ?? searchLabel}
        results={{ count: matches.length, noun }}
      />
      {searching && items.length >= minRows ? (
        matches.length > 0 ? (
          <Results {...(resultsClassName ? { className: resultsClassName } : {})}>
            {matches.map((item) => (
              <SearchHit key={item.id}>{item.node}</SearchHit>
            ))}
          </Results>
        ) : null
      ) : (
        children
      )}
    </>
  );
}

/** A found row, wrapped so each keeps its own key whatever the row draws. */
function SearchHit({ children }: { readonly children: ReactNode }) {
  return <>{children}</>;
}
