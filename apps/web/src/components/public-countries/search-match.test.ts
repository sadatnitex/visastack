import { describe, expect, it } from 'vitest';
import { foldAccents, matchCountries, normaliseQuery, searchStatus } from './search-match';

const INDEX = [
  { c: 'DE', n: 'Germany', f: 'de' },
  { c: 'GE', n: 'Georgia', f: 'ge' },
  { c: 'DZ', n: 'Algeria', f: 'dz' },
  { c: 'NG', n: 'Nigeria', f: 'ng' },
  { c: 'SG', n: 'Singapore', f: 'sg' },
  { c: 'AG', n: 'Antigua and Barbuda', f: 'ag' },
  { c: 'CI', n: "Côte d'Ivoire", f: 'ci' },
  { c: 'TR', n: 'Türkiye', f: 'tr' },
  { c: 'TL', n: 'Timor-Leste', f: 'tl' },
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

  it('ignores accents on both sides and breaks words at apostrophes, hyphens and brackets', () => {
    expect(foldAccents('Côte Türkiye')).toBe('cote turkiye');
    expect(matchCountries(INDEX, 'cote')[0]?.n).toBe("Côte d'Ivoire");
    expect(matchCountries(INDEX, 'turk')[0]?.n).toBe('Türkiye');
    expect(matchCountries(INDEX, 'Türk')[0]?.n).toBe('Türkiye');
    expect(matchCountries(INDEX, 'ivoire')[0]?.n).toBe("Côte d'Ivoire");
    expect(matchCountries(INDEX, 'leste')[0]?.n).toBe('Timor-Leste');
  });

  it('names what the status line should say', () => {
    expect(searchStatus(0, '')).toEqual({ kind: 'quiet' });
    expect(searchStatus(0, 'g')).toEqual({ kind: 'short' });
    expect(searchStatus(0, 'xyzq')).toEqual({ kind: 'none' });
    expect(searchStatus(2, 'ge')).toEqual({ kind: 'found', count: 2 });
    expect(searchStatus(5, 'ge')).toEqual({ kind: 'first', count: 5, limit: 3 });
  });
});
