import batch001 from './batch-001.json';
import type { Destination, DestinationBatch, DestinationRoute, DestinationSource } from './types';

export type {
  Destination,
  DestinationBatch,
  DestinationRequirement,
  DestinationRoute,
  DestinationSource,
  EntryStatus,
  Money,
} from './types';

const BATCH = batch001 as unknown as DestinationBatch;

export const DESTINATIONS: readonly Destination[] = BATCH.countries;
export const DESTINATION_ROUTES: readonly DestinationRoute[] = BATCH.routes;

export function destinationByIso2(iso2: string): Destination | undefined {
  const code = iso2.trim().toUpperCase();
  return DESTINATIONS.find((d) => d.iso2 === code);
}

export function routesForCountry(country: string): readonly DestinationRoute[] {
  return DESTINATION_ROUTES.filter((r) => r.country === country);
}

/** The one shared route set the sheet files under the whole Schengen area. */
export const SCHENGEN_ROUTE_COUNTRY = 'Schengen Area (30 European States)';

/**
 * The thirty states the sheet groups under the shared Schengen route (it includes Cyprus, which the sheet
 * notes follows the same visa list by national alignment). Their short-stay visa is the one shared route.
 */
export const SCHENGEN_ISO2: readonly string[] = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IS',
  'IT',
  'LV',
  'LI',
  'LT',
  'LU',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'CH',
];

/** Every route that applies to a destination: its own routes, plus the shared Schengen route for those states. */
export function routesForDestination(destination: Destination): readonly DestinationRoute[] {
  const own = routesForCountry(destination.country);
  return SCHENGEN_ISO2.includes(destination.iso2)
    ? [...routesForCountry(SCHENGEN_ROUTE_COUNTRY), ...own]
    : own;
}

/** Countries that have stated facts, as opposed to just an official link. */
export function researchedDestinations(): readonly Destination[] {
  return DESTINATIONS.filter((d) => d.researched);
}

/** The most recent date any fact for this country was checked, or null when none carries a date. */
export function lastCheckedOn(country: string): string | null {
  const dates: string[] = [];
  const add = (s: DestinationSource | null) => {
    if (s?.checkedOn) dates.push(s.checkedOn);
  };
  const dest = DESTINATIONS.find((d) => d.country === country);
  if (dest) add(dest.source);
  for (const route of routesForCountry(country)) {
    add(route.source);
    for (const req of route.requirements) add(req.source);
  }
  return dates.length === 0 ? null : dates.reduce((a, b) => (a > b ? a : b));
}
