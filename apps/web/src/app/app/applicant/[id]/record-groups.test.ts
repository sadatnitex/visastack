import { CATALOGUE_LAYERS, DOCUMENT_GROUP_KEYS } from '@visastack/core/catalogue';
import { describe, expect, it } from 'vitest';
import { PACK_LABELS } from '../../../../lib/profile-fields';
import {
  OTHER_DOCUMENTS,
  docTypeCarriesExpiry,
  documentGroupLabel,
  recordGroupOfDocType,
} from './record-groups';

const layer = (key: string) => CATALOGUE_LAYERS.find((item) => item.key === key)?.label;

describe('Record groups for documents', () => {
  it('put a document beside the profile area that holds the same things', () => {
    expect(recordGroupOfDocType('PASSPORT')).toBe(layer('identity'));
    expect(recordGroupOfDocType('PASSPORT')).toBe('Identity and Civil Status');
    expect(recordGroupOfDocType('BANK_STATEMENT')).toBe(layer('money'));
    expect(recordGroupOfDocType('BANK_STATEMENT')).toBe('Money');
    expect(recordGroupOfDocType('MEDICAL_REPORT')).toBe(layer('health'));
  });

  it('keep the catalogue group name where no profile area matches', () => {
    expect(documentGroupLabel('photos_biometrics')).toBe('Photos and Biometrics');
    expect(documentGroupLabel('employment_business')).toBe('Employment and Business');
  });

  it('send a document with no kind, or an unknown kind, to Other Documents', () => {
    expect(recordGroupOfDocType(null)).toBe(OTHER_DOCUMENTS);
    expect(recordGroupOfDocType('NOT_A_REAL_KIND')).toBe(OTHER_DOCUMENTS);
    expect(documentGroupLabel('other_documents')).toBe('Other Documents');
  });

  it('never show a raw key or a sharing pack name', () => {
    const packNames = new Set(Object.values(PACK_LABELS));
    for (const key of DOCUMENT_GROUP_KEYS) {
      const label = documentGroupLabel(key);
      expect(label, key).not.toMatch(/_/);
      expect(label.toLowerCase(), key).not.toBe(key);
      expect(packNames.has(label), key).toBe(false);
    }
  });
});

describe('which kinds carry an expiry', () => {
  it.each(['PASSPORT', 'RESIDENCE_PERMIT', 'WORK_PERMIT', 'VISA', 'POLICE_CLEARANCE'])(
    '%s has an end date of its own',
    (kind) => expect(docTypeCarriesExpiry(kind)).toBe(true),
  );
  it.each(['BANK_STATEMENT', 'SALARY_SLIP', 'PHOTO', 'NOT_A_REAL_KIND'])('%s has none', (kind) =>
    expect(docTypeCarriesExpiry(kind)).toBe(false),
  );
  it('a document with no kind has none', () => {
    expect(docTypeCarriesExpiry(null)).toBe(false);
  });
});
