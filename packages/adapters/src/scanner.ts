import { inflateSync } from 'node:zlib';
import type { BlobStore, MalwareScannerPort, ScanResult } from '@visastack/services';
import { validateDocxStructure } from './docx-validation';

/**
 * Built-in structural safety scanner (ADR-0011).
 *
 * A dependency-free `MalwareScannerPort` for when no antivirus service is wired. It
 * reads the stored bytes and enforces a positive allow-list: the content must
 * either begin with the magic bytes of an expected binary document type
 * (PDF/PNG/JPEG/DOCX — DOCX additionally passing real structural validation,
 * PDF additionally screened for active-content markers; see below), or pass
 * a plain-text heuristic (TXT/MD — these have no magic bytes), and be within
 * the size limit; executables and everything unrecognized are rejected.
 *
 * IMPORTANT: this is NOT antivirus. It stops type-spoofing, structurally
 * invalid/hostile-shaped documents, and obvious executable/malware-shaped
 * uploads, but not signature-based threats. It is paired with the human-
 * approval gate (documents never auto-promote to shared without owner
 * confirmation). Swap in a real ClamAV adapter behind this same port to
 * close the AV gate — no domain changes.
 *
 * DOCX shares its ZIP magic bytes with XLSX/PPTX/generic ZIP archives, so a
 * magic-byte match alone is never sufficient — `validateDocxStructure`
 * (`docx-validation.ts`) reads the ZIP central directory to confirm the real
 * OOXML Word-document shape (and reject macro-enabled/encrypted/oversized/
 * zip-bomb-shaped/path-traversing archives) before this scanner calls a
 * zip-shaped upload safe. `mammoth` (`text-extraction.ts`) remains a second,
 * independent check at extraction time.
 *
 * SECURITY: the plain-text path is deliberately gated to the exact declared
 * content types the upload UI/extraction layer support (`text/plain`,
 * `text/markdown`) — NOT "anything that decodes as clean UTF-8". HTML and
 * SVG source are both ordinary UTF-8 text with no control characters, so a
 * heuristic that accepted any such content would let a caller who bypasses
 * the file picker (a raw Server Action call) mark `text/html`/`image/svg+xml`
 * content "safe", which `/api/blob/[key]` would later serve inline under the
 * app's own origin — a stored-XSS vector via SVG script execution or
 * HTML-sniffing. Gating on the declared type closes that: an upload
 * declaring `text/html` is rejected here regardless of its byte content.
 */

const SCANNER_NAME = 'basic-structural-scanner';
const SCANNER_VERSION = '2.0.0';

const PDF_MAGIC: readonly number[] = [0x25, 0x50, 0x44, 0x46]; // %PDF
const DOCX_ZIP_MAGIC: readonly number[] = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

