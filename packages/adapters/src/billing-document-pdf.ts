import type {
  BillingDocument,
  BillingDocumentTable,
  BillingDocumentTone,
} from '@visastack/services';
import type { PDFDocument, PDFFont, PDFPage, RGB } from 'pdf-lib';

/**
 * Draws a billing document (S30) as an A4 PDF. Pure layout: everything it writes comes from the
 * finished view model (`BillingDocument`, built and access-checked in @visastack/services), so the
 * same model always gives the same page, and nothing here reads a database, the network or a
 * file.
 *
 * Look: the product's light, flat style translated to print. Inter (the product's typeface,
 * embedded whole: fontkit's subsetter fails on these glyphs, and the Latin-1 files are small), the brand blue for the mark and one rule, hairline table borders, a soft
 * header row, and a status stamp drawn as an outlined pill whose word carries the meaning (never
 * colour alone). No gradients, no shadows, no images other than the mark.
 *
 * Long content flows onto further pages; every page carries the footer and "Page n of m".
 *
 * The PDF library, its font engine and the font data load only when a document is drawn (dynamic
 * imports), so nothing that merely imports @visastack/adapters pays for them.
 */

/** Who issues the document and how to reach them; from the deployment, never from the model. */
export interface BillingDocumentIssuer {
  /** The product address people know, e.g. "vs.obsidianglobal.studio". Optional. */
  readonly website?: string;
  /** A watched support address, when one is set up. */
  readonly supportEmail?: string;
}

const A4 = { width: 595.28, height: 841.89 } as const;
const MARGIN = 48;
const CONTENT_WIDTH = A4.width - MARGIN * 2;
const FOOTER_TOP = 72;
/** The Billed To column ends well before the facts column starts (at 52% of the width). */
const BILLED_TO_WIDTH = 230;
export const BILLING_DOCUMENT_LAYOUT = {
  margin: MARGIN,
  billedToWidth: BILLED_TO_WIDTH,
  factsX: MARGIN + CONTENT_WIDTH * 0.52,
} as const;

/** A colour in pdf-lib's own shape, made without loading the library. */
function rgb(red: number, green: number, blue: number): RGB {
  return { type: 'RGB', red, green, blue } as unknown as RGB;
}

