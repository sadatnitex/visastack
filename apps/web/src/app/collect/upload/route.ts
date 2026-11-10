import { addGuestFile, isUploadId, loadUploadQuotaConfig } from '@visastack/services';
import { cookies } from 'next/headers';
import { createMalwareScanner } from '../../../lib/providers';
import { createContentLimitsChecker } from '../../../lib/providers-media';
import { withPublicDb } from '../../../lib/public-db';
import { reportServerError } from '../../../lib/server-error';
import { createStorage } from '../../../lib/storage';
import {
  FILE_TOO_LARGE_MESSAGE,
  STREAM_UPLOAD_LIMIT,
  admitsHeicUpload,
  pdfUploadsAccepted,
  prepareUploadBytes,
  readBoundedUpload,
  validateUploadBytes,
} from '../../../lib/upload-preflight';
import { COLLECT_COOKIE, collectSwitchOn, sessionProofFrom } from '../load';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Characters read from `X-File-Name` before the service cleans and caps it further. */
const ORIGINAL_NAME_HEADER_LIMIT = 400;

const json = (message: string, status: number, extra: Record<string, string> = {}) =>
  Response.json(
    { message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        ...extra,
      },
    },
  );

function fileNameHeader(request: Request): string {
  const raw = request.headers.get('x-file-name');
  if (!raw || raw.length > ORIGINAL_NAME_HEADER_LIMIT * 12) return '';
  try {
    return decodeURIComponent(raw).slice(0, ORIGINAL_NAME_HEADER_LIMIT);
  } catch {
    return '';
  }
}

/**
 * A verified guest adds one file to their request (UMPE P9), one file per request, same-origin
 * only, through the desk session in the httpOnly `/collect` cookie (never the link). The same byte
 * checks the vault upload route runs come first (size, type, structure, iPhone photo conversion);
 * the service then stores the file privately, scans it with the configured scanner, checks its
 * page and pixel counts, and proposes the item it fits. The answers match the vault route's, so
 * the same browser queue drives both: 201 kept, 4xx refused with a reason, 429 or 503 not now.
 */
export async function POST(request: Request): Promise<Response> {
  if (!collectSwitchOn()) return json('Not found.', 404);
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return json('Not authorized.', 403);
  }
  const size = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(size) || size < 1 || size > STREAM_UPLOAD_LIMIT || !request.body) {
    return json(FILE_TOO_LARGE_MESSAGE, 413);
  }
  const proof = sessionProofFrom((await cookies()).get(COLLECT_COOKIE)?.value);
  if (!proof) return json('This page has closed. Open the link from your message again.', 403);
  const uploadId = request.headers.get('x-upload-id')?.trim() ?? '';
  if (!isUploadId(uploadId)) return json('Choose the file again.', 400);
  const declaredType = request.headers.get('content-type')?.split(';')[0]?.trim() ?? '';

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedUpload(request.body as ReadableStream<Uint8Array>, size);
  } catch {
    return json('The upload could not be read.', 400);
  }
  const quota = loadUploadQuotaConfig();
  if (
    !admitsHeicUpload(bytes, declaredType) &&
    !validateUploadBytes(bytes, declaredType, pdfUploadsAccepted(), quota.maxUploadBytes)
  ) {
    return json('This file type cannot be safely processed. Choose a PDF, JPG or PNG.', 415);
  }
  // An iPhone photo becomes a new JPEG before anything is stored; the HEIC bytes never are.
  const prepared = await prepareUploadBytes(bytes, declaredType, quota.maxImageMegapixels);
  if (!prepared.ok) return json(prepared.message, 415);
  if (
    !validateUploadBytes(
      prepared.bytes,
      prepared.contentType,
      pdfUploadsAccepted(),
      quota.maxUploadBytes,
    )
  ) {
    return json('This file type cannot be safely processed. Choose a PDF, JPG or PNG.', 415);
  }

  try {
    return await withPublicDb(async (db) => {
      const storage = createStorage(db);
      const scanner = createMalwareScanner(storage, { allowPdf: true });
      const result = await addGuestFile(db, storage, proof, {
        uploadId: uploadId.toLowerCase(),
        contentType: prepared.contentType,
        bytes: prepared.bytes,
        originalName: fileNameHeader(request),
        checks: {
          scanner,
          contentLimits: createContentLimitsChecker(storage),
          // Only the ClamAV scanner looks for viruses; the structural check is never called a scan.
          virusScanner: scanner.name === 'clamav',
        },
      });
      if (!result.ok) {
        const error = result.error;
        if (error.code === 'in_progress') {
          return json(error.message, 503, { 'Retry-After': String(error.retryAfterSeconds) });
        }
        if (error.code === 'rate_limited') {
          return json('Too many files were added just now. Wait a little, then try again.', 429, {
            'Retry-After': '600',
          });
        }
        if (error.code === 'invalid') return json(error.message, 400);
        return json('This page has closed. Open the link from your message again.', 403);
      }
      if (result.value.kind === 'refused') return json(result.value.message, 422);
      return json(result.value.replay ? 'Already added.' : 'Added and checked.', 201);
    });
  } catch (error) {
    reportServerError('guestCollectionUpload', error, { step: 'upload failed' });
    return json('The file could not be added. Try again in a minute.', 500);
  }
}
