'use client';
import { useId, useState } from 'react';
import { useT } from '../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';
import {
  RECORD_FILTERS,
  type RecordFilter,
  type RecordItem,
  filterRecordItems,
  layoutRecordPage,
  recordFilterCount,
} from './record-hub';
import { NotStartedRows, RecordRow } from './record/record-row';

/** The same page length as the documents wallet. */
const PAGE_SIZE = 12;

/** Filters that only documents can match; they have nothing to count when documents did not load. */
const DOCUMENT_FILTERS: ReadonlySet<RecordFilter> = new Set(['ready', 'attention', 'previous']);

/**
 * Find anything in the Personal Record by its details (WP-V3 part 2). The list arrives from the
 * server already limited to what the owner can see; searching and filtering only narrow it. The
 * controls follow the documents wallet: state filters, then Category, then Search, then a count.
 */
export function RecordBrowser({
  items,
  documentsLoaded = true,
}: {
  readonly items: readonly RecordItem[];
  /** False when the documents could not be read, so document counts are unknown, not zero. */
  readonly documentsLoaded?: boolean;
}) {
  const t = useT(appApplicantCatalog);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [filter, setFilter] = useState<RecordFilter>('all');
  const [page, setPage] = useState(0);
  const searchId = useId();
  const groupId = useId();
  const groupsId = useId();
  const groups = [...new Set(items.map((item) => item.group))];
  const matches = filterRecordItems(items, { query, group, filter });
  const {
    groups: shownGroups,
    notStarted,
    rowCount,
    pageCount,
    activePage,
  } = layoutRecordPage(matches, {
    filter,
    page,
    pageSize: PAGE_SIZE,
  });
  const counts = Object.fromEntries(
    RECORD_FILTERS.map(({ key }) => [key, recordFilterCount(items, key)]),
  ) as Record<RecordFilter, number>;
  const unavailable = (key: RecordFilter) => !documentsLoaded && DOCUMENT_FILTERS.has(key);

  return (
    <div className="record-hub">
      <fieldset className="record-hub-filter-set">
        <legend className="sr-only">
          {t.node('appApplicant.appApplicantIdRecordBrowser.recordFilters')}
        </legend>
        <div className="u6-filters">
          {RECORD_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              disabled={unavailable(key)}
              onClick={() => {
                setFilter(key);
                setPage(0);
              }}
            >
              <span>{label}</span>
              {unavailable(key) ? (
                <span className="record-hub-filter-unavailable">
                  {t.node('appApplicant.appApplicantIdRecordBrowser.notAvailableRightNow')}
                </span>
              ) : (
                <strong>{counts[key]}</strong>
              )}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="wallet-filter-controls">
        <label htmlFor={groupId}>
          Category
          <select
            id={groupId}
            className="input"
            value={group}
            onChange={(event) => {
              setGroup(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All Categories</option>
            {groups.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={searchId}>
          {t.node('appApplicant.appApplicantIdRecordBrowser.searchYourRecord')}
          <input
            id={searchId}
            className="input"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={t('appApplicant.appApplicantIdRecordBrowser.namesKindsCategoriesOrCases')}
          />
        </label>
      </div>
      <output className="muted record-hub-count" aria-live="polite">
        {rowCount === 1
          ? t.node('appApplicant.appApplicantIdRecordBrowser.1ItemMatches')
          : t.node('appApplicant.appApplicantIdRecordBrowser.rowcountItemsMatch', {
              rowCount: rowCount,
            })}
        {pageCount > 1 ? ` Page ${activePage + 1} of ${pageCount}.` : null}
      </output>
      {shownGroups.length === 0 && notStarted.length === 0 ? (
        // When documents did not load, the alert above already explains the short list.
        documentsLoaded ? (
          <p className="notice record-hub-empty">
            {t.node('appApplicant.appApplicantIdRecordBrowser.nothingMatchesClearTheSearchOr')}
          </p>
        ) : null
      ) : (
        <>
          {shownGroups.map(({ name, rows }, index) => (
            <section
              key={name}
              className="record-hub-group u6-group"
              aria-labelledby={`${groupsId}-${index}`}
            >
              <h2 id={`${groupsId}-${index}`}>{name}</h2>
              <ul className="u6-rows">
                {rows.map((item) => (
                  <RecordRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ))}
          {notStarted.length ? (
            <section
              className="record-hub-group u6-group"
              aria-labelledby={`${groupsId}-not-started`}
            >
              <h2 id={`${groupsId}-not-started`}>
                {t.node('appApplicant.appApplicantIdRecordRow.notStarted')}
              </h2>
              <NotStartedRows groups={notStarted} />
            </section>
          ) : null}
        </>
      )}
      {pageCount > 1 ? (
        <div
          className="wallet-pagination"
          aria-label={t('appApplicant.appApplicantIdRecordBrowser.recordPages')}
        >
          <button
            type="button"
            className="btn btn-secondary"
            disabled={activePage === 0}
            onClick={() => setPage(activePage - 1)}
          >
            {t.node('appApplicant.appApplicantIdRecordBrowser.previous')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={activePage + 1 === pageCount}
            onClick={() => setPage(activePage + 1)}
          >
            {t.node('appApplicant.appApplicantIdPage.next')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
