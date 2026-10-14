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
