import {
  DESTINATIONS,
  type Destination,
  type DestinationSource,
  destinationByIso2,
} from '@visastack/core/destinations';
import { AVAILABLE_FLAG_CODES } from '../../components/flags/available-flags';
import { ENTRY_SHORT_LABEL, trustNotes } from '../../lib/country-view';
import { type SearchParamsRecord, nextShow, parseShow } from '../../lib/paging';

/** WP-PUB4: what the public Countries page shows, built only from the sourced destination catalogue. */

/** Rows shown first, and how many more each Show More adds (the 12-then-Show-More pattern of WP-SB8). */
export const COUNTRIES_STEP = 12;
const SHOW_KEY = 'show';

/** Places the ring of flags in the hero; only those the catalogue holds and a flag file exists for. */
const RING_CHOICE = ['jp', 'gb', 'us', 'de', 'fr', 'sg', 'ae', 'ca', 'au', 'it', 'nl', 'my'];

export const RING_CODES: readonly string[] = RING_CHOICE.filter(
  (code) => destinationByIso2(code) !== undefined,
);

const FLAGS = new Set(AVAILABLE_FLAG_CODES);

export const NOT_RESEARCHED_WORDS = 'Not Researched Yet';
export const NO_DATE_WORDS = 'Date Not Recorded';
export const NO_SOURCE_WORDS = 'No Source Given';

export interface CountryRow {
  readonly iso2: string;
  readonly name: string;
  /** The code of a flag file that exists, or null. */
  readonly flag: string | null;
  readonly researched: boolean;
  /** For example "E-Visa"; null while nothing is stated. */
  readonly entry: string | null;
  /** The shown source's publisher, title or, failing both, the host of its address; null when there is no source address. */
  readonly source: string | null;
  /** "Checked On 14 Oct 2026" (the date of the source shown), or the no-date words; null for a country not researched yet. */
  readonly checked: string | null;
  /** The same warnings the signed-in list shows ("Not from an official page.", "Needs checking before you rely on it."). */
  readonly notes: readonly string[];
}

/** A name for a source page: its publisher, else its title, else its address's host name; null when it has none. */
export function sourceLabel(source: DestinationSource | null): string | null {
  if (source === null) return null;
  if (source.publisher) return source.publisher;
  if (source.title) return source.title;
  try {
    return new URL(source.url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** "Checked On 14 Oct 2026". The same words for everyone, whatever their device language. */
export function checkedOnWords(date: string): string {
  const day = new Date(date).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `Checked On ${day}`;
}

export function countryRow(destination: Destination): CountryRow {
  const code = destination.iso2.toLowerCase();
  const base = {
    iso2: destination.iso2,
    name: destination.country,
    flag: FLAGS.has(code) ? code : null,
    researched: destination.researched,
  };
  if (!destination.researched)
    return { ...base, entry: null, source: null, checked: null, notes: [] };
  const shown = destination.source;
  const when = shown?.checkedOn ?? null;
  return {
    ...base,
    entry:
      destination.entryStatus === 'NOT_FOUND' ? null : ENTRY_SHORT_LABEL[destination.entryStatus],
    source: sourceLabel(shown),
    checked: when === null ? NO_DATE_WORDS : checkedOnWords(when),
    // A fact with no source gets "No Source Given" on its own line, so only a real source adds the warnings.
    notes: shown === null ? [] : trustNotes(shown),
  };
}

/** In name order (English rules, so the order is the same on every machine). Rows are built only for what is drawn. */
const SORTED: readonly Destination[] = [...DESTINATIONS].sort((a, b) =>
  a.country.localeCompare(b.country, 'en'),
);

export interface CountriesWindow {
  readonly rows: readonly CountryRow[];
  readonly total: number;
  readonly shown: number;
  /** The `show` value for the next Show More, or null at the end. */
  readonly next: number | null;
}

/**
 * The rows to draw for `?show=`. Missing, repeated or hand-edited values are clamped by `parseShow`
 * to whole steps; the ceiling is the whole list rounded up to a step, so Show More always reaches the end.
 */
export function countriesWindow(params: SearchParamsRecord): CountriesWindow {
  const total = SORTED.length;
  const max = Math.max(1, Math.ceil(total / COUNTRIES_STEP)) * COUNTRIES_STEP;
  const shown = Math.min(total, parseShow(params[SHOW_KEY], { step: COUNTRIES_STEP, max }));
  const next = shown < total ? nextShow(shown, { step: COUNTRIES_STEP, max }) : null;
  return { rows: SORTED.slice(0, shown).map(countryRow), total, shown, next };
}

/** The id of a country's row, so Show More can land on the first new one. */
export function rowId(iso2: string): string {
  return `country-${iso2}`;
}

/** The id of the first row a Show More click adds, or null at the end. */
export function firstNewRowId(window: CountriesWindow): string | null {
  const row = SORTED[window.shown];
  return window.next === null || row === undefined ? null : rowId(row.iso2);
}
