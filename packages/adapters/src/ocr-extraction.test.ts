import type { BlobStore } from '@visastack/services';
import { afterEach, describe, expect, it, vi } from 'vitest';

const command = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  execFile: Object.assign(() => undefined, {
    [Symbol.for('nodejs.util.promisify.custom')]: command,
  }),
}));
const { IsolatedOcrExtractor } = await import('./ocr-extraction');
const png = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1kAAAAASUVORK5CYII=',
    'base64',
  ),
);
const store = (bytes: Uint8Array, contentType: string) =>
  ({ getObject: async () => ({ bytes, contentType }) }) as unknown as BlobStore;
afterEach(() => command.mockReset());

describe('private bounded OCR fallback', () => {
  it('uses OCR for a photo with no text layer and retains review warnings', async () => {
    command.mockResolvedValue({
      stdout: 'PASSPORT\nSynthetic document\nExpires 2032-01-01',
      stderr: '',
    });
    const extractor = new IsolatedOcrExtractor(store(png, 'image/png'), 'tesseract 5.fixture');
    const result = await extractor.extract({
      bucket: 'CLEAN',
      objectKey: 'safe-key',
      originalName: 'passport.png',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('OCR failed');
    expect(result.result.parserName).toBe('tesseract-private');
    expect(result.result.warnings[0]).toMatch(/Confirm/);
    expect(command.mock.calls[0]?.[0]).toBe('tesseract');
    expect(command.mock.calls[0]?.[2]).toEqual({ timeout: 30_000, maxBuffer: 1_000_000 });
  });
  it('preserves embedded text without launching OCR', async () => {
    const result = await new IsolatedOcrExtractor(
      store(new TextEncoder().encode('Existing text'), 'text/plain'),
      'tesseract 5.fixture',
    ).extract({ bucket: 'CLEAN', objectKey: 'key', originalName: 'plain.txt' });
    expect(result.ok).toBe(true);
    expect(command).not.toHaveBeenCalled();
  });
  it('refuses oversized image dimensions before launching a decoder', async () => {
    const malicious = png.slice();
    const header = new DataView(malicious.buffer);
    header.setUint32(16, 60000);
    header.setUint32(20, 60000);
    const result = await new IsolatedOcrExtractor(
      store(malicious, 'image/png'),
      'tesseract 5.fixture',
    ).extract({ bucket: 'CLEAN', objectKey: 'key', originalName: 'image.png' });
    expect(result.ok).toBe(false);
    expect(command).not.toHaveBeenCalled();
  });
  it('returns a bounded failure without exposing stderr, input paths or extracted contents', async () => {
    command.mockRejectedValue(new Error('Private data and runner pathname'));
    const result = await new IsolatedOcrExtractor(
      store(png, 'image/png'),
      'tesseract 5.fixture',
    ).extract({ bucket: 'CLEAN', objectKey: 'key', originalName: 'passport.png' });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('Private data');
  });
  it('never treats an unconfigured OCR engine as a verified implementation', () => {
    expect(() => new IsolatedOcrExtractor(store(png, 'image/png'), 'unknown')).toThrow(
      'OCR engine not verified',
    );
  });
});
