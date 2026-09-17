import type { PreviewRenderResult, PreviewRendererPort } from '@visastack/services';
import { imageDimensions } from './image-dimensions';
import { withTimeout } from './timeout';

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
 *
 * PDF rendering re-checks the same page-count limit `content-limits.ts`
 * already enforced at intake, rather than trusting that earlier verdict
 * blindly: a render happens later, on demand, every time a preview is
 * served, not once at intake, so a limit that only ever ran once at intake
 * would not protect a version whose stored bytes changed identity between
 * the two (this mirrors the exact "recheck against current state, not a
 * stale mint-time decision" reasoning `documents.ts`'s `recheckDocumentAccess`
 * already uses for authorization). `maxPdfPages` is threaded in from the
 * same operator-configurable source `content-limits.ts` uses, so the two
 * checks cannot silently drift apart the way the independent
 * `MAX_IMAGE_PIXELS` constant below already can if an operator overrides
 * `QUOTA_MAX_IMAGE_MEGAPIXELS` (a pre-existing, narrower gap, not fixed
 * here).
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

/** Matches `DEFAULT_UPLOAD_QUOTAS.maxPdfPages` (`packages/services/src/quotas.ts`); real deployments pass the operator-configured value explicitly via `createPreviewRenderer`. */
const DEFAULT_MAX_PDF_PAGES = 50;

function exceedsPixelCap(contentType: string, bytes: Uint8Array): boolean {
  const dims = imageDimensions(contentType, bytes);
  if (!dims) return false; // dimensions unavailable: let the decoder itself fail closed below
  return dims.width * dims.height > MAX_IMAGE_PIXELS;
}

async function renderPdf(bytes: Uint8Array, maxPdfPages: number): Promise<PreviewRenderResult> {
  const { getDocumentProxy, renderPageAsImage } = await import('unpdf');
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    // Resolved once and reused below for both the page-count check and the
    // render itself, never re-resolved from the same raw bytes a second
    // time: two independently-resolved PDFDocumentProxy instances open
    // concurrently in this process corrupt pdfjs's in-process fake-worker
    // transport ("Cannot transfer object of unsupported type", thrown deep
    // inside unpdf/pdfjs's LoopbackPort) -- confirmed by an isolated repro
    // against this exact library version before landing this fix, not
    // theoretical. Passing the resolved proxy itself into `renderPageAsImage`
    // (rather than raw bytes) makes it reuse this same document instead of
    // resolving its own second one (`unpdf`'s own `withDocument` helper
    // explicitly supports either).
    pdf = await withTimeout(getDocumentProxy(bytes), RENDER_TIMEOUT_MS, 'PDF structure parse');
    if (pdf.numPages > maxPdfPages) {
      return {
        rendered: false,
        detail: `PDF has ${pdf.numPages} pages, exceeding the ${maxPdfPages}-page preview limit`,
      };
    }
    const buffer = await withTimeout(
      renderPageAsImage(pdf, 1, {
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
  } finally {
    // A proxy resolved here is ours to destroy: unpdf's own `withDocument`
    // convention is that a caller-supplied proxy "keeps its lifecycle with
    // the caller," and `renderPageAsImage` above was handed the proxy
    // itself, not raw bytes, so it never destroys it on our behalf.
    await pdf?.loadingTask.destroy();
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

export interface BuiltinPreviewRendererOptions {
  /** Reject a PDF preview render past this page count (default matches `DEFAULT_UPLOAD_QUOTAS.maxPdfPages`; real deployments should pass the same configured value `createContentLimitsChecker` uses). */
  readonly maxPdfPages?: number;
}

export class BuiltinPreviewRenderer implements PreviewRendererPort {
  readonly name = RENDERER_NAME;
  readonly version = RENDERER_VERSION;
  private readonly maxPdfPages: number;

  constructor(options: BuiltinPreviewRendererOptions = {}) {
    this.maxPdfPages = options.maxPdfPages ?? DEFAULT_MAX_PDF_PAGES;
  }

  async render(input: {
    readonly bytes: Uint8Array;
    readonly contentType: string;
  }): Promise<PreviewRenderResult> {
    const { bytes, contentType } = input;
    if (contentType === 'application/pdf') return renderPdf(bytes, this.maxPdfPages);
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
