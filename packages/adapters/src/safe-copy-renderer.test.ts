import { randomBytes } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { SafeCopyBox, SafeCopySource } from '@visastack/services';
import { getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { stripJpegMetadata, stripPngMetadata, writeImagePdf } from './image-pdf-writer';
import {
  BuiltinSafeCopyRenderer,
  MASK_PAD_PX,
  MAX_PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
} from './safe-copy-renderer';
import { assemblePdf, loadedPdf, passwordPdf } from './test-pdf.test-support';

const TIMEOUT_MS = 60_000;
const PDF = 'application/pdf';
const BUDGET = { timeLimitMs: 60_000, maxPages: 20, maxBytes: 4_000_000 };
const MAX_OUTPUT = 4_000_000;

/**
 * What preparing and then downloading a safe copy does: every page drawn once with its boxes
 * (as the owner's prepare step stores them), then put together without drawing anything.
 */
async function prepareAndAssemble(
  renderer: BuiltinSafeCopyRenderer,
  source: SafeCopySource,
  masks: readonly (readonly SafeCopyBox[])[],
  maxOutput = MAX_OUTPUT,
) {
  const pages = [];
  for (const [index, boxes] of masks.entries()) {
    const page = await renderer.renderMaskedPage(source, index + 1, boxes, BUDGET);
    if (!page.ok) return page;
    pages.push(page);
  }
  return renderer.assembleSafeCopy(pages, maxOutput);
}
const BOX = { x: 0.1, y: 0.3, w: 0.3, h: 0.1 };

function marker(): string {
  return `MK${randomBytes(6).toString('hex').toUpperCase()}`;
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

/** The JPEG data of every image stream in a PDF this writer produced. */
function jpegStreams(pdf: Uint8Array): Uint8Array[] {
  const text = latin1(pdf);
  const out: Uint8Array[] = [];
  const pattern = /\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/g;
  for (const match of text.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length;
    out.push(pdf.subarray(start, start + Number(match[1])));
  }
  return out;
}

/** The PDF with every stream body removed, so only its structure is left to read. */
function structureOnly(pdf: Uint8Array): string {
  return latin1(pdf).replace(/stream\n[\s\S]*?\nendstream/g, 'stream endstream');
}

/** Every /Name the writer may use; anything else would be a way to carry data. */
const ALLOWED_NAMES = new Set([
  'Type',
  'Catalog',
  'Pages',
  'Kids',
  'Count',
  'Page',
  'Parent',
  'MediaBox',
  'Resources',
  'XObject',
  'Im0',
  'Contents',
  'Subtype',
  'Image',
  'Width',
  'Height',
  'ColorSpace',
  'DeviceRGB',
  'DeviceGray',
  'BitsPerComponent',
  'Filter',
  'DCTDecode',
  'Length',
  'Size',
  'Root',
]);

async function pixel(jpegOrPng: Uint8Array, fx: number, fy: number) {
  const image = await loadImage(Buffer.from(jpegOrPng));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return {
    width: image.width,
    height: image.height,
    data: context.getImageData(0, 0, image.width, image.height).data,
    at(x: number, y: number) {
      const i = (y * image.width + x) * 4;
      return [this.data[i] ?? -1, this.data[i + 1] ?? -1, this.data[i + 2] ?? -1];
    },
    fx,
    fy,
  };
}

/** The largest channel value anywhere inside the box, 2 pixels in from its edge. */
async function brightestInside(image: Uint8Array, box: typeof BOX): Promise<number> {
  const decoded = await pixel(image, 0, 0);
  const left = Math.ceil(box.x * decoded.width) + 2;
  const top = Math.ceil(box.y * decoded.height) + 2;
  const right = Math.floor((box.x + box.w) * decoded.width) - 2;
  const bottom = Math.floor((box.y + box.h) * decoded.height) - 2;
  let brightest = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      brightest = Math.max(brightest, ...decoded.at(x, y));
    }
  }
  return brightest;
}

