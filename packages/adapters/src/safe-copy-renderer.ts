import { redactionPixelRect } from '@visastack/core/redaction-boxes';
import {
  MASKS_MISMATCH_DETAIL,
  type PositionedText,
  type SafeCopyBox,
  type SafeCopyBudget,
  type SafeCopyFailure,
  type SafeCopyFailureReason,
  type SafeCopyRendererPort,
  type SafeCopySource,
} from '@visastack/services';
import { imageDimensions } from './image-dimensions';
import {
  type PdfImagePage,
  stripJpegMetadata,
  stripPngMetadata,
  writeImagePdf,
} from './image-pdf-writer';

/**
 * Safe copy rendering (ADR 0022, S23), built on the same rasterising path as the safe preview
 * (`preview-renderer.ts`: unpdf, which is pdfjs, and @napi-rs/canvas). Only stored files that
 * already passed the structural check and the malware scan reach it.
 *
 * - Every page is drawn as pixels at `PAGE_WIDTH_PX` (A4 at 150 dots per inch), the same size for
 *   the editor's page images and for the safe copy, so the boxes the owner places line up with
 *   what is painted.
 * - Boxes are rounded outwards to whole pixels, widened by `MASK_PAD_PX`, and filled solid black
 *   on the canvas before anything is encoded.
 * - PDF pages are encoded as JPEG with every metadata segment removed and put together by
 *   `writeImagePdf`, which writes no text, metadata, attachments, annotations, forms or scripts. A
 *   single image becomes one PNG with only its image chunks.
 * - The time budget is checked between pages and bounds every step; one page canvas is alive at a
 *   time, and calls are run one after another inside a process, which also keeps pdfjs from
 *   having two documents open at once (see preview-renderer.ts on why that matters).
 * - Any error refuses: nothing partly drawn is ever returned.
 */

const RENDERER_NAME = 'builtin-safe-copy-renderer';
const RENDERER_VERSION = '1.0.0';

/** Width every PDF page is drawn at, for the editor and the safe copy alike. */
export const PAGE_WIDTH_PX = 1240;
/** Editor images of a photo are no wider than a page. */
const EDITOR_MAX_SIDE_PX = 1600;
const EDITOR_JPEG_QUALITY = 82;
/** JPEG quality steps for safe copy pages: the first that fits the output limit is used. */
const SAFE_COPY_QUALITIES: readonly number[] = [80, 62, 48];
/** Longest side of a safe copy made from a photo: the first that fits the output limit is used. */
const IMAGE_SIDES_PX: readonly number[] = [2000, 1600, 1240];
/** Extra pixels painted around every box, so compression never softens its edge into view. */
export const MASK_PAD_PX = 2;
/** Same pixel cap as the safe preview: bounds decode memory. */
const MAX_IMAGE_PIXELS = 40_000_000;
/** Text pieces read from one page at most (suggestions only). */
const MAX_TEXT_ITEMS_PER_PAGE = 2_000;

type CanvasModule = typeof import('@napi-rs/canvas');
type Canvas = import('@napi-rs/canvas').Canvas;
type PdfProxy = Awaited<ReturnType<typeof import('unpdf').getDocumentProxy>>;

/** The longest delay a timer accepts. */
const MAX_TIMER_MS = 2_147_483_647;

class OutOfTime extends Error {}

class Refused extends Error {
  constructor(
    readonly reason: SafeCopyFailureReason,
    detail: string,
  ) {
    super(detail);
  }
}

function failure(reason: SafeCopyFailureReason, detail: string): SafeCopyFailure {
  return { ok: false, reason, detail };
}

function asFailure(error: unknown): SafeCopyFailure {
  if (error instanceof Refused) return failure(error.reason, error.message);
  if (error instanceof OutOfTime) return failure('out_of_time', 'the time allowed ran out');
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') return failure('unreadable', 'the PDF is password protected');
  const message = error instanceof Error ? error.message : String(error);
  return failure('unreadable', `could not draw the file: ${message.slice(0, 200)}`);
}

