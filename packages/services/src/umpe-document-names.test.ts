import { describe, expect, it } from 'vitest';
import {
  MAX_ORIGINAL_FILE_NAME_LENGTH,
  readableNameFromFileName,
  sanitizeOriginalFileName,
} from './umpe-document-names';

/** Characters built from code points, so this file holds none of them literally. */
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const NUL = String.fromCodePoint(0);

describe('the file name kept privately with an upload (UMPE P3)', () => {
  it('keeps only the last part of a path, so a folder path never reaches the record', () => {
    expect(sanitizeOriginalFileName('Family/Anna/passport scan.jpg')).toBe('passport scan.jpg');
    expect(sanitizeOriginalFileName('C:\\Users\\anna\\bank.pdf')).toBe('bank.pdf');
    expect(sanitizeOriginalFileName('../../etc/passwd')).toBe('passwd');
  });

  it('drops control and text-direction characters that could disguise a name', () => {
    expect(sanitizeOriginalFileName(`invoice${RIGHT_TO_LEFT_OVERRIDE}fdp.exe`)).toBe(
      'invoicefdp.exe',
    );
    expect(sanitizeOriginalFileName(`a${NUL}b.jpg`)).toBe('ab.jpg');
  });

  it('caps the length by characters, never splitting one', () => {
    const long = `${'\u09AC'.repeat(400)}.jpg`;
    const kept = sanitizeOriginalFileName(long);
    expect(kept && Array.from(kept).length).toBe(MAX_ORIGINAL_FILE_NAME_LENGTH);
  });

  it('keeps nothing when nothing usable is left', () => {
    expect(sanitizeOriginalFileName('')).toBeNull();
    expect(sanitizeOriginalFileName('   ')).toBeNull();
    expect(sanitizeOriginalFileName('folder/')).toBeNull();
    expect(sanitizeOriginalFileName('..')).toBeNull();
    expect(sanitizeOriginalFileName(null)).toBeNull();
    expect(sanitizeOriginalFileName(undefined)).toBeNull();
  });
});

describe('a readable name suggested from the file name', () => {
  it('turns a descriptive name into words', () => {
    expect(readableNameFromFileName('bank_statement-march_2026.pdf')).toBe(
      'Bank Statement March 2026',
    );
    expect(readableNameFromFileName('salarySlipOfAnna.jpg')).toBe('Salary Slip of Anna');
    expect(readableNameFromFileName('NID front.png')).toBe('NID Front');
  });

  it('suggests nothing from a name a camera, scanner or chat app made up', () => {
    for (const name of [
      'IMG_2041.jpg',
      'scan0003.pdf',
      'Document.pdf',
      'WhatsApp Image 2026-03-01 at 10.22.33.jpeg',
      'PXL_20260301_102233.jpg',
      '20260301_102233.jpg',
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301.png',
      'a1 b2.jpg',
    ]) {
      expect(readableNameFromFileName(name), name).toBeNull();
    }
  });

  it('keeps a generic word when the rest of the name says something', () => {
    expect(readableNameFromFileName('Copy of Passport.pdf')).toBe('Copy of Passport');
  });
});
