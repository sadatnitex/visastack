/**
 * A minimal, image-only PDF writer for safe copies (ADR 0022, S23).
 *
 * Every page is one JPEG drawn to fill the page, and nothing else: a catalog, a page tree, and per
 * page a page object, its image and a four-operator content stream. There is deliberately no
 * document information dictionary, no file identifier, no XMP metadata, no fonts or text, no
 * annotations, forms, outlines, names, attachments, actions or scripts, so none of those can
 * carry anything from the original. The trailer holds only /Size and /Root.
 *
 * Hand-written on purpose: the canvas library's own PDF output writes a producer name and a
 * creation date, and no PDF library is otherwise needed. The structure is small enough to test
 * key by key (see image-pdf-writer.test.ts).
 */

export interface PdfImagePage {
  /** Baseline JPEG data with no metadata segments (see `stripJpegMetadata`). */
  readonly jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  readonly widthPx: number;
  readonly heightPx: number;
  /** 1 for grey, 3 for colour. */
  readonly components: 1 | 3;
  /** Page size in points (1/72 inch). */
  readonly widthPt: number;
  readonly heightPt: number;
}

const encoder = new TextEncoder();

function number(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error('page sizes must be positive');
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '');
}

function integer(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('image sizes must be positive');
  return String(value);
}

/** Writes the pages as one PDF. Throws for an empty list or a nonsensical size. */
export function writeImagePdf(pages: readonly PdfImagePage[]): Uint8Array {
  if (pages.length === 0) throw new Error('a PDF needs at least one page');
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.byteLength;
  };
  const startObject = (id: number) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  // Header with a binary comment so transfer tools treat the file as binary.
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // Object numbers: 1 catalog, 2 page tree, then three per page (page, image, contents).
  const pageId = (index: number) => 3 + index * 3;
  const kids = pages.map((_, index) => `${pageId(index)} 0 R`).join(' ');

  startObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObject(2);
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, index) => {
    const id = pageId(index);
    const imageId = id + 1;
    const contentsId = id + 2;
    const w = number(page.widthPt);
    const h = number(page.heightPt);
    startObject(id);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentsId} 0 R >>\nendobj\n`,
    );
    startObject(imageId);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${integer(page.widthPx)} /Height ${integer(page.heightPx)} /ColorSpace ${page.components === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.byteLength} >>\nstream\n`,
    );
    push(page.jpeg);
    push('\nendstream\nendobj\n');
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    startObject(contentsId);
    push(
      `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}\nendstream\nendobj\n`,
    );
  });

  const size = 3 + pages.length * 3;
  const xrefOffset = length;
  push(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let id = 1; id < size; id++) {
    const offset = offsets[id];
    if (offset === undefined) throw new Error('missing object offset');
    push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

export interface JpegInfo {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly components: 1 | 3;
}

/**
 * A JPEG with every application segment (APP0 to APP15: JFIF, Exif, ICC, XMP and the like) and
 * every comment removed, plus its size and colour components read from the frame header. Only
 * the segments needed to decode the image remain. Throws on anything that is not a plain baseline
 * or progressive JPEG with 1 or 3 components.
 */
export function stripJpegMetadata(input: Uint8Array): {
  readonly jpeg: Uint8Array;
  readonly info: JpegInfo;
} {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) throw new Error('not a JPEG');
  const kept: Uint8Array[] = [input.subarray(0, 2)];
  let info: JpegInfo | undefined;
  let i = 2;
  while (i + 4 <= input.length) {
    if (input[i] !== 0xff) throw new Error('JPEG segment marker expected');
    const marker = input[i + 1] ?? 0;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    const segmentLength = ((input[i + 2] ?? 0) << 8) | (input[i + 3] ?? 0);
    if (segmentLength < 2 || i + 2 + segmentLength > input.length) throw new Error('JPEG segment');
    const segment = input.subarray(i, i + 2 + segmentLength);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isComment = marker === 0xfe;
    // Start of frame (baseline or progressive Huffman): read size and components.
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const heightPx = ((segment[5] ?? 0) << 8) | (segment[6] ?? 0);
      const widthPx = ((segment[7] ?? 0) << 8) | (segment[8] ?? 0);
      const components = segment[9];
      if (components !== 1 && components !== 3) throw new Error('JPEG colour components');
      if (widthPx < 1 || heightPx < 1) throw new Error('JPEG size');
      info = { widthPx, heightPx, components };
    }
    if (!isApp && !isComment) kept.push(segment);
    i += 2 + segmentLength;
    if (marker === 0xda) {
      // Start of scan: the entropy-coded data and everything after it are image data.
      kept.push(input.subarray(i));
      break;
    }
  }
  if (!info) throw new Error('JPEG has no frame header');
  const total = kept.reduce((sum, part) => sum + part.byteLength, 0);
  const jpeg = new Uint8Array(total);
  let at = 0;
  for (const part of kept) {
    jpeg.set(part, at);
    at += part.byteLength;
  }
  return { jpeg, info };
}

/** PNG chunks a safe copy keeps: the image itself, nothing that describes it. */
const PNG_KEPT_CHUNKS: ReadonlySet<string> = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG with every chunk other than the image's own data removed (text, time, colour notes). */
export function stripPngMetadata(input: Uint8Array): Uint8Array {
  if (input.length < 8 || PNG_SIGNATURE.some((byte, index) => input[index] !== byte)) {
    throw new Error('not a PNG');
  }
  const kept: Uint8Array[] = [input.subarray(0, 8)];
  let i = 8;
  let ended = false;
  while (i + 12 <= input.length) {
    const chunkLength =
      (((input[i] ?? 0) << 24) >>> 0) +
      ((input[i + 1] ?? 0) << 16) +
      ((input[i + 2] ?? 0) << 8) +
      (input[i + 3] ?? 0);
    const end = i + 12 + chunkLength;
    if (end > input.length) throw new Error('PNG chunk');
    const type = String.fromCharCode(
      input[i + 4] ?? 0,
      input[i + 5] ?? 0,
      input[i + 6] ?? 0,
      input[i + 7] ?? 0,
    );
    if (PNG_KEPT_CHUNKS.has(type)) kept.push(input.subarray(i, end));
    i = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended) throw new Error('PNG has no end');
  const total = kept.reduce((sum, part) => sum + part.byteLength, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const part of kept) {
    png.set(part, at);
    at += part.byteLength;
  }
  return png;
}
