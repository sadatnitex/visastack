import { describe, expect, it, vi } from 'vitest';

/**
 * A name two countries both claim is refused, never guessed. The real data has none today, so the
 * rule is shown with a stand-in alias table where "Britain" is claimed by two countries.
 */
vi.mock('./country-start', async (importOriginal) => {
  const original = await importOriginal<typeof import('./country-start')>();
  return {
    ...original,
    COUNTRY_ALIASES: { ...original.COUNTRY_ALIASES, JP: ['Britain'], GB: ['Britain', 'UK'] },
  };
});
const { resolveCaseCountry } = await import('./case-choices');

describe('a destination name that two countries claim', () => {
  it('is refused, while each country keeps its own name and its other names', () => {
    expect(resolveCaseCountry('Britain')).toBeNull();
    expect(resolveCaseCountry('britain')).toBeNull();
    expect(resolveCaseCountry('Japan')?.iso2).toBe('JP');
    expect(resolveCaseCountry('United Kingdom')?.iso2).toBe('GB');
    expect(resolveCaseCountry('UK')?.iso2).toBe('GB');
  });
});
