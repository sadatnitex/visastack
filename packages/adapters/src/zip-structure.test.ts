import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseZipCentralDirectory } from './zip-structure';

interface EntrySpec {
  readonly name: string;
  readonly compressedSize?: number;
  readonly uncompressedSize?: number;
  readonly encrypted?: boolean;
  /** Raw general-purpose flag override — takes precedence over `encrypted` when set. */
  readonly generalPurposeFlag?: number;
  /** Defaults to the same value as the central directory's flag — set differently to simulate a forged local/central flag mismatch. */
  readonly localGeneralPurposeFlagOverride?: number;
  /** Defaults to `name` — set differently to simulate a local/central header mismatch. */
  readonly localName?: string;
  /** Defaults to `compressedSize`/`uncompressedSize` — set to simulate a local/central size mismatch. */
  readonly localCompressedSize?: number;
  readonly localUncompressedSize?: number;
  /**
   * How many filler bytes are actually physically written after the local
   * header — defaults to `compressedSize`. Independent of `compressedSize`/
   * `localCompressedSize`, which only control what's *declared* in the
   * headers: this is what lets a test declare a huge size while only a
   * handful of real bytes follow, to exercise the "declared data runs past
   * the end of the file" check without allocating a huge fixture.
   */
  readonly actualDataSize?: number;
  /** Skip writing a local header entirely at the computed offset (garbage/no header there). */
  readonly omitLocalHeader?: boolean;
  /** Force the central directory's declared "relative offset of local header" to something else. */
  readonly localHeaderOffsetOverride?: number;
}

interface BuildOptions {
  /** Corrupt the EOCD's "size of central directory" field by this delta (default: correct). */
  readonly centralDirectorySizeDelta?: number;
  /**
   * Extra raw bytes spliced between the end of the central directory's real
   * content and the EOCD record. `centralDirectorySize` still reports the
   * true (un-inflated) content size, so the gap is unaccounted for —
   * distinct from `centralDirectorySizeDelta`, which lies about the size
   * field itself rather than displacing the EOCD record.
   */
  readonly gapBeforeEocd?: number;
}

const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const nameBytes = (name: string) => Array.from(new TextEncoder().encode(name));

/**
 * Builds a genuine, fully-formed ZIP: real local file headers + data,
 * followed by a central directory whose "relative offset of local header"
 * fields point at them, followed by an EOCD record — the structure
 * `parseZipCentralDirectory` now actually cross-validates end to end
 * (finding #8, post-programme defect register). Every knob defaults to
 * producing a genuinely well-formed archive; individual tests override one
 * knob at a time to construct a specific hostile shape.
 */