function hex(value: string): RGB {
  const n = Number.parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** The product's colour tokens (apps/web/src/app/globals.css), for print. */
const COLOURS = {
  text: hex('#13243d'),
  secondary: hex('#3b4b63'),
  tertiary: hex('#4e6079'),
  brand: hex('#1d4c98'),
  brandBg: hex('#e8f0fc'),
  hairline: hex('#cad4e2'),
  hairlineSoft: hex('#e4e9f1'),
  subtle: hex('#edf1f5'),
  white: rgb(1, 1, 1),
} as const;

const STAMP_COLOURS: Readonly<Record<BillingDocumentTone, { ink: RGB; fill: RGB }>> = {
  paid: { ink: hex('#0f5a41'), fill: hex('#e8f4ee') },
  open: { ink: hex('#1d4c98'), fill: hex('#e8f0fc') },
  overdue: { ink: hex('#8f1f2b'), fill: hex('#fbeaec') },
  refunded: { ink: hex('#7a3f1f'), fill: hex('#fbeee7') },
  cancelled: { ink: hex('#3b4b63'), fill: hex('#edf1f5') },
};

/** The VisaStack Sliced V (components/brand-mark.tsx), on a 512 unit grid. */
const MARK_PATHS = [
  'M93.41 102.89 L92.45 102.96 L91.50 103.18 L90.60 103.54 L89.77 104.03 L89.02 104.64 L88.37 105.36 L87.84 106.17 L87.43 107.05 L87.16 107.98 L87.04 108.94 L87.06 109.90 L87.23 110.86 L87.54 111.77 L120.24 188.33 L120.74 189.27 L121.38 190.11 L122.16 190.84 L123.05 191.42 L124.02 191.85 L125.05 192.11 L126.11 192.20 L213.76 192.20 L214.74 192.13 L215.70 191.90 L216.61 191.53 L217.45 191.03 L218.20 190.40 L218.85 189.67 L219.38 188.84 L219.78 187.94 L220.03 187.00 L220.14 186.02 L220.09 185.04 L219.90 184.08 L219.56 183.16 L184.34 106.60 L183.83 105.70 L183.18 104.89 L182.41 104.19 L181.54 103.63 L180.59 103.22 L179.58 102.97 L178.55 102.89 Z',
  'M292.44 183.16 L292.10 184.08 L291.91 185.04 L291.86 186.02 L291.97 187.00 L292.22 187.94 L292.62 188.84 L293.15 189.67 L293.80 190.40 L294.55 191.03 L295.39 191.53 L296.30 191.90 L297.26 192.13 L298.24 192.20 L385.89 192.20 L386.95 192.11 L387.98 191.85 L388.95 191.42 L389.84 190.84 L390.62 190.11 L391.26 189.27 L391.76 188.33 L424.46 111.77 L424.77 110.86 L424.94 109.90 L424.96 108.94 L424.84 107.98 L424.57 107.05 L424.16 106.17 L423.63 105.36 L422.98 104.64 L422.23 104.03 L421.40 103.54 L420.50 103.18 L419.55 102.96 L418.59 102.89 L333.45 102.89 L332.42 102.97 L331.41 103.22 L330.46 103.63 L329.59 104.19 L328.82 104.89 L328.17 105.70 L327.66 106.60 Z',
  'M256.00 262.38 L238.63 224.63 L238.12 223.72 L237.48 222.91 L236.70 222.22 L235.83 221.66 L234.88 221.25 L233.87 221.00 L232.84 220.91 L143.82 220.91 L142.85 220.99 L141.91 221.20 L141.01 221.56 L140.18 222.05 L139.42 222.66 L138.78 223.38 L138.24 224.19 L137.84 225.07 L137.57 226.00 L137.45 226.96 L137.47 227.93 L137.64 228.88 L137.95 229.80 L169.28 303.16 L169.78 304.10 L170.43 304.95 L171.20 305.67 L172.09 306.26 L173.06 306.69 L174.09 306.95 L175.15 307.04 L336.85 307.04 L337.91 306.95 L338.94 306.69 L339.91 306.26 L340.80 305.67 L341.57 304.95 L342.22 304.10 L342.72 303.16 L374.05 229.80 L374.36 228.88 L374.53 227.93 L374.55 226.96 L374.43 226.00 L374.16 225.07 L373.76 224.19 L373.22 223.38 L372.58 222.66 L371.82 222.05 L370.99 221.56 L370.09 221.20 L369.15 220.99 L368.18 220.91 L279.16 220.91 L278.13 221.00 L277.12 221.25 L276.17 221.66 L275.30 222.22 L274.52 222.91 L273.88 223.72 L273.37 224.63 Z',
  'M325.01 344.63 L325.32 343.71 L325.49 342.76 L325.51 341.79 L325.39 340.83 L325.12 339.90 L324.71 339.02 L324.18 338.22 L323.53 337.50 L322.78 336.89 L321.95 336.40 L321.05 336.04 L320.10 335.82 L319.14 335.75 L192.86 335.75 L191.90 335.82 L190.95 336.04 L190.05 336.40 L189.22 336.89 L188.47 337.50 L187.82 338.22 L187.29 339.02 L186.88 339.90 L186.61 340.83 L186.49 341.79 L186.51 342.76 L186.68 343.71 L186.99 344.63 L212.88 405.24 L213.37 406.18 L214.02 407.02 L214.80 407.74 L215.68 408.33 L216.66 408.76 L217.69 409.02 L218.74 409.11 L293.26 409.11 L294.31 409.02 L295.34 408.76 L296.32 408.33 L297.20 407.74 L297.98 407.02 L298.63 406.18 L299.12 405.24 Z',
] as const;
const MARK_TILE =
  'M112 0 L400 0 Q512 0 512 112 L512 400 Q512 512 400 512 L112 512 Q0 512 0 400 L0 112 Q0 0 112 0 Z';

interface Fonts {
  readonly regular: PDFFont;
  readonly semibold: PDFFont;
  readonly supported: ReadonlySet<number>;
}

/**
 * A loader that runs once and keeps its answer, but forgets a failure: if loading fails, the
 * cached promise is cleared before the error goes on, so the next call tries again instead of
 * failing for the life of the server instance (S30).
 */
export function onceRetryingFailures<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    cached ??= load().catch((error: unknown) => {
      cached = null;
      throw error;
    });
    return cached;
  };
}

/** The decoded font files, decoded once per server instance. */
const loadFontFiles = onceRetryingFailures(() =>
  import('./billing-document-fonts').then((fonts) => ({
    regular: base64Bytes(fonts.INTER_REGULAR_TTF_BASE64),
    semibold: base64Bytes(fonts.INTER_SEMIBOLD_TTF_BASE64),
  })),
);

function base64Bytes(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, 'base64'));
}

