import { redactionPixelRect } from '@visastack/core/redaction-boxes';
import type {
  PositionedText,
  SafeCopyBox,
  SafeCopyBudget,
  SafeCopyFailure,
  SafeCopyFailureReason,
  SafeCopyPageImage,
  SafeCopyRendererPort,
  SafeCopySource,
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
 *   what is painted. A page that would be taller than `MAX_PAGE_HEIGHT_PX` is drawn smaller to fit,
 *   and one that cannot fit in `MAX_PAGE_PIXELS` (or would be under 1 pixel either way) is refused
 *   as too large, so a crafted page size cannot allocate an enormous canvas.
 * - Boxes are rounded outwards to whole pixels, widened by `MASK_PAD_PX`, and filled solid black
 *   on the canvas before anything is encoded.
 * - A safe copy page is drawn once, when the owner prepares the copy (`renderMaskedPage`), and
 *   stored by the service; a download only puts stored pages together (`assembleSafeCopy`):
 *   JPEG pages with every metadata segment removed in the hand-written image-only PDF of
 *   `writeImagePdf`, or the single PNG with only its image chunks.
 * - Each call's time limit starts when its drawing starts; the limit is checked between steps and
 *   bounds every step. Calls run one after another inside a process (one page canvas alive, one
 *   pdfjs document open: see preview-renderer.ts on why two at once fail), and every page is
 *   released (`page.cleanup()`) as soon as it is drawn or read.
 * - Any error refuses: nothing partly drawn is ever returned.
 */

const RENDERER_NAME = 'builtin-safe-copy-renderer';
const RENDERER_VERSION = '2.0.0';

/** Width every PDF page is drawn at, for the editor and the safe copy alike. */
export const PAGE_WIDTH_PX = 1240;
/** The tallest page drawn: four page widths. Taller pages are drawn smaller to fit. */
export const MAX_PAGE_HEIGHT_PX = 4 * PAGE_WIDTH_PX;
/** Same pixel cap as the safe preview: bounds decode and canvas memory. */
export const MAX_PAGE_PIXELS = 40_000_000;
/** Editor images of a photo are no wider than this. */
const EDITOR_MAX_SIDE_PX = 1600;
const EDITOR_JPEG_QUALITY = 82;
/** JPEG quality steps for a safe copy page: the first that fits the page's byte limit is used. */
const SAFE_COPY_QUALITIES: readonly number[] = [80, 62, 48];
/** Longest side of a safe copy made from a photo: the first that fits the byte limit is used. */
const IMAGE_SIDES_PX: readonly number[] = [2000, 1600, 1240];
/** Extra pixels painted around every box, so compression never softens its edge into view. */
export const MASK_PAD_PX = 2;
/** Text pieces read from one page at most (suggestions only). */
const MAX_TEXT_ITEMS_PER_PAGE = 2_000;
/** The longest delay a timer accepts. */
const MAX_TIMER_MS = 2_147_483_647;

type CanvasModule = typeof import('@napi-rs/canvas');
type Canvas = import('@napi-rs/canvas').Canvas;
type PdfProxy = Awaited<ReturnType<typeof import('unpdf').getDocumentProxy>>;

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

function isImage(contentType: string): boolean {
  return contentType === 'image/png' || contentType === 'image/jpeg';
}

/**
 * The scale a PDF page is drawn at: `PAGE_WIDTH_PX` wide, unless that would make it taller than
 * `MAX_PAGE_HEIGHT_PX`, in which case it is drawn to that height. Refused when the result would be
 * under one pixel either way or over `MAX_PAGE_PIXELS`.
 */
export function pdfPageScale(widthPt: number, heightPt: number): number {
  if (!(widthPt > 0) || !(heightPt > 0)) throw new Refused('unreadable', 'the page has no size');
  let scale = PAGE_WIDTH_PX / widthPt;
  if (heightPt * scale > MAX_PAGE_HEIGHT_PX) scale = MAX_PAGE_HEIGHT_PX / heightPt;
  const width = Math.floor(widthPt * scale);
  const height = Math.floor(heightPt * scale);
  if (width < 1 || height < 1 || width * height > MAX_PAGE_PIXELS) {
    throw new Refused('too_large', 'the page is too large to draw');
  }
  return scale;
}

export interface SafeCopyRendererOptions {
  /** The clock the time limit is measured on (tests pass their own). */
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

  /** Runs `work` in turn, its deadline counted from when it starts, not from when it queued. */
  private run<T>(budget: SafeCopyBudget, work: (deadline: number) => Promise<T>): Promise<T> {
    return oneAtATime(() => work(this.now() + budget.timeLimitMs));
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
    deadline: number,
    work: (pdf: PdfProxy) => Promise<T>,
  ): Promise<T> {
    const { getDocumentProxy } = await import('unpdf');
    let pdf: PdfProxy | undefined;
    try {
      pdf = await this.beforeDeadline(getDocumentProxy(new Uint8Array(source.bytes)), deadline);
      if (pdf.numPages < 1) throw new Refused('unreadable', 'the PDF has no pages');
      if (pdf.numPages > budget.maxPages) {
        throw new Refused('too_large', `the PDF has more than ${budget.maxPages} pages`);
      }
      return await work(pdf);
    } finally {
      await pdf?.loadingTask.destroy();
    }
  }

  /**
   * One PDF page drawn (see `pdfPageScale`), decoded onto a fresh canvas, and its size in points.
   * The page is released as soon as it is drawn.
   */
  private async drawPdfPage(
    canvasModule: CanvasModule,
    pdf: PdfProxy,
    pageNumber: number,
    deadline: number,
  ): Promise<{ canvas: Canvas; widthPt: number; heightPt: number }> {
    const { renderPageAsImage } = await import('unpdf');
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
      throw new Refused('unreadable', 'no such page');
    }
    this.checkTime(deadline);
    const page = await this.beforeDeadline(pdf.getPage(pageNumber), deadline);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const scale = pdfPageScale(viewport.width, viewport.height);
      const png = await this.beforeDeadline(
        renderPageAsImage(pdf, pageNumber, {
          canvasImport: () => import('@napi-rs/canvas'),
          scale,
          toDataURL: false,
        }),
        deadline,
      );
      const image = await this.beforeDeadline(canvasModule.loadImage(Buffer.from(png)), deadline);
      if (image.width * image.height > MAX_PAGE_PIXELS) {
        throw new Refused('too_large', 'the page is too large to draw');
      }
      const canvas = canvasModule.createCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, image.width, image.height);
      context.drawImage(image, 0, 0);
      return { canvas, widthPt: viewport.width, heightPt: viewport.height };
    } finally {
      page.cleanup();
    }
  }

  /** A stored photo decoded onto a fresh canvas no larger than `maxSide` on its longest side. */
  private async drawImage(
    canvasModule: CanvasModule,
    source: SafeCopySource,
    maxSide: number,
    deadline: number,
  ): Promise<Canvas> {
    const dims = imageDimensions(source.contentType, source.bytes);
    if (dims && dims.width * dims.height > MAX_PAGE_PIXELS) {
      throw new Refused('too_large', 'the image has too many pixels');
    }
    const image = await this.beforeDeadline(
      canvasModule.loadImage(Buffer.from(source.bytes)),
      deadline,
    );
    if (image.width * image.height > MAX_PAGE_PIXELS) {
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
    return this.run(budget, async (deadline) => {
      try {
        if (source.contentType === 'application/pdf') {
          const pageCount = await this.withPdf(
            source,
            budget,
            deadline,
            async (pdf) => pdf.numPages,
          );
          return { ok: true as const, pageCount };
        }
        if (isImage(source.contentType)) {
          const dims = imageDimensions(source.contentType, source.bytes);
          if (!dims) return failure('unreadable', 'the image size could not be read');
          if (dims.width * dims.height > MAX_PAGE_PIXELS) {
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
    return this.run(budget, async (deadline) => {
      try {
        const canvasModule = await import('@napi-rs/canvas');
        let canvas: Canvas;
        if (source.contentType === 'application/pdf') {
          canvas = await this.withPdf(
            source,
            budget,
            deadline,
            async (pdf) => (await this.drawPdfPage(canvasModule, pdf, page, deadline)).canvas,
          );
        } else if (isImage(source.contentType)) {
          if (page !== 1) return failure('unreadable', 'an image has one page');
          canvas = await this.drawImage(canvasModule, source, EDITOR_MAX_SIDE_PX, deadline);
        } else {
          return failure('unsupported', 'safe copies are made from PDF files and images only');
        }
        const encoded = await this.beforeDeadline(
          canvas.encode('jpeg', EDITOR_JPEG_QUALITY),
          deadline,
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
    return this.run(budget, async (deadline) => {
      try {
        const pages = await this.withPdf(source, budget, deadline, async (pdf) => {
          const all: PositionedText[][] = [];
          for (let number = 1; number <= pdf.numPages; number++) {
            this.checkTime(deadline);
            const page = await this.beforeDeadline(pdf.getPage(number), deadline);
            try {
              all.push(await this.readPageText(page, deadline));
            } finally {
              page.cleanup();
            }
          }
          return all;
        });
        return { ok: true as const, pages };
      } catch (error) {
        return asFailure(error);
      }
    });
  }

  private async readPageText(
    page: Awaited<ReturnType<PdfProxy['getPage']>>,
    deadline: number,
  ): Promise<PositionedText[]> {
    const viewport = page.getViewport({ scale: 1 });
    const content = await this.beforeDeadline(page.getTextContent(), deadline);
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
      items.push({ text: item.str, box: { x: left, y: top, w: right - left, h: bottom - top } });
    }
    return items;
  }

  async renderMaskedPage(
    source: SafeCopySource,
    page: number,
    boxes: readonly SafeCopyBox[],
    budget: SafeCopyBudget & { readonly maxBytes: number },
  ): ReturnType<SafeCopyRendererPort['renderMaskedPage']> {
    return this.run(budget, async (deadline) => {
      try {
        const canvasModule = await import('@napi-rs/canvas');
        if (source.contentType === 'application/pdf') {
          const drawn = await this.withPdf(source, budget, deadline, (pdf) =>
            this.drawPdfPage(canvasModule, pdf, page, deadline),
          );
          paintMasks(drawn.canvas, boxes);
          for (const quality of SAFE_COPY_QUALITIES) {
            const encoded = await this.encodePage(
              drawn.canvas,
              quality,
              drawn.widthPt,
              drawn.heightPt,
              deadline,
            );
            if (encoded.jpeg.byteLength <= budget.maxBytes) {
              return {
                ok: true as const,
                contentType: 'image/jpeg' as const,
                bytes: encoded.jpeg,
                widthPt: drawn.widthPt,
                heightPt: drawn.heightPt,
              };
            }
          }
          return failure('too_large', 'the page would be too large for a safe copy');
        }
        if (isImage(source.contentType)) {
          if (page !== 1) return failure('unreadable', 'an image has one page');
          for (const side of IMAGE_SIDES_PX) {
            this.checkTime(deadline);
            const canvas = await this.drawImage(canvasModule, source, side, deadline);
            paintMasks(canvas, boxes);
            const encoded = await this.beforeDeadline(canvas.encode('png'), deadline);
            const png = stripPngMetadata(new Uint8Array(encoded));
            if (png.byteLength <= budget.maxBytes) {
              return {
                ok: true as const,
                contentType: 'image/png' as const,
                bytes: png,
                widthPt: canvas.width,
                heightPt: canvas.height,
              };
            }
          }
          return failure('too_large', 'the safe copy would be too large');
        }
        return failure('unsupported', 'safe copies are made from PDF files and images only');
      } catch (error) {
        return asFailure(error);
      }
    });
  }

  assembleSafeCopy(
    pages: readonly SafeCopyPageImage[],
    maxOutputBytes: number,
  ): ReturnType<SafeCopyRendererPort['assembleSafeCopy']> {
    try {
      const [only] = pages;
      if (!only) return failure('unreadable', 'a safe copy needs at least one page');
      if (only.contentType === 'image/png') {
        if (pages.length !== 1) return failure('unreadable', 'a photo has one page');
        // Stripped again: only image chunks ever leave, whatever was stored.
        const png = stripPngMetadata(only.bytes);
        if (png.byteLength > maxOutputBytes) {
          return failure('too_large', 'the safe copy would be too large');
        }
        return { ok: true, contentType: 'image/png', bytes: png };
      }
      const written: PdfImagePage[] = pages.map((page) => {
        if (page.contentType !== 'image/jpeg') {
          throw new Refused('unreadable', 'a PDF safe copy has JPEG pages only');
        }
        const { jpeg, info } = stripJpegMetadata(page.bytes);
        return { jpeg, ...info, widthPt: page.widthPt, heightPt: page.heightPt };
      });
      const bytes = writeImagePdf(written);
      if (bytes.byteLength > maxOutputBytes) {
        return failure('too_large', 'the safe copy would be too large');
      }
      return { ok: true, contentType: 'application/pdf', bytes };
    } catch (error) {
      return asFailure(error);
    }
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
function paintMasks(canvas: Canvas, boxes: readonly SafeCopyBox[]): void {
  const context = canvas.getContext('2d');
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
