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

function readUInt32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}
function readUInt16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
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
 */
function validateLocalFileHeader(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  expected: {
    readonly name: string;
    readonly compressedSize: number;
    readonly uncompressedSize: number;
    readonly generalPurposeFlag: number;
  },
): Result<void, string> {
  if (offset + LOCAL_HEADER_FIXED_SIZE > bytes.length) {
    return err('local header offset is out of bounds');
  }
  if (readUInt32LE(view, offset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    return err('local header offset does not point to a genuine local file header');
  }
  const localNameLength = readUInt16LE(view, offset + 26);
  const localExtraLength = readUInt16LE(view, offset + 28);
  const localNameStart = offset + LOCAL_HEADER_FIXED_SIZE;
  const localNameEnd = localNameStart + localNameLength;
  if (localNameEnd > bytes.length) return err('local header name runs past the end of the file');
  const localName = new TextDecoder('utf-8', { fatal: false }).decode(
    bytes.subarray(localNameStart, localNameEnd),
  );
  if (localName !== expected.name) {
    return err('local header name does not match the central directory entry');
  }
  // Sizes are only meaningful in the local header when the streamed-write
  // (data-descriptor) convention isn't in play — see DATA_DESCRIPTOR_FLAG.
  if ((expected.generalPurposeFlag & DATA_DESCRIPTOR_FLAG) === 0) {
    const localCompressedSize = readUInt32LE(view, offset + 18);
    const localUncompressedSize = readUInt32LE(view, offset + 22);
    if (
      localCompressedSize !== expected.compressedSize ||
      localUncompressedSize !== expected.uncompressedSize
    ) {
      return err('local header size fields do not match the central directory entry');
    }
  }
  const dataStart = localNameEnd + localExtraLength;
  if (dataStart + expected.compressedSize > bytes.length) {
    return err('declared entry data runs past the end of the file');
  }
  return ok(undefined);
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
    const compressedSize = readUInt32LE(view, cursor + 20);
    const uncompressedSize = readUInt32LE(view, cursor + 24);
    const nameLength = readUInt16LE(view, cursor + 28);
    const extraLength = readUInt16LE(view, cursor + 30);
    const commentLength = readUInt16LE(view, cursor + 32);
    const localHeaderOffset = readUInt32LE(view, cursor + 42);

    const nameStart = cursor + CENTRAL_HEADER_FIXED_SIZE;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length) return err(`central directory entry ${i} name runs out of bounds`);
    const name = decoder.decode(bytes.subarray(nameStart, nameEnd));

    const localHeader = validateLocalFileHeader(bytes, view, localHeaderOffset, {
      name,
      compressedSize,
      uncompressedSize,
      generalPurposeFlag,
    });
    if (!localHeader.ok) return err(`central directory entry ${i} (${name}): ${localHeader.error}`);

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

  return ok(entries);
}