function buildZip(entries: readonly EntrySpec[], options: BuildOptions = {}): Uint8Array {
  const localChunks: number[][] = [];
  const localOffsets: number[] = [];
  let localCursor = 0;

  for (const entry of entries) {
    const offset = localCursor;
    if (entry.omitLocalHeader) {
      localOffsets.push(offset);
      continue;
    }
    const compressedSize = entry.compressedSize ?? 10;
    const localCompressedSize = entry.localCompressedSize ?? compressedSize;
    const localUncompressedSize = entry.localUncompressedSize ?? entry.uncompressedSize ?? 10;
    const actualDataSize = entry.actualDataSize ?? compressedSize;
    const localName = nameBytes(entry.localName ?? entry.name);
    const flag = entry.generalPurposeFlag ?? (entry.encrypted ? 0x1 : 0x0);
    const localFlag = entry.localGeneralPurposeFlagOverride ?? flag;
    const data = new Array(actualDataSize).fill(0);
    const chunk = [
      ...u32(0x04034b50), // local file header signature
      ...u16(0), // version needed
      ...u16(localFlag), // general purpose flag
      ...u16(8), // compression method (deflate)
      ...u16(0), // mod time
      ...u16(0), // mod date
      ...u32(0), // crc32
      ...u32(localCompressedSize),
      ...u32(localUncompressedSize),
      ...u16(localName.length),
      ...u16(0), // extra length
      ...localName,
      ...data,
    ];
    localChunks.push(chunk);
    localOffsets.push(offset);
    localCursor += chunk.length;
  }

  const centralDirectoryOffset = localCursor;

  const centralChunks: number[][] = [];
  entries.forEach((entry, i) => {
    const name = nameBytes(entry.name);
    const flag = entry.generalPurposeFlag ?? (entry.encrypted ? 0x1 : 0x0);
    const localHeaderOffset = entry.localHeaderOffsetOverride ?? localOffsets[i] ?? 0;
    centralChunks.push([
      ...u32(0x02014b50), // central directory signature
      ...u16(0), // version made by
      ...u16(0), // version needed
      ...u16(flag),
      ...u16(8), // compression method
      ...u16(0), // mod time
      ...u16(0), // mod date
      ...u32(0), // crc32
      ...u32(entry.compressedSize ?? 10),
      ...u32(entry.uncompressedSize ?? 10),
      ...u16(name.length),
      ...u16(0), // extra length
      ...u16(0), // comment length
      ...u16(0), // disk number start
      ...u16(0), // internal attrs
      ...u32(0), // external attrs
      ...u32(localHeaderOffset),
      ...name,
    ]);
  });

  const centralDirectorySize =
    centralChunks.reduce((sum, c) => sum + c.length, 0) + (options.centralDirectorySizeDelta ?? 0);
  const eocdGap = new Array(options.gapBeforeEocd ?? 0).fill(0);

  const eocd = [
    ...u32(0x06054b50), // EOCD signature
    ...u16(0), // disk number
    ...u16(0), // disk with cd start
    ...u16(entries.length), // entries on this disk
    ...u16(entries.length), // total entries
    ...u32(centralDirectorySize),
    ...u32(centralDirectoryOffset),
    ...u16(0), // comment length
  ];

  return new Uint8Array([...localChunks.flat(), ...centralChunks.flat(), ...eocdGap, ...eocd]);
}

