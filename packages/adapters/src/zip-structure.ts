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
const EOCD_FIXED_SIZE = 22;
const CENTRAL_HEADER_FIXED_SIZE = 46;
/** ZIP comment length is a 16-bit field — this is the true maximum possible EOCD search window. */
const MAX_COMMENT_LENGTH = 0xffff;

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
): { readonly totalEntries: number; readonly centralDirectoryOffset: number } | undefined {
  const searchStart = Math.max(0, bytes.length - EOCD_FIXED_SIZE - MAX_COMMENT_LENGTH);
  for (let i = bytes.length - EOCD_FIXED_SIZE; i >= searchStart; i--) {
    if (readUInt32LE(view, i) !== EOCD_SIGNATURE) continue;
    const commentLength = readUInt16LE(view, i + 20);
    // A real EOCD's comment must reach exactly to the end of the file — a
    // signature-byte coincidence inside file data would fail this check.
    if (i + EOCD_FIXED_SIZE + commentLength !== bytes.length) continue;
    return {
      totalEntries: readUInt16LE(view, i + 10),
      centralDirectoryOffset: readUInt32LE(view, i + 16),
    };
  }
  return undefined;
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

    const nameStart = cursor + CENTRAL_HEADER_FIXED_SIZE;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length) return err(`central directory entry ${i} name runs out of bounds`);
    const name = decoder.decode(bytes.subarray(nameStart, nameEnd));

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      encrypted: (generalPurposeFlag & 0x1) !== 0,
    });

    cursor = nameEnd + extraLength + commentLength;
  }

  return ok(entries);
}