describe('safe copy renderer: what the copy carries', () => {
  it(
    'keeps no text, metadata, attachment, form, note, script or original object of the source',
    async () => {
      const mark = marker();
      const source = { bytes: loadedPdf({ marker: mark, pages: 2 }), contentType: PDF };
      // The source really does carry the marker everywhere a safe copy must not.
      const input = await getDocumentProxy(new Uint8Array(source.bytes));
      expect((await input.getMetadata()).info).toMatchObject({ Title: mark });
      expect(await input.getAttachments()).not.toBeNull();
      expect(JSON.stringify((await (await input.getPage(1)).getTextContent()).items)).toContain(
        mark,
      );
      await input.loadingTask.destroy();

      const renderer = new BuiltinSafeCopyRenderer();
      const made = await prepareAndAssemble(renderer, source, [[BOX], []]);
      expect(made.ok).toBe(true);
      if (!made.ok) return;
      expect(made.contentType).toBe('application/pdf');

      // Nothing of the marker survives anywhere in the bytes.
      expect(latin1(made.bytes)).not.toContain(mark);

      // Parsed back: no text layer, no metadata, no attachments, no forms, no scripts, no notes.
      const output = await getDocumentProxy(new Uint8Array(made.bytes));
      try {
        expect(output.numPages).toBe(2);
        const meta = await output.getMetadata();
        expect(meta.metadata).toBeNull();
        for (const key of ['Title', 'Author', 'Producer', 'Creator', 'Keywords', 'Subject']) {
          expect(meta.info).not.toHaveProperty(key);
        }
        expect(meta.info).not.toHaveProperty('CreationDate');
        expect(meta.info).not.toHaveProperty('Custom');
        expect(meta.info).toMatchObject({ IsAcroFormPresent: false });
        expect(await output.getAttachments()).toBeNull();
        expect(await output.getFieldObjects()).toBeNull();
        expect(await output.getJSActions()).toBeNull();
        expect(await output.getOutline()).toBeNull();
        for (const number of [1, 2]) {
          const page = await output.getPage(number);
          expect((await page.getTextContent()).items).toEqual([]);
          expect(await page.getAnnotations()).toEqual([]);
        }
      } finally {
        await output.loadingTask.destroy();
      }

      // Byte level: only the writer's own keys, no text operators, a trailer with only /Size and
      // /Root, and image streams with no metadata segments.
      const structure = structureOnly(made.bytes);
      const names = [...structure.matchAll(/\/([A-Za-z0-9]+)/g)].map((m) => m[1] ?? '');
      expect(names.filter((name) => !ALLOWED_NAMES.has(name))).toEqual([]);
      expect(structure).not.toMatch(/\bBT\b|\bTj\b|\bTJ\b|\/Font|\/Info|\/ID|\/Metadata/);
      expect(structure).toMatch(/trailer\n<< \/Size \d+ \/Root 1 0 R >>/);
      const images = jpegStreams(made.bytes);
      expect(images).toHaveLength(2);
      for (const image of images) {
        for (let i = 2; i + 4 < image.length; ) {
          const marker = image[i + 1] ?? 0;
          expect(marker >= 0xe0 && marker <= 0xef).toBe(false);
          expect(marker).not.toBe(0xfe);
          if (marker === 0xda) break;
          i += 2 + (((image[i + 2] ?? 0) << 8) | (image[i + 3] ?? 0));
        }
      }
    },
    TIMEOUT_MS,
  );

  it(
    'paints every box solid black, page by page, and leaves the rest of the page as it was',
    async () => {
      const renderer = new BuiltinSafeCopyRenderer();
      const source = { bytes: loadedPdf({ marker: marker(), pages: 2 }), contentType: PDF };
      const made = await prepareAndAssemble(renderer, source, [[BOX], []]);
      expect(made.ok).toBe(true);
      if (!made.ok) return;
      const [first, second] = jpegStreams(made.bytes);
      if (!first || !second) throw new Error('two pages expected');
      // JPEG pages: at most 8 in any channel, 2 pixels inside the box.
      expect(await brightestInside(first, BOX)).toBeLessThanOrEqual(8);
      // Outside the box the red page is still red; the second page had no box at all.
      const page = await pixel(first, 0, 0);
      expect(page.width).toBe(PAGE_WIDTH_PX);
      const [r, g, b] = page.at(Math.round(page.width * 0.8), Math.round(page.height * 0.8));
      expect(r).toBeGreaterThan(200);
      expect(g).toBeLessThan(60);
      expect(b).toBeLessThan(60);
      expect(await brightestInside(second, BOX)).toBeGreaterThan(200);
    },
    TIMEOUT_MS,
  );

  it(
    'makes one PNG from a photo, with exactly black boxes and only image chunks',
    async () => {
      const canvas = createCanvas(400, 300);
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, 400, 300);
      const png = new Uint8Array(canvas.toBuffer('image/png'));
      const renderer = new BuiltinSafeCopyRenderer();
      const made = await prepareAndAssemble(renderer, { bytes: png, contentType: 'image/png' }, [
        [BOX],
      ]);
      expect(made.ok).toBe(true);
      if (!made.ok) return;
      expect(made.contentType).toBe('image/png');
      // PNG is exact: every pixel of the box, padding included, is 0, 0, 0.
      const decoded = await pixel(made.bytes, 0, 0);
      const left = Math.floor(BOX.x * 400) - MASK_PAD_PX;
      const right = Math.ceil((BOX.x + BOX.w) * 400) + MASK_PAD_PX;
      const top = Math.floor(BOX.y * 300) - MASK_PAD_PX;
      const bottom = Math.ceil((BOX.y + BOX.h) * 300) + MASK_PAD_PX;
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) expect(decoded.at(x, y)).toEqual([0, 0, 0]);
      }
      expect(decoded.at(5, 5)).toEqual([255, 255, 255]);
      const chunks: string[] = [];
      for (let i = 8; i < made.bytes.length; ) {
        const length = Buffer.from(made.bytes).readUInt32BE(i);
        chunks.push(latin1(made.bytes.subarray(i + 4, i + 8)));
        i += 12 + length;
      }
      expect(
        chunks.every((chunk) => ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(chunk)),
      ).toBe(true);
    },
    TIMEOUT_MS,
  );
});

