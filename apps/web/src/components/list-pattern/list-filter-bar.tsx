'use client';

import type { ReactNode } from 'react';
import type { DepthLevel } from '../../lib/ccd/depth';
import { atLevel } from '../depth';

/**
 * The search (and any other filters) above a list, drawn the same on every list screen: the
 * filters the screen gives, then a search box. A short list needs no filter, so the bar is not
 * drawn below `minRows` rows (a screen that always wants it passes 1).
 */
export function ListFilterBar({
  rows,
  minRows = 8,
  query,
  onQuery,
  searchLabel,
  placeholder = 'Search',
  level,
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
  /** The screen's own filters, drawn before the search box. */
  readonly children?: ReactNode;
}) {
  if (rows < minRows) return null;
  return (
    <div
      className="wallet-filter-controls lp-filter-bar"
      data-pattern="filter-bar"
      {...(level ? atLevel(level) : {})}
    >
      {children}
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
    </div>
  );
}
