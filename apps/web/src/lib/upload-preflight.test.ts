import { describe, expect, it } from 'vitest';
import { STREAM_UPLOAD_LIMIT, readBoundedUpload, validateUploadBytes } from './upload-preflight';

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
describe('upload preflight', () => {
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
