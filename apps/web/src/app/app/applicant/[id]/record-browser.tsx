'use client';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useT } from '../../../../components/i18n-provider';
import { StatusBadge } from '../../../../components/ui';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';
import {
  RECORD_FILTERS,
  type RecordFilter,
  type RecordItem,
  filterRecordItems,
  layoutRecordPage,
  recordFilterCount,
} from './record-hub';

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
        <div className="record-hub-filters">
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
      {shownGroups.length === 0 ? (
        // When documents did not load, the alert above already explains the short list.
        documentsLoaded ? (
          <p className="notice record-hub-empty">
            {t.node('appApplicant.appApplicantIdRecordBrowser.nothingMatchesClearTheSearchOr')}
          </p>
        ) : null
      ) : (
        shownGroups.map(({ name, rows, nothingSaved }, index) => (
          <section
            key={name}
            className="card record-hub-group"
            aria-labelledby={`${groupsId}-${index}`}
          >
            <h2 id={`${groupsId}-${index}`}>{name}</h2>
            {rows.length ? (
              <ul className="record-hub-list">
                {rows.map((item) => (
                  <li key={item.id} className="record-hub-item" data-kind={item.kind}>
                    <div className="record-hub-item-head">
                      <Link className="record-hub-item-title" href={item.href} dir="auto">
                        {item.title}
                      </Link>
                      <StatusBadge tone={item.status.tone}>{item.status.label}</StatusBadge>
                    </div>
                    {item.type ? <p className="muted">{item.type}</p> : null}
                    <ul className="record-hub-facts">
                      {item.facts.map((fact) => (
                        <li key={fact}>{fact}</li>
                      ))}
                    </ul>
                    {item.action ? (
                      <div className="record-hub-actions">
                        <Link
                          className="btn btn-secondary"
                          href={item.action.href}
                          aria-label={`${item.action.label}: ${item.title}`}
                        >
                          {item.action.label}
                        </Link>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {nothingSaved.length ? (
              <p className="muted record-hub-nothing-saved">
                Nothing saved yet:{' '}
                {nothingSaved.map((item, position) => (
                  <span key={item.id}>
                    {position > 0 ? ', ' : null}
                    <Link href={item.href}>{item.title}</Link>
                  </span>
                ))}
              </p>
            ) : null}
          </section>
        ))
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
