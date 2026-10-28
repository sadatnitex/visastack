'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import { StatusBadge } from './ui';

export interface ActivityLogEntry {
  readonly id: string;
  /** What happened, in plain words; also the "What Happened" filter. */
  readonly what: string;
  /** A second line: the case, the document or the note itself. */
  readonly detail?: string;
  /** Who did it; also the "Who" filter, offered only when entries name someone. */
  readonly who?: string;
  readonly result?: 'ALLOWED' | 'DENIED' | null;
  /** ISO time, for the period filter and the machine-readable <time>. */
  readonly at: string;
  /** The same time as people read it. */
  readonly when: string;
  readonly href?: string;
}

const PERIODS = [
  { key: 'any', label: 'Any Time', days: null },
  { key: 'day', label: 'Last 24 Hours', days: 1 },
  { key: 'week', label: 'Last 7 Days', days: 7 },
  { key: 'month', label: 'Last 30 Days', days: 30 },
] as const;
type PeriodKey = (typeof PERIODS)[number]['key'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each distinct value once, in the order it first appears (newest first). */
function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * A log that stays the same height however long it grows: the entries scroll inside their own
 * box, and a search and a few filters find one activity among many. Filtering happens here, over
 * the entries the page already loaded; nothing extra is read.
 */
export function ActivityLog({
  entries,
  label,
}: {
  readonly entries: readonly ActivityLogEntry[];
  /** The accessible name of the scrolling box, for example "Access log entries". */
  readonly label: string;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [who, setWho] = useState('');
  const [result, setResult] = useState('');
  const [period, setPeriod] = useState<PeriodKey>('any');

  const kinds = useMemo(() => distinct(entries.map((entry) => entry.what)).sort(), [entries]);
  const people = useMemo(
    () => distinct(entries.flatMap((entry) => (entry.who ? [entry.who] : []))).sort(),
    [entries],
  );
  const hasResults = entries.some((entry) => entry.result);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    const days = PERIODS.find((option) => option.key === period)?.days ?? null;
    const since = days === null ? null : Date.now() - days * DAY_MS;
    return entries.filter(
      (entry) =>
        (!kind || entry.what === kind) &&
        (!who || entry.who === who) &&
        (!result || entry.result === result) &&
        (since === null || new Date(entry.at).getTime() >= since) &&
        (!words ||
          [entry.what, entry.detail ?? '', entry.who ?? ''].some((text) =>
            text.toLowerCase().includes(words),
          )),
    );
  }, [entries, query, kind, who, result, period]);

  const filtered = Boolean(query.trim() || kind || who || result || period !== 'any');
  const clear = () => {
    setQuery('');
    setKind('');
    setWho('');
    setResult('');
    setPeriod('any');
  };

  return (
    <div className="activity-log">
      <fieldset className="activity-log-filters">
        <legend className="sr-only">Find an Activity</legend>
        <label className="activity-log-field activity-log-search" htmlFor={`${id}-q`}>
          <span className="field-label">Search</span>
          <input
            id={`${id}-q`}
            type="search"
            className="input"
            value={query}
            placeholder="A name, a document, a person"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="activity-log-field" htmlFor={`${id}-kind`}>
          <span className="field-label">What Happened</span>
          <select
            id={`${id}-kind`}
            className="input"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="">Everything</option>
            {kinds.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        {people.length > 0 ? (
          <label className="activity-log-field" htmlFor={`${id}-who`}>
            <span className="field-label">Who</span>
            <select
              id={`${id}-who`}
              className="input"
              value={who}
              onChange={(event) => setWho(event.target.value)}
            >
              <option value="">Anyone</option>
              {people.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {hasResults ? (
          <label className="activity-log-field" htmlFor={`${id}-result`}>
            <span className="field-label">Result</span>
            <select
              id={`${id}-result`}
              className="input"
              value={result}
              onChange={(event) => setResult(event.target.value)}
            >
              <option value="">Allowed or Blocked</option>
              <option value="ALLOWED">Allowed</option>
              <option value="DENIED">Blocked</option>
            </select>
          </label>
        ) : null}
        <label className="activity-log-field" htmlFor={`${id}-when`}>
          <span className="field-label">When</span>
          <select
            id={`${id}-when`}
            className="input"
            value={period}
            onChange={(event) => setPeriod(event.target.value as PeriodKey)}
          >
            {PERIODS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <div className="activity-log-summary">
        <output className="muted u-fs-085">
          {filtered
            ? `Showing ${shown.length} of ${entries.length}.`
            : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}, newest first.`}
        </output>
        {filtered ? (
          <button type="button" className="btn btn-secondary u-btn-sm" onClick={clear}>
            Clear Filters
          </button>
        ) : null}
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it */}
      <section className="activity-log-scroll" aria-label={label} tabIndex={0}>
        {shown.length === 0 ? (
          <p className="muted activity-log-none">Nothing matches these filters.</p>
        ) : (
          <ol className="rows activity-log-list">
            {shown.map((entry) => (
              <li className="row activity-log-row" key={entry.id}>
                <span className="activity-log-what">
                  <span className="row-key">
                    {entry.href ? <Link href={entry.href}>{entry.what}</Link> : entry.what}
                  </span>
                  {entry.detail ? (
                    <span className="activity-log-detail">{entry.detail}</span>
                  ) : null}
                  {entry.who ? <span className="muted u-fs-085">{entry.who}</span> : null}
                </span>
                <span className="row-end">
                  {entry.result ? (
                    <StatusBadge tone={entry.result === 'ALLOWED' ? 'success' : 'danger'}>
                      {entry.result === 'ALLOWED' ? 'Allowed' : 'Blocked'}
                    </StatusBadge>
                  ) : null}
                  <time className="muted u-fs-085" dateTime={entry.at}>
                    {entry.when}
                  </time>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
