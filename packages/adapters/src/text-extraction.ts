import type { BlobStore, ExtractionOutcome, TextExtractionPort } from '@visastack/services';
import { capExtractedText } from '@visastack/services';

/**
 * Deterministic text extraction adapter (master directive §11).
 *
 * Dispatches by content type / filename extension to a real parser for each
 * supported format. This is embedded/native text extraction, NOT OCR — an
 * image format (PNG/JPEG/HEIC/TIFF) has no text layer to read and is
 * therefore `unsupported_format`, honestly, rather than silently producing
 * nothing or faking a result.
 */

const PARSER_VERSION = '1.0.0';

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractionOutcome> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  try {
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    if (text.trim().length === 0) {
      return {
        ok: false,
        code: 'empty_content',
        message: 'PDF has no embedded text layer (likely a scanned image; OCR is not implemented)',
      };
    }
    const { text: capped, truncated } = capExtractedText(text);
    return {
      ok: true,
      result: {
        text: capped,
        truncated,
        pageCount: totalPages,
        warnings: [],
        parserName: 'unpdf',
        parserVersion: PARSER_VERSION,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password|encrypted/i.test(message)) {
      return { ok: false, code: 'password_protected', message: 'PDF is password-protected' };
    }
    return { ok: false, code: 'corrupt_file', message: `PDF could not be parsed: ${message}` };
  }
}

async function extractDocx(bytes: Uint8Array): Promise<ExtractionOutcome> {
  const mammoth = (await import('mammoth')).default;
  try {
    const { value, messages } = await mammoth.extractRawText({
      buffer: Buffer.from(bytes),
    });
    if (value.trim().length === 0) {
      return { ok: false, code: 'empty_content', message: 'DOCX contains no extractable text' };
    }
    const { text: capped, truncated } = capExtractedText(value);
    return {
      ok: true,
      result: {
        text: capped,
        truncated,
        pageCount: null,
        warnings: messages.map((m) => m.message),
        parserName: 'mammoth',
        parserVersion: PARSER_VERSION,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: 'corrupt_file', message: `DOCX could not be parsed: ${message}` };
  }
}

function extractPlainText(bytes: Uint8Array): ExtractionOutcome {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: 'corrupt_file', message: 'not valid UTF-8 text' };
  }
  if (text.trim().length === 0) {
    return { ok: false, code: 'empty_content', message: 'file is empty' };
  }
  const { text: capped, truncated } = capExtractedText(text);
  return {
    ok: true,
    result: {
      text: capped,
      truncated,
      pageCount: null,
      warnings: [],
      parserName: 'plain-text',
      parserVersion: PARSER_VERSION,
    },
  };
}

export interface DeterministicTextExtractorOptions {
  readonly blobStore: BlobStore;
}

export class DeterministicTextExtractor implements TextExtractionPort {
  private readonly blobStore: BlobStore;

  constructor(options: DeterministicTextExtractorOptions) {
    this.blobStore = options.blobStore;
  }

  async extract(input: {
    readonly bucket: 'QUARANTINE' | 'CLEAN';
    readonly objectKey: string;
    readonly originalName: string;
  }): Promise<ExtractionOutcome> {
    const object = await this.blobStore.getObject(input.objectKey);
    if (!object) {
      return { ok: false, code: 'corrupt_file', message: 'object bytes not found' };
    }
    const ext = extOf(input.originalName);
    const contentType = object.contentType;
    const isPdf = ext === 'pdf' || contentType === 'application/pdf';
    const isDocx =
      ext === 'docx' ||
      contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const isText = ext === 'txt' || ext === 'md' || contentType.startsWith('text/');

    if (isPdf) return extractPdf(object.bytes);
    if (isDocx) return extractDocx(object.bytes);
    if (isText) return extractPlainText(object.bytes);

    return {
      ok: false,
      code: 'unsupported_format',
      message: `no deterministic text extractor for "${ext || contentType}" yet (image formats require OCR, not yet implemented)`,
    };
  }
}
