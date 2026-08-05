import { type Result, err, ok } from '@visastack/core';

/**
 * Bounded, dependency-free ZIP central-directory reader (master directive §7
 * "PR 3" — DOCX validation).
 *
 * Reads ONLY the central directory metadata (entry names, declared sizes,
 * the encryption flag) — it never inflates/decompresses a single byte of
 * entry content. This is deliberate: the goal is a cheap, safe structural
 * pre-check ahead of the real parser (`mammoth`, via `text-extraction.ts`),
 * not a general-purpose unzip. Declared sizes in a ZIP header are
 * attacker-controlled and are therefore used only as a bound to REJECT
 * obviously-hostile shapes (absurd entry counts, absurd declared ratios) —
 * never trusted as a guarantee of the true decompressed size.
 */

export interface ZipEntry {
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly encrypted: boolean;
}

export interface ZipParseLimits {
  /** Reject outright (not just truncate) if the declared entry count exceeds this. */
  readonly maxEntries: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const EOCD_FIXED_SIZE = 22;
const CENTRAL_HEADER_FIXED_SIZE = 46;
const LOCAL_HEADER_FIXED_SIZE = 30;
/** ZIP comment length is a 16-bit field — this is the true maximum possible EOCD search window. */
const MAX_COMMENT_LENGTH = 0xffff;
/**
 * General-purpose bit 3: when set, a compliant writer leaves the local
 * header's CRC/size fields as 0 and stores the real values in a "data
 * descriptor" immediately after the entry's data instead (the standard
 * streamed-write convention — common enough in real-world zip writers that
 * treating it as a mismatch would reject legitimate archives, not just
 * forged ones). The central directory's copy of these fields is always
 * authoritative regardless of this flag, since it is written last, after
 * all data and descriptors, when every true value is already known.
 */
const DATA_DESCRIPTOR_FLAG = 0x0008;
/**
 * The data descriptor's leading signature (`PK\x07\x08`) is itself OPTIONAL
 * per spec — not every writer includes it — so its presence is detected,
 * never required, the same way a real streaming unzip implementation would:
 * try the signature-prefixed 16-byte form first, fall back to the bare
 * 12-byte form otherwise.
 */
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
/** crc32(4) + compressedSize(4) + uncompressedSize(4), no signature. */
const DATA_DESCRIPTOR_FIXED_SIZE = 12;

function readUInt32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}
function readUInt16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Search backward for the End Of Central Directory record. The comment
 * field (0-65535 bytes) is the only variable-length data after it, so the
 * record can appear anywhere in the last `22 + 65535` bytes of a
 * well-formed ZIP — never earlier, so the search window is bounded
 * regardless of overall file size.
 */
function findEndOfCentralDirectory(
  bytes: Uint8Array,
  view: DataView,
):
  | {
      readonly totalEntries: number;
      readonly centralDirectoryOffset: number;
      readonly centralDirectorySize: number;
      readonly eocdOffset: number;
    }
  | undefined {
  const searchStart = Math.max(0, bytes.length - EOCD_FIXED_SIZE - MAX_COMMENT_LENGTH);
  for (let i = bytes.length - EOCD_FIXED_SIZE; i >= searchStart; i--) {
    if (readUInt32LE(view, i) !== EOCD_SIGNATURE) continue;
    const commentLength = readUInt16LE(view, i + 20);
    // A real EOCD's comment must reach exactly to the end of the file — a
    // signature-byte coincidence inside file data would fail this check.
    if (i + EOCD_FIXED_SIZE + commentLength !== bytes.length) continue;
    return {
      totalEntries: readUInt16LE(view, i + 10),
      centralDirectorySize: readUInt32LE(view, i + 12),
      centralDirectoryOffset: readUInt32LE(view, i + 16),
      eocdOffset: i,
    };
  }
  return undefined;
}

