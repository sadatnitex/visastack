import { CATALOGUE_DOCUMENTS } from '@visastack/core/catalogue';
import { describe, expect, it } from 'vitest';
import { CLASSIFIABLE_DOCUMENT_TYPES } from './classification';
import { documentCategory } from './sharing';

/**
 * The catalogue is data only in Phase 1, so these tests pin the two places where it already has to
 * agree with live behaviour: which types the scanner can recognise, and which types have a sharing
 * category. A type that gains a category in sharing.ts must carry the same one in the catalogue.
 */
describe('catalogue agrees with live document behaviour', () => {
  it('names exactly the types the classifier can produce', () => {
    const recognised = CATALOGUE_DOCUMENTS.filter((d) => d.recognisedToday).map((d) => d.key);
    expect([...recognised].sort()).toEqual([...CLASSIFIABLE_DOCUMENT_TYPES].sort());
  });

  it('never disagrees with a live sharing category', () => {
    for (const d of CATALOGUE_DOCUMENTS) {
      const live = documentCategory(d.key);
      if (live !== undefined) expect(d.pack, d.key).toBe(live);
    }
  });

  it('still has live categories for the three recognised types', () => {
    for (const key of ['PASSPORT', 'BANK_STATEMENT', 'EMPLOYMENT_CERTIFICATE']) {
      expect(documentCategory(key), key).toBeDefined();
    }
  });
});
