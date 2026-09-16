import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { BuiltinPreviewRenderer } from './preview-renderer';

/** Build a minimal, hand-crafted but genuinely valid single-page PDF with a text stream (mirrors text-extraction.test.ts). */
function buildMinimalPdf(text: string): Uint8Array {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (s: string) => {
    const buf = Buffer.from(s, 'latin1');
    parts.push(buf);
    pos += buf.length;
  };
  push('%PDF-1.4\n');
  offsets[1] = pos;
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offsets[2] = pos;
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  offsets[3] = pos;
  push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 300 144] /Contents 5 0 R >>\nendobj\n',
  );
  offsets[4] = pos;
  push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  const stream = `BT /F1 24 Tf 100 100 Td (${text}) Tj ET`;
  offsets[5] = pos;
  push(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  const xrefStart = pos;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);
  return new Uint8Array(Buffer.concat(parts));
}

/** Build a minimal, genuinely valid DOCX (mirrors text-extraction.test.ts). */
async function buildMinimalDocx(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder('_rels')?.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder('word')?.file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: 'uint8array' });
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWithPngMagic(bytes: Uint8Array): boolean {
  return PNG_MAGIC.every((b, i) => bytes[i] === b);
}

/** A hand-crafted PNG IHDR-only header (signature + IHDR chunk), no real image data: enough to exercise the pre-decode dimension check without needing a fully valid, absurdly large real PNG. */
function pngHeaderClaiming(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set(PNG_MAGIC, 0);
  // IHDR chunk length (13, unused by the dimension reader) + "IHDR" tag.
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

describe('BuiltinPreviewRenderer: safe rendered previews with active content removed (EVI-02/EVI-06)', () => {
  it('exposes its name and version', () => {
    const renderer = new BuiltinPreviewRenderer();
    expect(renderer.name).toBe('builtin-preview-renderer');
    expect(renderer.version).toBeTruthy();
  });

  it('rasterizes page 1 of a real PDF to a PNG image, never the original PDF bytes', async () => {
    const pdfBytes = buildMinimalPdf('Hello World');
    const renderer = new BuiltinPreviewRenderer();
    const result = await renderer.render({ bytes: pdfBytes, contentType: 'application/pdf' });
    expect(result.rendered).toBe(true);
    if (!result.rendered) return;
    expect(result.contentType).toBe('image/png');
    expect(startsWithPngMagic(result.bytes)).toBe(true);
    // Never the source PDF's own bytes/magic number under a relabeled type.
    expect(result.bytes.slice(0, 4)).not.toEqual(Uint8Array.from([0x25, 0x50, 0x44, 0x46]));
  });

  it('fails closed (rendered: false) on a corrupt PDF, never throwing and never inventing an image', async () => {
    const garbage = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02, 0xff, 0xff]);
    const renderer = new BuiltinPreviewRenderer();
    const result = await renderer.render({ bytes: garbage, contentType: 'application/pdf' });
    expect(result.rendered).toBe(false);
    if (result.rendered) return;
    expect(result.detail).toContain('pdf preview render failed');
  });

  it('re-encodes a PNG through decode-and-redraw (strips any trailing/polyglot bytes past the real image data)', async () => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const source = createCanvas(20, 10);
    const ctx = source.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 20, 10);
    const sourceBytes = source.toBuffer('image/png');
    // Polyglot-style trailing bytes appended past the real PNG data, must not survive.
    const withTrailer = Buffer.concat([sourceBytes, Buffer.from('<script>evil()</script>')]);

    const renderer = new BuiltinPreviewRenderer();
    const result = await renderer.render({
      bytes: new Uint8Array(withTrailer),
      contentType: 'image/png',
    });
    expect(result.rendered).toBe(true);
    if (!result.rendered) return;
    expect(result.contentType).toBe('image/png');
    expect(startsWithPngMagic(result.bytes)).toBe(true);
    const text = Buffer.from(result.bytes).toString('latin1');
    expect(text).not.toContain('evil()');
  });

  it('re-encodes a JPEG to PNG', async () => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const source = createCanvas(16, 16);
    const ctx = source.getContext('2d');
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 16, 16);
    const jpegBytes = source.toBuffer('image/jpeg');

    const renderer = new BuiltinPreviewRenderer();
    const result = await renderer.render({
      bytes: new Uint8Array(jpegBytes),
      contentType: 'image/jpeg',
    });
    expect(result.rendered).toBe(true);
    if (!result.rendered) return;
    expect(result.contentType).toBe('image/png');
    expect(startsWithPngMagic(result.bytes)).toBe(true);
  });

  it('rejects an image whose declared PNG dimensions exceed the pixel cap, without attempting to decode it', async () => {
    const bomb = pngHeaderClaiming(60000, 60000); // 3.6 billion declared pixels
    const renderer = new BuiltinPreviewRenderer();
    const result = await renderer.render({ bytes: bomb, contentType: 'image/png' });
    expect(result.rendered).toBe(false);
    if (result.rendered) return;
    expect(result.detail).toContain('maximum preview pixel count');
  });

  it('extracts plain text from a real DOCX, stripping formatting/macros/OLE objects, never the original DOCX bytes', async () => {
    const docxBytes = await buildMinimalDocx('Employment Certificate content here.');
    const renderer = new BuiltinPreviewRenderer();
    const result = await renderer.render({
      bytes: docxBytes,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(result.rendered).toBe(true);
    if (!result.rendered) return;
    expect(result.contentType).toBe('text/plain');
    expect(new TextDecoder().decode(result.bytes)).toContain(
      'Employment Certificate content here.',
    );
  });

  it('fails closed on a corrupt DOCX', async () => {
    const garbage = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]);
    const renderer = new BuiltinPreviewRenderer();
    const result = await renderer.render({
      bytes: garbage,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(result.rendered).toBe(false);
  });

  it('passes plain text through unchanged, as text/plain', async () => {
    const bytes = new TextEncoder().encode('Plain text content.');
    const renderer = new BuiltinPreviewRenderer();
    const result = await renderer.render({ bytes, contentType: 'text/plain' });
    expect(result.rendered).toBe(true);
    if (!result.rendered) return;
    expect(result.contentType).toBe('text/plain');
    expect(new TextDecoder().decode(result.bytes)).toBe('Plain text content.');
  });

  it('normalizes markdown to text/plain (defense in depth: never re-typed as anything renderable-as-markup)', async () => {
    const bytes = new TextEncoder().encode('# Heading\n\n<script>evil()</script>');
    const renderer = new BuiltinPreviewRenderer();
    const result = await renderer.render({ bytes, contentType: 'text/markdown' });
    expect(result.rendered).toBe(true);
    if (!result.rendered) return;
    expect(result.contentType).toBe('text/plain');
  });

  it('returns an independently-owned buffer for a passthrough, not a view over the caller-supplied array', async () => {
    const backing = new Uint8Array(100);
    backing.set(new TextEncoder().encode('hello'), 10);
    const view = backing.subarray(10, 15); // a Uint8Array view whose .buffer is much larger than itself
    const renderer = new BuiltinPreviewRenderer();
    const result = await renderer.render({ bytes: view, contentType: 'text/plain' });
    expect(result.rendered).toBe(true);
    if (!result.rendered) return;
    expect(result.bytes.buffer).not.toBe(backing.buffer);
    expect(result.bytes.byteLength).toBe(5);
  });

  it('honestly reports no renderer for an unsupported content type, rather than guessing', async () => {
    const renderer = new BuiltinPreviewRenderer();
    const result = await renderer.render({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'application/zip',
    });
    expect(result.rendered).toBe(false);
    if (result.rendered) return;
    expect(result.detail).toContain('application/zip');
  });
});
