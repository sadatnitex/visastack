import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseZipCentralDirectory } from './zip-structure';

/**
 * A hand-assembled ZIP central directory (+ EOCD), with NO local file
 * headers or entry data before it. `parseZipCentralDirectory` only ever
 * reads from `centralDirectoryOffset` onward, so this is a complete,
 * deterministic fixture for exercising the parser's structural rules
 * without needing real compressed data.
 */
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
      ...u32(0x02014b50), // central directory signature
      ...u16(0), // version made by
      ...u16(0), // version needed
      ...u16(entry.encrypted ? 0x1 : 0x0), // general purpose flag (bit 0 = encrypted)
      ...u16(8), // compression method (deflate)
      ...u16(0), // mod time
      ...u16(0), // mod date
      ...u32(0), // crc32
      ...u32(entry.compressedSize ?? 10), // compressed size
      ...u32(entry.uncompressedSize ?? 10), // uncompressed size
      ...u16(name.length), // filename length
      ...u16(0), // extra length
      ...u16(0), // comment length
      ...u16(0), // disk number start
      ...u16(0), // internal attrs
      ...u32(0), // external attrs
      ...u32(0), // relative offset of local header
      ...name,
    ]);
  }

  const centralDirectorySize = chunks.reduce((sum, c) => sum + c.length, 0);
  push([
    ...u32(0x06054b50), // EOCD signature
    ...u16(0), // disk number
    ...u16(0), // disk with cd start
    ...u16(entries.length), // entries on this disk
    ...u16(entries.length), // total entries
    ...u32(centralDirectorySize),
    ...u32(0), // central directory offset (starts at byte 0 in this fixture)
    ...u16(0), // comment length
  ]);

  return new Uint8Array(chunks.flat());
}

describe('parseZipCentralDirectory — bounded structural read (no decompression)', () => {
  it('parses entry names, sizes, and the encryption flag', () => {
    const zip = buildCentralDirectoryOnlyZip([
      { name: '[Content_Types].xml', uncompressedSize: 500, compressedSize: 200 },
      { name: 'word/document.xml', uncompressedSize: 1000, compressedSize: 300, encrypted: true },
    ]);
    const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toEqual({
      name: '[Content_Types].xml',
      compressedSize: 200,
      uncompressedSize: 500,
      encrypted: false,
    });
    expect(result.value[1]?.encrypted).toBe(true);
  });

  it('parses a real jszip-generated archive identically to a hand-built one', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'hello world');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const result = parseZipCentralDirectory(bytes, { maxEntries: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((e) => e.name)).toEqual(['hello.txt']);
    expect(result.value[0]?.encrypted).toBe(false);
  });

  it('rejects bytes with no end-of-central-directory record', () => {
    const result = parseZipCentralDirectory(new Uint8Array([1, 2, 3, 4, 5]), { maxEntries: 10 });
    expect(result.ok).toBe(false);
  });

  it('rejects a declared entry count beyond the configured limit', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.xml` }));
    const zip = buildCentralDirectoryOnlyZip(entries);
    const result = parseZipCentralDirectory(zip, { maxEntries: 3 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('exceeds the limit');
  });

  it('rejects a central directory truncated mid-entry', () => {
    const zip = buildCentralDirectoryOnlyZip([{ name: 'word/document.xml' }]);
    const truncated = zip.slice(0, zip.length - 30);
    const result = parseZipCentralDirectory(truncated, { maxEntries: 10 });
    expect(result.ok).toBe(false);
  });

  it('does not false-positive on an EOCD-signature byte sequence that fails the exact-end-of-buffer check', () => {
    // A coincidental 4-byte match to the EOCD signature, sitting mid-buffer
    // with trailing bytes after it (so its declared comment length could
    // never reach exactly to the end) must not be accepted as a real EOCD.
    const decoy = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const trailingJunk = new Uint8Array([1, 2, 3, 4]);
    const noRealEocd = new Uint8Array([...decoy, ...trailingJunk]);
    const result = parseZipCentralDirectory(noRealEocd, { maxEntries: 10 });
    expect(result.ok).toBe(false);
  });
});
