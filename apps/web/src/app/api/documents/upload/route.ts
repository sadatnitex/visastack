import { getApplicant, isUploadId } from '@visastack/services';
import type { UpgradeLineKind } from '../../../../components/upgrade-line';
import { withSession } from '../../../../lib/session';
import {
  STREAM_UPLOAD_LIMIT,
  admitsHeicUpload,
  pdfUploadsAccepted,
  readBoundedUpload,
  validateUploadBytes,
} from '../../../../lib/upload-preflight';
import { uploadRetryAfterSeconds } from '../../../../lib/upload-retry-after';
import { guardUploadRoute } from '../../../../lib/upload-route-guard';
import { uploadDocumentAction } from '../../../app/applicant/[id]/actions';

export const runtime = 'nodejs';

/** Characters read from `X-File-Name` before the action cleans and caps it further. */
const ORIGINAL_NAME_HEADER_LIMIT = 400;
/** Seconds a repeat of an upload still being stored waits, when the action did not say. */
const IN_PROGRESS_RETRY_AFTER_SECONDS = 5;
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface AnswerExtras {
  readonly title?: string | undefined;
  readonly upgrade?: UpgradeLineKind | undefined;
  /** LC-C: the new document's id, only when it is an exact copy the uploader may remove again. */
  readonly removableCopyId?: string | undefined;
  /** The new document's id, so the screen after the upload can follow this file by itself. */
  readonly documentId?: string | undefined;
  readonly headers?: Readonly<Record<string, string>>;
}

const json = (message: string, status: number, extras: AnswerExtras = {}) =>
  Response.json(
    {
      message,
      ...(extras.title ? { title: extras.title } : {}),
      ...(extras.upgrade ? { upgrade: extras.upgrade } : {}),
      ...(extras.removableCopyId ? { removableCopyId: extras.removableCopyId } : {}),
      ...(extras.documentId ? { documentId: extras.documentId } : {}),
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extras.headers,
      },
    },
  );

/**
 * A header value sent percent-encoded (so a name in any script survives the trip), or '' when it
 * is missing or not valid encoding.
 */
function encodedHeader(request: Request, name: string, limit = 200): string {
  const raw = request.headers.get(name);
  if (!raw || raw.length > limit * 12) return '';
  try {
    return decodeURIComponent(raw).slice(0, limit);
  } catch {
    return '';
  }
}

/**
 * Authenticated, same-origin raw-body upload, one file per request (the upload form sends each
 * file this way so it can show how far each one has got). Original evidence bytes are never
 * rewritten, except that an iPhone photo (HEIC or HEIF) is stored as a converted JPEG copy, which
 * the upload action records. The kind of document, when chosen, arrives in `X-Document-Kind` and
 * the name of an "Other" kind in `X-Document-Name`; both are checked by the action like a form's.
 */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return json('Not authorized.', 403);
  const size = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(size) || size < 1 || size > STREAM_UPLOAD_LIMIT || !request.body) {
    return json('Choose a file smaller than 4 MB.', 413);
  }
  const applicantId = new URL(request.url).searchParams.get('applicantId');
  if (!applicantId || !/^[a-f0-9-]{36}$/i.test(applicantId))
    return json('Choose a traveller.', 400);
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  // Authenticate before spending memory on the body. Ownership, quota, durable
  // registration, stored-byte verification and job enqueue remain in the action.
  return guardUploadRoute('upload', () =>
    withSession(async ({ db, accountId }) => {
      if ((await getApplicant(db, applicantId))?.ownerAccountId !== accountId)
        return json('Not authorized.', 403);
      let bytes: Uint8Array;
      try {
        bytes = await readBoundedUpload(request.body as ReadableStream<Uint8Array>, size);
      } catch {
        return json('The upload could not be read.', 400);
      }
      const admitted =
        admitsHeicUpload(bytes, contentType) ||
        validateUploadBytes(bytes, contentType, pdfUploadsAccepted());
      if (!admitted) return json('This file type cannot be safely processed.', 415);
      const form = new FormData();
      form.set('applicantId', applicantId);
      form.set('docType', encodedHeader(request, 'x-document-kind'));
      form.set('subject', encodedHeader(request, 'x-document-name'));
      // UMPE P3: the browser's id for this file (the same on every attempt), checked as a UUID, and
      // the file's own name, kept privately on the upload receipt only (the action cleans it).
      const uploadId = request.headers.get('x-upload-id')?.trim() ?? '';
      if (isUploadId(uploadId)) form.set('uploadId', uploadId.toLowerCase());
      const originalFileName = encodedHeader(request, 'x-file-name', ORIGINAL_NAME_HEADER_LIMIT);
      if (originalFileName) form.set('originalFileName', originalFileName);
      // Do not accept a caller-controlled path or header as the stored filename.
      form.set('file', new File([Buffer.from(bytes)], 'document', { type: contentType }));
      const result = await uploadDocumentAction({ ok: false, message: '' }, form);
      // Turned away by the hourly upload limit before anything was stored: a definite "not now",
      // with how long until the window frees, so a batch import waits instead of guessing.
      if (!result.ok && result.refusal === 'rate_limited') {
        return json(result.message, 429, {
          upgrade: result.upgrade,
          headers: { 'Retry-After': String(uploadRetryAfterSeconds()) },
        });
      }
      // The same upload is being stored by another request right now: nothing was stored by this
      // one, so it is a definite "not yet" the browser asks again after.
      if (!result.ok && result.refusal === 'in_progress') {
        return json(result.message, 503, {
          headers: {
            'Retry-After': String(result.retryAfterSeconds ?? IN_PROGRESS_RETRY_AFTER_SECONDS),
          },
        });
      }
      if (!result.ok && result.refusal === 'upload_conflict') return json(result.message, 409);
      if (!result.ok) return json(result.message, 400, { upgrade: result.upgrade });
      return json(result.message, 201, {
        title: result.title,
        removableCopyId: result.removableCopyId,
        documentId: result.documentId,
      });
    }),
  );
}
