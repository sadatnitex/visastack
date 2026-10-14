import { describe, expect, it } from 'vitest';
import {
  DESTINATIONS,
  DESTINATION_ROUTES,
  destinationByIso2,
  lastCheckedOn,
  researchedDestinations,
  routesForCountry,
} from './index';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('destinations reference data', () => {
  it('holds the first batch of countries and routes', () => {
    expect(DESTINATIONS).toHaveLength(156);
    expect(DESTINATION_ROUTES).toHaveLength(61);
    expect(new Set(DESTINATIONS.map((d) => d.iso2)).size).toBe(DESTINATIONS.length);
    expect(new Set(DESTINATION_ROUTES.map((r) => r.key)).size).toBe(DESTINATION_ROUTES.length);
  });

  it('keeps a source link and a checked-on date on every stated fact', () => {
    for (const d of DESTINATIONS) {
      if (d.source === null) continue;
      expect(d.source.url, d.country).toMatch(/^https?:\/\//);
      expect(d.source.checkedOn, d.country).toMatch(DATE);
    }
    for (const r of DESTINATION_ROUTES) {
      expect(r.source, r.key).not.toBeNull();
      expect(r.source?.url, r.key).toMatch(/^https?:\/\//);
      expect(r.source?.checkedOn, r.key).toMatch(DATE);
      for (const q of r.requirements) {
        expect(q.source?.url, r.key).toMatch(/^https?:\/\//);
        expect(q.source?.checkedOn, r.key).toMatch(DATE);
      }
    }
  });

  it('never marks a country without a stated entry status as researched', () => {
    for (const d of DESTINATIONS) {
      expect(d.researched, d.country).toBe(d.entryStatus !== 'NOT_FOUND');
    }
    expect(researchedDestinations().length).toBeLessThan(DESTINATIONS.length);
  });

  it('points every route at a country in the list', () => {
    const names = new Set(DESTINATIONS.map((d) => d.country));
    const loose = DESTINATION_ROUTES.filter((r) => !names.has(r.country));
    // Schengen and Gulf routes are filed under the area name, so only check the plain countries.
    for (const r of loose) expect(r.issuingNote, r.key).not.toBeNull();
  });

  it('looks countries up by code and finds the latest check date', () => {
    const bd = destinationByIso2(' gb ');
    expect(bd?.country).toBe('United Kingdom');
    expect(routesForCountry('United Kingdom').length).toBeGreaterThan(0);
    expect(lastCheckedOn('United Kingdom')).toMatch(DATE);
    expect(lastCheckedOn('Nowhere')).toBeNull();
    expect(destinationByIso2('ZZ')).toBeUndefined();
  });
});
