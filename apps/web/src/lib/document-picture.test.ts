import { CATALOGUE_DOCUMENTS } from '@visastack/core/catalogue/documents';
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_PICTURE_NAMES,
  ICON_ONLY_DOCUMENT_TYPES,
  documentPicture,
} from './document-picture';
import { DOCUMENT_ICONS, documentMark, hasOwnDocumentIcon } from './item-icons';

describe('documentPicture', () => {
  it('has a picture name for every document kind item-icons knows, and no other', () => {
    expect([...DOCUMENT_PICTURE_NAMES].sort()).toEqual([...DOCUMENT_ICONS].sort());
  });

  it('gives every catalogue type a picture, or names it on the pinned icon-only list', () => {
    const allowed = new Set(ICON_ONLY_DOCUMENT_TYPES);
    const unexplained: string[] = [];
    for (const document of CATALOGUE_DOCUMENTS) {
      const choice = documentPicture(document.key);
      if (choice.kind === 'picture') {
        expect(choice.picture, document.key).not.toBe('file');
        expect(allowed.has(document.key), document.key).toBe(false);
      } else if (!allowed.has(document.key)) {
        unexplained.push(document.key);
      }
    }
    expect(unexplained).toEqual([]);
  });

  it('keeps the icon-only list exact: no stale key and no key that now has a picture', () => {
    const keys = new Set(CATALOGUE_DOCUMENTS.map((document) => document.key));
    expect(ICON_ONLY_DOCUMENT_TYPES.filter((key) => !keys.has(key))).toEqual([]);
    expect(ICON_ONLY_DOCUMENT_TYPES.filter((key) => hasOwnDocumentIcon(key))).toEqual([]);
    expect(new Set(ICON_ONLY_DOCUMENT_TYPES).size).toBe(ICON_ONLY_DOCUMENT_TYPES.length);
  });

  it('draws the same kind as the icon, so the picture and the icon of a paper agree', () => {
    for (const document of CATALOGUE_DOCUMENTS) {
      const choice = documentPicture(document.key);
      expect(choice.mark, document.key).toEqual(documentMark(document.key));
      if (choice.kind === 'picture') expect(choice.picture).toBe(choice.mark.icon);
    }
  });

  it('reads stored types, typed names and aliases the way the icons do', () => {
    expect(documentPicture('PASSPORT')).toMatchObject({ kind: 'picture', picture: 'docPassport' });
    expect(documentPicture('  bank statement ')).toMatchObject({
      kind: 'picture',
      picture: 'docBank',
      key: 'BANK_STATEMENT',
    });
    expect(documentPicture('Travel Insurance')).toMatchObject({ picture: 'docInsurance' });
  });

  it('falls back to the icon for an unknown word, nothing at all, or an icon-only type', () => {
    for (const value of ['NOT_A_REAL_TYPE', '', '   ', null, undefined, 'COURT_ORDER']) {
      const choice = documentPicture(value);
      expect(choice.kind, String(value)).toBe('icon');
      expect(choice.mark.icon).toBe('file');
    }
  });

  it('gives the generic paper picture instead of the icon only when asked', () => {
    expect(documentPicture('COURT_ORDER', { generic: 'picture' })).toMatchObject({
      kind: 'picture',
      picture: 'file',
    });
    expect(documentPicture('NOT_A_REAL_TYPE', { generic: 'picture' })).toMatchObject({
      kind: 'picture',
      picture: 'file',
    });
    expect(documentPicture('PASSPORT', { generic: 'picture' })).toMatchObject({
      picture: 'docPassport',
    });
  });
});