export interface SafeCopyRendererOptions {
  /** The clock the budget's deadline is measured on (tests pass their own). */
  readonly now?: () => number;
}

/** One call at a time in this process: one page canvas alive, one pdfjs document open. */
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

export class BuiltinSafeCopyRenderer implements SafeCopyRendererPort {
  readonly name = RENDERER_NAME;
  readonly version = RENDERER_VERSION;
  private readonly now: () => number;

  constructor(options: SafeCopyRendererOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  /** Waits for `promise`, refusing once the deadline passes (the work itself is abandoned). */
  private async beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
    // Abandoned work may still fail later (pdfjs reports its closed transport): never unhandled.
    promise.catch(() => undefined);
    const remaining = deadline - this.now();
    if (remaining <= 0) throw new OutOfTime();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      // Timers past about 24.8 days fire at once, so a far deadline sets no timer at all.
      if (remaining <= MAX_TIMER_MS) timer = setTimeout(() => reject(new OutOfTime()), remaining);
    });
    try {
      return await Promise.race([promise, late]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private checkTime(deadline: number): void {
    if (this.now() >= deadline) throw new OutOfTime();
  }

  private async withPdf<T>(
    source: SafeCopySource,
    budget: SafeCopyBudget,
    work: (pdf: PdfProxy) => Promise<T>,
  ): Promise<T> {
    const { getDocumentProxy } = await import('unpdf');
    let pdf: PdfProxy | undefined;
    try {
      pdf = await this.beforeDeadline(
        getDocumentProxy(new Uint8Array(source.bytes)),
        budget.deadline,
      );
      if (pdf.numPages < 1) throw new Refused('unreadable', 'the PDF has no pages');
      if (pdf.numPages > budget.maxPages) {
        throw new Refused('too_large', `the PDF has more than ${budget.maxPages} pages`);
      }
      return await work(pdf);
    } finally {
      await pdf?.loadingTask.destroy();
    }
  }

  /** One PDF page drawn at `PAGE_WIDTH_PX`, decoded onto a fresh canvas, and its size in points. */
  private async drawPdfPage(
    canvasModule: CanvasModule,
    pdf: PdfProxy,
    pageNumber: number,
    deadline: number,
  ): Promise<{ canvas: Canvas; widthPt: number; heightPt: number }> {
    const { renderPageAsImage } = await import('unpdf');
    this.checkTime(deadline);
    const page = await this.beforeDeadline(pdf.getPage(pageNumber), deadline);
    const viewport = page.getViewport({ scale: 1 });
    const png = await this.beforeDeadline(
      renderPageAsImage(pdf, pageNumber, {
        canvasImport: () => import('@napi-rs/canvas'),
        width: PAGE_WIDTH_PX,
        toDataURL: false,
      }),
      deadline,
    );
    const image = await this.beforeDeadline(canvasModule.loadImage(Buffer.from(png)), deadline);
    const canvas = canvasModule.createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, image.width, image.height);
    context.drawImage(image, 0, 0);
    return { canvas, widthPt: viewport.width, heightPt: viewport.height };
  }

  /** A stored photo decoded onto a fresh canvas no larger than `maxSide` on its longest side. */
  private async drawImage(
    canvasModule: CanvasModule,
    source: SafeCopySource,
    maxSide: number,
    deadline: number,
  ): Promise<Canvas> {
    const dims = imageDimensions(source.contentType, source.bytes);
    if (dims && dims.width * dims.height > MAX_IMAGE_PIXELS) {
      throw new Refused('too_large', 'the image has too many pixels');
    }
    const image = await this.beforeDeadline(
      canvasModule.loadImage(Buffer.from(source.bytes)),
      deadline,
    );
    if (image.width * image.height > MAX_IMAGE_PIXELS) {
      throw new Refused('too_large', 'the image has too many pixels');
    }
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = canvasModule.createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  }

  async pageCount(
    source: SafeCopySource,
    budget: SafeCopyBudget,
  ): Promise<{ readonly ok: true; readonly pageCount: number } | SafeCopyFailure> {
    return oneAtATime(async () => {
      try {
        if (source.contentType === 'application/pdf') {
          const pageCount = await this.withPdf(source, budget, async (pdf) => pdf.numPages);
          return { ok: true as const, pageCount };
        }
        if (source.contentType === 'image/png' || source.contentType === 'image/jpeg') {
          const dims = imageDimensions(source.contentType, source.bytes);
          if (!dims) return failure('unreadable', 'the image size could not be read');
          if (dims.width * dims.height > MAX_IMAGE_PIXELS) {
            return failure('too_large', 'the image has too many pixels');
          }
          return { ok: true as const, pageCount: 1 };
        }
        return failure('unsupported', 'safe copies are made from PDF files and images only');
      } catch (error) {
        return asFailure(error);
      }
    });
  }

  async renderPage(
    source: SafeCopySource,
    page: number,
    budget: SafeCopyBudget,
  ): ReturnType<SafeCopyRendererPort['renderPage']> {
    return oneAtATime(async () => {
      try {
        const canvasModule = await import('@napi-rs/canvas');
        let canvas: Canvas;
        if (source.contentType === 'application/pdf') {
          canvas = await this.withPdf(source, budget, async (pdf) => {
            if (!Number.isSafeInteger(page) || page < 1 || page > pdf.numPages) {
              throw new Refused('unreadable', 'no such page');
            }
            return (await this.drawPdfPage(canvasModule, pdf, page, budget.deadline)).canvas;
          });
        } else if (source.contentType === 'image/png' || source.contentType === 'image/jpeg') {
          if (page !== 1) return failure('unreadable', 'an image has one page');
          canvas = await this.drawImage(canvasModule, source, EDITOR_MAX_SIDE_PX, budget.deadline);
        } else {
          return failure('unsupported', 'safe copies are made from PDF files and images only');
        }
        const encoded = await this.beforeDeadline(
          canvas.encode('jpeg', EDITOR_JPEG_QUALITY),
          budget.deadline,
        );
        const { jpeg } = stripJpegMetadata(new Uint8Array(encoded));
        return {
          ok: true as const,
          contentType: 'image/jpeg' as const,
          bytes: jpeg,
          width: canvas.width,
          height: canvas.height,
        };
      } catch (error) {
        return asFailure(error);
      }
    });
  }

  async textPositions(
    source: SafeCopySource,
    budget: SafeCopyBudget,
  ): ReturnType<SafeCopyRendererPort['textPositions']> {
    if (source.contentType !== 'application/pdf') {
      return { ok: true, pages: [[]] };
    }
    return oneAtATime(async () => {
      try {
        const pages = await this.withPdf(source, budget, async (pdf) => {
          const all: PositionedText[][] = [];
          for (let number = 1; number <= pdf.numPages; number++) {
            this.checkTime(budget.deadline);
            const page = await this.beforeDeadline(pdf.getPage(number), budget.deadline);
            const viewport = page.getViewport({ scale: 1 });
            const content = await this.beforeDeadline(page.getTextContent(), budget.deadline);
            const items: PositionedText[] = [];
            for (const item of content.items) {
              if (items.length >= MAX_TEXT_ITEMS_PER_PAGE) break;
              if (!('str' in item) || item.str.trim().length === 0) continue;
              const corners = textCorners(item.transform as number[], item.width, item.height);
              if (!corners) continue;
              const points = corners.map(([x, y]) => viewport.convertToViewportPoint(x, y));
              const xs = points.map((point) => Number(point[0]));
              const ys = points.map((point) => Number(point[1]));
              if (![...xs, ...ys].every(Number.isFinite)) continue;
              const left = Math.max(0, Math.min(...xs) / viewport.width);
              const top = Math.max(0, Math.min(...ys) / viewport.height);
              const right = Math.min(1, Math.max(...xs) / viewport.width);
              const bottom = Math.min(1, Math.max(...ys) / viewport.height);
              if (!(right > left) || !(bottom > top)) continue;
              items.push({
                text: item.str,
                box: { x: left, y: top, w: right - left, h: bottom - top },
              });
            }
            all.push(items);
          }
          return all;
        });
        return { ok: true as const, pages };
      } catch (error) {
        return asFailure(error);
      }
    });
  }

  async renderSafeCopy(
    source: SafeCopySource,
    masks: readonly (readonly SafeCopyBox[])[],
    budget: SafeCopyBudget & { readonly maxOutputBytes: number },
  ): ReturnType<SafeCopyRendererPort['renderSafeCopy']> {
    if (masks.length < 1 || masks.length > budget.maxPages) {
      return failure('unreadable', MASKS_MISMATCH_DETAIL);
    }
    return oneAtATime(async () => {
      try {
        const canvasModule = await import('@napi-rs/canvas');
        if (source.contentType === 'application/pdf') {
          return await this.safeCopyOfPdf(canvasModule, source, masks, budget);
        }
        if (source.contentType === 'image/png' || source.contentType === 'image/jpeg') {
          return await this.safeCopyOfImage(canvasModule, source, masks, budget);
        }
        return failure('unsupported', 'safe copies are made from PDF files and images only');
      } catch (error) {
        return asFailure(error);
      }
    });
  }

  private async safeCopyOfPdf(
    canvasModule: CanvasModule,
    source: SafeCopySource,
    masks: readonly (readonly SafeCopyBox[])[],
    budget: SafeCopyBudget & { readonly maxOutputBytes: number },
  ): Promise<
    | { ok: true; contentType: 'application/pdf'; bytes: Uint8Array; pageCount: number }
    | SafeCopyFailure
  > {
    const [firstQuality = 80, ...lowerQualities] = SAFE_COPY_QUALITIES;
    const pages = await this.withPdf(source, budget, async (pdf) => {
      if (pdf.numPages !== masks.length) throw new Refused('unreadable', MASKS_MISMATCH_DETAIL);
      const drawn: PdfImagePage[] = [];
      let total = 0;
      for (let number = 1; number <= pdf.numPages; number++) {
        const { canvas, widthPt, heightPt } = await this.drawPdfPage(
          canvasModule,
          pdf,
          number,
          budget.deadline,
        );
        paintMasks(canvas, masks[number - 1] ?? []);
        const page = await this.encodePage(
          canvas,
          firstQuality,
          widthPt,
          heightPt,
          budget.deadline,
        );
        total += page.jpeg.byteLength;
        // Far past the limit already: lower quality will not bring it back, so stop drawing.
        if (total > budget.maxOutputBytes * 3) {
          throw new Refused('too_large', 'the safe copy would be too large');
        }
        drawn.push(page);
      }
      return drawn;
    });

    let pdfBytes = writeImagePdf(pages);
    for (const quality of lowerQualities) {
      if (pdfBytes.byteLength <= budget.maxOutputBytes) break;
      const smaller: PdfImagePage[] = [];
      for (const [index, page] of pages.entries()) {
        this.checkTime(budget.deadline);
        const image = await this.beforeDeadline(
          canvasModule.loadImage(Buffer.from(page.jpeg)),
          budget.deadline,
        );
        const canvas = canvasModule.createCanvas(image.width, image.height);
        canvas.getContext('2d').drawImage(image, 0, 0);
        // Painted again on the re-encoded page, so nothing softened by compression shows.
        paintMasks(canvas, masks[index] ?? []);
        smaller.push(
          await this.encodePage(canvas, quality, page.widthPt, page.heightPt, budget.deadline),
        );
      }
      pdfBytes = writeImagePdf(smaller);
    }
    if (pdfBytes.byteLength > budget.maxOutputBytes) {
      return failure('too_large', 'the safe copy would be too large');
    }
    return { ok: true, contentType: 'application/pdf', bytes: pdfBytes, pageCount: pages.length };
  }

  private async encodePage(
    canvas: Canvas,
    quality: number,
    widthPt: number,
    heightPt: number,
    deadline: number,
  ): Promise<PdfImagePage> {
    const encoded = await this.beforeDeadline(canvas.encode('jpeg', quality), deadline);
    const { jpeg, info } = stripJpegMetadata(new Uint8Array(encoded));
    if (info.widthPx !== canvas.width || info.heightPx !== canvas.height) {
      throw new Refused('unreadable', 'the page image did not match its canvas');
    }
    return {
      jpeg,
      widthPx: info.widthPx,
      heightPx: info.heightPx,
      components: info.components,
      widthPt,
      heightPt,
    };
  }

  private async safeCopyOfImage(
    canvasModule: CanvasModule,
    source: SafeCopySource,
    masks: readonly (readonly SafeCopyBox[])[],
    budget: SafeCopyBudget & { readonly maxOutputBytes: number },
  ): Promise<
    { ok: true; contentType: 'image/png'; bytes: Uint8Array; pageCount: number } | SafeCopyFailure
  > {
    if (masks.length !== 1) return failure('unreadable', MASKS_MISMATCH_DETAIL);
    for (const side of IMAGE_SIDES_PX) {
      this.checkTime(budget.deadline);
      const canvas = await this.drawImage(canvasModule, source, side, budget.deadline);
      paintMasks(canvas, masks[0] ?? []);
      const encoded = await this.beforeDeadline(canvas.encode('png'), budget.deadline);
      const png = stripPngMetadata(new Uint8Array(encoded));
      if (png.byteLength <= budget.maxOutputBytes) {
        return { ok: true, contentType: 'image/png', bytes: png, pageCount: 1 };
      }
    }
    return failure('too_large', 'the safe copy would be too large');
  }
}

