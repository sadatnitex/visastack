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

/**
 * A genuine, fully-formed ZIP: real local file headers + data, followed by a
 * central directory whose "relative offset of local header" fields
 * correctly point at them (zip-structure.ts's local-header cross-validation
 * — finding #8, post-programme defect register — now rejects a central
 * directory with no matching local headers before any of this module's own
 * checks ever run, so a genuinely well-formed shape is required to exercise
 * THIS module's checks specifically). See zip-structure.test.ts for the
 * same technique, with the hostile-shape override knobs this file doesn't need.
 */
function buildZip(
  entries: ReadonlyArray<{
    readonly name: string;
    readonly compressedSize?: number;
    readonly uncompressedSize?: number;
    readonly encrypted?: boolean;
  }>,
): Uint8Array {
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const nameBytes = (name: string) => Array.from(new TextEncoder().encode(name));

  const localChunks: number[][] = [];
  const localOffsets: number[] = [];
  let localCursor = 0;
  for (const entry of entries) {
    const compressedSize = entry.compressedSize ?? 10;
    const name = nameBytes(entry.name);
    const chunk = [
      ...u32(0x04034b50), // local file header signature
      ...u16(0),
      ...u16(entry.encrypted ? 0x1 : 0x0),
      ...u16(8),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(compressedSize),
      ...u32(entry.uncompressedSize ?? 10),
      ...u16(name.length),
      ...u16(0),
      ...name,
      ...new Array(compressedSize).fill(0),
    ];
    localOffsets.push(localCursor);
    localChunks.push(chunk);
    localCursor += chunk.length;
  }

  const centralDirectoryOffset = localCursor;
  const centralChunks: number[][] = [];
  entries.forEach((entry, i) => {
    const name = nameBytes(entry.name);
    centralChunks.push([
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
      ...u32(localOffsets[i] ?? 0),
      ...name,
    ]);
  });
  const centralDirectorySize = centralChunks.reduce((sum, c) => sum + c.length, 0);
  const eocd = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralDirectorySize),
    ...u32(centralDirectoryOffset),
    ...u16(0),
  ];
  return new Uint8Array([...localChunks.flat(), ...centralChunks.flat(), ...eocd]);
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
    const zip = buildZip([
      { name: '[Content_Types].xml' },
      { name: 'word/document.xml', encrypted: true },
    ]);
    const result = validateDocxStructure(zip);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('encrypted');
  });

  it('rejects path traversal in an entry name', () => {
    const zip = buildZip([
      { name: '[Content_Types].xml' },
      { name: 'word/document.xml' },
      { name: '../../etc/passwd' },
    ]);
    const result = validateDocxStructure(zip);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('traversal');
  });

  it('rejects an entry whose declared compression ratio is a zip-bomb shape', () => {
    const zip = buildZip([
      { name: '[Content_Types].xml' },
      { name: 'word/document.xml' },
      { name: 'word/media/image1.bin', compressedSize: 100, uncompressedSize: 100_000_000 },
    ]);
    const result = validateDocxStructure(zip);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('compression-ratio');
  });

  it('rejects an entry beyond the per-entry uncompressed-size limit', () => {
    // compressedSize stays small and realistic — declaring 90M compressed
    // bytes here would mean physically writing 90M bytes of fixture data,
    // and isn't what this test is exercising (that's the ratio test above);
    // the uncompressedSize limit check runs before the ratio check either way.
    const zip = buildZip([
      { name: '[Content_Types].xml' },
      { name: 'word/document.xml' },
      {
        name: 'word/media/image1.bin',
        uncompressedSize: 200_000_000,
      },
    ]);
    const result = validateDocxStructure(zip);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('size limit');
  });

  it('rejects an entry count beyond the bound (denial-of-service shape)', () => {
    const entries = Array.from({ length: 600 }, (_, i) => ({ name: `f${i}.xml` }));
    const result = validateDocxStructure(buildZip(entries));
    expect(result.valid).toBe(false);
  });

  it('rejects garbage bytes that merely share the ZIP magic prefix', () => {
    const result = validateDocxStructure(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]));
    expect(result.valid).toBe(false);
  });
});