/** Text the embedded font can draw: anything outside its character set becomes "?". */
function printable(fonts: Fonts, text: string): string {
  let out = '';
  for (const char of text.replace(/[\r\n\t]+/g, ' ')) {
    const code = char.codePointAt(0) ?? 63;
    out += fonts.supported.has(code) ? char : '?';
  }
  return out;
}

/** Splits text into lines no wider than `width`, breaking long words if they must. */
function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const words = text.split(/ +/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = '';
  const fits = (candidate: string) => font.widthOfTextAtSize(candidate, size) <= width;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (fits(word)) {
      line = word;
      continue;
    }
    // One word wider than the column (a long reference): cut it.
    let piece = '';
    for (const char of word) {
      if (fits(piece + char)) piece += char;
      else {
        lines.push(piece);
        piece = char;
      }
    }
    line = piece;
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

class Layout {
  readonly pages: PDFPage[] = [];
  page: PDFPage;
  y: number;

  constructor(
    readonly pdf: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.page = this.addPage();
    this.y = A4.height - MARGIN;
  }

  private addPage(): PDFPage {
    const page = this.pdf.addPage([A4.width, A4.height]);
    this.pages.push(page);
    return page;
  }

  /** Makes room for `height` points, starting a new page when the footer would be crossed. */
  ensure(height: number): void {
    if (this.y - height >= FOOTER_TOP + 12) return;
    this.page = this.addPage();
    this.y = A4.height - MARGIN;
  }

  text(
    value: string,
    x: number,
    y: number,
    options: { size: number; bold?: boolean; color?: RGB; align?: 'left' | 'right' } = { size: 10 },
  ): void {
    const font = options.bold ? this.fonts.semibold : this.fonts.regular;
    const clean = printable(this.fonts, value);
    const width = font.widthOfTextAtSize(clean, options.size);
    this.page.drawText(clean, {
      x: options.align === 'right' ? x - width : x,
      y,
      size: options.size,
      font,
      color: options.color ?? COLOURS.text,
    });
  }

  rule(y: number, color: RGB = COLOURS.hairline, thickness = 0.75): void {
    this.page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4.width - MARGIN, y },
      thickness,
      color,
    });
  }
}

function drawMark(page: PDFPage, x: number, top: number, size: number): void {
  const scale = size / 512;
  page.drawSvgPath(MARK_TILE, { x, y: top, scale, color: COLOURS.brand });
  for (const path of MARK_PATHS) page.drawSvgPath(path, { x, y: top, scale, color: COLOURS.white });
}

function drawStamp(
  layout: Layout,
  label: string,
  tone: BillingDocumentTone,
  left: number,
  top: number,
): void {
  const colours = STAMP_COLOURS[tone];
  const size = 10;
  const text = label;
  const font = layout.fonts.semibold;
  const width = font.widthOfTextAtSize(text, size) + 24;
  const height = 20;
  const x = left;
  const y = top - height;
  const r = height / 2;
  const pill = `M${r} 0 L${width - r} 0 Q${width} 0 ${width} ${r} Q${width} ${height} ${width - r} ${height} L${r} ${height} Q0 ${height} 0 ${r} Q0 0 ${r} 0 Z`;
  layout.page.drawSvgPath(pill, {
    x,
    y: top,
    color: colours.fill,
    borderColor: colours.ink,
    borderWidth: 1,
  });
  layout.page.drawText(text, {
    x: x + 12,
    y: y + 6.4,
    size,
    font,
    color: colours.ink,
  });
}

/** Column widths for a table: the last (amount) column is fixed and right-aligned. */
function columnWidths(columns: number, amountColumn: boolean): number[] {
  if (columns === 5) return [80, 118, 126, 72, CONTENT_WIDTH - 396];
  if (columns === 3 && amountColumn) {
    return [CONTENT_WIDTH * 0.42, CONTENT_WIDTH * 0.36, CONTENT_WIDTH * 0.22];
  }
  if (columns === 3) return [CONTENT_WIDTH * 0.36, CONTENT_WIDTH * 0.28, CONTENT_WIDTH * 0.36];
  const each = CONTENT_WIDTH / columns;
  return Array.from({ length: columns }, () => each);
}

