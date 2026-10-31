'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import { StatusBadge } from './ui';

export interface ActivityLogEntry {
  readonly id: string;
  /** What happened, in plain words; also the "What Happened" filter. */
  readonly what: string;
  /** A second line, for example the record or the reason; searched too. */
  readonly detail?: string;
  /** Who did it; also the "Who" filter, offered only when entries name someone. */
  readonly who?: string;
  /** The outcome as the page words it ("Allowed", "Blocked"); also the "Result" filter. */
  readonly outcome?: { readonly label: string; readonly tone: 'success' | 'danger' | 'neutral' };
  /** ISO time, for the period filter and the machine-readable <time>. */
  readonly at: string;
  /** The same time as people read it. */
  readonly when: string;
}

const PERIODS = [
  { key: 'any', label: 'Any Time', days: null },
  { key: 'day', label: 'Last 24 Hours', days: 1 },
  { key: 'week', label: 'Last 7 Days', days: 7 },
  { key: 'month', label: 'Last 30 Days', days: 30 },
] as const;
type PeriodKey = (typeof PERIODS)[number]['key'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each distinct value once, sorted. */
function distinct(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** A chosen filter value that is no longer among the options counts as no filter. */
function stillOffered(value: string, options: readonly string[]): string {
  return options.includes(value) ? value : '';
}

/**
 * A log that stays the same height however long it grows: the entries scroll inside their own
 * box, and a search and a few filters find one activity among many. Filtering happens here, over
 * the entries the page already loaded (newest first); the summary line says how far back they go,
 * so a period filter never seems to cover more than was loaded.
 *
 * Long logs load from the server one page at a time (WP-SB0): `olderHref` adds a Show Older
 * Entries link under the box (the page builds it with `pagingHref` and a server cursor), and
 * `newestHref` a way back to the newest page. Without those props the log looks and behaves as it
 * always has.
 */
export function ActivityLog({
  entries,
  label,
  id: anchorId,
  olderHref,
  newestHref,
  totalLabel,
}: {
  readonly entries: readonly ActivityLogEntry[];
  /** The accessible name of the scrolling box, for example "Access Log Entries". */
  readonly label: string;
  /** An id for the whole log, so a Show Older Entries address can land back on it. */
  readonly id?: string;
  /** The address of the next, older page of entries; left out when nothing older exists. */
  readonly olderHref?: string;
  /** The address of the newest page, shown while an older page is open. */
  readonly newestHref?: string;
  /** A closing sentence for the summary line, for example "1,240 entries in all." */
  readonly totalLabel?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [whatChoice, setWhat] = useState('');
  const [whoChoice, setWho] = useState('');
  const [outcomeChoice, setOutcome] = useState('');
  const [period, setPeriod] = useState<PeriodKey>('any');

  const whats = useMemo(() => distinct(entries.map((entry) => entry.what)), [entries]);
  const people = useMemo(
    () => distinct(entries.flatMap((entry) => (entry.who ? [entry.who] : []))),
    [entries],
  );
  const outcomes = useMemo(
    () => distinct(entries.flatMap((entry) => (entry.outcome ? [entry.outcome.label] : []))),
    [entries],
  );
  // After the page refreshes, a value that has left the list must not keep filtering unseen.
  const what = stillOffered(whatChoice, whats);
  const who = stillOffered(whoChoice, people);
  const outcome = stillOffered(outcomeChoice, outcomes);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    const days = PERIODS.find((option) => option.key === period)?.days ?? null;
    const since = days === null ? null : Date.now() - days * DAY_MS;
    return entries.filter(
      (entry) =>
        (!what || entry.what === what) &&
        (!who || entry.who === who) &&
        (!outcome || entry.outcome?.label === outcome) &&
        (since === null || new Date(entry.at).getTime() >= since) &&
        (!words ||
          [entry.what, entry.detail ?? '', entry.who ?? ''].some((text) =>
            text.toLowerCase().includes(words),
          )),
    );
  }, [entries, query, what, who, outcome, period]);

  const filtered = Boolean(query.trim() || what || who || outcome || period !== 'any');
  const oldest = entries.at(-1);
  const reach = oldest ? `, back to ${oldest.when}` : '';
  // On an older page the entries are not the newest any more, so the summary says "older".
  const which = newestHref ? 'older' : 'newest';
  const total = totalLabel ? ` ${totalLabel}` : '';
  const clear = () => {
    setQuery('');
    setWhat('');
    setWho('');
    setOutcome('');
    setPeriod('any');
  };

  return (
    <div className="activity-log" id={anchorId}>
      <fieldset className="activity-log-filters">
        <legend className="sr-only">Find an Activity</legend>
        <label className="activity-log-field activity-log-search" htmlFor={`${id}-q`}>
          <span className="field-label">Search</span>
          <input
            id={`${id}-q`}
            type="search"
            className="input"
            value={query}
            placeholder="Search this log"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="activity-log-field" htmlFor={`${id}-what`}>
          <span className="field-label">What Happened</span>
          <select
            id={`${id}-what`}
            className="input"
            value={what}
            onChange={(event) => setWhat(event.target.value)}
          >
            <option value="">Everything</option>
            {whats.map((option) => (
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
        {outcomes.length > 0 ? (
          <label className="activity-log-field" htmlFor={`${id}-outcome`}>
            <span className="field-label">Result</span>
            <select
              id={`${id}-outcome`}
              className="input"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
            >
              <option value="">Any Result</option>
              {outcomes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
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
            ? `Showing ${shown.length} of the ${entries.length} ${which} entries${reach}.${total}`
            : `The ${entries.length} ${which} ${entries.length === 1 ? 'entry' : 'entries'}${reach}.${total}`}
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
                  <span className="row-key">{entry.what}</span>
                  {entry.detail ? (
                    <span className="activity-log-detail">{entry.detail}</span>
                  ) : null}
                  {entry.who ? <span className="muted u-fs-085">{entry.who}</span> : null}
                </span>
                <span className="row-end">
                  {entry.outcome ? (
                    <StatusBadge tone={entry.outcome.tone}>{entry.outcome.label}</StatusBadge>
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
      {olderHref || newestHref ? (
        <nav className="activity-log-more" aria-label={`More of ${label}`}>
          {newestHref ? (
            <Link className="btn btn-secondary u-btn-sm" href={newestHref}>
              Show Newest Entries
            </Link>
          ) : null}
          {olderHref ? (
            <Link className="btn btn-secondary u-btn-sm" href={olderHref}>
              Show Older Entries
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
