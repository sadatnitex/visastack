import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { validateDocxStructure } from './docx-validation';

async function buildMinimalDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types/>',
  );
  zip
    .folder('word')
    ?.file('document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document/>');
  return zip.generateAsync({ type: 'uint8array' });
}

async function buildMinimalXlsx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types/>',
  );
  zip.folder('xl')?.file('workbook.xml', '<workbook/>');
  return zip.generateAsync({ type: 'uint8array' });
}

async function buildMacroEnabledDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types/>',
  );
  zip.folder('word')?.file('document.xml', '<w:document/>');
  zip.folder('word')?.file('vbaProject.bin', new Uint8Array([1, 2, 3]));
  return zip.generateAsync({ type: 'uint8array' });
}

/** A raw, hand-assembled central-directory-only zip — see zip-structure.test.ts for the technique. */
function buildCentralDirectoryOnlyZip(
  entries: ReadonlyArray<{
    readonly name: string;
    readonly compressedSize?: number;
    readonly uncompressedSize?: number;
    readonly encrypted?: boolean;
  }>,
): Uint8Array {
  const chunks: number[][] = [];
  const push = (bytes: number[]) => chunks.push(bytes);
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const nameBytes = (name: string) => Array.from(new TextEncoder().encode(name));

  for (const entry of entries) {
    const name = nameBytes(entry.name);
    push([
      ...u32(0x02014b50),
      ...u16(0),
      ...u16(0),
      ...u16(entry.encrypted ? 0x1 : 0x0),
      ...u16(8),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(entry.compressedSize ?? 10),
      ...u32(entry.uncompressedSize ?? 10),
      ...u16(name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(0),
      ...name,
    ]);
  }
  const centralDirectorySize = chunks.reduce((sum, c) => sum + c.length, 0);
  push([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralDirectorySize),
    ...u32(0),
    ...u16(0),
  ]);
  return new Uint8Array(chunks.flat());
}

describe('validateDocxStructure — real OOXML shape, not just a ZIP magic-byte match', () => {
  it('accepts a genuine minimal DOCX', async () => {
    const result = validateDocxStructure(await buildMinimalDocx());
    expect(result.valid).toBe(true);
  });

  it('rejects an XLSX (same ZIP magic bytes, wrong OOXML shape)', async () => {
    const result = validateDocxStructure(await buildMinimalXlsx());
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('XLSX/PPTX');
  });

  it('rejects a macro-enabled document (vbaProject.bin present)', async () => {
    const result = validateDocxStructure(await buildMacroEnabledDocx());
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('macro');
  });

  it('rejects a generic ZIP with neither required OOXML part', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'just a regular archive');
    const result = validateDocxStructure(await zip.generateAsync({ type: 'uint8array' }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not a Word document');
  });

  it('rejects an encrypted entry', () => {
    const zip = buildCentralDirectoryOnlyZip([
      { name: '[Content_Types].xml' },
      { name: 'word/document.xml', encrypted: true },
    ]);
    const result = validateDocxStructure(zip);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('encrypted');
  });

  it('rejects path traversal in an entry name', () => {
    const zip = buildCentralDirectoryOnlyZip([
      { name: '[Content_Types].xml' },
      { name: 'word/document.xml' },
      { name: '../../etc/passwd' },
    ]);
    const result = validateDocxStructure(zip);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('traversal');
  });

  it('rejects an entry whose declared compression ratio is a zip-bomb shape', () => {
    const zip = buildCentralDirectoryOnlyZip([
      { name: '[Content_Types].xml' },
      { name: 'word/document.xml' },
      { name: 'word/media/image1.bin', compressedSize: 100, uncompressedSize: 100_000_000 },
    ]);
    const result = validateDocxStructure(zip);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('compression-ratio');
  });

  it('rejects an entry beyond the per-entry uncompressed-size limit', () => {
    const zip = buildCentralDirectoryOnlyZip([
      { name: '[Content_Types].xml' },
      { name: 'word/document.xml' },
      {
        name: 'word/media/image1.bin',
        compressedSize: 90_000_000,
        uncompressedSize: 200_000_000,
      },
    ]);
    const result = validateDocxStructure(zip);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('size limit');
  });

  it('rejects an entry count beyond the bound (denial-of-service shape)', () => {
    const entries = Array.from({ length: 600 }, (_, i) => ({ name: `f${i}.xml` }));
    const result = validateDocxStructure(buildCentralDirectoryOnlyZip(entries));
    expect(result.valid).toBe(false);
  });

  it('rejects garbage bytes that merely share the ZIP magic prefix', () => {
    const result = validateDocxStructure(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]));
    expect(result.valid).toBe(false);
  });
});