function drawTable(layout: Layout, table: BillingDocumentTable, amountColumn: boolean): void {
  const size = 9.5;
  const lineHeight = 13;
  const padX = 8;
  const widths = columnWidths(table.columns.length, amountColumn);
  const lastIndex = table.columns.length - 1;
  const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));

  layout.ensure(60);
  layout.text(table.heading, MARGIN, layout.y - 12, { size: 11, bold: true });
  layout.y -= 22;

  const header = () => {
    layout.page.drawRectangle({
      x: MARGIN,
      y: layout.y - 22,
      width: CONTENT_WIDTH,
      height: 22,
      color: COLOURS.subtle,
    });
    table.columns.forEach((column, i) => {
      const right = amountColumn && i === lastIndex;
      layout.text(
        column,
        right ? (xs[i] ?? MARGIN) + (widths[i] ?? 0) - padX : (xs[i] ?? MARGIN) + padX,
        layout.y - 15,
        {
          size: 8.5,
          bold: true,
          color: COLOURS.secondary,
          align: right ? 'right' : 'left',
        },
      );
    });
    layout.y -= 22;
  };
  header();

  for (const row of table.rows) {
    const cells = row.map((cell, i) =>
      wrap(
        i === lastIndex && amountColumn ? layout.fonts.semibold : layout.fonts.regular,
        size,
        printable(layout.fonts, cell),
        (widths[i] ?? 60) - padX * 2,
      ),
    );
    const height = Math.max(...cells.map((c) => c.length)) * lineHeight + 12;
    if (layout.y - height < FOOTER_TOP + 12) {
      layout.ensure(height + 22);
      header();
    }
    cells.forEach((lines, i) => {
      const right = amountColumn && i === lastIndex;
      lines.forEach((line, n) => {
        layout.text(
          line,
          right ? (xs[i] ?? MARGIN) + (widths[i] ?? 0) - padX : (xs[i] ?? MARGIN) + padX,
          layout.y - 15 - n * lineHeight,
          { size, bold: right, align: right ? 'right' : 'left' },
        );
      });
    });
    layout.y -= height;
    layout.rule(layout.y, COLOURS.hairlineSoft, 0.75);
  }
  layout.y -= 18;
}

function drawFooter(layout: Layout, doc: BillingDocument, issuer: BillingDocumentIssuer): void {
  const total = layout.pages.length;
  const subject = doc.kind === 'invoice' ? 'this invoice' : 'this receipt';
  const contact = issuer.supportEmail
    ? `Questions about ${subject}? Write to ${issuer.supportEmail}.`
    : `Questions about ${subject}? Reply to any VisaStack billing email.`;
  layout.pages.forEach((page, index) => {
    layout.page = page;
    layout.rule(FOOTER_TOP - 14, COLOURS.hairline, 0.75);
    layout.text(contact, MARGIN, FOOTER_TOP - 30, { size: 8.5, color: COLOURS.secondary });
    layout.text(
      `VisaStack${issuer.website ? `  ·  ${issuer.website}` : ''}  ·  Made on ${doc.generatedAt} (Bangladesh time)`,
      MARGIN,
      FOOTER_TOP - 43,
      { size: 8, color: COLOURS.tertiary },
    );
    layout.text(`Page ${index + 1} of ${total}`, A4.width - MARGIN, FOOTER_TOP - 30, {
      size: 8.5,
      color: COLOURS.secondary,
      align: 'right',
    });
  });
}

/**
 * The finished PDF for one billing document. Deterministic apart from the PDF's own creation
 * moment, which is the document's `generatedAt` instant passed as `madeAt`.
 */
