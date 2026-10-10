import { structuralCheck } from '@visastack/adapters';

// Below Vercel's 4.5 MB request ceiling, including request overhead.
export const STREAM_UPLOAD_LIMIT = 4 * 1024 * 1024;
const TYPES = new Set([
  'image/png',
  'image/jpeg',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Admission to private quarantine, never an antivirus verdict. */
export function permitsPdfAdmission(provider: string | undefined): boolean {
  return provider === 'clamav' || provider === 'github_clamav';
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
