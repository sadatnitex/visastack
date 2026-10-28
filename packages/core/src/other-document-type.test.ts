import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_NAME_LENGTH, isOtherDocumentType } from './domain';

describe('Other kinds of document', () => {
  it('counts OTHER and every OTHER_ kind, and nothing else', () => {
    expect(isOtherDocumentType('OTHER')).toBe(true);
    expect(isOtherDocumentType('OTHER_LETTER')).toBe(true);
    expect(isOtherDocumentType('OTHER_IDENTITY_DOCUMENT')).toBe(true);
    expect(isOtherDocumentType('PASSPORT')).toBe(false);
    expect(isOtherDocumentType('MOTHER_BIRTH_CERTIFICATE')).toBe(false);
    expect(isOtherDocumentType('other')).toBe(false);
    expect(isOtherDocumentType(null)).toBe(false);
    expect(isOtherDocumentType(undefined)).toBe(false);
  });

  it('keeps one limit for a document name', () => {
    expect(MAX_DOCUMENT_NAME_LENGTH).toBe(200);
  });
});