/**
 * The four corners, in PDF space, of a piece of text: along its baseline for its width, from a
 * quarter of its height below the baseline (descenders) to its full height above. Follows the
 * text's own direction, so rotated text is covered too. Undefined for a piece with no size.
 */
function textCorners(
  transform: readonly number[],
  width: number,
  itemHeight: number,
): [number, number][] | undefined {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = transform;
  const along = Math.hypot(a, b);
  const up = Math.hypot(c, d);
  const height = itemHeight > 0 ? itemHeight : up;
  if (!(width > 0) || !(height > 0) || !(along > 0) || !(up > 0)) return undefined;
  const ux = a / along;
  const uy = b / along;
  const vx = c / up;
  const vy = d / up;
  const x0 = e - vx * height * 0.25;
  const y0 = f - vy * height * 0.25;
  const tall = height * 1.25;
  return [
    [x0, y0],
    [x0 + ux * width, y0 + uy * width],
    [x0 + vx * tall, y0 + vy * tall],
    [x0 + ux * width + vx * tall, y0 + uy * width + vy * tall],
  ];
}

/** Fills every box solid black on the canvas, rounded outwards and padded, before encoding. */
function paintMasks(
  canvas: { readonly width: number; readonly height: number; getContext(type: '2d'): unknown },
  boxes: readonly SafeCopyBox[],
): void {
  const context = canvas.getContext('2d') as {
    fillStyle: string;
    globalAlpha: number;
    globalCompositeOperation: string;
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    fillRect(x: number, y: number, w: number, h: number): void;
  };
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = '#000000';
  for (const box of boxes) {
    const rect = redactionPixelRect(box, canvas.width, canvas.height, MASK_PAD_PX);
    if (rect.width > 0 && rect.height > 0) {
      context.fillRect(rect.left, rect.top, rect.width, rect.height);
    }
  }
}

export function createSafeCopyRenderer(
  options: SafeCopyRendererOptions = {},
): SafeCopyRendererPort {
  return new BuiltinSafeCopyRenderer(options);
}
