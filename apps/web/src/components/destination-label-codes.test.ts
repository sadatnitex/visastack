import { describe, expect, it } from 'vitest';
import { destinationName } from '../app/app/agency/[orgId]/collection/terms';
import { caseCountryOptions } from '../lib/case-choices';
import { destinationFlagCode } from './destination-label';

/**
 * A document request keeps a two-letter code, so its pages write the country's name and let
 * `DestinationLabel` find the flag again from that name. This keeps that round trip honest: a
 * country whose name another country also claims would lose its flag without a sound.
 */
describe('a request destination code and its flag', () => {
  it('finds the same country again from its written name, for every country the pickers hold', () => {
    const lost = caseCountryOptions()
      .filter((country) => destinationFlagCode(destinationName(country.iso2)) !== country.iso2)
      .map((country) => country.iso2);
    expect(lost).toEqual([]);
  });

  it('writes a code the list does not hold as it is, with no flag', () => {
    expect(destinationName('ZZ')).toBe('ZZ');
    expect(destinationFlagCode('ZZ')).toBeNull();
  });
});
