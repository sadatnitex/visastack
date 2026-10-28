import { describe, expect, it } from 'vitest';
import {
  STORED_UPLOAD_TYPES,
  acceptAttribute,
  checkChosenFile,
  storedFileName,
  uploadLimitsText,
  withFileExtension,
} from './upload-rules';

const rules = { limitBytes: 4 * 1024 * 1024, limitLabel: '4 MB', pdfAccepted: true };
const file = (name: string, size: number, type = '') => ({ name, size, type });

describe('what may be uploaded', () => {
  it('says the limits in plain words, PDF only when it is admitted', () => {
    expect(uploadLimitsText('4 MB', true)).toBe(
      'Up to 4 MB per file; PDF, JPG, PNG, HEIC, Word or text files.',
    );
    expect(uploadLimitsText('4 MB', false)).toBe(
      'Up to 4 MB per file; JPG, PNG, HEIC, Word or text files. PDF files can be added only while our virus scan is switched on.',
    );
    expect(acceptAttribute(true)).toContain('application/pdf');
    expect(acceptAttribute(false)).not.toContain('pdf');
    expect(acceptAttribute(false)).toContain('image/heic');
  });

  it('fills in the type a browser left empty from the name, iPhone photos included', () => {
    expect(checkChosenFile(file('IMG_2041.HEIC', 100), rules)).toEqual({
      ok: true,
      contentType: 'image/heic',
    });
    expect(checkChosenFile(file('notes.md', 10), rules)).toEqual({
      ok: true,
      contentType: 'text/markdown',
    });
    expect(checkChosenFile(file('scan.pdf', 10, 'application/octet-stream'), rules)).toEqual({
      ok: true,
      contentType: 'application/pdf',
    });
    expect(checkChosenFile(file('a.jpg', 10, 'image/jpeg'), rules)).toEqual({
      ok: true,
      contentType: 'image/jpeg',
    });
  });

  it('refuses, with a reason, what the server would refuse anyway', () => {
    const reason = (f: ReturnType<typeof file>, r = rules) => {
      const checked = checkChosenFile(f, r);
      return checked.ok ? null : checked.reason;
    };
    expect(reason(file('empty.png', 0, 'image/png'))).toContain('empty');
    expect(reason(file('setup.exe', 10, 'application/x-msdownload'))).toContain('cannot be added');
    expect(reason(file('mystery', 10))).toContain('cannot be added');
    expect(reason(file('big.jpg', 4 * 1024 * 1024 + 1, 'image/jpeg'))).toContain(
      'larger than 4 MB',
    );
    expect(reason(file('ok.jpg', 4 * 1024 * 1024, 'image/jpeg'))).toBeNull();
    expect(
      reason(file('scan.pdf', 10, 'application/pdf'), { ...rules, pdfAccepted: false }),
    ).toContain(
      'PDF files can be added only while our virus scan is switched on. Add a photo or scan of each page as a JPG or PNG instead.',
    );
    // The PDF reason belongs to PDF files only, not to a picture in another format.
    expect(
      reason(file('pic.gif', 10, 'image/gif'), { ...rules, pdfAccepted: false }),
    ).not.toContain('virus scan');
  });
});

describe('the names a stored file carries', () => {
  it('ends the kept file name in the extension of what is stored', () => {
    expect(storedFileName('IMG_2041.HEIC', 'image/jpeg')).toBe('IMG_2041.jpg');
    expect(storedFileName('document', 'image/jpeg')).toBe('document.jpg');
    expect(storedFileName('scan.pdf', 'application/pdf')).toBe('scan.pdf');
    expect(storedFileName('.png', 'image/png')).toBe('document.png');
    expect(storedFileName('', 'text/plain')).toBe('document.txt');
    // Only a known extension is one: a dot that is part of the name stays.
    expect(storedFileName('Payslip v1.2026', 'application/pdf')).toBe('Payslip v1.2026.pdf');
    expect(storedFileName('J.Smith.HEIC', 'image/jpeg')).toBe('J.Smith.jpg');
  });

  it('gives a download the extension a title does not have, and keeps one that is there', () => {
    expect(withFileExtension('Passport, Nazmus', 'image/jpeg')).toBe('Passport, Nazmus.jpg');
    expect(withFileExtension('Document, Nazmus, 27 Oct 2026', 'application/pdf')).toBe(
      'Document, Nazmus, 27 Oct 2026.pdf',
    );
    expect(withFileExtension('Passport - Nazmus Sadat.png', 'image/png')).toBe(
      'Passport - Nazmus Sadat.png',
    );
    expect(withFileExtension('Letter from Mr. Smith', 'text/plain')).toBe(
      'Letter from Mr. Smith.txt',
    );
    expect(withFileExtension('anything', 'application/octet-stream')).toBe('anything');
  });

  it('counts only a known file extension as one, never a dot that is part of the name', () => {
    expect(withFileExtension('Payslip v1.2026', 'application/pdf')).toBe('Payslip v1.2026.pdf');
    expect(withFileExtension('J.Smith', 'image/jpeg')).toBe('J.Smith.jpg');
    expect(withFileExtension('Statement 2026.10', 'application/pdf')).toBe('Statement 2026.10.pdf');
    expect(withFileExtension('Letter.final', 'text/plain')).toBe('Letter.final.txt');
    // A known extension for the stored type is kept, whatever its case or spelling.
    expect(withFileExtension('Scan.jpeg', 'image/jpeg')).toBe('Scan.jpeg');
    expect(withFileExtension('Scan.JPG', 'image/jpeg')).toBe('Scan.JPG');
    // A known extension for another type is replaced by the stored file's own.
    expect(withFileExtension('IMG_2041.HEIC', 'image/jpeg')).toBe('IMG_2041.jpg');
    expect(withFileExtension('Scan.pdf', 'image/png')).toBe('Scan.png');
    expect(withFileExtension('.pdf', 'image/png')).toBe('document.png');
  });

  it('has one list of stored types, which the server check is built from', () => {
    expect(STORED_UPLOAD_TYPES).toEqual(
      expect.arrayContaining(['image/jpeg', 'image/png', 'application/pdf', 'text/plain']),
    );
    // Every stored type has the extension a download gets.
    for (const type of STORED_UPLOAD_TYPES) {
      expect(withFileExtension('Name', type)).toMatch(/^Name\.[a-z]+$/);
    }
  });
});
