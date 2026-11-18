import { describe, expect, it } from 'vitest';
import { matchCountries, normaliseQuery, resultCountWords } from './search-match';

const INDEX = [
  { c: 'DE', n: 'Germany', f: 'de' },
  { c: 'GE', n: 'Georgia', f: 'ge' },
  { c: 'DZ', n: 'Algeria', f: 'dz' },
  { c: 'NG', n: 'Nigeria', f: 'ng' },
  { c: 'SG', n: 'Singapore', f: 'sg' },
  { c: 'AG', n: 'Antigua and Barbuda', f: 'ag' },
] as const;

describe('hero search matching', () => {
  it('matches nothing for fewer than two letters', () => {
    expect(matchCountries(INDEX, 'g')).toEqual([]);
    expect(matchCountries(INDEX, '  ')).toEqual([]);
  });

  it('lists names that start with the text first, then word starts, then anywhere', () => {
    const names = matchCountries(INDEX, 'ger', 10).map((entry) => entry.n);
    expect(names).toEqual(['Germany', 'Algeria', 'Nigeria']);
    expect(matchCountries(INDEX, 'bar', 10).map((entry) => entry.n)).toEqual([
      'Antigua and Barbuda',
    ]);
  });

  it('cuts the list to the limit', () => {
    expect(matchCountries(INDEX, 'ge', 2)).toHaveLength(2);
  });

  it('ignores case and extra spaces', () => {
    expect(normaliseQuery('  SIN   gap ')).toBe('sin gap');
    expect(matchCountries(INDEX, ' SINGA ')[0]?.n).toBe('Singapore');
  });

  it('says plainly how many matched, and when only the first few are shown', () => {
    expect(resultCountWords(0, 'xyzq')).toBe('No country matches.');
    expect(resultCountWords(1, 'sing')).toBe('1 country found.');
    expect(resultCountWords(2, 'ge')).toBe('2 countries found.');
    expect(resultCountWords(5, 'ge')).toBe(
      '5 countries found. Showing the first 3. Keep typing to narrow it.',
    );
    expect(resultCountWords(5, 'g')).toBe('');
  });
});
