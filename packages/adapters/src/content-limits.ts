import type { BlobStore, ContentLimitsPort, ContentLimitsResult } from '@visastack/services';
import { imageDimensions } from './image-dimensions';
import { withTimeout } from './timeout';

/**
 * Built-in content-limits checker (Commercial V1 Part 3, EVI-01: "Initial
 * configurable limits: ... 50 PDF pages, 40 megapixels per image"). The
 * only `ContentLimitsPort` implementation, matching `DocumentConverterPort`'s
 * `DeterministicTextExtractor` shape: no external service, always active.
 *
 * Runs in the intake pipeline's NORMALIZING step, after the malware scan
 * already confirmed CLEAN (`intake.ts`'s own doc comment explains why: a
 * genuinely clean, genuinely well-formed file can still exceed these
 * limits, and checking before the scan would mean parsing untrusted bytes
 * before they are known safe). PDF page count is read via `unpdf`
 * (pdfjs, the same battle-tested library `text-extraction.ts` and
 * `preview-renderer.ts` already trust), never a hand-rolled parser (see
 * `scanner.ts`'s module doc comment for why one was abandoned). Image
 * megapixels are read via the shared `image-dimensions.ts` header readers,
 * the same ones `preview-renderer.ts` uses to bound its own decode step,
 * so the two never drift into independently-maintained copies of the same
 * logic. A password-protected PDF is also rejected here, with the PRD's
 * own explicit wording ("clear request for an unlocked copy"): the
 * earliest point in the pipeline that can tell, since `structuralCheck`
 * (`scanner.ts`) deliberately never parses PDF content.
 *
 * DOCX and plain text have no numeric limit named by EVI-01, so they
 * always pass this check trivially.
 */

const CHECKER_NAME = 'builtin-content-limits';
const CHECKER_VERSION = '1.0.0';

/** Wall-clock bound on the PDF structural parse (Commercial V1 Part 3 §5, "bounded CPU/memory/time"): matches `preview-renderer.ts`'s own `RENDER_TIMEOUT_MS`, the only other place this codebase parses untrusted PDF structure this way. */
const PDF_PARSE_TIMEOUT_MS = 10_000;

export interface ContentLimitsConfig {
  readonly maxPdfPages: number;
  readonly maxImageMegapixels: number;
}

export interface BuiltinContentLimitsCheckerOptions {
  readonly blobStore: BlobStore;
  readonly config: ContentLimitsConfig;
}

export class BuiltinContentLimitsChecker implements ContentLimitsPort {
  readonly name = CHECKER_NAME;
  readonly version = CHECKER_VERSION;
  private readonly blobStore: BlobStore;
  private readonly config: ContentLimitsConfig;

  constructor(options: BuiltinContentLimitsCheckerOptions) {
    this.blobStore = options.blobStore;
    this.config = options.config;
  }

  async check(input: {
    readonly bucket: 'QUARANTINE' | 'CLEAN';
    readonly objectKey: string;
  }): Promise<ContentLimitsResult> {
    const object = await this.blobStore.getObject(input.objectKey);
    if (!object) return { withinLimits: false, detail: 'object bytes not found' };

    if (object.contentType === 'application/pdf') {
      return this.checkPdf(object.bytes);
    }
    if (object.contentType === 'image/png' || object.contentType === 'image/jpeg') {
      return this.checkImage(object.bytes, object.contentType);
    }
    return { withinLimits: true };
  }

  private async checkPdf(bytes: Uint8Array): Promise<ContentLimitsResult> {
    const { getDocumentProxy } = await import('unpdf');
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
    try {
      // Must be destroyed below: an undestroyed `PDFDocumentProxy` left open
      // in a warm, reused process (e.g. a Vercel container serving several
      // intake jobs in turn) corrupts pdfjs's in-process fake-worker
      // transport for a LATER, completely unrelated document's own
      // `getDocumentProxy`/`renderPageAsImage` call ("Cannot transfer object
      // of unsupported type", thrown deep inside unpdf/pdfjs's LoopbackPort)
      // -- confirmed by an isolated repro against this exact library version,
      // not theoretical; the same fix this session applied to
      // `preview-renderer.ts`'s `renderPdf`.
      pdf = await withTimeout(getDocumentProxy(bytes), PDF_PARSE_TIMEOUT_MS, 'PDF structure parse');
      if (pdf.numPages > this.config.maxPdfPages) {
        return {
          withinLimits: false,
          detail: `PDF has ${pdf.numPages} pages, exceeding the ${this.config.maxPdfPages}-page limit`,
          pageCount: pdf.numPages,
        };
      }
      return { withinLimits: true, pageCount: pdf.numPages };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/password|encrypted/i.test(message)) {
        return {
          withinLimits: false,
          detail: 'PDF is password-protected; please provide an unlocked copy',
        };
      }
      return { withinLimits: false, detail: `PDF could not be parsed: ${message}` };
    } finally {
      await pdf?.loadingTask.destroy();
    }
  }

  private checkImage(bytes: Uint8Array, contentType: string): ContentLimitsResult {
    const dims = imageDimensions(contentType, bytes);
    if (!dims) {
      return { withinLimits: false, detail: 'could not determine image dimensions' };
    }
    const megapixels = (dims.width * dims.height) / 1_000_000;
    if (megapixels > this.config.maxImageMegapixels) {
      return {
        withinLimits: false,
        detail: `image is ${megapixels.toFixed(1)} megapixels, exceeding the ${this.config.maxImageMegapixels} MP limit`,
      };
    }
    return { withinLimits: true };
  }
}
