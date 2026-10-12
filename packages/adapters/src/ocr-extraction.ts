import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { BlobStore, DocumentConverterPort, ExtractionOutcome } from '@visastack/services';
import { capExtractedText } from '@visastack/services';
import { imageDimensions } from './image-dimensions';
import { DeterministicTextExtractor } from './text-extraction';

const execute = promisify(execFile);
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_OCR_PAGES = 3;

/** Private isolated intake only. No document or extracted text goes to a public OCR service. */
export class IsolatedOcrExtractor implements DocumentConverterPort {
  private readonly native: DeterministicTextExtractor;
  constructor(
    private readonly blobStore: BlobStore,
    private readonly engineVersion: string,
  ) {
    if (!engineVersion.startsWith('tesseract ')) throw new Error('OCR engine not verified');
    this.native = new DeterministicTextExtractor({ blobStore });
  }

  async extract(
    input: Parameters<DocumentConverterPort['extract']>[0],
  ): Promise<ExtractionOutcome> {
    const native = await this.native.extract(input);
    if (native.ok || !['unsupported_format', 'empty_content'].includes(native.code)) return native;
    const object = await this.blobStore.getObject(input.objectKey);
    if (!object || object.bytes.length > MAX_BYTES)
      return {
        ok: false,
        code: 'corrupt_file',
        message: 'OCR input is missing or exceeds its limit',
      };
    const pdf = object.contentType === 'application/pdf';
    if (!pdf && !['image/png', 'image/jpeg'].includes(object.contentType)) return native;
    const dimensions = !pdf && imageDimensions(object.contentType, object.bytes);
    if (!pdf && (!dimensions || dimensions.width * dimensions.height > MAX_PIXELS))
      return {
        ok: false,
        code: 'corrupt_file',
        message: 'OCR image dimensions exceed their limit',
      };
    const directory = await mkdtemp(join(tmpdir(), 'visastack-ocr-'));
    try {
      const source = join(directory, pdf ? 'source.pdf' : 'source.image');
      await writeFile(source, object.bytes, { mode: 0o600 });
      let pages = [source];
      if (pdf) {
        await execute(
          'pdftoppm',
          [
            '-f',
            '1',
            '-l',
            String(MAX_OCR_PAGES),
            '-scale-to',
            '2400',
            '-png',
            source,
            join(directory, 'page'),
          ],
          { timeout: 30_000, maxBuffer: 64_000 },
        );
        pages = (await readdir(directory))
          .filter((name) => /^page-\d+\.png$/.test(name))
          .sort()
          .map((name) => join(directory, name));
        if (!pages.length || pages.length > MAX_OCR_PAGES)
          throw new Error('OCR page rendering failed');
      }
      const texts: string[] = [];
      for (const page of pages) {
        if ((await readFile(page)).length > MAX_BYTES)
          throw new Error('OCR page exceeds its limit');
        const result = await execute('tesseract', [page, 'stdout', '-l', 'eng', '--psm', '6'], {
          timeout: 30_000,
          maxBuffer: 1_000_000,
        });
        texts.push(result.stdout);
      }
      const text = texts.join('\n').trim();
      if (!text)
        return {
          ok: false,
          code: 'empty_content',
          message: 'No readable text found. Upload a clearer document image.',
        };
      const capped = capExtractedText(text);
      return {
        ok: true,
        result: {
          ...capped,
          pageCount: null,
          warnings: [
            'OCR text can contain reading errors. Confirm suggested information against the original.',
            ...(pdf
              ? ['OCR inspected only the first three pages; remaining pages require review.']
              : []),
          ],
          parserName: 'tesseract-private',
          parserVersion: this.engineVersion,
        },
      };
    } catch {
      return {
        ok: false,
        code: 'corrupt_file',
        message:
          'Image reading could not finish within its limits. Retry with a clearer or smaller document.',
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
