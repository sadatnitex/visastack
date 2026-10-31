import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STREAM_UPLOAD_LIMIT,
  pdfUploadsAccepted,
  permitsPdfAdmission,
  readBoundedUpload,
  validateUploadBytes,
} from './upload-preflight';
import { STORED_UPLOAD_TYPES } from './upload-rules';

/** The smallest file that is a Word document: the two parts every one has. */
async function minimalDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
  zip.file('word/document.xml', '<?xml version="1.0"?><document/>');
  return zip.generateAsync({ type: 'uint8array' });
}

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
describe('upload preflight', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('asks the deployment once whether PDF files can be added', () => {
    vi.stubEnv('MALWARE_SCANNER_PROVIDER', 'github_clamav');
    expect(pdfUploadsAccepted()).toBe(true);
    vi.stubEnv('MALWARE_SCANNER_PROVIDER', 'builtin');
    expect(pdfUploadsAccepted()).toBe(true);
    vi.stubEnv('MALWARE_SCANNER_PROVIDER', '');
    expect(pdfUploadsAccepted()).toBe(true);
  });

  it('lets the owner switch PDF uploads off without a deployment change', () => {
    vi.stubEnv('MALWARE_SCANNER_PROVIDER', 'builtin');
    for (const off of ['off', 'OFF', ' false ', '0', 'no']) {
      vi.stubEnv('PDF_UPLOADS', off);
      expect(pdfUploadsAccepted(), off).toBe(false);
    }
    vi.stubEnv('PDF_UPLOADS', 'on');
    expect(pdfUploadsAccepted()).toBe(true);
  });

  it('checks the bytes against the same list of types the upload form uses', async () => {
    // A type outside the shared list is refused whatever its bytes.
    expect(validateUploadBytes(png, 'image/gif', true)).toBe(false);
    // Every type on the list reaches its own byte check (none is refused for its type alone).
    const samples: Record<string, Uint8Array> = {
      'image/png': png,
      'image/jpeg': Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70]),
      'application/pdf': Buffer.from('%PDF-1.7'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        await minimalDocx(),
      'text/plain': Buffer.from('A plain note.'),
      'text/markdown': Buffer.from('# A plain note'),
    };
    for (const type of STORED_UPLOAD_TYPES) {
      const sample = samples[type];
      expect(sample, type).toBeDefined();
      if (sample) expect(validateUploadBytes(sample, type, true), type).toBe(true);
    }
  });

  it('admits PDF to quarantine on the built-in checks too; signature spoofing still fails', () => {
    for (const provider of [undefined, '', 'builtin', 'clamav', 'github_clamav']) {
      expect(permitsPdfAdmission(provider)).toBe(true);
      expect(
        validateUploadBytes(
          Buffer.from('%PDF-1.7'),
          'application/pdf',
          permitsPdfAdmission(provider),
        ),
      ).toBe(true);
      expect(
        validateUploadBytes(
          Buffer.from('MZpayload'),
          'application/pdf',
          permitsPdfAdmission(provider),
        ),
      ).toBe(false);
    }
    expect(permitsPdfAdmission('unknown')).toBe(false);
  });
  it('rejects mismatched MIME, truncated signatures and executables', () => {
    expect(validateUploadBytes(png, 'image/png', false)).toBe(true);
    expect(validateUploadBytes(png, 'image/jpeg', false)).toBe(false);
    expect(validateUploadBytes(png, 'text/plain', false)).toBe(false);
    expect(validateUploadBytes(png.slice(0, 4), 'image/png', false)).toBe(false);
    for (const prefix of ['MZ', '\u007fELF', '#!/bin/sh', '<svg onload="evil()">']) {
      expect(validateUploadBytes(Buffer.from(prefix), 'image/png', false)).toBe(false);
    }
  });
  it('keeps PDF blocked without a real scanner and rejects unsupported active formats', () => {
    expect(validateUploadBytes(Buffer.from('%PDF-1.7'), 'application/pdf', false)).toBe(false);
    expect(validateUploadBytes(Buffer.from('%PDF-1.7'), 'application/pdf', true)).toBe(true);
    expect(validateUploadBytes(Buffer.from('<script>evil()</script>'), 'text/html', false)).toBe(
      false,
    );
    expect(validateUploadBytes(png, 'image/svg+xml', false)).toBe(false);
  });
  it('bounds actual stream bytes and cancels when a chunk exceeds the declared size', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readBoundedUpload(stream, 4)).rejects.toThrow('rejected');
    expect(cancelled).toBe(true);
  });
  it('rejects missing bytes and oversized declarations; preserves exact bytes', async () => {
    const stream = (bytes: Uint8Array) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      });
    await expect(readBoundedUpload(stream(png), png.length + 1)).rejects.toThrow('rejected');
    await expect(readBoundedUpload(stream(png), STREAM_UPLOAD_LIMIT + 1)).rejects.toThrow('size');
    expect(await readBoundedUpload(stream(png), png.length)).toEqual(Buffer.from(png));
  });
});