export async function renderBillingDocumentPdf(
  doc: BillingDocument,
  issuer: BillingDocumentIssuer = {},
  madeAt: Date = new Date(),
): Promise<Uint8Array> {
  const [{ PDFDocument }, fontkitModule, files] = await Promise.all([
    import('pdf-lib'),
    import('@pdf-lib/fontkit'),
    loadFontFiles(),
  ]);
  const fontkit = (fontkitModule as { default?: unknown }).default ?? fontkitModule;
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit as Parameters<PDFDocument['registerFontkit']>[0]);
  // Whole fonts, not subsets: @pdf-lib/fontkit 1.1.1's subsetter throws on these glyph tables.
  const regular = await pdf.embedFont(files.regular, { subset: false });
  const semibold = await pdf.embedFont(files.semibold, { subset: false });
  const fonts: Fonts = { regular, semibold, supported: new Set(regular.getCharacterSet()) };

  pdf.setTitle(`${doc.title} ${doc.number}`, { showInWindowTitleBar: true });
  pdf.setAuthor('VisaStack');
  pdf.setCreator('VisaStack');
  pdf.setProducer('VisaStack');
  pdf.setLanguage('en-GB');
  pdf.setCreationDate(madeAt);
  pdf.setModificationDate(madeAt);

  const layout = new Layout(pdf, fonts);
  const top = A4.height - MARGIN;

  // Header: the mark and name on the left, the document's title and number on the right.
  drawMark(layout.page, MARGIN, top, 34);
  layout.text('VisaStack', MARGIN + 44, top - 23, { size: 17, bold: true });
  if (issuer.website) {
    layout.text(issuer.website, MARGIN + 44, top - 37, { size: 8.5, color: COLOURS.tertiary });
  }
  layout.text(doc.title, A4.width - MARGIN, top - 22, { size: 24, bold: true, align: 'right' });
  layout.text(doc.number, A4.width - MARGIN, top - 40, {
    size: 10.5,
    color: COLOURS.secondary,
    align: 'right',
  });
  layout.y = top - 58;
  layout.rule(layout.y, COLOURS.brand, 1.5);
  layout.y -= 26;

  // Billed to (left), the document's facts and stamp (right).
  const blockTop = layout.y;
  layout.text('Billed To', MARGIN, blockTop, { size: 8.5, bold: true, color: COLOURS.tertiary });
  let left = blockTop - 17;
  for (const line of wrap(
    fonts.semibold,
    12.5,
    printable(fonts, doc.billedTo.name),
    BILLED_TO_WIDTH,
  )) {
    layout.text(line, MARGIN, left, { size: 12.5, bold: true });
    left -= 16;
  }
  for (const line of doc.billedTo.lines) {
    for (const part of wrap(fonts.regular, 9.5, printable(fonts, line), BILLED_TO_WIDTH)) {
      layout.text(part, MARGIN, left, { size: 9.5, color: COLOURS.secondary });
      left -= 13.5;
    }
  }

  const factsX = MARGIN + CONTENT_WIDTH * 0.52;
  let right = blockTop;
  for (const fact of doc.facts) {
    layout.text(fact.label, factsX, right, { size: 8.5, bold: true, color: COLOURS.tertiary });
    const lines = wrap(
      fonts.regular,
      9.5,
      printable(fonts, fact.value),
      A4.width - MARGIN - factsX - 92,
    );
    lines.forEach((line, n) => {
      layout.text(line, factsX + 92, right - n * 12.5, { size: 9.5 });
    });
    right -= Math.max(1, lines.length) * 12.5 + 5;
  }
  // The status, as a word in an outlined pill beside its label.
  layout.text('Status', factsX, right, { size: 8.5, bold: true, color: COLOURS.tertiary });
  drawStamp(layout, doc.stamp.label, doc.stamp.tone, factsX + 92, right + 13);
  right -= 24;
  layout.y = Math.min(left, right) - 14;

  // What is billed or paid.
  drawTable(layout, doc.items, true);

  // Totals, right-aligned, with the one that matters most set apart.
  const totalsLeft = MARGIN + CONTENT_WIDTH * 0.5;
  layout.ensure(doc.totals.length * 20 + 20);
  layout.y += 6;
  for (const total of doc.totals) {
    if (total.strong) {
      layout.page.drawLine({
        start: { x: totalsLeft, y: layout.y + 2 },
        end: { x: A4.width - MARGIN, y: layout.y + 2 },
        thickness: 0.75,
        color: COLOURS.hairline,
      });
      layout.y -= 8;
    }
    layout.text(total.label, totalsLeft + 8, layout.y - 12, {
      size: total.strong ? 11 : 9.5,
      bold: total.strong === true,
      color: total.strong ? COLOURS.text : COLOURS.secondary,
    });
    layout.text(total.value, A4.width - MARGIN - 8, layout.y - 12, {
      size: total.strong ? 12 : 9.5,
      bold: total.strong === true,
      align: 'right',
    });
    layout.y -= total.strong ? 24 : 19;
  }
  layout.y -= 14;

  for (const section of doc.sections) {
    const amounts = section.columns.at(-1) === 'Amount';
    drawTable(layout, section, amounts);
  }

  // Notes: plain sentences in a soft panel.
  if (doc.notes.length > 0) {
    const lines = doc.notes.flatMap((note) =>
      wrap(fonts.regular, 9.5, printable(fonts, note), CONTENT_WIDTH - 28),
    );
    const height = lines.length * 13.5 + 20;
    layout.ensure(height + 8);
    layout.page.drawRectangle({
      x: MARGIN,
      y: layout.y - height,
      width: CONTENT_WIDTH,
      height,
      color: COLOURS.brandBg,
    });
    lines.forEach((line, n) => {
      layout.text(line, MARGIN + 14, layout.y - 18 - n * 13.5, {
        size: 9.5,
        color: COLOURS.text,
      });
    });
    layout.y -= height + 10;
  }

  drawFooter(layout, doc, issuer);
  return pdf.save({ useObjectStreams: false });
}
