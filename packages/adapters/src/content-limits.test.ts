import type { BlobStore, StoredBytes } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { BuiltinContentLimitsChecker } from './content-limits';

/** Build a minimal, genuinely valid multi-page PDF (mirrors text-extraction.test.ts's single-page helper). */
function buildMultiPagePdf(pageCount: number): Uint8Array {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (s: string) => {
    const buf = Buffer.from(s, 'latin1');
    parts.push(buf);
    pos += buf.length;
  };

  const pageObjNums = Array.from({ length: pageCount }, (_, i) => 3 + i);
  const fontObjNum = 3 + pageCount;
  const totalObjects = fontObjNum; // catalog(1) + pages(2) + N pages + font

  push('%PDF-1.4\n');
  offsets[1] = pos;
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offsets[2] = pos;
  push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`,
  );
  for (const objNum of pageObjNums) {
    offsets[objNum] = pos;
    push(
      `${objNum} 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /MediaBox [0 0 300 144] >>\nendobj\n`,
    );
  }
  offsets[fontObjNum] = pos;
  push(`${fontObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);

  const xrefStart = pos;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjects; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);
  return new Uint8Array(Buffer.concat(parts));
}

function fakeBlobStore(objects: Readonly<Record<string, StoredBytes>>): BlobStore {
  return {
    async getObject(objectKey: string) {
      return objects[objectKey];
    },
    async putObject() {
      throw new Error('not used in this test');
    },
    async deleteObject() {
      throw new Error('not used in this test');
    },
    async listObjectKeys() {
      throw new Error('not used in this test');
    },
  };
}

describe('BuiltinContentLimitsChecker: EVI-01 initial configurable limits (50 PDF pages, 40 megapixels per image)', () => {
  it('exposes its name and version', () => {
    const checker = new BuiltinContentLimitsChecker({
      blobStore: fakeBlobStore({}),
      config: { maxPdfPages: 50, maxImageMegapixels: 40 },
    });
    expect(checker.name).toBe('builtin-content-limits');
    expect(checker.version).toBeTruthy();
  });

  it('accepts a real PDF within the page limit and reports its exact page count', async () => {
    const pdfBytes = buildMultiPagePdf(3);
    const checker = new BuiltinContentLimitsChecker({
      blobStore: fakeBlobStore({ k1: { contentType: 'application/pdf', bytes: pdfBytes } }),
      config: { maxPdfPages: 5, maxImageMegapixels: 40 },
    });
    const result = await checker.check({ bucket: 'CLEAN', objectKey: 'k1' });
    expect(result.withinLimits).toBe(true);
    // documentVersions.pages persistence (Part 3 §7) relies on this: a
    // scanned PDF passes this check but fails text extraction entirely
    // (no text layer), so this is the only point in the pipeline that ever
    // has a page count for it.
    expect(result.pageCount).toBe(3);
  });

  it('rejects a real PDF that exceeds the page limit, naming and reporting the actual page count', async () => {
    const pdfBytes = buildMultiPagePdf(6);
    const checker = new BuiltinContentLimitsChecker({
      blobStore: fakeBlobStore({ k2: { contentType: 'application/pdf', bytes: pdfBytes } }),
      config: { maxPdfPages: 5, maxImageMegapixels: 40 },
    });
    const result = await checker.check({ bucket: 'CLEAN', objectKey: 'k2' });
    expect(result.withinLimits).toBe(false);
    expect(result.detail).toContain('6 pages');
    expect(result.detail).toContain('5-page limit');
    expect(result.pageCount).toBe(6);
  });

  it('fails closed (never invents a page count) on a corrupt PDF', async () => {
    const garbage = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02, 0xff, 0xff]);
    const checker = new BuiltinContentLimitsChecker({
      blobStore: fakeBlobStore({ k3: { contentType: 'application/pdf', bytes: garbage } }),
      config: { maxPdfPages: 50, maxImageMegapixels: 40 },
    });
    const result = await checker.check({ bucket: 'CLEAN', objectKey: 'k3' });
    expect(result.withinLimits).toBe(false);
    expect(result.pageCount).toBeUndefined();
  });

  it('accepts a real image within the megapixel limit', async () => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const bytes = new Uint8Array(createCanvas(100, 100).toBuffer('image/png')); // 0.01 MP
    const checker = new BuiltinContentLimitsChecker({
      blobStore: fakeBlobStore({ k4: { contentType: 'image/png', bytes } }),
      config: { maxPdfPages: 50, maxImageMegapixels: 40 },
    });
    const result = await checker.check({ bucket: 'CLEAN', objectKey: 'k4' });
    expect(result.withinLimits).toBe(true);
  });

  it('rejects an image whose declared dimensions exceed the megapixel limit, naming the actual megapixel count', async () => {
    // A hand-crafted PNG IHDR-only header (no real pixel data needed: the
    // check reads dimensions from the header, never decodes).
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 8000, false);
    view.setUint32(20, 8000, false); // 64 MP
    const checker = new BuiltinContentLimitsChecker({
      blobStore: fakeBlobStore({ k5: { contentType: 'image/png', bytes } }),
      config: { maxPdfPages: 50, maxImageMegapixels: 40 },
    });
    const result = await checker.check({ bucket: 'CLEAN', objectKey: 'k5' });
    expect(result.withinLimits).toBe(false);
    expect(result.detail).toContain('64.0 megapixels');
    expect(result.detail).toContain('40 MP limit');
  });

  it('respects a configured limit tighter than the PRD default', async () => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const bytes = new Uint8Array(createCanvas(200, 200).toBuffer('image/png')); // 0.04 MP
    const checker = new BuiltinContentLimitsChecker({
      blobStore: fakeBlobStore({ k6: { contentType: 'image/png', bytes } }),
      config: { maxPdfPages: 50, maxImageMegapixels: 0.01 },
    });
    const result = await checker.check({ bucket: 'CLEAN', objectKey: 'k6' });
    expect(result.withinLimits).toBe(false);
  });

  it('passes DOCX through unconditionally: EVI-01 names no numeric limit for it', async () => {
    const checker = new BuiltinContentLimitsChecker({
      blobStore: fakeBlobStore({
        k7: {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        },
      }),
      config: { maxPdfPages: 1, maxImageMegapixels: 0.001 },
    });
    const result = await checker.check({ bucket: 'CLEAN', objectKey: 'k7' });
    expect(result.withinLimits).toBe(true);
  });

  it('passes plain text through unconditionally', async () => {
    const checker = new BuiltinContentLimitsChecker({
      blobStore: fakeBlobStore({
        k8: { contentType: 'text/plain', bytes: new TextEncoder().encode('hello') },
      }),
      config: { maxPdfPages: 1, maxImageMegapixels: 0.001 },
    });
    const result = await checker.check({ bucket: 'CLEAN', objectKey: 'k8' });
    expect(result.withinLimits).toBe(true);
  });

  it('fails closed when the object bytes are missing', async () => {
    const checker = new BuiltinContentLimitsChecker({
      blobStore: fakeBlobStore({}),
      config: { maxPdfPages: 50, maxImageMegapixels: 40 },
    });
    const result = await checker.check({ bucket: 'CLEAN', objectKey: 'missing' });
    expect(result.withinLimits).toBe(false);
    expect(result.detail).toContain('not found');
  });
});