/**
 * Validate that a central directory entry's declared "relative offset of
 * local header" actually points to a genuine local file header describing
 * the SAME entry (finding #8, post-programme defect register) — without
 * this, a forged central directory can describe an innocuous-looking DOCX
 * shape while the file's real bytes (which `validateDocxStructure` never
 * otherwise inspects) are anything at all, defeating the structural
 * scanner entirely.
 *
 * **Codex review, PR-B3, round 2**: the local header's OWN general-purpose
 * flag field (offset +6) was never read or compared — every decision that
 * depends on the flag (whether local size fields are meaningful, whether
 * the entry is `encrypted`) used only the central directory's copy. A
 * forged entry could set the data-descriptor bit centrally to skip the
 * local size cross-check above even though the local header's own flag
 * says its sizes ARE authoritative and could be lying, or clear the
 * encryption bit centrally while the local header's own flag marks the
 * entry encrypted — `parseZipCentralDirectory` would then report
 * `encrypted: false` for genuinely encrypted content. Requiring the two
 * copies to match closes both: once they're proven equal, every
 * flag-dependent decision downstream (here and in the caller) is
 * authoritative regardless of which copy it nominally reads.
 *
 * **Codex review, PR-B3R, round 1**: name/size/flag agreement alone still
 * left the compression method and CRC-32 duplicated-but-uncompared — a
 * crafted archive could declare one compression method (or CRC) centrally
 * and a different one locally. Since this module and whatever eventually
 * extracts the entry's real content can each read a different copy of
 * these fields, that's a parser-differential gap, not merely a cosmetic
 * one. Compression method is checked unconditionally (it is fixed at
 * write time and never deferred to a trailing data descriptor, unlike
 * size/CRC); CRC-32 is checked under the same data-descriptor-flag
 * condition already governing the size fields, since it is deferred
 * alongside them under that convention.
 *
 * **Codex review, PR-B3R, round 2 (final verification)**: when the
 * data-descriptor flag is set, the round-1 fix above correctly skips the
 * now-meaningless local-header CRC/size fields — but nothing filled the
 * gap that leaves: the entry's data span was bounded using the central
 * directory's compressedSize alone, without ever reading the trailing
 * data descriptor that convention requires. A streaming unzip
 * implementation that doesn't consult the central directory at all (the
 * entire point of the streamed-write convention) determines the entry's
 * true crc/sizes from THAT descriptor, not from the central directory copy
 * this module treats as authoritative elsewhere — so a descriptor-less
 * entry, or one whose descriptor disagrees with the central directory,
 * previously passed here while a real streaming reader could extract
 * something else entirely. The descriptor (12 bytes, or 16 with its
 * optional leading signature) is now located immediately after the
 * declared compressed payload, required to match the central directory's
 * crc32/compressedSize/uncompressedSize exactly, and folded into the
 * returned `dataEnd` so the overlap and central-directory-boundary checks
 * in the caller cover its bytes too.
 *
 * **Codex review, PR-B3R, post-final-verification**: the name check above
 * compared *decoded* strings — but decoding used a non-fatal UTF-8 decoder
 * on both sides, which silently replaces invalid byte sequences with U+FFFD
 * rather than failing. Two different invalid byte sequences (attacker-
 * controlled on both the local and central side) can decode to the exact
 * same replacement-character string and pass this check as "equal" even
 * though the real bytes disagree — defeating the very cross-check this
 * function exists to perform. Comparing the raw name bytes directly (never
 * decoding either side for this comparison) removes the lossy step
 * entirely, so no two genuinely different byte sequences can be confused
 * for a match regardless of what they'd decode to.
 */
