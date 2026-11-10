import { describe, expect, it } from 'vitest';
import {
  MAX_SHRINK_INPUT_BYTES,
  STORED_UPLOAD_TYPES,
  acceptAttribute,
  canShrinkToFit,
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

describe('a photo over the limit when shrinking is allowed (P2)', () => {
  const MB = 1024 * 1024;
  const shrinking = { ...rules, shrinkPhotos: true };
  const check = (f: ReturnType<typeof file>, r = shrinking) => checkChosenFile(f, r);

  it('lets a JPEG or PNG photo over the limit through, marked to be shrunk', () => {
    expect(check(file('IMG_1.jpg', 9 * MB, 'image/jpeg'))).toEqual({
      ok: true,
      contentType: 'image/jpeg',
      shrink: true,
    });
    expect(check(file('shot.png', 6 * MB, 'image/png'))).toEqual({
      ok: true,
      contentType: 'image/png',
      shrink: true,
    });
    // A browser that left the type empty: the name decides, as for any file.
    expect(check(file('IMG_2.JPG', 9 * MB))).toMatchObject({ ok: true, shrink: true });
  });

  it('never marks a file under the limit, or one exactly at it', () => {
    expect(check(file('a.jpg', 4 * MB, 'image/jpeg'))).toEqual({
      ok: true,
      contentType: 'image/jpeg',
    });
    expect(check(file('b.jpg', 100, 'image/jpeg'))).toEqual({
      ok: true,
      contentType: 'image/jpeg',
    });
  });

  it('keeps the size refusal for everything that is not a JPEG or PNG photo', () => {
    const tooLarge = (f: ReturnType<typeof file>) => {
      const checked = check(f);
      return checked.ok ? null : checked.reason;
    };
    expect(tooLarge(file('scan.pdf', 9 * MB, 'application/pdf'))).toContain('larger than 4 MB');
    expect(tooLarge(file('iphone.heic', 9 * MB, 'image/heic'))).toContain('larger than 4 MB');
    expect(
      tooLarge(
        file(
          'cv.docx',
          9 * MB,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      ),
    ).toContain('larger than 4 MB');
    expect(tooLarge(file('notes.txt', 9 * MB, 'text/plain'))).toContain('larger than 4 MB');
  });

  it('keeps the size refusal for a photo too big to read into memory', () => {
    const checked = check(file('huge.jpg', MAX_SHRINK_INPUT_BYTES + 1, 'image/jpeg'));
    expect(checked.ok).toBe(false);
    expect(check(file('edge.jpg', MAX_SHRINK_INPUT_BYTES, 'image/jpeg'))).toMatchObject({
      ok: true,
      shrink: true,
    });
  });

  it('changes nothing unless the caller asks for it', () => {
    for (const r of [rules, { ...rules, shrinkPhotos: false }]) {
      const checked = checkChosenFile(file('IMG_1.jpg', 9 * MB, 'image/jpeg'), r);
      expect(checked.ok).toBe(false);
    }
  });

  it('knows which photos can be shrunk', () => {
    expect(canShrinkToFit('image/jpeg', 5 * MB, 4 * MB)).toBe(true);
    expect(canShrinkToFit('image/png', 5 * MB, 4 * MB)).toBe(true);
    expect(canShrinkToFit('image/webp', 5 * MB, 4 * MB)).toBe(false);
    expect(canShrinkToFit('application/pdf', 5 * MB, 4 * MB)).toBe(false);
    expect(canShrinkToFit('image/jpeg', 4 * MB, 4 * MB)).toBe(false);
  });
});

describe('the limits line where photos are made smaller (P2)', () => {
  it('says so after the kinds, and before the PDF reason', () => {
    expect(uploadLimitsText('4 MB', true, true)).toBe(
      'Up to 4 MB per file; PDF, JPG, PNG, HEIC, Word or text files. Larger photos are made smaller to fit.',
    );
    expect(uploadLimitsText('4 MB', false, true)).toBe(
      'Up to 4 MB per file; JPG, PNG, HEIC, Word or text files. Larger photos are made smaller to fit. PDF files can be added only while our virus scan is switched on.',
    );
    // Everywhere that does not shrink photos keeps the plain line.
    expect(uploadLimitsText('4 MB', true)).not.toContain('smaller');
  });
});
