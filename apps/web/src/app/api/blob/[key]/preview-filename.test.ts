import { describe, expect, it } from 'vitest';
import { previewFilename } from './preview-filename';

describe('previewFilename: display name for a rendered redacted preview', () => {
  it('replaces the extension to match the rendered content type', () => {
    expect(previewFilename('passport.pdf', 'image/png')).toBe('passport-preview.png');
  });

  it('replaces a DOCX extension with .txt when rendered to plain text', () => {
    expect(previewFilename('contract.docx', 'text/plain')).toBe('contract-preview.txt');
  });

  it('handles a filename with no extension', () => {
    expect(previewFilename('passport', 'image/png')).toBe('passport-preview.png');
  });

  it('passes the original through unchanged for a content type with no known extension mapping (defensive fallback; every renderer output today is covered above)', () => {
    expect(previewFilename('notes.md', 'application/octet-stream')).toBe('notes.md');
  });

  it('keeps a dot that is part of the name, counting only known extensions', () => {
    expect(previewFilename('Payslip v1.2026', 'image/png')).toBe('Payslip v1.2026-preview.png');
    expect(previewFilename('J.Smith.pdf', 'image/png')).toBe('J.Smith-preview.png');
    expect(previewFilename('.pdf', 'image/png')).toBe('document-preview.png');
  });

  it('passes undefined through unchanged', () => {
    expect(previewFilename(undefined, 'image/png')).toBeUndefined();
  });
});
