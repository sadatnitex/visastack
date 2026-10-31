import {
  HeicConversionError,
  type HeicConversionFailure,
  HeicJpegConverter,
  looksLikeHeic,
  structuralCheck,
} from '@visastack/adapters';
import { readEnv } from './env';
import { STORED_UPLOAD_TYPES, isHeicType } from './upload-rules';

// Below Vercel's 4.5 MB request ceiling, including request overhead.
export const STREAM_UPLOAD_LIMIT = 4 * 1024 * 1024;

/**
 * The size one file may be, as the upload form says it and checks it: the account's per-file
 * quota, but never more than one request to the host can carry, since each file is sent alone.
 */
export function uploadLimitBytes(quota: { readonly maxUploadBytes: number }): number {
  return Math.min(quota.maxUploadBytes, STREAM_UPLOAD_LIMIT);
}
/** The types stored as they are: the same list the upload form checks (upload-rules.ts). */
const TYPES: ReadonlySet<string> = new Set(STORED_UPLOAD_TYPES);

/**
 * Admission to private quarantine, never an antivirus verdict. PDFs are admitted with the built-in
 * checks too (owner decision, ADR 0024): the scan record says their content is unverified until a
 * real scanner is switched on. An unrecognized provider name is not a reason to admit.
 */
export function permitsPdfAdmission(provider: string | undefined): boolean {
  return (
    provider === undefined ||
    provider === '' ||
    provider === 'builtin' ||
    provider === 'clamav' ||
    provider === 'github_clamav'
  );
}

/**
 * Whether PDF files can be added in this deployment. `PDF_UPLOADS=off` is the owner's kill switch.
 * The one place the upload form, the upload route and the upload action ask.
 */
export function pdfUploadsAccepted(): boolean {
  return (
    readEnv('PDF_UPLOADS') !== 'off' && permitsPdfAdmission(readEnv('MALWARE_SCANNER_PROVIDER'))
  );
}

export function validateUploadBytes(
  bytes: Uint8Array,
  contentType: string,
  allowPdf: boolean,
  maxBytes = STREAM_UPLOAD_LIMIT,
): boolean {
  if (!TYPES.has(contentType)) return false;
  const result = structuralCheck(bytes, contentType, { maxBytes, allowPdf });
  if (!result.accepted) return false;
  const prefix = Buffer.from(bytes.subarray(0, 8));
  if (contentType === 'image/png')
    return prefix.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/jpeg')
    return prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255;
  if (contentType === 'application/pdf') return prefix.subarray(0, 5).toString() === '%PDF-';
  if (contentType.endsWith('wordprocessingml.document')) {
    return prefix[0] === 80 && prefix[1] === 75 && prefix[2] === 3 && prefix[3] === 4;
  }
  // Text declarations must not disguise a magic-byte binary document.
  return result.detail === 'text';
}

/** Consume a request stream with a hard actual-byte limit, including chunked bodies. */
export async function readBoundedUpload(
  stream: ReadableStream<Uint8Array>,
  size: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(size) || size < 1 || size > STREAM_UPLOAD_LIMIT) {
    throw new Error('invalid upload size');
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > size || total > STREAM_UPLOAD_LIMIT) throw new Error('upload size exceeded');
      chunks.push(chunk.value);
    }
    if (total !== size) throw new Error('upload length mismatch');
    return Buffer.concat(chunks, total);
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new Error('upload stream rejected');
  } finally {
    reader.releaseLock();
  }
}

/**
 * The raw-body route's first look at an iPhone photo: declared as HEIC or HEIF and starting like
 * one. The full check is the conversion itself, which runs in the upload action.
 */
export function admitsHeicUpload(bytes: Uint8Array, contentType: string): boolean {
  return isHeicType(contentType) && looksLikeHeic(bytes);
}

export type PreparedUpload =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly contentType: string;
      /** Set when the stored file is a converted copy, not the bytes that were sent. */
      readonly convertedFrom: 'HEIC' | null;
    }
  | { readonly ok: false; readonly message: string; readonly reason: string };

const HEIC_FAILURE_MESSAGES: Readonly<Record<HeicConversionFailure, string>> = {
  not_heic: 'This file does not look like an iPhone photo. Choose a JPG or PNG copy instead.',
  unreadable: 'We could not read this iPhone photo. Choose a JPG or PNG copy instead.',
  too_large: 'This photo has too many pixels to add. Choose a smaller copy.',
  too_slow: 'This photo took too long to prepare. Try again, or choose a JPG or PNG copy.',
  unavailable: 'iPhone photos cannot be added right now. Choose a JPG or PNG copy instead.',
};

let converter: HeicJpegConverter | undefined;

/**
 * Turn an iPhone photo (HEIC or HEIF) into a new JPEG before anything is stored; every other
 * file passes through unchanged. A file declared as HEIC must be one, and a file sent with no
 * type that turns out to be one is converted too. The original HEIC bytes are never stored.
 */
export async function prepareUploadBytes(
  bytes: Uint8Array,
  declaredType: string,
  maxImageMegapixels: number,
): Promise<PreparedUpload> {
  const untyped = declaredType === '' || declaredType === 'application/octet-stream';
  const heic = isHeicType(declaredType) || (untyped && looksLikeHeic(bytes));
  if (!heic) return { ok: true, bytes, contentType: declaredType, convertedFrom: null };
  converter ??= new HeicJpegConverter();
  try {
    const converted = await converter.convert({
      bytes,
      maxInputPixels: maxImageMegapixels * 1_000_000,
    });
    return { ok: true, bytes: converted.bytes, contentType: 'image/jpeg', convertedFrom: 'HEIC' };
  } catch (error) {
    const reason = error instanceof HeicConversionError ? error.reason : 'unreadable';
    return { ok: false, message: HEIC_FAILURE_MESSAGES[reason], reason: `heic ${reason}` };
  }
}
