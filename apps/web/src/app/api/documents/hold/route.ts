import {
  accountPrincipal,
  holdFamilyFile,
  isUploadId,
  loadUploadQuotaConfig,
  requireAccess,
} from '@visastack/services';
import {
  createContentLimitsChecker,
  createDocumentConverter,
  createKeyManagementPort,
  createMalwareScanner,
} from '../../../../lib/providers';
import { isRecordId } from '../../../../lib/record-id';
import { withSession } from '../../../../lib/session';
import { createStorage } from '../../../../lib/storage';
import {
  STREAM_UPLOAD_LIMIT,
  admitsHeicUpload,
  pdfUploadsAccepted,
  prepareUploadBytes,
  readBoundedUpload,
  validateUploadBytes,
} from '../../../../lib/upload-preflight';
import { uploadRetryAfterSeconds } from '../../../../lib/upload-retry-after';
import { storedFileName } from '../../../../lib/upload-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Characters read from `X-File-Name` before the service cleans and caps it further. */
const ORIGINAL_NAME_HEADER_LIMIT = 400;

const json = (
  message: string,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
) =>
  Response.json(
    { message, ...(status === 201 ? { title: 'Waiting for Which Person?' } : {}) },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extraHeaders,
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
 * UMPE G1 (ledger I09): one file of a family batch, sent the way the upload route sends one file.
 * The same byte checks run first (size, type, structure, iPhone photo conversion). The file is then
 * held for the signed-in account only, scanned and checked before it is read, and filed under
 * nobody until the account's Which Person? decision. The page's own person is checked as the
 * account's (owner only); that person is not where the file goes.
 */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return json('Not authorized.', 403);
  }
  const size = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(size) || size < 1 || size > STREAM_UPLOAD_LIMIT || !request.body) {
    return json('Choose a file smaller than 4 MB.', 413);
  }
  const applicantId = new URL(request.url).searchParams.get('applicantId') ?? '';
  if (!isRecordId(applicantId)) return json('Choose a traveller.', 400);
  const uploadId = request.headers.get('x-upload-id')?.trim().toLowerCase() ?? '';
  if (!isUploadId(uploadId)) return json('Choose the file again.', 400);
  const declaredType = request.headers.get('content-type')?.split(';')[0]?.trim() ?? '';

  // No try/catch here: the sign-in redirect thrown by withSession must reach Next as it is.
  return withSession(async ({ db, accountId }) => {
    // Authenticated and checked before any memory is spent on the body.
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { applicantId },
      { purpose: 'owner_family_batch' },
    );
    if (!access.ok) return json('Not authorized.', 403);
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
      return json('This file type cannot be safely processed.', 415);
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
      return json('This file type cannot be safely processed.', 415);
    }
    const originalFileName = fileNameHeader(request);
    const storage = createStorage(db);
    const scanner = createMalwareScanner(storage, { allowPdf: true });
    const encryption = createKeyManagementPort();
    const outcome = await holdFamilyFile(
      access.value,
      {
        storage,
        checks: {
          scanner,
          contentLimits: createContentLimitsChecker(storage),
          // Only the ClamAV scanner looks for viruses; the structural check is never called a scan.
          virusScanner: scanner.name === 'clamav',
        },
        converter: createDocumentConverter(storage),
        ...(encryption ? { encryption } : {}),
      },
      {
        uploadId,
        originalFileName,
        bytes: prepared.bytes,
        contentType: prepared.contentType,
        // The same stored name an ordinary upload gets, with the extension of what is stored.
        storedFileName: storedFileName(originalFileName || 'document', prepared.contentType),
        convertedFromHeic: prepared.convertedFrom === 'HEIC',
      },
    );
    switch (outcome.kind) {
      case 'held':
        return json(
          outcome.replay
            ? 'Already added. It waits in Needs One Decision for Which Person?.'
            : 'Added. It waits in Needs One Decision until you choose who it belongs to.',
          201,
        );
      case 'in_progress':
        return json('This file is still being added. Try again in a minute or two.', 503, {
          'Retry-After': String(outcome.retryAfterSeconds),
        });
      case 'refused':
        if (outcome.reason === 'rate_limited') {
          return json(outcome.message, 429, { 'Retry-After': String(uploadRetryAfterSeconds()) });
        }
        if (outcome.reason === 'unavailable') return json(outcome.message, 409);
        return json(outcome.message, outcome.reason === 'unsafe' ? 422 : 400);
    }
  });
}
