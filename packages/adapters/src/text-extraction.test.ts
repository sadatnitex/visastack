import type { BlobStore, StoredBytes } from '@visastack/services';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { DeterministicTextExtractor } from './text-extraction';

/** Build a minimal, hand-crafted but genuinely valid single-page PDF with a text stream. */
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

function fakeBlobStore(objects: Readonly<Record<string, StoredBytes>>): BlobStore {
  return {
    async getObject(objectKey: string) {
      return objects[objectKey];
    },
    async putObject() {
      throw new Error('not used in this test');
    },
  };
}

describe('DeterministicTextExtractor — embedded PDF/DOCX/plain-text extraction', () => {
  it('extracts embedded text from a real PDF (no OCR involved)', async () => {
    const pdfBytes = buildMinimalPdf('Hello World');
    const extractor = new DeterministicTextExtractor({
      blobStore: fakeBlobStore({
        k1: { contentType: 'application/pdf', bytes: pdfBytes },
      }),
    });
    const outcome = await extractor.extract({
      bucket: 'CLEAN',
      objectKey: 'k1',
      originalName: 'doc.pdf',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.text).toContain('Hello World');
    expect(outcome.result.parserName).toBe('unpdf');
    expect(outcome.result.pageCount).toBe(1);
    expect(outcome.result.truncated).toBe(false);
  });

  it('extracts text from a real DOCX file', async () => {
    const docxBytes = await buildMinimalDocx('Employment Certificate content here.');
    const extractor = new DeterministicTextExtractor({
      blobStore: fakeBlobStore({
        k2: {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          bytes: docxBytes,
        },
      }),
    });
    const outcome = await extractor.extract({
      bucket: 'CLEAN',
      objectKey: 'k2',
      originalName: 'cert.docx',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.text).toContain('Employment Certificate content here.');
    expect(outcome.result.parserName).toBe('mammoth');
  });

  it('reads a plain TXT/MD file directly (no parser needed)', async () => {
    const bytes = new TextEncoder().encode('Plain text content.');
    const extractor = new DeterministicTextExtractor({
      blobStore: fakeBlobStore({ k3: { contentType: 'text/plain', bytes } }),
    });
    const outcome = await extractor.extract({
      bucket: 'CLEAN',
      objectKey: 'k3',
      originalName: 'notes.txt',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.text).toBe('Plain text content.');
    expect(outcome.result.parserName).toBe('plain-text');
  });

  it('rejects a corrupt PDF as corrupt_file, never invents content', async () => {
    const garbage = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02, 0xff, 0xff]);
    const extractor = new DeterministicTextExtractor({
      blobStore: fakeBlobStore({ k4: { contentType: 'application/pdf', bytes: garbage } }),
    });
    const outcome = await extractor.extract({
      bucket: 'CLEAN',
      objectKey: 'k4',
      originalName: 'broken.pdf',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('corrupt_file');
  });

  it('rejects an image format as unsupported (no OCR implemented — honest limitation)', async () => {
    const pngMagic = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const extractor = new DeterministicTextExtractor({
      blobStore: fakeBlobStore({ k5: { contentType: 'image/png', bytes: pngMagic } }),
    });
    const outcome = await extractor.extract({
      bucket: 'CLEAN',
      objectKey: 'k5',
      originalName: 'passport-photo.png',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('unsupported_format');
  });

  it('rejects an empty file as empty_content', async () => {
    const extractor = new DeterministicTextExtractor({
      blobStore: fakeBlobStore({ k6: { contentType: 'text/plain', bytes: new Uint8Array(0) } }),
    });
    const outcome = await extractor.extract({
      bucket: 'CLEAN',
      objectKey: 'k6',
      originalName: 'empty.txt',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('empty_content');
  });

  it('reports corrupt_file (not a crash) when the referenced object bytes are missing', async () => {
    const extractor = new DeterministicTextExtractor({ blobStore: fakeBlobStore({}) });
    const outcome = await extractor.extract({
      bucket: 'CLEAN',
      objectKey: 'missing',
      originalName: 'x.pdf',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('corrupt_file');
  });

  it('truncates text beyond the retention cap and flags it', async () => {
    const longText = 'A'.repeat(25_000);
    const extractor = new DeterministicTextExtractor({
      blobStore: fakeBlobStore({
        k7: { contentType: 'text/plain', bytes: new TextEncoder().encode(longText) },
      }),
    });
    const outcome = await extractor.extract({
      bucket: 'CLEAN',
      objectKey: 'k7',
      originalName: 'big.txt',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.truncated).toBe(true);
    expect(outcome.result.text.length).toBe(20_000);
  });
});