function validateLocalFileHeader(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  expected: {
    readonly nameBytes: Uint8Array;
    readonly compressionMethod: number;
    readonly crc32: number;
    readonly compressedSize: number;
    readonly uncompressedSize: number;
    readonly generalPurposeFlag: number;
  },
): Result<{ readonly dataEnd: number }, string> {
  if (offset + LOCAL_HEADER_FIXED_SIZE > bytes.length) {
    return err('local header offset is out of bounds');
  }
  if (readUInt32LE(view, offset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    return err('local header offset does not point to a genuine local file header');
  }
  const localGeneralPurposeFlag = readUInt16LE(view, offset + 6);
  if (localGeneralPurposeFlag !== expected.generalPurposeFlag) {
    return err('local header general-purpose flags do not match the central directory entry');
  }
  // The compression method is fixed at write time, never deferred to a
  // data descriptor — always meaningful, regardless of the flag above.
  const localCompressionMethod = readUInt16LE(view, offset + 8);
  if (localCompressionMethod !== expected.compressionMethod) {
    return err('local header compression method does not match the central directory entry');
  }
  const localNameLength = readUInt16LE(view, offset + 26);
  const localExtraLength = readUInt16LE(view, offset + 28);
  const localNameStart = offset + LOCAL_HEADER_FIXED_SIZE;
  const localNameEnd = localNameStart + localNameLength;
  if (localNameEnd > bytes.length) return err('local header name runs past the end of the file');
  // Compared as raw bytes, never decoded -- a non-fatal UTF-8 decode on
  // both sides could otherwise map two different invalid byte sequences to
  // the same U+FFFD-replacement string and pass this as a "match".
  if (!bytesEqual(bytes.subarray(localNameStart, localNameEnd), expected.nameBytes)) {
    return err('local header name does not match the central directory entry');
  }
  // CRC/sizes are only meaningful in the local header when the streamed-write
  // (data-descriptor) convention isn't in play — see DATA_DESCRIPTOR_FLAG.
  if ((expected.generalPurposeFlag & DATA_DESCRIPTOR_FLAG) === 0) {
    const localCrc32 = readUInt32LE(view, offset + 14);
    const localCompressedSize = readUInt32LE(view, offset + 18);
    const localUncompressedSize = readUInt32LE(view, offset + 22);
    if (
      localCrc32 !== expected.crc32 ||
      localCompressedSize !== expected.compressedSize ||
      localUncompressedSize !== expected.uncompressedSize
    ) {
      return err('local header CRC/size fields do not match the central directory entry');
    }
  }
  const dataStart = localNameEnd + localExtraLength;
  const compressedDataEnd = dataStart + expected.compressedSize;
  if (compressedDataEnd > bytes.length) {
    return err('declared entry data runs past the end of the file');
  }
  let dataEnd = compressedDataEnd;
  if ((expected.generalPurposeFlag & DATA_DESCRIPTOR_FLAG) !== 0) {
    const hasSignature =
      compressedDataEnd + 4 + DATA_DESCRIPTOR_FIXED_SIZE <= bytes.length &&
      readUInt32LE(view, compressedDataEnd) === DATA_DESCRIPTOR_SIGNATURE;
    const descriptorStart = compressedDataEnd + (hasSignature ? 4 : 0);
    const descriptorEnd = descriptorStart + DATA_DESCRIPTOR_FIXED_SIZE;
    if (descriptorEnd > bytes.length) {
      return err('data descriptor runs past the end of the file');
    }
    const descriptorCrc32 = readUInt32LE(view, descriptorStart);
    const descriptorCompressedSize = readUInt32LE(view, descriptorStart + 4);
    const descriptorUncompressedSize = readUInt32LE(view, descriptorStart + 8);
    if (
      descriptorCrc32 !== expected.crc32 ||
      descriptorCompressedSize !== expected.compressedSize ||
      descriptorUncompressedSize !== expected.uncompressedSize
    ) {
      return err('data descriptor does not match the central directory entry');
    }
    dataEnd = descriptorEnd;
  }
  return ok({ dataEnd });
}

/**
 * Parse a ZIP's central directory. Returns entry metadata only — no entry
 * content is ever read or decompressed. Fails closed (an `err`) on anything
 * that does not parse as a clean, well-formed central directory: this
 * module is a gate, not a lenient best-effort unzipper.
 */
export function parseZipCentralDirectory(
  bytes: Uint8Array,
  limits: ZipParseLimits,
): Result<readonly ZipEntry[], string> {
  if (bytes.length < EOCD_FIXED_SIZE) return err('too small to be a zip archive');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocd = findEndOfCentralDirectory(bytes, view);
  if (!eocd) return err('no end-of-central-directory record found');
  if (eocd.totalEntries > limits.maxEntries) {
    return err(`entry count ${eocd.totalEntries} exceeds the limit of ${limits.maxEntries}`);
  }
  if (eocd.centralDirectoryOffset > bytes.length) {
    return err('central directory offset is out of bounds');
  }
  // The central directory's declared span must exactly reach the EOCD
  // record that follows it — otherwise the "size" field is either lying
  // about the directory's true extent or bytes have been inserted/removed
  // between the directory and the EOCD record.
  if (eocd.centralDirectoryOffset + eocd.centralDirectorySize !== eocd.eocdOffset) {
    return err('central directory size does not match its actual extent');
  }

  const entries: ZipEntry[] = [];
  // Every entry's [localHeaderOffset, dataEnd) span, collected so overlap
  // between entries can be checked once every span is known (Codex review,
  // PR-B3, round 1, finding on packages/adapters/src/zip-structure.ts):
  // bounding an entry's declared data only against the end of the FILE
  // (the original finding #8 fix) still let a forged entry claim a
  // compressed-data interval that extends through a later local header —
  // each header individually still validated, even though the underlying
  // byte ranges overlapped, which is exactly the "overlapping entries"
  // hostile shape this boundary was always supposed to reject.
  const localSpans: Array<{ readonly start: number; readonly end: number }> = [];
  let cursor = eocd.centralDirectoryOffset;
  const decoder = new TextDecoder('utf-8', { fatal: false });

  for (let i = 0; i < eocd.totalEntries; i++) {
    if (cursor + CENTRAL_HEADER_FIXED_SIZE > bytes.length) {
      return err('central directory entry runs past the end of the file');
    }
    if (readUInt32LE(view, cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      return err(`central directory entry ${i} has an invalid signature`);
    }
    const generalPurposeFlag = readUInt16LE(view, cursor + 8);
    const compressionMethod = readUInt16LE(view, cursor + 10);
    const crc32 = readUInt32LE(view, cursor + 16);
    const compressedSize = readUInt32LE(view, cursor + 20);
    const uncompressedSize = readUInt32LE(view, cursor + 24);
    const nameLength = readUInt16LE(view, cursor + 28);
    const extraLength = readUInt16LE(view, cursor + 30);
    const commentLength = readUInt16LE(view, cursor + 32);
    const localHeaderOffset = readUInt32LE(view, cursor + 42);

    const nameStart = cursor + CENTRAL_HEADER_FIXED_SIZE;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length) return err(`central directory entry ${i} name runs out of bounds`);
    const nameBytes = bytes.subarray(nameStart, nameEnd);
    // Decoded only for display/return purposes (ZipEntry.name, error
    // messages) -- the local/central cross-check below compares nameBytes
    // directly, never this lossy decode (Codex review, PR-B3R,
    // post-final-verification).
    const name = decoder.decode(nameBytes);

    const localHeader = validateLocalFileHeader(bytes, view, localHeaderOffset, {
      nameBytes,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      generalPurposeFlag,
    });
    if (!localHeader.ok) return err(`central directory entry ${i} (${name}): ${localHeader.error}`);
    // Bounding against EOF alone (validateLocalFileHeader's own check)
    // isn't the only boundary that matters: an entry's data must also end
    // no later than where the local-header section itself is declared to
    // end — anything past that is the central directory's own territory.
    if (localHeader.value.dataEnd > eocd.centralDirectoryOffset) {
      return err(
        `central directory entry ${i} (${name}): entry data extends into the central directory`,
      );
    }
    localSpans.push({ start: localHeaderOffset, end: localHeader.value.dataEnd });

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      encrypted: (generalPurposeFlag & 0x1) !== 0,
    });

    cursor = nameEnd + extraLength + commentLength;
  }
  if (cursor !== eocd.eocdOffset) {
    return err('central directory entries do not exactly fill the declared central directory size');
  }

  // Sorted by start, a set of intervals has an overlap somewhere if and
  // only if some ADJACENT pair (in that sort order) overlaps — if entry k
  // doesn't overlap its immediate successor (successor.start >= k.end),
  // no later entry (whose start is >= the successor's, by the sort) can
  // overlap entry k either. One linear pass after an O(n log n) sort is
  // enough to catch any overlapping local-header/data interval, wherever
  // in the file the two entries involved happen to sit.
  localSpans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < localSpans.length; i++) {
    const previous = localSpans[i - 1];
    const current = localSpans[i];
    if (previous && current && current.start < previous.end) {
      return err('local file header/data intervals overlap between entries');
    }
  }

  return ok(entries);
}
