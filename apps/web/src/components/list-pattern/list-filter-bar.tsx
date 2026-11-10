'use client';

import { type ReactNode, useId, useState } from 'react';
import type { DepthLevel } from '../../lib/ccd/depth';
import { atLevel } from '../depth';
import type { RowNoun } from '../show-more';

/**
 * The search (and any other filters) above a list, drawn the same on every list screen, like the
 * search at the top of Google Drive or Gmail: the search box first, always in view, then a
 * "Filters" button with the number of filters in use, which opens the screen's own filters. A
 * short list needs no search, so the bar is not drawn below `minRows` rows (a screen that always
 * wants it passes 1).
 *
 * Given `results`, the bar also says how many rows match (read out politely, for a screen reader)
 * and, when a search or a filter leaves nothing, one plain line about what to do next.
 */
export function ListFilterBar({
  rows,
  minRows = 8,
  query,
  onQuery,
  searchLabel,
  placeholder = 'Search',
  level,
  filtersLevel,
  activeFilters = 0,
  results,
  children,
}: {
  /** How many rows the list holds before filtering. */
  readonly rows: number;
  readonly minRows?: number;
  readonly query: string;
  readonly onQuery: (value: string) => void;
  /** The accessible name of the search box ("Search Documents"). */
  readonly searchLabel: string;
  readonly placeholder?: string;
  /** The depth the bar shows at, when it is not at every depth. */
  readonly level?: DepthLevel;
  /** The depth the Filters button shows at, when the search is wanted at every depth but not it. */
  readonly filtersLevel?: DepthLevel;
  /** How many of the screen's own filters are in use now; shown on the Filters button. */
  readonly activeFilters?: number;
  /** How many rows match now, and what they are called, so the bar can say so. */
  readonly results?: { readonly count: number; readonly noun: RowNoun };
  /** The screen's own filters; they open behind a Filters button, after the search box. */
  readonly children?: ReactNode;
}) {
  const filtersId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  if (rows < minRows) return null;
  const searching = query.trim() !== '';
  const narrowed = searching || activeFilters > 0;
  const none = results !== undefined && results.count === 0 && narrowed;
  return (
    <div className="lp-filter-bar-wrap" {...(level ? atLevel(level) : {})}>
      <div className="wallet-filter-controls lp-filter-bar" data-pattern="filter-bar">
        <label>
          <span className="sr-only">{searchLabel}</span>
          <input
            className="input"
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={placeholder}
          />
        </label>
        {children ? (
          <button
            type="button"
            className="btn btn-secondary lp-filters-toggle"
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
            onClick={() => setFiltersOpen((open) => !open)}
            {...(filtersLevel ? atLevel(filtersLevel) : {})}
          >
            Filters
            {activeFilters > 0 ? (
              <>
                <span className="lp-filters-count" aria-hidden="true">
                  {activeFilters}
                </span>
                <span className="sr-only">{`, ${activeFilters} in use`}</span>
              </>
            ) : null}
          </button>
        ) : null}
      </div>
      {children ? (
        <div
          className="lp-filters-panel"
          id={filtersId}
          hidden={!filtersOpen}
          {...(filtersLevel ? atLevel(filtersLevel) : {})}
        >
          {children}
        </div>
      ) : null}
      {results ? (
        <output className="sr-only">
          {narrowed
            ? `${results.count} ${results.count === 1 ? results.noun.one : results.noun.other} ${results.count === 1 ? 'matches' : 'match'}.`
            : ''}
        </output>
      ) : null}
      {none ? (
        <p className="muted lp-filter-none">
          {`No ${results.noun.other} match. `}
          {searching ? 'Clear the search' : 'Remove a filter'}
          {searching && activeFilters > 0 ? ' or remove a filter' : ''}
          {' to see more. '}
          {searching ? (
            <button
              type="button"
              className="btn btn-secondary u-btn-sm"
              onClick={() => onQuery('')}
            >
              Clear Search
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
