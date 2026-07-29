import type { BlobStore, ScanResult, ScannerPort } from '@visastack/services';

/**
 * Built-in structural safety scanner (ADR-0011).
 *
 * A dependency-free `ScannerPort` for when no antivirus service is wired. It
 * reads the stored bytes and enforces a positive allow-list: the content must
 * either begin with the magic bytes of an expected binary document type
 * (PDF/PNG/JPEG/DOCX), or pass a plain-text heuristic (TXT/MD — these have no
 * magic bytes), and be within the size limit; executables and everything
 * unrecognized are rejected.
 *
 * IMPORTANT: this is NOT antivirus. It stops type-spoofing and obvious
 * executable/malware-shaped uploads, but not signature-based threats. It is
 * paired with the human-approval gate (documents never auto-promote to shared
 * without owner confirmation). Swap in a real ClamAV adapter behind this same
 * port to close the AV gate — no domain changes.
 *
 * DOCX shares its ZIP magic bytes with XLSX/PPTX/generic ZIP archives — a
 * structural scanner can't distinguish them without parsing the archive's
 * central directory, which is out of scope here. The deterministic text
 * extractor (`mammoth`) is the real second check: a mislabeled ZIP fails
 * there with `corrupt_file`/`parser_error` rather than silently succeeding.
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

const MAGIC_ALLOW: ReadonlyArray<{ readonly label: string; readonly bytes: readonly number[] }> = [
  { label: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { label: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { label: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { label: 'docx (zip)', bytes: [0x50, 0x4b, 0x03, 0x04] }, // PK\x03\x04
];

const MAGIC_DENY: ReadonlyArray<{ readonly label: string; readonly bytes: readonly number[] }> = [
  { label: 'dos/pe executable', bytes: [0x4d, 0x5a] }, // MZ
  { label: 'elf executable', bytes: [0x7f, 0x45, 0x4c, 0x46] }, // \x7FELF
  { label: 'mach-o executable', bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { label: 'shell script', bytes: [0x23, 0x21] }, // #!
];

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

export class BasicSafetyScanner implements ScannerPort {
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
    for (const allow of MAGIC_ALLOW) {
      if (startsWith(bytes, allow.bytes)) return { safe: true, detail: allow.label };
    }
    if (PLAIN_TEXT_CONTENT_TYPES.has(object.contentType) && looksLikePlainText(bytes)) {
      return { safe: true, detail: 'text' };
    }
    return { safe: false, detail: 'unrecognized file type' };
  }
}
