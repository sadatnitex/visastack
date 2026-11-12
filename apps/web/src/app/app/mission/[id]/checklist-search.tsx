'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../../components/i18n-provider';
import { ListFilterBar } from '../../../../components/list-pattern';
import { appMissionCatalog } from '../../../../i18n/app-mission';

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
  const t = useT(appMissionCatalog);
  const [query, setQuery] = useState('');
  const [drawn, setDrawn] = useState(false);
  const [matches, setMatches] = useState(rows);
  // The folds as they were before the first search, put back when the search is cleared.
  const folds = useRef<Map<HTMLDetailsElement, boolean> | null>(null);
  useEffect(() => setDrawn(true), []);

  useEffect(() => {
    const scope = document.getElementById(scopeId);
    if (!scope) return;
    const needle = query.trim().toLocaleLowerCase();
    let shown = 0;
    if (needle !== '' && folds.current === null) {
      folds.current = new Map(
        [...scope.querySelectorAll<HTMLDetailsElement>('details')].map(
          (fold) => [fold, fold.open] as const,
        ),
      );
    }
    for (const row of scope.querySelectorAll<HTMLElement>('[data-pattern="list-row"]')) {
      // The name only, in full: a cut name is searched by its whole sentence, a short one by itself.
      const link = row.querySelector('a[data-pane-open]');
      const text = (
        link?.getAttribute('aria-label') ??
        link?.textContent ??
        ''
      ).toLocaleLowerCase();
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
    if (needle === '' && folds.current) {
      for (const [fold, open] of folds.current) fold.open = open;
      folds.current = null;
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
        placeholder={t('appMission.appMissionIdChecklistSearch.searchTheChecklist')}
      />
      <output className="sr-only">
        {t('appMission.appMissionIdChecklistSearch.matchesOfRowsItemsMatch', {
          matches: matches,
          rows: rows,
        })}
      </output>
      {matches === 0 ? (
        <p className="muted u-fs-085">{t('appMission.appMissionIdChecklistSearch.noItemsMatch')}</p>
      ) : null}
    </div>
  );
}
