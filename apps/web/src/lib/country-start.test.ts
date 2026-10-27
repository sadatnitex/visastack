import { DESTINATIONS, routesForDestination } from '@visastack/core/destinations';
import { describe, expect, it } from 'vitest';
import { countryNameOf, countryStartData, parseCountryParam } from './country-start';
import {
  COUNTRY_PARAM,
  appHrefForCountry,
  cleanIso2,
  permissionStepHref,
  startHrefForCountry,
} from './country-start-links';
import { THIN_LIST } from './country-view';
import { safeReturnPath } from './neon-recency';

describe('reading a country from an address', () => {
  it.each([
    ['JP', 'JP'],
    ['jp', 'JP'],
    ['Jp', 'JP'],
    [['jp', 'de'], 'JP'],
  ])('accepts %j', (value, expected) => {
    expect(parseCountryParam(value)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    '',
    'J',
    'JPN',
    'ZZ',
    'XX',
    '12',
    'J1',
    ' JP',
    'JP ',
    'JP&step=consent',
    '<script>',
    "JP'--",
    '../../etc',
    [],
    {},
    42,
  ])('refuses %j', (value) => {
    expect(parseCountryParam(value)).toBeNull();
  });

  it('only shapes text; the data decides what is a country', () => {
    expect(cleanIso2('ZZ')).toBe('ZZ');
    expect(parseCountryParam('ZZ')).toBeNull();
    expect(countryNameOf('JP')).toBe('Japan');
    expect(countryNameOf('ZZ')).toBeNull();
    expect(countryNameOf(null)).toBeNull();
  });
});

describe('where the choice travels', () => {
  it('rides in the address, never a cookie, under one name', () => {
    expect(COUNTRY_PARAM).toBe('country');
    expect(appHrefForCountry('JP')).toBe('/app?country=JP');
  });

  it('hands the home page choice to sign-up, or to sign-in while sign-up is closed', () => {
    expect(startHrefForCountry('JP', true)).toBe('/auth/sign-up?next=%2Fapp%3Fcountry%3DJP');
    expect(startHrefForCountry('JP', false)).toBe('/auth/sign-in?next=%2Fapp%3Fcountry%3DJP');
  });

  it('is a return path the sign-in code keeps as it is, so the choice survives the round trip', () => {
    for (const iso2 of ['JP', 'GB', 'AE']) {
      const next = decodeURIComponent(startHrefForCountry(iso2, true).split('next=')[1] ?? '');
      expect(safeReturnPath(next)).toBe(next);
      expect(next).toBe(`/app?country=${iso2}`);
    }
  });

  it('moves first run to the permission screen, with or without a country', () => {
    expect(permissionStepHref('JP')).toBe('/app?country=JP&step=consent');
    expect(permissionStepHref(null)).toBe('/app?step=consent');
  });
});

describe('the picker data matches the country pages', () => {
  const data = countryStartData();

  it('has every country, in name order', () => {
    expect(data.countries).toHaveLength(DESTINATIONS.length);
    const names = data.countries.map((country) => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('drops no item and invents none: each route holds exactly the requirements the data has', () => {
    for (const destination of DESTINATIONS) {
      const country = data.countries.find((c) => c.iso2 === destination.iso2);
      const own = routesForDestination(destination);
      expect(country?.routeKeys.slice().sort(), destination.country).toEqual(
        own.map((route) => route.key).sort(),
      );
      for (const route of own) {
        const shown = data.routes[route.key];
        expect(shown?.total, route.key).toBe(route.requirements.length);
        const texts = shown?.groups.flatMap((group) => group.items.map((item) => item.text));
        expect(texts?.slice().sort(), route.key).toEqual(
          route.requirements.map((requirement) => requirement.text).sort(),
        );
      }
    }
  });

  it('calls a list thin by the same rule as the country page', () => {
    for (const route of Object.values(data.routes)) {
      expect(route.thin, route.key).toBe(route.total < THIN_LIST);
    }
    expect(THIN_LIST).toBe(5);
  });

  it('puts the fullest list first, so the default is the most useful one', () => {
    for (const country of data.countries) {
      const totals = country.routeKeys.map((key) => data.routes[key]?.total ?? 0);
      expect(totals, country.name).toEqual([...totals].sort((a, b) => b - a));
    }
  });

  it('keeps the warning on a fact whose source is unofficial or flagged', () => {
    const flagged = Object.values(data.routes).flatMap((route) =>
      route.groups.flatMap((group) => group.items.filter((item) => item.check)),
    );
    const expected = DESTINATIONS.flatMap((destination) => routesForDestination(destination))
      .filter((route, index, all) => all.findIndex((r) => r.key === route.key) === index)
      .flatMap((route) => route.requirements)
      .filter(
        (requirement) =>
          requirement.source !== null &&
          (requirement.source.needsCheck ||
            requirement.source.confidence === 'LOW' ||
            requirement.source.type === 'other'),
      );
    expect(flagged).toHaveLength(expected.length);
  });

  it('counts the countries that have a list, and only those with at least one item', () => {
    const counted = data.countries.filter((country) =>
      country.routeKeys.some((key) => (data.routes[key]?.total ?? 0) > 0),
    ).length;
    expect(data.withChecklist).toBe(counted);
    expect(counted).toBeGreaterThan(0);
  });

  it('only links to official pages over https', () => {
    for (const country of data.countries) {
      if (country.officialUrl !== null) expect(country.officialUrl).toMatch(/^https:\/\//);
    }
  });
});