describe('parseZipCentralDirectory — bounded structural read (no decompression)', () => {
  it('parses entry names, sizes, and the encryption flag', () => {
    const zip = buildZip([
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
    const zip = buildZip(entries);
    const result = parseZipCentralDirectory(zip, { maxEntries: 3 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('exceeds the limit');
  });

  it('rejects a central directory truncated mid-entry', () => {
    const zip = buildZip([{ name: 'word/document.xml' }]);
    const truncated = zip.slice(0, zip.length - 5);
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

  describe('local file header cross-validation (Codex review, PR-B, finding #8)', () => {
    it('rejects a forged central directory entry with no local file header at its declared offset', () => {
      const zip = buildZip([{ name: 'word/document.xml', omitLocalHeader: true }]);
      const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('local header');
    });

    it('rejects a central directory entry whose declared local-header offset points past the end of the file', () => {
      const zip = buildZip([{ name: 'word/document.xml', localHeaderOffsetOverride: 10_000_000 }]);
      const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('out of bounds');
    });

    it('rejects a central directory entry pointing at bytes that are not a genuine local file header (forged central directory over unrelated data)', () => {
      // Offset 50 lands inside the first entry's zero-filled data region
      // (its 30-byte header + 20-byte "[Content_Types].xml" name end at
      // byte 50) — no PK\x03\x04 signature there, unlike offset 0, which
      // would just be the first entry's own genuine header.
      const zip = buildZip([
        { name: '[Content_Types].xml' },
        { name: 'word/document.xml', localHeaderOffsetOverride: 50 },
      ]);
      const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('genuine local file header');
    });

    it('rejects a local header whose name does not match the central directory entry', () => {
      const zip = buildZip([{ name: 'word/document.xml', localName: 'word/something-else.xml' }]);
      const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('name does not match');
    });

    it('rejects a local header whose size fields do not match the central directory entry', () => {
      const zip = buildZip([
        { name: 'word/document.xml', compressedSize: 10, localCompressedSize: 999 },
      ]);
      const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('size fields do not match');
    });

    it('accepts a mismatched-looking local size when the data-descriptor flag is set (legitimate streamed-write convention)', () => {
      // Bit 3 set: compliant writers leave local-header sizes at 0 and store
      // the real values in a data descriptor after the entry's data instead —
      // must not be misread as tampering. actualDataSize still writes the
      // real 500 bytes of data (a genuine writer using this convention
      // still writes real data, it just doesn't record the size up front),
      // so the "runs past the end of the file" check correctly finds it.
      const zip = buildZip([
        {
          name: 'word/document.xml',
          compressedSize: 500,
          uncompressedSize: 500,
          generalPurposeFlag: 0x0008,
          localCompressedSize: 0,
          localUncompressedSize: 0,
          actualDataSize: 500,
        },
      ]);
      const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
      expect(result.ok).toBe(true);
    });

    it('rejects a declared compressed size that does not fit in the file (data would run past EOF)', () => {
      // Central and local sizes agree (both declare 10MB, so the mismatch
      // check upstream doesn't fire first) but only 50 real bytes are
      // actually written — the declared size doesn't fit in the file.
      const zip = buildZip([
        {
          name: 'word/document.xml',
          compressedSize: 10_000_000,
          localCompressedSize: 10_000_000,
          actualDataSize: 50,
        },
      ]);
      const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('runs past the end of the file');
    });

    it('rejects an entry whose declared data overlaps a later entry local-header/data interval, even though it fits before EOF and before the central directory (Codex review, PR-B3, round 1)', () => {
      // a.xml physically occupies only 5 bytes of data (actualDataSize) but
      // DECLARES 50 — its declared span [35, 85) overlaps b.xml's real span
      // [40, 85), even though 85 <= centralDirectoryOffset (130), so
      // neither the EOF check nor the "extends into the central directory"
      // check catches this on their own — only a genuine overlap check does.
      const zip = buildZip([
        { name: 'a.xml', compressedSize: 50, actualDataSize: 5 },
        { name: 'b.xml' },
        { name: 'c.xml' },
      ]);
      const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('overlap');
    });

    it('rejects an entry whose declared data extends into the central directory itself', () => {
      // dataEnd (35 + 60 = 95) must land strictly between centralDirectoryOffset
      // (40, the local chunk's real size) and the whole file's length (113,
      // local + central + EOCD) — comfortably inside the file overall (so the
      // plain EOF check doesn't fire first) but past where local data is
      // supposed to end.
      const zip = buildZip([{ name: 'a.xml', compressedSize: 60, actualDataSize: 5 }]);
      const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('extends into the central directory');
    });

    it('rejects an entry whose local header general-purpose flag disagrees with the central directory entry (Codex review, PR-B3, round 2)', () => {
      // The central directory declares the data-descriptor bit clear (sizes
      // are authoritative) with a size that matches — but the local header's
      // OWN flag (independently overridden here) sets the data-descriptor
      // bit, meaning that header's real convention is "sizes are 0/ignored,
      // trust the data descriptor instead." Without cross-checking the two
      // copies, the size match above would be accepted as-is even though it
      // is not the local header's own claim about what its fields mean.
      const zip = buildZip([
        { name: 'a.xml', generalPurposeFlag: 0x0, localGeneralPurposeFlagOverride: 0x0008 },
      ]);
      const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('general-purpose flags do not match');
    });
  });

  describe('EOCD central-directory-size validation (Codex review, PR-B, finding #8)', () => {
    it('rejects an EOCD whose declared central-directory size is smaller than its actual extent', () => {
      const zip = buildZip([{ name: '[Content_Types].xml' }, { name: 'word/document.xml' }], {
        centralDirectorySizeDelta: -10,
      });
      const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('does not match its actual extent');
    });

    it('rejects an EOCD whose declared central-directory size is larger than its actual extent', () => {
      const zip = buildZip([{ name: '[Content_Types].xml' }, { name: 'word/document.xml' }], {
        centralDirectorySizeDelta: 10,
      });
      const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('does not match its actual extent');
    });

    it('rejects extra bytes injected between the central directory and the EOCD record', () => {
      const zip = buildZip([{ name: 'word/document.xml' }], { gapBeforeEocd: 8 });
      const result = parseZipCentralDirectory(zip, { maxEntries: 10 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('does not match its actual extent');
    });
  });
});
