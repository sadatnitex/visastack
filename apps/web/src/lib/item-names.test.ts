import { describe, expect, it } from 'vitest';
import { documentKindLabel } from './item-names';

describe('documentKindLabel', () => {
  it('spells out an abbreviation and keeps the short form', () => {
    expect(documentKindLabel('noc')).toBe('No Objection Certificate (NOC)');
    expect(documentKindLabel('NID')).toBe('National ID');
  });

  it('uses the catalogue label when the kind is in it', () => {
    expect(documentKindLabel('bank_statement')).toBe(documentKindLabel('BANK-STATEMENT'));
    expect(documentKindLabel('passport')).toBe('Passport');
    expect(documentKindLabel('other')).toBe('Other Document');
  });

  it('turns an unknown code into words, never into a raw code', () => {
    expect(documentKindLabel('some_new_kind')).toBe('Some New Kind');
  });
});
