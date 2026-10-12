/**
 * Document conversion port before optional AI processing.
 * The web adapter reads embedded PDF/DOCX/text content. The isolated scanner
 * worker adds bounded private OCR for supported image/scanned-PDF inputs.
 * Unsupported or unreadable content remains an explicit failure, never invented text.
 */

/** Never retain unbounded extracted text (master directive §11). */
export const MAX_EXTRACTED_TEXT_CHARS = 20_000;

export interface ExtractedDocument {
  readonly text: string;
  readonly truncated: boolean;
  readonly pageCount: number | null;
  readonly warnings: readonly string[];
  readonly parserName: string;
  readonly parserVersion: string;
}

export type ExtractionErrorCode =
  | 'unsupported_format'
  | 'corrupt_file'
  | 'password_protected'
  | 'empty_content'
  | 'parser_error';

export type ExtractionOutcome =
  | { readonly ok: true; readonly result: ExtractedDocument }
  | { readonly ok: false; readonly code: ExtractionErrorCode; readonly message: string };

export interface TextExtractionInput {
  readonly bucket: 'QUARANTINE' | 'CLEAN';
  readonly objectKey: string;
  /** Used for extension-based dispatch (the object's own content-type is read from storage). */
  readonly originalName: string;
}

export interface DocumentConverterPort {
  extract(input: TextExtractionInput): Promise<ExtractionOutcome>;
}

/** Cap extracted text and record whether it was truncated. */
export function capExtractedText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACTED_TEXT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_EXTRACTED_TEXT_CHARS), truncated: true };
}
