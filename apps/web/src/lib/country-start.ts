import { DESTINATIONS, type Destination, routesForDestination } from '@visastack/core/destinations';
import { cleanIso2 } from './country-start-links';
import { ENTRY_LABEL, THIN_LIST, isUnofficial, needsChecking } from './country-view';

/**
 * The slim record behind "Pick a country, see the checklist at once" (Growth G2). The data is
 * static, so the checklist for every country that has one is sent with the page (about 12 KB) and
 * the picker fills in with no waiting. Server side only: this is the one place that reads the full
 * country data for the picker, so the browser component never loads it.
 */

export type StartItemKind = 'DOCUMENT' | 'DETAIL' | 'PROCESS_STEP';

export interface StartItem {
  readonly text: string;
  readonly optional: boolean;
  readonly onlyWhen: string | null;
  readonly maxAgeDays: number | null;
  /** The source is unofficial or flagged: say so beside the item, as the country page does. */
  readonly check: boolean;
}

export interface StartGroup {
  readonly kind: StartItemKind;
  readonly label: string;
  readonly items: readonly StartItem[];
}

export interface StartRoute {
  readonly key: string;
  readonly name: string;
  readonly groups: readonly StartGroup[];
  readonly total: number;
  /** Fewer items than a full list would have: the picker says it may not be complete. */
  readonly thin: boolean;
}

export interface StartCountry {
  readonly iso2: string;
  readonly name: string;
  /** Other names people type for it (checked against the data in the tests). */
  readonly aka: readonly string[];
  /** What the entry rule is, in plain words (never "approved"). */
  readonly entry: string;
  readonly researched: boolean;
  /** Route keys, the fullest list first. */
  readonly routeKeys: readonly string[];
  readonly officialUrl: string | null;
}

export interface StartData {
  readonly countries: readonly StartCountry[];
  readonly routes: Readonly<Record<string, StartRoute>>;
  /** How many countries have a checklist today. */
  readonly withChecklist: number;
}

/**
 * Other names people type for a country, by its code. Only whole names count when the box is read,
 * so none of these can be reached by a half-typed word. A test holds each code to a country in the
 * data and each name to a country that has no other claim on it.
 */
export const COUNTRY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  AE: ['UAE', 'Emirates'],
  CI: ['Ivory Coast'],
  CZ: ['Czech Republic'],
  GB: ['UK', 'Britain', 'Great Britain', 'England'],
  HK: ['Hong Kong'],
  LA: ['Lao'],
  MK: ['Macedonia'],
  MM: ['Burma'],
  NL: ['Holland'],
  TL: ['East Timor'],
  TR: ['Turkey'],
  US: ['USA', 'US', 'America'],
  VN: ['Viet Nam'],
};

const KIND_LABEL: Readonly<Record<StartItemKind, string>> = {
  DOCUMENT: 'Documents',
  DETAIL: 'Details to Give',
  PROCESS_STEP: 'Steps',
};
const KIND_ORDER: readonly StartItemKind[] = ['DOCUMENT', 'DETAIL', 'PROCESS_STEP'];

function kindOf(kind: string): StartItemKind {
  return kind === 'DOCUMENT' || kind === 'DETAIL' ? kind : 'PROCESS_STEP';
}

function officialUrlOf(destination: Destination): string | null {
  const url = destination.applyUrl ?? destination.source?.url ?? null;
  return url !== null && /^https:\/\//.test(url) ? url : null;
}

function buildStartData(): StartData {
  const routes: Record<string, StartRoute> = {};
  const countries: StartCountry[] = [];
  for (const destination of [...DESTINATIONS].sort((a, b) => a.country.localeCompare(b.country))) {
    const own = routesForDestination(destination);
    for (const route of own) {
      if (routes[route.key]) continue;
      const entries = route.requirements.map((requirement) => ({
        kind: kindOf(requirement.kind),
        item: {
          text: requirement.text,
          optional: requirement.optional,
          onlyWhen: requirement.onlyWhen,
          maxAgeDays: requirement.maxAgeDays,
          check: needsChecking(requirement.source) || isUnofficial(requirement.source),
        } satisfies StartItem,
      }));
      routes[route.key] = {
        key: route.key,
        name: route.name,
        groups: KIND_ORDER.map((kind) => ({
          kind,
          label: KIND_LABEL[kind],
          items: entries.filter((entry) => entry.kind === kind).map((entry) => entry.item),
        })).filter((group) => group.items.length > 0),
        total: entries.length,
        thin: entries.length < THIN_LIST,
      };
    }
    countries.push({
      iso2: destination.iso2,
      name: destination.country,
      aka: COUNTRY_ALIASES[destination.iso2] ?? [],
      entry: ENTRY_LABEL[destination.entryStatus],
      researched: destination.researched,
      // The fullest list first; ties keep the order the data gives.
      routeKeys: own
        .map((route, index) => ({ key: route.key, index, total: routes[route.key]?.total ?? 0 }))
        .sort((a, b) => b.total - a.total || a.index - b.index)
        .map((entry) => entry.key),
      officialUrl: officialUrlOf(destination),
    });
  }
  return {
    countries,
    routes,
    withChecklist: countries.filter((country) =>
      country.routeKeys.some((key) => (routes[key]?.total ?? 0) > 0),
    ).length,
  };
}

let cached: StartData | undefined;

/** The picker's data. Built once per process; the source is static. */
export function countryStartData(): StartData {
  cached ??= buildStartData();
  return cached;
}

/** A country code from an address, accepted only when it names a country we hold. */
export function parseCountryParam(value: unknown): string | null {
  const iso2 = cleanIso2(Array.isArray(value) ? value[0] : value);
  if (iso2 === null) return null;
  return DESTINATIONS.some((destination) => destination.iso2 === iso2) ? iso2 : null;
}

/** The plain name of a country we hold, or null. */
export function countryNameOf(iso2: string | null): string | null {
  if (iso2 === null) return null;
  return DESTINATIONS.find((destination) => destination.iso2 === iso2)?.country ?? null;
}
