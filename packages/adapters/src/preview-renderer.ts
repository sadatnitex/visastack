import type { PreviewRenderResult, PreviewRendererPort } from '@visastack/services';
import { imageDimensions } from './image-dimensions';

/**
 * Built-in safe preview renderer (Commercial V1 EVI-02/EVI-06). The only
 * `PreviewRendererPort` implementation, matching `DocumentConverterPort`'s
 * `DeterministicTextExtractor` (`providers.ts`'s `DOCUMENT_CONVERTER_PROVIDER:
 * ['builtin']`): no external service, no provider selection, always active.
 *
 * Dispatches on the object's already-validated stored content type (this
 * code path only ever runs on bytes that already passed `structuralCheck`
 * and a malware scan, so the declared type is a trustworthy signal here,
 * unlike at upload time):
 *
 *  - `application/pdf` -> rasterize page 1 to PNG via `unpdf` (pdfjs, the
 *    same battle-tested renderer Firefox ships) + `@napi-rs/canvas`. A
 *    raster image cannot carry a PDF's JS actions, launch actions, embedded
 *    files, or form fields: this is the strongest possible "active content
 *    removed" guarantee for PDF, and deliberately NOT a hand-rolled parser
 *    (see `scanner.ts`'s module doc comment for why one was abandoned).
 *    Page 1 only: a document *preview* thumbnail, not a full-document
 *    viewer; `downloadDocument` remains the path to the complete original.
 *  - `image/png` / `image/jpeg` -> decode then redraw onto a fresh canvas,
 *    re-encoded as PNG. Strips EXIF/ICC metadata and any trailing bytes
 *    beyond the actual decoded pixels (closes the polyglot-file class of
 *    attack: a PNG/JPEG with appended HTML/script bytes past its real image
 *    data can never survive a decode-and-redraw).
 *  - DOCX -> `mammoth.extractRawText` (already used for extraction,
 *    `text-extraction.ts`), served as plain text. Strips macros, OLE
 *    objects, external template references, and tracked-changes/comment
 *    metadata; only the visible text survives.
 *  - `text/plain` / `text/markdown` -> passthrough, normalized to
 *    `text/plain`. Already inert (no execution model); the normalization is
 *    defense in depth so redacted text output is never later reinterpreted
 *    as markup by some future consumer.
 *  - anything else -> `{ rendered: false }`, honestly, not a guess.
 *
 * Every render is wall-clock bounded (`RENDER_TIMEOUT_MS`): PDF parsing in
 * particular has no other bound available without hand-rolling one, which
 * this codebase has already tried and abandoned once (`scanner.ts`). Image
 * decoding is additionally bounded by a pixel-count pre-check read directly
 * from the PNG IHDR chunk / JPEG SOF marker (a few fixed bytes, not a full
 * parse) BEFORE calling into the decoder: `loadImage` itself has no size
 * cap, so an attacker-supplied highly-compressible image with an absurd
 * declared pixel count (e.g. a solid-colour 60000x60000 PNG well under the
 * 20 MiB upload cap) would otherwise allocate tens of gigabytes decoding.
 */

const RENDERER_NAME = 'builtin-preview-renderer';
const RENDERER_VERSION = '1.0.0';

/** Wall-clock bound on a single render, regardless of content type. */
const RENDER_TIMEOUT_MS = 10_000;

/** ~40 MP: generous for any real document photo/scan, bounds worst-case RGBA decode memory to ~160 MB. */
const MAX_IMAGE_PIXELS = 40_000_000;

/** unpdf/pdfjs scales the PDF's own declared page size to this width, so an oversized declared page never grows the output canvas. */
const PDF_PREVIEW_WIDTH = 1600;

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function exceedsPixelCap(contentType: string, bytes: Uint8Array): boolean {
  const dims = imageDimensions(contentType, bytes);
  if (!dims) return false; // dimensions unavailable: let the decoder itself fail closed below
  return dims.width * dims.height > MAX_IMAGE_PIXELS;
}

async function renderPdf(bytes: Uint8Array): Promise<PreviewRenderResult> {
  try {
    const { renderPageAsImage } = await import('unpdf');
    const buffer = await withTimeout(
      renderPageAsImage(bytes, 1, {
        canvasImport: () => import('@napi-rs/canvas'),
        width: PDF_PREVIEW_WIDTH,
        toDataURL: false,
      }),
      RENDER_TIMEOUT_MS,
      'PDF preview render',
    );
    return { rendered: true, contentType: 'image/png', bytes: new Uint8Array(buffer) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { rendered: false, detail: `pdf preview render failed: ${message}` };
  }
}

async function renderImage(bytes: Uint8Array, contentType: string): Promise<PreviewRenderResult> {
  if (exceedsPixelCap(contentType, bytes)) {
    return { rendered: false, detail: 'image exceeds the maximum preview pixel count' };
  }
  try {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const image = await withTimeout(loadImage(bytes), RENDER_TIMEOUT_MS, 'image preview decode');
    if (image.width * image.height > MAX_IMAGE_PIXELS) {
      return { rendered: false, detail: 'image exceeds the maximum preview pixel count' };
    }
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return {
      rendered: true,
      contentType: 'image/png',
      bytes: new Uint8Array(canvas.toBuffer('image/png')),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { rendered: false, detail: `image preview render failed: ${message}` };
  }
}

async function renderDocx(bytes: Uint8Array): Promise<PreviewRenderResult> {
  try {
    const mammoth = (await import('mammoth')).default;
    const { value } = await withTimeout(
      mammoth.extractRawText({ buffer: Buffer.from(bytes) }),
      RENDER_TIMEOUT_MS,
      'docx preview extraction',
    );
    return { rendered: true, contentType: 'text/plain', bytes: new TextEncoder().encode(value) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { rendered: false, detail: `docx preview render failed: ${message}` };
  }
}

function renderPlainText(bytes: Uint8Array): PreviewRenderResult {
  // Copy so the result is always an independently-owned, exactly-sized
  // buffer (postcondition of this port), regardless of whether the input
  // `Uint8Array` is itself a view over a larger backing buffer.
  return { rendered: true, contentType: 'text/plain', bytes: Uint8Array.from(bytes) };
}

export class BuiltinPreviewRenderer implements PreviewRendererPort {
  readonly name = RENDERER_NAME;
  readonly version = RENDERER_VERSION;

  async render(input: {
    readonly bytes: Uint8Array;
    readonly contentType: string;
  }): Promise<PreviewRenderResult> {
    const { bytes, contentType } = input;
    if (contentType === 'application/pdf') return renderPdf(bytes);
    if (contentType === 'image/png' || contentType === 'image/jpeg') {
      return renderImage(bytes, contentType);
    }
    if (contentType === DOCX_CONTENT_TYPE) return renderDocx(bytes);
    if (contentType === 'text/plain' || contentType === 'text/markdown') {
      return renderPlainText(bytes);
    }
    return { rendered: false, detail: `no safe preview renderer for "${contentType}" yet` };
  }
}
