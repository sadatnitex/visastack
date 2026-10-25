import { describe, expect, it } from 'vitest';
import {
  buildProposedName,
  documentKindLabel,
  extensionOf,
  sanitizeNameComponent,
} from './naming';

describe('sanitizeNameComponent', () => {
  it('strips path-traversal sequences and separators', () => {
    expect(sanitizeNameComponent('../../etc/passwd')).toBe('etcpasswd');
    expect(sanitizeNameComponent('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  it('strips control characters', () => {
    expect(sanitizeNameComponent('Nazmus\x00\x1f\x7fSadat')).toBe('NazmusSadat');
  });

  it('normalizes Unicode (NFC) while preserving legal names, scripts, and diacritics', () => {
    // "é" as combining sequence (e + combining acute) normalizes to the precomposed form.
    const decomposed = 'José García';
    expect(sanitizeNameComponent(decomposed)).toBe('José García');
    expect(sanitizeNameComponent('Nazmus Sadat')).toBe('Nazmus Sadat');
    expect(sanitizeNameComponent("O'Brien-Smith")).toBe("O'Brien-Smith");
  });

  it('preserves governed acronyms exactly cased', () => {
    expect(sanitizeNameComponent('nid verification')).toContain('NID');
    expect(sanitizeNameComponent('IELTS Score Report')).toContain('IELTS');
    expect(sanitizeNameComponent('Tin certificate')).toContain('TIN');
  });

  it('caps length', () => {
    const long = 'A'.repeat(500);
    expect(sanitizeNameComponent(long).length).toBe(120);
  });
});

describe('buildProposedName', () => {
  it('builds the full pattern when every component is known', () => {
    const name = buildProposedName({
      classifiedType: 'PASSPORT',
      primarySubject: 'Nazmus Sadat',
      issuerOrContext: 'Bangladesh',
      relevantDateOrPeriod: 'Expires 2031-04-16',
      extension: 'pdf',
    });
    expect(name).toBe('Passport - Nazmus Sadat - Bangladesh - Expires 2031-04-16.pdf');
  });

  it('omits missing components rather than inventing them', () => {
    const name = buildProposedName({
      classifiedType: 'BANK_STATEMENT',
      primarySubject: 'Nazmus Sadat',
      extension: 'pdf',
    });
    expect(name).toBe('Bank Statement - Nazmus Sadat.pdf');
  });

  it('names every catalogue kind in words, never as its key', () => {
    const name = buildProposedName({
      classifiedType: 'BUSINESS_BANK_STATEMENT',
      primarySubject: 'Nazmus Sadat',
      extension: 'pdf',
    });
    expect(name).toBe('Business Bank Statement - Nazmus Sadat.pdf');
    expect(documentKindLabel('NOT_IN_THE_CATALOGUE')).toBe('NOT_IN_THE_CATALOGUE');
  });

  it('falls back to "Document" for an unclassified type', () => {
    const name = buildProposedName({
      classifiedType: null,
      primarySubject: 'Nazmus Sadat',
      extension: 'pdf',
    });
    expect(name).toBe('Document - Nazmus Sadat.pdf');
  });

  it('handles a missing extension gracefully', () => {
    const name = buildProposedName({
      classifiedType: 'PASSPORT',
      primarySubject: 'Nazmus Sadat',
      extension: '',
    });
    expect(name).toBe('Passport - Nazmus Sadat');
  });

  it('lower-cases and sanitizes the extension', () => {
    const name = buildProposedName({
      classifiedType: 'PASSPORT',
      primarySubject: 'Nazmus Sadat',
      extension: '.PDF',
    });
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('extensionOf', () => {
  it('extracts the extension without the dot', () => {
    expect(extensionOf('passport.pdf')).toBe('pdf');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  it('returns empty string when there is no extension', () => {
    expect(extensionOf('noext')).toBe('');
  });
});