describe('safe copy renderer: limits and refusals', () => {
  it(
    'refuses more than 20 pages before drawing anything',
    async () => {
      const renderer = new BuiltinSafeCopyRenderer();
      const source = { bytes: loadedPdf({ marker: marker(), pages: 21 }), contentType: PDF };
      expect(await renderer.pageCount(source, BUDGET)).toMatchObject({
        ok: false,
        reason: 'too_large',
      });
      expect(await renderer.renderMaskedPage(source, 1, [], BUDGET)).toMatchObject({
        ok: false,
        reason: 'too_large',
      });
      const twenty = { bytes: loadedPdf({ marker: marker(), pages: 20 }), contentType: PDF };
      expect(await renderer.pageCount(twenty, BUDGET)).toEqual({ ok: true, pageCount: 20 });
    },
    TIMEOUT_MS,
  );

  it(
    'puts stored pages together only when they are well formed, never mixing kinds',
    async () => {
      const renderer = new BuiltinSafeCopyRenderer();
      const source = { bytes: loadedPdf({ marker: marker(), pages: 1 }), contentType: PDF };
      const page = await renderer.renderMaskedPage(source, 1, [BOX], BUDGET);
      if (!page.ok) throw new Error('page expected');
      const png = { ...page, contentType: 'image/png' as const };
      expect(renderer.assembleSafeCopy([], MAX_OUTPUT)).toMatchObject({ ok: false });
      expect(renderer.assembleSafeCopy([page, png], MAX_OUTPUT)).toMatchObject({ ok: false });
      const broken = { ...page, bytes: new Uint8Array([1, 2, 3]) };
      expect(renderer.assembleSafeCopy([broken], MAX_OUTPUT)).toMatchObject({
        ok: false,
        reason: 'unreadable',
      });
      expect(renderer.assembleSafeCopy([page], 100)).toMatchObject({
        ok: false,
        reason: 'too_large',
      });
      expect(renderer.assembleSafeCopy([page, page], MAX_OUTPUT)).toMatchObject({ ok: true });
    },
    TIMEOUT_MS,
  );

  it(
    'stops when the time allowed runs out, counting from when the drawing starts',
    async () => {
      // Each look at the clock moves it on 4 seconds; 6 seconds run out part way through.
      let now = 0;
      const renderer = new BuiltinSafeCopyRenderer({
        now: () => {
          now += 4_000;
          return now;
        },
      });
      const source = { bytes: loadedPdf({ marker: marker(), pages: 6 }), contentType: PDF };
      const made = await renderer.renderMaskedPage(source, 6, [], {
        ...BUDGET,
        timeLimitMs: 6_000,
      });
      expect(made).toMatchObject({ ok: false, reason: 'out_of_time' });
      // No time at all: refused before anything is drawn.
      const none = new BuiltinSafeCopyRenderer();
      expect(await none.pageCount(source, { ...BUDGET, timeLimitMs: 0 })).toMatchObject({
        ok: false,
        reason: 'out_of_time',
      });
    },
    TIMEOUT_MS,
  );

  it(
    'refuses a page when the file does not have the page count the boxes were saved for',
    async () => {
      const renderer = new BuiltinSafeCopyRenderer();
      const source = { bytes: loadedPdf({ marker: marker(), pages: 2 }), contentType: PDF };
      expect(
        await renderer.renderMaskedPage(source, 1, [], { ...BUDGET, expectedPageCount: 3 }),
      ).toMatchObject({ ok: false, reason: 'unreadable' });
      expect(
        await renderer.renderMaskedPage(source, 3, [], { ...BUDGET, expectedPageCount: 2 }),
      ).toMatchObject({ ok: false, reason: 'unreadable' });
      expect(
        await renderer.renderMaskedPage(source, 2, [], { ...BUDGET, expectedPageCount: 2 }),
      ).toMatchObject({ ok: true, contentType: 'image/jpeg' });
    },
    TIMEOUT_MS,
  );

  it(
    'refuses an output that cannot be kept inside the size limit',
    async () => {
      const renderer = new BuiltinSafeCopyRenderer();
      const source = { bytes: loadedPdf({ marker: marker(), pages: 1 }), contentType: PDF };
      expect(
        await renderer.renderMaskedPage(source, 1, [], { ...BUDGET, maxBytes: 500 }),
      ).toMatchObject({ ok: false, reason: 'too_large' });
    },
    TIMEOUT_MS,
  );

  it(
    'refuses protected and damaged PDFs, documents and text, without drawing',
    async () => {
      const renderer = new BuiltinSafeCopyRenderer();
      const cases = [
        { bytes: passwordPdf(), contentType: PDF, reason: 'unreadable' },
        {
          bytes: new TextEncoder().encode('%PDF-1.7 broken'),
          contentType: PDF,
          reason: 'unreadable',
        },
        {
          bytes: new Uint8Array([0x50, 0x4b, 3, 4]),
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          reason: 'unsupported',
        },
        {
          bytes: new TextEncoder().encode('hello'),
          contentType: 'text/plain',
          reason: 'unsupported',
        },
      ];
      for (const { reason, ...source } of cases) {
        expect(await renderer.pageCount(source, BUDGET)).toMatchObject({ ok: false, reason });
        expect(await renderer.renderMaskedPage(source, 1, [], BUDGET)).toMatchObject({
          ok: false,
          reason,
        });
        expect(await renderer.renderPage(source, 1, BUDGET)).toMatchObject({ ok: false, reason });
      }
    },
    TIMEOUT_MS,
  );
});