// PDF and DOCX get their own structural checks below (magic bytes alone are
// not sufficient for either); everything else here is magic-byte-only.
const MAGIC_ALLOW: ReadonlyArray<{ readonly label: string; readonly bytes: readonly number[] }> = [
  { label: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { label: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
];

const MAGIC_DENY: ReadonlyArray<{ readonly label: string; readonly bytes: readonly number[] }> = [
  { label: 'dos/pe executable', bytes: [0x4d, 0x5a] }, // MZ
  { label: 'elf executable', bytes: [0x7f, 0x45, 0x4c, 0x46] }, // \x7FELF
  { label: 'mach-o executable', bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { label: 'shell script', bytes: [0x23, 0x21] }, // #!
];

/**
 * Object-dictionary keys a PDF uses to run embedded JavaScript, auto-launch
 * an external action on open/close, or carry an embedded file. A byte-level
 * substring heuristic, not a real PDF object parse — bounded, cheap, and
 * deliberately conservative (a real applicant document essentially never
 * contains these); paired with `unpdf`'s independent parse at extraction
 * time. Full sanitization (CDR) is tracked, not implemented here.
 * `/AA` (Additional Actions) added alongside `/OpenAction` (Codex review,
 * PR-B3, finding #9) — the same risk category, triggered by other document
 * events (page open/close, focus, etc.) rather than just document-open.
 */
const ACTIVE_PDF_CONTENT_MARKERS: readonly string[] = [
  '/JavaScript',
  '/JS',
  '/OpenAction',
  '/AA',
  '/Launch',
  '/EmbeddedFile',
];

/**
 * PDF "name object" syntax lets any byte be written as `#XX` (2 hex
 * digits) instead of literally — a legitimate escape for names containing
 * special characters, but also a trivial way to spell `/Open#41ction`
 * instead of `/OpenAction` and slip past a plain substring search entirely
 * (Codex review, PR-B3, finding #9). Decoding every `#XX` occurrence before
 * matching closes this — unescaping can only ever reveal a marker that a
 * plain search would otherwise miss, never hide one that's already there in
 * plain text.
 */
function decodePdfNameEscapes(text: string): string {
  return text.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function findActiveMarkerIn(text: string): string | undefined {
  const unescaped = decodePdfNameEscapes(text);
  return ACTIVE_PDF_CONTENT_MARKERS.find((marker) => unescaped.includes(marker));
}

const MAX_STREAMS_SCANNED = 200;
/** Generous for any legitimate compressed object/content stream, tight enough to bound a decompression-bomb attempt. */
const MAX_STREAM_INFLATED_BYTES = 10 * 1024 * 1024;
/** How far back from `stream` to look for its dictionary's `/Filter` entry — generous for a real per-object dictionary. */
const FILTER_LOOKBACK_BYTES = 2000;

/**
 * Best-effort extraction of `FlateDecode` stream bodies for the same bounded,
 * dependency-free scan (Codex review, PR-B3, finding #9) — a PDF can hide an
 * entire compressed *object stream* (`/Type /ObjStm`) whose decompressed
 * content is itself PDF syntax (indirect objects, name-keyed dictionaries,
 * possibly `/OpenAction` etc.), which never appears as a matchable literal
 * substring anywhere in the raw file bytes.
 *
 * Not a real PDF parser: locates `stream`/`endstream` keyword pairs
 * directly rather than resolving `/Length` (which is frequently an
 * indirect object reference a bounded scanner can't safely chase), and
 * looks for `/Filter ... FlateDecode` in a bounded window immediately
 * before `stream` rather than fully parsing the dictionary. Deliberately
 * conservative in the other direction too: a stream that declares
 * FlateDecode but fails to actually inflate is reported as undecodable,
 * never silently treated as "not compressed, therefore nothing to find."
 */
function extractFlateStreams(text: string): {
  readonly decoded: readonly string[];
  readonly undecodable: boolean;
} {
  const decoded: string[] = [];
  let undecodable = false;
  let cursor = 0;
  for (let scanned = 0; scanned < MAX_STREAMS_SCANNED; scanned++) {
    const relativeMatch = /stream\r?\n/.exec(text.slice(cursor));
    if (!relativeMatch) break;
    const streamKeywordStart = cursor + relativeMatch.index;
    const dataStart = streamKeywordStart + relativeMatch[0].length;
    const endIndex = text.indexOf('endstream', dataStart);
    if (endIndex === -1) break;

    const dictWindow = text.slice(
      Math.max(0, streamKeywordStart - FILTER_LOOKBACK_BYTES),
      streamKeywordStart,
    );
    const declaresFlate = /\/Filter\s*(\/FlateDecode\b|\[[^\]]*\/FlateDecode\b[^\]]*\])/.test(
      dictWindow,
    );
    if (declaresFlate) {
      // A trailing EOL before "endstream" is formatting, not stream data.
      const raw = text.slice(dataStart, endIndex).replace(/\r?\n$/, '');
      try {
        const inflated = inflateSync(Buffer.from(raw, 'latin1'), {
          maxOutputLength: MAX_STREAM_INFLATED_BYTES,
        });
        decoded.push(inflated.toString('latin1'));
      } catch {
        undecodable = true;
      }
    }
    cursor = endIndex + 'endstream'.length;
  }
  return { decoded, undecodable };
}

type PdfContentCheck =
  | { readonly kind: 'clean' }
  | { readonly kind: 'active-marker'; readonly marker: string }
  | { readonly kind: 'undecidable' };

function checkPdfContent(bytes: Uint8Array): PdfContentCheck {
  // latin1 is byte-transparent (1 char <-> 1 byte) — exactly what a raw
  // marker search over binary PDF bytes needs, with no UTF-8 decode risk.
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const directMarker = findActiveMarkerIn(text);
  if (directMarker) return { kind: 'active-marker', marker: directMarker };

  const { decoded, undecodable } = extractFlateStreams(text);
  for (const streamText of decoded) {
    const marker = findActiveMarkerIn(streamText);
    if (marker) return { kind: 'active-marker', marker };
  }
  if (undecodable) return { kind: 'undecidable' };
  return { kind: 'clean' };
}

/** Declared content types the plain-text path accepts — nothing else, regardless of byte shape. */
const PLAIN_TEXT_CONTENT_TYPES: ReadonlySet<string> = new Set(['text/plain', 'text/markdown']);

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Plain-text heuristic for TXT/MD (no magic bytes exist for them): the file
 * must decode as strict, well-formed UTF-8 with no NUL bytes and no control
 * characters other than tab/newline/carriage-return. This is the same
 * "reject anything binary-shaped" posture as the magic-byte deny list, just
 * applied to content that has no header signature to check instead.
 *
 * Decodes the WHOLE (already size-bounded) byte array rather than an
 * arbitrary sample — decoding a fixed-length prefix can split a multi-byte
 * UTF-8 sequence at the boundary and reject a perfectly valid file.
 */
function looksLikePlainText(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isControl = code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    if (isControl || code === 0x7f) return false;
  }
  return true;
}

export interface BasicSafetyScannerOptions {
  readonly blobStore: BlobStore;
  /** Reject anything larger than this many bytes (default 25 MiB). */
  readonly maxBytes?: number;
}

export class BasicSafetyScanner implements MalwareScannerPort {
  readonly name = SCANNER_NAME;
  readonly version = SCANNER_VERSION;
  private readonly blobStore: BlobStore;
  private readonly maxBytes: number;

  constructor(options: BasicSafetyScannerOptions) {
    this.blobStore = options.blobStore;
    this.maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
  }

  async scan(input: { bucket: 'QUARANTINE' | 'CLEAN'; objectKey: string }): Promise<ScanResult> {
    const object = await this.blobStore.getObject(input.objectKey);
    if (!object) return { safe: false, detail: 'object bytes not found' };
    const { bytes } = object;

    if (bytes.byteLength === 0) return { safe: false, detail: 'empty file' };
    if (bytes.byteLength > this.maxBytes) return { safe: false, detail: 'file exceeds size limit' };

    for (const deny of MAGIC_DENY) {
      if (startsWith(bytes, deny.bytes)) {
        return { safe: false, detail: `rejected: ${deny.label}` };
      }
    }

    if (startsWith(bytes, PDF_MAGIC)) {
      const check = checkPdfContent(bytes);
      if (check.kind === 'active-marker') {
        return { safe: false, detail: `rejected: active PDF content (${check.marker})` };
      }
      if (check.kind === 'undecidable') {
        return {
          safe: false,
          detail: 'rejected: pdf contains an encoded stream that could not be verified clean',
        };
      }
      return { safe: true, detail: 'pdf' };
    }

    if (startsWith(bytes, DOCX_ZIP_MAGIC)) {
      const structure = validateDocxStructure(bytes);
      if (!structure.valid) {
        return { safe: false, detail: `rejected: invalid docx structure (${structure.reason})` };
      }
      return { safe: true, detail: 'docx (zip)' };
    }

    for (const allow of MAGIC_ALLOW) {
      if (startsWith(bytes, allow.bytes)) return { safe: true, detail: allow.label };
    }
    if (PLAIN_TEXT_CONTENT_TYPES.has(object.contentType) && looksLikePlainText(bytes)) {
      return { safe: true, detail: 'text' };
    }
    return { safe: false, detail: 'unrecognized file type' };
  }
}
