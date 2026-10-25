'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { StatusBadge } from '../../../../components/ui';
import {
  RECORD_FILTERS,
  type RecordFilter,
  type RecordItem,
  filterRecordItems,
} from './record-hub';

/**
 * Find anything in the Personal Record by its details (WP-V3 part 2). The list arrives from the
 * server already limited to what the owner can see; searching and filtering only narrow it.
 */
export function RecordBrowser({ items }: { readonly items: readonly RecordItem[] }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [filter, setFilter] = useState<RecordFilter>('all');
  const searchId = useId();
  const groupId = useId();
  const groups = [...new Set(items.map((item) => item.group))];
  const matches = filterRecordItems(items, { query, group, filter });
  const counts = Object.fromEntries(
    RECORD_FILTERS.map(({ key }) => [
      key,
      filterRecordItems(items, { query: '', group: 'all', filter: key }).length,
    ]),
  ) as Record<RecordFilter, number>;
  const shownGroups = groups.filter((name) => matches.some((item) => item.group === name));

  return (
    <div className="record-hub">
      <div className="wallet-overview-strip record-hub-filters" aria-label="Record filters">
        {RECORD_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            <span>{label}</span>
            <strong>{counts[key]}</strong>
          </button>
        ))}
      </div>
      <div className="wallet-filter-controls record-hub-controls">
        <label htmlFor={searchId}>
          Search Your Record
          <input
            id={searchId}
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Names, kinds, groups or cases"
          />
        </label>
        <label htmlFor={groupId}>
          Group
          <select
            id={groupId}
            className="input"
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          >
            <option value="all">All Groups</option>
            {groups.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <output className="sr-only" aria-live="polite">
        {matches.length === 1 ? '1 record shown' : `${matches.length} records shown`}
      </output>
      {matches.length === 0 ? (
        <p className="notice record-hub-empty">
          Nothing matches. Clear the search or choose another group or filter.
        </p>
      ) : (
        shownGroups.map((name) => (
          <section key={name} className="card record-hub-group" aria-label={name}>
            <h3>{name}</h3>
            <ul className="record-hub-list">
              {matches
                .filter((item) => item.group === name)
                .map((item) => (
                  <li key={item.id} className="record-hub-item" data-kind={item.kind}>
                    <div className="record-hub-item-head">
                      <strong dir="auto">{item.title}</strong>
                      <StatusBadge tone={item.status.tone}>{item.status.label}</StatusBadge>
                    </div>
                    {item.type ? <p className="muted">{item.type}</p> : null}
                    <ul className="record-hub-facts">
                      {item.facts.map((fact) => (
                        <li key={fact}>{fact}</li>
                      ))}
                    </ul>
                    <div className="record-hub-actions">
                      {item.actions.map((action) => (
                        <Link
                          key={action.label}
                          className="btn btn-secondary"
                          href={action.href}
                          aria-label={`${action.label}: ${item.title}`}
                        >
                          {action.label}
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