describe('safe copy renderer: page size caps', () => {
  const blankPdf = (w: number, h: number) =>
    assemblePdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] >>`,
    ]);

  it(
    'draws a very tall page smaller, never taller than four page widths',
    async () => {
      const renderer = new BuiltinSafeCopyRenderer();
      for (const [w, h] of [
        [612, 7920],
        [10, 14400],
      ] as const) {
        const page = await renderer.renderPage(
          { bytes: blankPdf(w, h), contentType: PDF },
          1,
          BUDGET,
        );
        expect(page.ok).toBe(true);
        if (!page.ok) return;
        expect(page.height).toBeLessThanOrEqual(MAX_PAGE_HEIGHT_PX);
        expect(page.width * page.height).toBeLessThanOrEqual(PAGE_WIDTH_PX * MAX_PAGE_HEIGHT_PX);
      }
    },
    TIMEOUT_MS,
  );

  it(
    'refuses a page that would be under one pixel, before drawing it',
    async () => {
      const renderer = new BuiltinSafeCopyRenderer();
      const page = await renderer.renderPage(
        { bytes: blankPdf(14400, 1), contentType: PDF },
        1,
        BUDGET,
      );
      expect(page).toMatchObject({ ok: false, reason: 'too_large' });
    },
    TIMEOUT_MS,
  );
});

describe('safe copy renderer: the editor', () => {
  it(
    'draws a page as a JPEG at the safe copy width, with no metadata segments',
    async () => {
      const renderer = new BuiltinSafeCopyRenderer();
      const source = { bytes: loadedPdf({ marker: marker(), pages: 2 }), contentType: PDF };
      const page = await renderer.renderPage(source, 2, BUDGET);
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      expect(page.width).toBe(PAGE_WIDTH_PX);
      expect(page.contentType).toBe('image/jpeg');
      expect(stripJpegMetadata(page.bytes).jpeg).toEqual(page.bytes);
      expect(await renderer.renderPage(source, 3, BUDGET)).toMatchObject({ ok: false });
    },
    TIMEOUT_MS,
  );

  it(
    "reads where the file's own text sits on each page",
    async () => {
      const mark = marker();
      const renderer = new BuiltinSafeCopyRenderer();
      const text = await renderer.textPositions(
        { bytes: loadedPdf({ marker: mark, pages: 2 }), contentType: PDF },
        BUDGET,
      );
      expect(text.ok).toBe(true);
      if (!text.ok) return;
      expect(text.pages).toHaveLength(2);
      const item = text.pages[0]?.find((entry) => entry.text === mark);
      if (!item) throw new Error('marker text expected');
      // Drawn at x 72 and baseline 700 of 792 points, 24 points tall.
      expect(item.box.x).toBeCloseTo(72 / 612, 2);
      expect(item.box.y).toBeLessThan((792 - 700 - 20) / 792);
      expect(item.box.y + item.box.h).toBeGreaterThan((792 - 700) / 792);
      expect(text.pages[1]).toEqual([]);
      expect(
        await renderer.textPositions(
          { bytes: new Uint8Array(8), contentType: 'image/png' },
          BUDGET,
        ),
      ).toEqual({ ok: true, pages: [[]] });
    },
    TIMEOUT_MS,
  );
});

describe('image-only PDF writer', () => {
  it('writes a parseable PDF whose cross-reference offsets point at their objects', async () => {
    const canvas = createCanvas(20, 10);
    canvas.getContext('2d').fillRect(0, 0, 20, 10);
    const { jpeg, info } = stripJpegMetadata(new Uint8Array(await canvas.encode('jpeg', 80)));
    expect(info).toEqual({ widthPx: 20, heightPx: 10, components: 3 });
    const pdf = writeImagePdf([
      { jpeg, ...info, widthPt: 200, heightPt: 100 },
      { jpeg, ...info, widthPt: 595.28, heightPt: 841.89 },
    ]);
    const text = latin1(pdf);
    const xref = Number(text.match(/startxref\n(\d+)/)?.[1]);
    const rows = text.slice(xref).split('\n').slice(3, 9);
    rows.forEach((row, index) => {
      expect(text.slice(Number(row.slice(0, 10)))).toMatch(new RegExp(`^${index + 1} 0 obj`));
    });
    const parsed = await getDocumentProxy(new Uint8Array(pdf));
    expect(parsed.numPages).toBe(2);
    expect((await parsed.getPage(2)).view).toEqual([0, 0, 595.28, 841.89]);
    await parsed.loadingTask.destroy();
    expect(() => writeImagePdf([])).toThrow();
  });

  it('strips text and time chunks from a PNG and refuses what is not one', () => {
    const canvas = createCanvas(4, 4);
    const png = new Uint8Array(canvas.toBuffer('image/png'));
    const stripped = stripPngMetadata(png);
    expect(latin1(stripped)).not.toMatch(/sRGB|sBIT|tEXt|tIME/);
    expect(() => stripPngMetadata(new Uint8Array(12))).toThrow();
    expect(() => stripJpegMetadata(new Uint8Array(12))).toThrow();
  });
});
