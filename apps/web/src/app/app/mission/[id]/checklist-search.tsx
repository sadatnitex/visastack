'use client';

import { useEffect, useState } from 'react';
import { ListFilterBar } from '../../../../components/list-pattern';

/**
 * Search above a long checklist, drawn only once the page's script runs and the list is long
 * enough to need it (the kit's rule: about eight rows). The rows are the server's; this hides the
 * ones that do not match, opens the folders that still hold a match and shows the sticky bar
 * under the page header while the list scrolls. Nothing is removed from the page: clearing the
 * search shows every row again.
 */
export function ChecklistSearch({
  scopeId,
  rows,
}: {
  /** The element that holds the checklist rows. */
  readonly scopeId: string;
  readonly rows: number;
}) {
  const [query, setQuery] = useState('');
  const [drawn, setDrawn] = useState(false);
  const [matches, setMatches] = useState(rows);
  useEffect(() => setDrawn(true), []);

  useEffect(() => {
    const scope = document.getElementById(scopeId);
    if (!scope) return;
    const needle = query.trim().toLocaleLowerCase();
    let shown = 0;
    for (const row of scope.querySelectorAll<HTMLElement>('[data-pattern="list-row"]')) {
      const link = row.querySelector('a[data-pane-open]');
      const text = (link?.getAttribute('aria-label') ?? row.textContent ?? '').toLocaleLowerCase();
      const hit = needle === '' || text.includes(needle);
      row.hidden = !hit;
      if (hit) shown += 1;
    }
    // A category heading with no row under it, and a folder with no match, step aside; a folder
    // that holds a match opens so the match is on screen.
    for (const category of scope.querySelectorAll<HTMLElement>('.case-category')) {
      category.hidden = !category.querySelector('[data-pattern="list-row"]:not([hidden])');
    }
    for (const folder of scope.querySelectorAll<HTMLDetailsElement>('details.collapsible-group')) {
      const has = folder.querySelector('[data-pattern="list-row"]:not([hidden])') !== null;
      folder.hidden = !has;
      if (needle !== '' && has) {
        folder.open = true;
        for (const rest of folder.querySelectorAll<HTMLDetailsElement>(
          'details.case-checklist-rest',
        )) {
          if (rest.querySelector('[data-pattern="list-row"]:not([hidden])')) rest.open = true;
        }
      }
    }
    setMatches(shown);
  }, [query, scopeId]);

  if (!drawn) return null;
  return (
    <div className="lp-sticky-filter">
      <ListFilterBar
        rows={rows}
        query={query}
        onQuery={setQuery}
        searchLabel="Search the Checklist"
        placeholder="Search the Checklist"
      />
      <output className="sr-only">
        {matches} of {rows} items match.
      </output>
      {matches === 0 ? <p className="muted u-fs-085">No Items Match</p> : null}
    </div>
  );
}
