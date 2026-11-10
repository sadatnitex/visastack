'use client';

import { Fragment, type ReactNode, useState } from 'react';
import type { RowNoun } from '../show-more';
import { ListFilterBar } from './list-filter-bar';

/** One row a person can search for: the words it is found by, and the row as the server drew it. */
export interface SearchableItem {
  readonly id: string;
  /** Everything a person might type to find it (a name, a country, a stage). */
  readonly text: string;
  readonly node: ReactNode;
  /** The heading the row sits under in the page's layout ("Past Cases"); kept in the results. */
  readonly group?: string;
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
 * headings, its links). Typing swaps it for the matching rows, in the order the page gave them
 * and under the same headings (a row with a `group`), and says how many match; with no match one plain line says what to do.
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
      {searching && items.length >= minRows
        ? groupsOf(matches).map(({ group, rows }) => (
            <Fragment key={group}>
              {group ? <h2 className="card-title lp-search-group">{group}</h2> : null}
              <Results {...(resultsClassName ? { className: resultsClassName } : {})}>
                {rows.map((item) => (
                  <Fragment key={item.id}>{item.node}</Fragment>
                ))}
              </Results>
            </Fragment>
          ))
        : children}
    </>
  );
}

/** The matches split under their headings, in the order the page gave them. */
function groupsOf(matches: readonly SearchableItem[]) {
  const groups: { group: string; rows: SearchableItem[] }[] = [];
  for (const item of matches) {
    const group = item.group ?? '';
    const existing = groups.find((entry) => entry.group === group);
    if (existing) existing.rows.push(item);
    else groups.push({ group, rows: [item] });
  }
  return groups;
}
