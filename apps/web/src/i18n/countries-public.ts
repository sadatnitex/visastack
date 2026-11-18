import { defineCatalog } from '@visastack/i18n';

/**
 * Words of the public Countries page's hero search (R4). "Search Countries", "Search", "All
 * Countries" and "No countries match." come from the components catalogue, which already has
 * Bengali for some of them. The messages below have English only until the translation register
 * approves Bengali wording; a visitor on a Bangla page then sees them marked as English.
 */
export const countriesPublicCatalog = defineCatalog({
  en: {
    'countriesPublic.search.matchingCountries': 'Matching Countries',
    'countriesPublic.search.found':
      '{count, plural, one {# country found.} other {# countries found.}}',
    'countriesPublic.search.foundFirst':
      '{count} countries found. Showing the first {limit}. Keep typing to narrow it.',
    'countriesPublic.search.typeMore': 'Type at least two letters.',
    'countriesPublic.search.typeACountry': 'Type a country name.',
    'countriesPublic.motion.pause': 'Pause Motion',
    'countriesPublic.motion.play': 'Play Motion',
  },
  bn: {},
});
