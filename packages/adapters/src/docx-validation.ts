import { parseZipCentralDirectory } from './zip-structure';

/**
 * Bounded DOCX structural validation (master directive §7 "PR 3").
 *
 * DOCX, XLSX, PPTX, and a plain ZIP archive all share the same magic bytes
 * (`PK\x03\x04`) — a magic-byte check alone cannot tell them apart, so
 * `scanner.ts` previously labelled ANY zip-shaped upload "docx" without
 * looking inside it at all. This module is the real second check: it reads
 * the ZIP central directory (structure only, never decompressing entry
 * content — see `zip-structure.ts`) and requires the OOXML Word-document
 * shape specifically, rejecting anything else as unsafe/uncertain.
 *
 * Archive-level byte size is bounded upstream by the scanner's general
 * `maxBytes` check before this ever runs, so it is not duplicated here;
 * this module instead bounds what the byte-size check cannot see —
 * declared per-entry/aggregate uncompressed size and compression ratio —
 * since those are what a zip bomb actually games.
 */

const MAX_ENTRIES = 512;
/** Generous for a legitimate DOCX (even with many embedded images), tight enough to reject a bomb. */
const MAX_ENTRY_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_AGGREGATE_UNCOMPRESSED_BYTES = 300 * 1024 * 1024;
/** A well-formed XML/text part rarely compresses better than ~20:1; classic zip-bomb ratios are 1000:1+. */
const MAX_COMPRESSION_RATIO = 100;

const REQUIRED_ENTRIES = ['[Content_Types].xml', 'word/document.xml'];
/** Presence of either means this is actually XLSX/PPTX, not a Word document. */
const OTHER_OOXML_MARKERS = ['xl/workbook.xml', 'ppt/presentation.xml'];
/** The macro project stream — its presence means a macro-enabled document (.docm shape). */
const MACRO_MARKER = 'word/vbaproject.bin';

export interface DocxValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

function isPathTraversal(name: string): boolean {
  if (name.startsWith('/') || name.startsWith('\\')) return true;
  if (/^[a-zA-Z]:/.test(name)) return true; // Windows drive-letter absolute path.
  return name.split(/[/\\]/).some((segment) => segment === '..');
}

/**
 * True only for a well-formed, bounded, non-macro, non-encrypted Word
 * (.docx) archive. Any structural uncertainty fails closed (`valid: false`)
 * — this function never guesses.
 */
export function validateDocxStructure(bytes: Uint8Array): DocxValidationResult {
  const parsed = parseZipCentralDirectory(bytes, { maxEntries: MAX_ENTRIES });
  if (!parsed.ok) return { valid: false, reason: `not a valid zip structure: ${parsed.error}` };
  const entries = parsed.value;

  let aggregateUncompressed = 0;
  for (const entry of entries) {
    if (isPathTraversal(entry.name)) {
      return { valid: false, reason: `path traversal in entry name: ${entry.name}` };
    }
    if (entry.encrypted) {
      return { valid: false, reason: `encrypted entry: ${entry.name}` };
    }
    if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      return { valid: false, reason: `entry exceeds the per-entry size limit: ${entry.name}` };
    }
    if (entry.compressedSize > 0) {
      const ratio = entry.uncompressedSize / entry.compressedSize;
      if (ratio > MAX_COMPRESSION_RATIO) {
        return { valid: false, reason: `entry exceeds the compression-ratio limit: ${entry.name}` };
      }
    }
    aggregateUncompressed += entry.uncompressedSize;
    if (aggregateUncompressed > MAX_AGGREGATE_UNCOMPRESSED_BYTES) {
      return { valid: false, reason: 'aggregate uncompressed size exceeds the archive limit' };
    }
  }

  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  if (OTHER_OOXML_MARKERS.some((marker) => names.has(marker))) {
    return { valid: false, reason: 'archive is XLSX/PPTX, not a Word document' };
  }
  if (names.has(MACRO_MARKER)) {
    return {
      valid: false,
      reason: 'macro-enabled documents are not accepted in the controlled pilot',
    };
  }
  const missingRequired = REQUIRED_ENTRIES.filter((required) => !names.has(required.toLowerCase()));
  if (missingRequired.length > 0) {
    return { valid: false, reason: 'archive is not a Word document (generic zip or corrupt DOCX)' };
  }

  return { valid: true };
}
