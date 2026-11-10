import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import baseline from './familiar-baseline.json';
import { FAMILIAR_ROWS, type FamiliarRow, familiarShares } from './familiar-registry';

/**
 * The ratchet on how familiar the product feels (owner direction, 10 Nov 2026: more than 60
 * percent of styles, behaviours and features should be ones Bangladesh users already know from
 * everyday apps). The registry is an estimate from reading the code; this test keeps it honest
 * and keeps it from sliding back.
 */

const SRC = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(SRC, file), 'utf8');
const key = (row: FamiliarRow) => `${row.screen} / ${row.pattern}`;

describe('the familiar-pattern registry', () => {
  it('names real files, and each screen and pattern once', () => {
    const keys = FAMILIAR_ROWS.map(key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const row of FAMILIAR_ROWS) {
      expect(row.files.length, key(row)).toBeGreaterThan(0);
      for (const file of row.files) {
        expect(existsSync(resolve(SRC, file)), `${key(row)}: ${file} is gone`).toBe(true);
      }
    }
  });

  it('gives every bespoke row a reason, and every row a weight from 1 to 5 and a match', () => {
    for (const row of FAMILIAR_ROWS) {
      expect(row.weight >= 1 && row.weight <= 5, key(row)).toBe(true);
      expect(row.matches.trim().length, key(row)).toBeGreaterThan(5);
      if (row.class === 'bespoke') {
        expect((row.reason ?? '').trim().length, `${key(row)} needs a reason`).toBeGreaterThan(20);
      }
    }
  });

  it('still finds, in the file, what a converted row claims', () => {
    const proven = FAMILIAR_ROWS.filter((row) => row.proof !== undefined);
    expect(proven.length).toBeGreaterThan(0);
    for (const row of proven) {
      const { file, includes } = row.proof ?? { file: '', includes: '' };
      expect(read(file), `${key(row)} no longer contains "${includes}"`).toContain(includes);
    }
  });

  it('never lets the weighted share fall below the baseline, and records a gain', () => {
    const shares = familiarShares();
    expect(shares.rows).toBe(baseline.rows);
    expect(
      shares.weighted,
      'The familiar share fell: a pattern was changed away from the everyday-app way.',
    ).toBeGreaterThanOrEqual(baseline.weightedFamiliarShare - 0.0005);
    // A gain must be written down in familiar-baseline.json, or the next change could lose it.
    expect(
      shares.weighted,
      'The familiar share rose: raise weightedFamiliarShare in familiar-baseline.json.',
    ).toBeLessThanOrEqual(baseline.weightedFamiliarShare + 0.0005);
    expect(shares.count).toBeGreaterThanOrEqual(baseline.countFamiliarShare - 0.0005);
    expect(shares.count).toBeLessThanOrEqual(baseline.countFamiliarShare + 0.0005);
  });
});
