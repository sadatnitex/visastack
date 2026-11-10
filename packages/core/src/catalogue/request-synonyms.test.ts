import { describe, expect, it } from 'vitest';
import { CATALOGUE_DOCUMENTS } from './documents';
import { knownFieldOptions } from './queries';
import { REQUEST_CONTEXT, REQUEST_SYNONYMS } from './request-synonyms';

const FIELD_LABELS = new Map(knownFieldOptions().map((option) => [option.key, option.label]));
const DOCUMENT_LABELS = new Map(
  CATALOGUE_DOCUMENTS.map((document) => [document.key, document.label]),
);
const lower = (text: string) => text.trim().toLowerCase();

/** Words that would turn "what it is called" into "what someone requires". */
const SAYS_REQUIRED =
  /\b(required|requires|require|mandatory|compulsory|obligatory|must|needed|need|needs)\b/i;
/** A country named in a term would tie the name to one country's rules. */
const NAMES_A_COUNTRY =
  /\b(schengen|uk|usa|us|america|american|canada|canadian|australia|australian|britain|british|germany|france|italy|japan|singapore|malaysia|dubai|uae|saudi|qatar|kuwait|oman|india|china)\b/i;

describe('request synonyms', () => {
  it('every entry names a real detail or document type, once', () => {
    const seen = new Set<string>();
    for (const entry of REQUEST_SYNONYMS) {
      const id = `${entry.kind}:${entry.key}`;
      expect(seen.has(id), `${id} is listed twice`).toBe(false);
      seen.add(id);
      const real =
        entry.kind === 'FIELD' ? FIELD_LABELS.has(entry.key) : DOCUMENT_LABELS.has(entry.key);
      expect(real, `${id} is not in the catalogue`).toBe(true);
      expect(entry.terms.length, `${id} has no terms`).toBeGreaterThan(0);
    }
  });

  it('terms are plain names: not blank, not repeated, not the item itself, never a claim of requirement', () => {
    for (const entry of REQUEST_SYNONYMS) {
      const own = lower(
        (entry.kind === 'FIELD' ? FIELD_LABELS : DOCUMENT_LABELS).get(entry.key) ?? '',
      );
      const terms = entry.terms.map(lower);
      expect(new Set(terms).size, `${entry.key} repeats a term`).toBe(terms.length);
      for (const term of entry.terms) {
        expect(term.trim(), `${entry.key} has a blank term`).not.toBe('');
        expect(lower(term), `${entry.key}: "${term}" repeats its own name`).not.toBe(own);
        expect(SAYS_REQUIRED.test(term), `${entry.key}: "${term}" implies a requirement`).toBe(
          false,
        );
        expect(NAMES_A_COUNTRY.test(term), `${entry.key}: "${term}" names a country`).toBe(false);
      }
    }
  });

  it("a term is never another item's own name (it would point two places)", () => {
    const labels = new Map<string, string>();
    for (const [key, label] of DOCUMENT_LABELS) labels.set(lower(label), `DOCUMENT:${key}`);
    for (const [key, label] of FIELD_LABELS) {
      if (!labels.has(lower(label))) labels.set(lower(label), `FIELD:${key}`);
    }
    const clashes: string[] = [];
    for (const entry of REQUEST_SYNONYMS) {
      for (const term of entry.terms) {
        const owner = labels.get(lower(term));
        if (owner !== undefined && owner !== `${entry.kind}:${entry.key}`) {
          clashes.push(`"${term}" on ${entry.key} is already the name of ${owner}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it('the Bangladesh names people actually type find the right document', () => {
    const find = (term: string) =>
      REQUEST_SYNONYMS.filter((entry) => entry.terms.map(lower).includes(lower(term))).map(
        (entry) => entry.key,
      );
    expect(find('NID')).toContain('NID');
    expect(find('Trade Licence')).toContain('TRADE_LICENSE');
    expect(find('Bank Solvency')).toContain('SOLVENCY_CERTIFICATE');
    expect(find('NOC')).toEqual(expect.arrayContaining(['NOC_EMPLOYER', 'NOC_GOVERNMENT']));
    expect(find('BRC')).toContain('BIRTH_CERTIFICATE');
    expect(find('TIN')).toContain('TIN_CERTIFICATE');
    expect(find('Passport Photo')).toContain('PHOTO');
    expect(find('Kabin Nama')).toContain('MARRIAGE_CERTIFICATE');
    // Every real Other type is found by the words people try for "not listed".
    const others = CATALOGUE_DOCUMENTS.filter((document) => document.key.startsWith('OTHER'));
    for (const document of others) {
      for (const term of ['Other', 'Something Else', 'Not in the List']) {
        expect(find(term), `${document.key} is not found by "${term}"`).toContain(document.key);
      }
    }
  });

  it('context lines are for real details and are plain words, never keys', () => {
    for (const [key, text] of Object.entries(REQUEST_CONTEXT)) {
      expect(FIELD_LABELS.has(key), `${key} is not a detail an agency can ask for`).toBe(true);
      expect(text).toMatch(/^[A-Z][A-Za-z]*( [A-Z][A-Za-z]*)*$/);
      expect(text).not.toContain('_');
    }
  });
});
